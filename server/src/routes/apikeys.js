import express from 'express';
import { audit, db, nowIso } from '../db.js';
import {
  API_RATE_LIMIT,
  generateApiKey,
  hasPerm,
  parsePerms,
  requireAuth,
} from '../auth.js';
import { HttpError, ah, clientIp, text } from '../helpers.js';

export const apiKeyRouter = express.Router();

const mapKey = (row) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  displayName: row.display_name,
  name: row.name,
  prefix: row.prefix,
  expiresAt: row.expires_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
});

const isAdmin = (user) => user.role === 'admin';
const canUseApi = (user) => isAdmin(user) || hasPerm(user, 'api');

apiKeyRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    if (!canUseApi(req.user)) throw new HttpError(403, '没有权限执行该操作');
    const base = `SELECT k.*, u.username, u.display_name
                  FROM api_keys k JOIN users u ON u.id = k.user_id`;
    const rows = isAdmin(req.user)
      ? db.prepare(`${base} ORDER BY k.created_at DESC`).all()
      : db.prepare(`${base} WHERE k.user_id = ? ORDER BY k.created_at DESC`).all(req.user.id);
    res.json({ items: rows.map(mapKey), rateLimit: API_RATE_LIMIT });
  }),
);

/** 可签发对象：管理员+已开启 API 权限的启用成员 */
apiKeyRouter.get(
  '/users',
  requireAuth,
  ah((req, res) => {
    if (!isAdmin(req.user)) throw new HttpError(403, '没有权限执行该操作');
    const rows = db
      .prepare("SELECT id, username, display_name, role, perms FROM users WHERE status = 'active' ORDER BY id")
      .all();
    res.json({
      items: rows
        .filter((row) => row.role === 'admin' || parsePerms(row.perms).includes('api'))
        .map((row) => ({
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
        })),
    });
  }),
);

apiKeyRouter.post(
  '/',
  requireAuth,
  ah((req, res) => {
    if (!canUseApi(req.user)) throw new HttpError(403, '没有权限执行该操作');
    const name = text(req.body?.name, { field: '密钥名称', required: true, max: 40 });
    const targetId = isAdmin(req.user) && req.body?.userId ? Number(req.body.userId) : req.user.id;
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target || target.status !== 'active') throw new HttpError(400, '成员不存在或已停用');
    if (!canUseApi(target)) {
      throw new HttpError(400, '该成员未开启「API 调用」权限，请先在成员管理中勾选');
    }

    let expiresAt = null;
    if (req.body?.expiresInDays !== undefined && req.body.expiresInDays !== null && req.body.expiresInDays !== '') {
      const days = Number(req.body.expiresInDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new HttpError(400, '有效期需为 1-3650 天');
      }
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    const generated = generateApiKey();
    const id = Number(
      db
        .prepare(
          `INSERT INTO api_keys (user_id, name, prefix, key_hash, expires_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(target.id, name, generated.prefix, generated.hash, expiresAt, req.user.id, nowIso()).lastInsertRowid,
    );
    audit({
      actor: req.user,
      action: 'api_key.create',
      entityType: 'api_key',
      entityId: id,
      detail: { name, userId: target.id, expiresAt },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });

    const row = db
      .prepare(
        `SELECT k.*, u.username, u.display_name
         FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
      )
      .get(id);
    res.status(201).json({ ...mapKey(row), key: generated.key });
  }),
);

apiKeyRouter.post(
  '/:id/revoke',
  requireAuth,
  ah((req, res) => {
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(req.params.id));
    if (!row) throw new HttpError(404, '密钥不存在');
    if (!isAdmin(req.user) && row.user_id !== req.user.id) throw new HttpError(403, '没有权限执行该操作');
    if (row.revoked_at) throw new HttpError(400, '该密钥已撤销');
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit({
      actor: req.user,
      action: 'api_key.revoke',
      entityType: 'api_key',
      entityId: row.id,
      detail: { name: row.name, userId: row.user_id },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  }),
);
