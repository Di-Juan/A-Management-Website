import express from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { ah } from '../helpers.js';

export const logRouter = express.Router();

logRouter.get(
  '/',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const where = ['1 = 1'];
    const params = [];

    if (req.query.action) {
      where.push('action = ?');
      params.push(String(req.query.action));
    }
    if (req.query.actorId) {
      const id = Number.parseInt(req.query.actorId, 10);
      if (Number.isFinite(id)) {
        where.push('actor_id = ?');
        params.push(id);
      }
    }
    if (req.query.from) {
      where.push('created_at >= ?');
      params.push(`${String(req.query.from)}T00:00:00.000Z`);
    }
    if (req.query.to) {
      where.push('created_at <= ?');
      params.push(`${String(req.query.to)}T23:59:59.999Z`);
    }
    if (req.query.q) {
      const keyword = `%${String(req.query.q).trim().slice(0, 60)}%`;
      where.push("(actor_name LIKE ? OR action LIKE ? OR IFNULL(detail, '') LIKE ?)");
      params.push(keyword, keyword, keyword);
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 30));
    const whereSql = where.join(' AND ');

    const rows = db
      .prepare(`SELECT * FROM audit_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE ${whereSql}`).get(...params).c;

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        detail: r.detail ? JSON.parse(r.detail) : null,
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  }),
);

logRouter.get(
  '/actions',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const rows = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
    res.json({ items: rows.map((r) => r.action) });
  }),
);
