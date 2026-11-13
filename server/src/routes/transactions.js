import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { UPLOAD_DIR } from '../config.js';
import { HttpError, ah, clientIp, pageParams, parseAmountCents, parseDateOnly, text } from '../helpers.js';
import { getTransaction, mapTransaction, queryTransactions } from '../ledger.js';

export const transactionRouter = express.Router();

const canRecord = (user, type) => {
  if (user.role === 'admin') return true;
  if (!hasPerm(user, 'finance')) return false;
  return type === 'income' ? !!user.can_income : !!user.can_expense;
};

const canEdit = (user, record) => {
  if (user.role === 'admin') return true;
  if (!hasPerm(user, 'finance')) return false;
  return record.operator_id === user.id && canRecord(user, record.type);
};

function normalizeCategory(categoryId, type) {
  if (categoryId === null || categoryId === undefined || categoryId === '') return null;
  const id = Number.parseInt(categoryId, 10);
  if (!Number.isFinite(id)) throw new HttpError(400, '分类不正确');
  const category = db.prepare('SELECT id, type, archived FROM categories WHERE id = ?').get(id);
  if (!category) throw new HttpError(400, '分类不存在');
  if (category.archived) throw new HttpError(400, '该分类已停用');
  if (category.type !== type) throw new HttpError(400, '分类类型与收支类型不匹配');
  return id;
}

function readTxPayload(body) {
  const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
  if (!type) throw new HttpError(400, '请选择收入或支出');
  const amountCents = parseAmountCents(body.amount);
  const reason = text(body.reason, { field: '收支原因', required: true, max: 200 });
  const occurredAt = parseDateOnly(body.occurredAt, '收支日期');
  const categoryId = normalizeCategory(body.categoryId, type);
  const counterparty = text(body.counterparty, { field: '对方', max: 60 });
  const note = text(body.note, { field: '备注', max: 500 });
  return { type, amountCents, reason, occurredAt, categoryId, counterparty, note };
}

transactionRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const { page } = pageParams(req.query);
    const { rows, total, pageSize } = queryTransactions({ ...req.query, page });
    res.json({
      items: rows.map((r) => mapTransaction(r)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  }),
);

transactionRouter.get(
  '/:id',
  requireAuth,
  ah((req, res) => {
    const record = getTransaction(Number.parseInt(req.params.id, 10));
    if (!record) throw new HttpError(404, '记录不存在或已删除');
    res.json({ transaction: record });
  }),
);

transactionRouter.post(
  '/',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    const payload = readTxPayload(req.body || {});
    if (!canRecord(req.user, payload.type)) {
      throw new HttpError(403, `没有录入${payload.type === 'income' ? '收入' : '支出'}的权限`);
    }
    const clientRequestId = text(req.body?.clientRequestId, { field: '请求标识', max: 64 }) || null;

    if (clientRequestId) {
      const existing = db
        .prepare('SELECT id FROM transactions WHERE client_request_id = ?')
        .get(clientRequestId);
      if (existing) {
        return res.json({ transaction: getTransaction(existing.id), duplicate: true });
      }
    }

    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO transactions
             (type, amount_cents, category_id, reason, counterparty, note, occurred_at,
              operator_id, version, client_request_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(
          payload.type,
          payload.amountCents,
          payload.categoryId,
          payload.reason,
          payload.counterparty || null,
          payload.note || null,
          payload.occurredAt,
          req.user.id,
          clientRequestId,
          now,
          now,
        );
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'transaction.create',
        entityType: 'transaction',
        entityId: newId,
        detail: {
          type: payload.type,
          amountCents: payload.amountCents,
          reason: payload.reason,
          occurredAt: payload.occurredAt,
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });

    res.status(201).json({ transaction: getTransaction(id) });
  }),
);

transactionRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const current = db.prepare('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!current) throw new HttpError(404, '记录不存在或已删除');
    if (!canEdit(req.user, current)) throw new HttpError(403, '只能修改自己录入的记录');

    const payload = readTxPayload(req.body || {});
    if (!canRecord(req.user, payload.type)) {
      throw new HttpError(403, `没有修改为${payload.type === 'income' ? '收入' : '支出'}的权限`);
    }
    const expectedVersion = Number.parseInt(req.body?.version, 10);

    const result = tx(() => {
      const version = Number.isFinite(expectedVersion) ? expectedVersion : current.version;
      const update = db
        .prepare(
          `UPDATE transactions
           SET type = ?, amount_cents = ?, category_id = ?, reason = ?, counterparty = ?, note = ?,
               occurred_at = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .run(
          payload.type,
          payload.amountCents,
          payload.categoryId,
          payload.reason,
          payload.counterparty || null,
          payload.note || null,
          payload.occurredAt,
          nowIso(),
          id,
          version,
        );
      if (update.changes === 0) {
        throw new HttpError(409, '该记录已被他人修改，请刷新后重试');
      }
      audit({
        actor: req.user,
        action: 'transaction.update',
        entityType: 'transaction',
        entityId: id,
        detail: {
          before: {
            type: current.type,
            amountCents: current.amount_cents,
            reason: current.reason,
            occurredAt: current.occurred_at,
          },
          after: {
            type: payload.type,
            amountCents: payload.amountCents,
            reason: payload.reason,
            occurredAt: payload.occurredAt,
          },
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return true;
    });

    res.json({ ok: result, transaction: getTransaction(id) });
  }),
);

transactionRouter.delete(
  '/:id',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const current = db.prepare('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!current) throw new HttpError(404, '记录不存在或已删除');
    if (!canEdit(req.user, current)) throw new HttpError(403, '只能删除自己录入的记录');

    tx(() => {
      db.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
        nowIso(),
        nowIso(),
        id,
      );
      audit({
        actor: req.user,
        action: 'transaction.delete',
        entityType: 'transaction',
        entityId: id,
        detail: {
          type: current.type,
          amountCents: current.amount_cents,
          reason: current.reason,
          occurredAt: current.occurred_at,
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ ok: true });
  }),
);

/* ---------------- 凭证上传 ---------------- */

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      cb(new HttpError(400, '仅支持 JPG / PNG / WEBP / GIF / PDF 格式的凭证'));
      return;
    }
    cb(null, true);
  },
});

transactionRouter.post(
  '/:id/attachments',
  requireAuth,
  requirePerm('finance'),
  upload.array('files', 6),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL').get(id);
    const files = req.files || [];

    const cleanup = () => {
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(UPLOAD_DIR, file.filename));
        } catch {
          /* ignore */
        }
      }
    };

    if (!record) {
      cleanup();
      throw new HttpError(404, '记录不存在或已删除');
    }
    if (!canEdit(req.user, record)) {
      cleanup();
      throw new HttpError(403, '只能给自己录入的记录上传凭证');
    }
    if (files.length === 0) throw new HttpError(400, '请选择要上传的凭证文件');

    const existing = db
      .prepare('SELECT COUNT(*) AS c FROM attachments WHERE transaction_id = ? AND deleted_at IS NULL')
      .get(id).c;
    if (existing + files.length > 12) {
      cleanup();
      throw new HttpError(400, '每条记录最多保存 12 张凭证');
    }

    try {
      tx(() => {
        const insert = db.prepare(
          `INSERT INTO attachments
             (transaction_id, original_name, stored_name, mime, size, sha256, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const file of files) {
          const buffer = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          insert.run(
            id,
            Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 160),
            file.filename,
            file.mimetype,
            file.size,
            sha256,
            req.user.id,
            nowIso(),
          );
        }
        audit({
          actor: req.user,
          action: 'attachment.upload',
          entityType: 'transaction',
          entityId: id,
          detail: { count: files.length, names: files.map((f) => f.originalname) },
          ip: clientIp(req),
          userAgent: req.headers['user-agent'],
        });
      });
    } catch (err) {
      cleanup();
      throw err;
    }

    res.status(201).json({ transaction: getTransaction(id) });
  }),
);

export const attachmentRouter = express.Router();

attachmentRouter.get(
  '/:id/file',
  requireAuth,
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = db
      .prepare(
        `SELECT a.*, t.deleted_at AS tx_deleted
         FROM attachments a JOIN transactions t ON t.id = a.transaction_id
         WHERE a.id = ? AND a.deleted_at IS NULL`,
      )
      .get(id);
    if (!row) throw new HttpError(404, '凭证不存在');
    if (row.tx_deleted && req.user.role !== 'admin') throw new HttpError(404, '凭证不存在');

    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    if (!fs.existsSync(filePath)) throw new HttpError(404, '凭证文件丢失');

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

attachmentRouter.delete(
  '/:id',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = db
      .prepare(
        `SELECT a.*, t.operator_id, t.type FROM attachments a
         JOIN transactions t ON t.id = a.transaction_id
         WHERE a.id = ? AND a.deleted_at IS NULL`,
      )
      .get(id);
    if (!row) throw new HttpError(404, '凭证不存在');
    if (req.user.role !== 'admin' && (row.operator_id !== req.user.id || !canRecord(req.user, row.type))) {
      throw new HttpError(403, '只能删除自己录入记录的凭证');
    }
    tx(() => {
      db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
      audit({
        actor: req.user,
        action: 'attachment.delete',
        entityType: 'attachment',
        entityId: id,
        detail: { originalName: row.original_name, transactionId: row.transaction_id },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ ok: true });
  }),
);
