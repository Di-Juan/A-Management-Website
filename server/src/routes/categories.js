import express from 'express';
import { db, audit, nowIso, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError, ah, clientIp, text } from '../helpers.js';

export const categoryRouter = express.Router();

categoryRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const includeArchived = req.query.all === '1' && req.user.role === 'admin';
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS usage_count
         FROM categories c
         ${includeArchived ? '' : 'WHERE c.archived = 0'}
         ORDER BY c.type DESC, c.sort, c.id`,
      )
      .all();
    res.json({
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        sort: c.sort,
        archived: !!c.archived,
        usageCount: c.usage_count,
      })),
    });
  }),
);

categoryRouter.post(
  '/',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const name = text(req.body?.name, { field: '分类名称', required: true, max: 20 });
    const type = req.body?.type === 'income' || req.body?.type === 'expense' ? req.body.type : null;
    if (!type) throw new HttpError(400, '请选择分类类型');
    if (db.prepare('SELECT 1 FROM categories WHERE name = ? AND type = ?').get(name, type)) {
      throw new HttpError(409, '同类型下已存在该分类');
    }
    const id = tx(() => {
      const sort = db
        .prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories WHERE type = ?')
        .get(type).s;
      const result = db
        .prepare('INSERT INTO categories (name, type, sort, created_at) VALUES (?, ?, ?, ?)')
        .run(name, type, sort, nowIso());
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'category.create',
        entityType: 'category',
        entityId: newId,
        detail: { name, type },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ id });
  }),
);

categoryRouter.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, '分类不存在');

    const name =
      req.body?.name === undefined
        ? target.name
        : text(req.body.name, { field: '分类名称', required: true, max: 20 });
    const archived = req.body?.archived === undefined ? target.archived : req.body.archived ? 1 : 0;

    if (name !== target.name) {
      if (
        db
          .prepare('SELECT 1 FROM categories WHERE name = ? AND type = ? AND id != ?')
          .get(name, target.type, id)
      ) {
        throw new HttpError(409, '同类型下已存在该分类');
      }
    }

    tx(() => {
      db.prepare('UPDATE categories SET name = ?, archived = ? WHERE id = ?').run(name, archived, id);
      audit({
        actor: req.user,
        action: 'category.update',
        entityType: 'category',
        entityId: id,
        detail: {
          before: { name: target.name, archived: !!target.archived },
          after: { name, archived: !!archived },
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ ok: true });
  }),
);

categoryRouter.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, '分类不存在');
    const used = db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ? AND deleted_at IS NULL')
      .get(id).c;
    if (used > 0) throw new HttpError(400, '该分类已被账单使用，请改为停用');

    tx(() => {
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      audit({
        actor: req.user,
        action: 'category.delete',
        entityType: 'category',
        entityId: id,
        detail: { name: target.name, type: target.type },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ ok: true });
  }),
);
