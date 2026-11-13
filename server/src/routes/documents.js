import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { UPLOAD_DIR } from '../config.js';
import { HttpError, ah, clientIp, text } from '../helpers.js';

export const documentRouter = express.Router();

const ALLOWED_MIME = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      cb(new HttpError(400, '仅支持 PDF / Office / ZIP / 文本 / 图片格式的资料'));
      return;
    }
    cb(null, true);
  },
});

const mapDocument = (row) => ({
  id: row.id,
  title: row.title,
  category: row.category,
  description: row.description || '',
  tags: row.tags || '',
  originalName: row.original_name,
  mime: row.mime,
  size: row.size,
  visibility: row.visibility,
  uploaderName: row.uploader_name || '',
  createdAt: row.created_at,
});

const DOC_SELECT = `SELECT d.*, u.display_name AS uploader_name
                    FROM documents d JOIN users u ON u.id = d.uploader_id`;

documentRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `${DOC_SELECT} WHERE d.deleted_at IS NULL`;
    if (req.query.category) {
      sql += ' AND d.category = ?';
      params.push(String(req.query.category));
    }
    if (req.query.q) {
      sql += ' AND (d.title LIKE ? OR d.description LIKE ? OR d.tags LIKE ? OR d.original_name LIKE ?)';
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like, like);
    }
    if (!hasPerm(req.user, 'doc')) sql += " AND d.visibility = 'all'";
    sql += ' ORDER BY d.created_at DESC LIMIT 200';
    const items = db.prepare(sql).all(...params).map(mapDocument);
    const categories = db
      .prepare('SELECT category, COUNT(*) AS count FROM documents WHERE deleted_at IS NULL GROUP BY category ORDER BY category')
      .all();
    res.json({ items, categories });
  }),
);

documentRouter.post(
  '/',
  requireAuth,
  requirePerm('doc'),
  upload.array('files', 5),
  ah((req, res) => {
    const files = req.files || [];
    if (files.length === 0) throw new HttpError(400, '请选择要归档的文件');
    const category = text(req.body?.category, { field: '资料分类', max: 40 }) || '其他';
    const description = text(req.body?.description, { field: '资料说明', max: 500 });
    const tags = text(req.body?.tags, { field: '标签', max: 100 });
    const visibility = req.body?.visibility === 'admin' ? 'admin' : 'all';
    const now = nowIso();

    const cleanup = () => {
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(UPLOAD_DIR, file.filename));
        } catch {
          /* ignore */
        }
      }
    };

    try {
      const created = tx(() => {
        const insert = db.prepare(
          `INSERT INTO documents
             (title, category, description, tags, original_name, stored_name, mime, size, sha256,
              visibility, uploader_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        return files.map((file) => {
          const title = text(req.body?.title, { field: '资料标题', max: 120 }) || file.originalname;
          const buffer = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const result = insert.run(
            title,
            category,
            description,
            tags,
            file.originalname,
            file.filename,
            file.mimetype,
            file.size,
            sha256,
            visibility,
            req.user.id,
            now,
          );
          return Number(result.lastInsertRowid);
        });
      });
      created.forEach((id) => {
        audit({
          actor: req.user,
          action: 'document.upload',
          entityType: 'document',
          entityId: id,
          detail: { category, visibility },
          ip: clientIp(req),
          userAgent: req.headers['user-agent'],
        });
      });
      const placeholders = created.map(() => '?').join(',');
      const items = db
        .prepare(`${DOC_SELECT} WHERE d.id IN (${placeholders})`)
        .all(...created)
        .map(mapDocument);
      res.status(201).json({ items });
    } catch (error) {
      cleanup();
      throw error;
    }
  }),
);

documentRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('doc'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '资料不存在');
    const title = req.body?.title === undefined ? target.title : text(req.body.title, { field: '资料标题', required: true, max: 120 });
    const category = req.body?.category === undefined ? target.category : text(req.body.category, { field: '资料分类', max: 40 }) || '其他';
    const description =
      req.body?.description === undefined ? target.description : text(req.body.description, { field: '资料说明', max: 500 });
    const tags = req.body?.tags === undefined ? target.tags : text(req.body.tags, { field: '标签', max: 100 });
    const visibility = req.body?.visibility === undefined ? target.visibility : req.body.visibility === 'admin' ? 'admin' : 'all';
    tx(() => {
      db.prepare(
        'UPDATE documents SET title = ?, category = ?, description = ?, tags = ?, visibility = ? WHERE id = ?',
      ).run(title, category, description, tags, visibility, target.id);
      audit({
        actor: req.user,
        action: 'document.update',
        entityType: 'document',
        entityId: target.id,
        detail: { title, category, visibility },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapDocument(db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(target.id)) });
  }),
);

documentRouter.delete(
  '/:id',
  requireAuth,
  requirePerm('doc'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '资料不存在');
    tx(() => {
      db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(nowIso(), target.id);
      audit({
        actor: req.user,
        action: 'document.delete',
        entityType: 'document',
        entityId: target.id,
        detail: { title: target.title },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.status(204).end();
  }),
);

documentRouter.get(
  '/:id/download',
  requireAuth,
  ah((req, res) => {
    const row = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
    if (!row) throw new HttpError(404, '资料不存在');
    if (row.visibility === 'admin' && !hasPerm(req.user, 'doc')) throw new HttpError(403, '没有权限下载该资料');
    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    if (!fs.existsSync(filePath)) throw new HttpError(404, '资料文件丢失');
    if (req.query.download === '1') {
      audit({
        actor: req.user,
        action: 'document.download',
        entityType: 'document',
        entityId: row.id,
        detail: { title: row.title },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    }
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    );
    fs.createReadStream(filePath).pipe(res);
  }),
);
