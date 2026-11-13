import express from 'express';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { HttpError, ah, clientIp, parseDateTime, text } from '../helpers.js';

export const accessRouter = express.Router();

const REQUEST_SELECT = `
  SELECT r.*, u.display_name AS user_name, u.student_no, v.display_name AS reviewer_name
  FROM access_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users v ON v.id = r.reviewed_by`;

const mapRequest = (row) => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  studentNo: row.student_no || '',
  purpose: row.purpose,
  location: row.location || '',
  startAt: row.start_at,
  endAt: row.end_at,
  status: row.status,
  reviewerName: row.reviewer_name || '',
  reviewedAt: row.reviewed_at,
  rejectReason: row.reject_reason || '',
  createdAt: row.created_at,
});

const GRANT_SELECT = `
  SELECT g.*, u.display_name AS user_name, u.student_no, a.display_name AS grantor_name
  FROM access_grants g
  JOIN users u ON u.id = g.user_id
  LEFT JOIN users a ON a.id = g.granted_by`;

const mapGrant = (row) => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  studentNo: row.student_no || '',
  scope: row.scope,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  status: row.status === 'active' && row.valid_to && row.valid_to < nowIso() ? 'expired' : row.status,
  grantorName: row.grantor_name || '',
  grantedAt: row.granted_at,
  revokedAt: row.revoked_at,
  note: row.note || '',
});

/* ------------------------------ 门禁申请 ------------------------------ */

accessRouter.get(
  '/requests',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `${REQUEST_SELECT} WHERE 1 = 1`;
    if (req.query.status) {
      sql += ' AND r.status = ?';
      params.push(String(req.query.status));
    }
    if (req.query.mine === '1') {
      sql += ' AND r.user_id = ?';
      params.push(req.user.id);
    }
    sql += ' ORDER BY r.start_at DESC LIMIT 200';
    const items = db
      .prepare(sql)
      .all(...params)
      .map(mapRequest);
    const pending = db.prepare("SELECT COUNT(*) AS c FROM access_requests WHERE status = 'pending'").get().c;
    res.json({ items, pending });
  }),
);

accessRouter.post(
  '/requests',
  requireAuth,
  ah((req, res) => {
    const purpose = text(req.body?.purpose, { field: '申请事由', required: true, max: 200 });
    const location = text(req.body?.location, { field: '门禁位置', max: 60 }) || '主实验室';
    const startAt = parseDateTime(req.body?.startAt, '开始时间');
    const endAt = parseDateTime(req.body?.endAt, '结束时间');
    if (new Date(endAt) <= new Date(startAt)) throw new HttpError(400, '结束时间需晚于开始时间');
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO access_requests (user_id, purpose, location, start_at, end_at, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(req.user.id, purpose, location, startAt, endAt, now, now);
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'access.apply',
        entityType: 'access_request',
        entityId: newId,
        detail: { purpose, location, startAt, endAt },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapRequest(db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id)) });
  }),
);

accessRouter.post(
  '/requests/:id/review',
  requireAuth,
  requirePerm('access'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '申请不存在');
    if (target.status !== 'pending') throw new HttpError(409, '该申请已处理，不能重复审核');
    const result = req.body?.result === 'reject' ? 'reject' : 'approve';
    const reason = text(req.body?.reason, { field: '审核意见', max: 200 });
    if (result === 'reject' && !reason) throw new HttpError(400, '驳回时请填写原因');
    const now = nowIso();
    tx(() => {
      const changed = db
        .prepare(
          `UPDATE access_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(result === 'approve' ? 'approved' : 'rejected', req.user.id, now, reason || null, now, target.id).changes;
      if (changed === 0) throw new HttpError(409, '该申请已被其他人处理，请刷新');
      if (result === 'approve') {
        db.prepare(
          `INSERT INTO access_grants
             (user_id, scope, valid_from, valid_to, status, granted_by, granted_at, note)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        ).run(target.user_id, target.location || '主实验室', target.start_at, target.end_at, req.user.id, now, '门禁申请通过自动授权');
      }
      audit({
        actor: req.user,
        action: 'access.review',
        entityType: 'access_request',
        entityId: target.id,
        detail: { result, reason },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapRequest(db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(target.id)) });
  }),
);

accessRouter.post(
  '/requests/:id/cancel',
  requireAuth,
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '申请不存在');
    const canManage = hasPerm(req.user, 'access');
    if (target.user_id !== req.user.id && !canManage) throw new HttpError(403, '只能取消自己的申请');
    if (!['pending', 'approved'].includes(target.status)) throw new HttpError(409, '该申请当前不可取消');
    tx(() => {
      db.prepare("UPDATE access_requests SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
        nowIso(),
        target.id,
      );
      db.prepare(
        "UPDATE access_grants SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND scope = ? AND status = 'active'",
      ).run(nowIso(), target.user_id, target.location || '主实验室');
      audit({
        actor: req.user,
        action: 'access.cancel',
        entityType: 'access_request',
        entityId: target.id,
        detail: {},
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapRequest(db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(target.id)) });
  }),
);

/* ------------------------------ 授权记录 ------------------------------ */

accessRouter.get(
  '/grants',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `${GRANT_SELECT} WHERE 1 = 1`;
    if (req.query.status) {
      sql += ' AND g.status = ?';
      params.push(String(req.query.status));
    }
    sql += ' ORDER BY g.granted_at DESC LIMIT 200';
    res.json({ items: db.prepare(sql).all(...params).map(mapGrant) });
  }),
);

accessRouter.post(
  '/grants',
  requireAuth,
  requirePerm('access'),
  ah((req, res) => {
    const userId = Number(req.body?.userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || user.status !== 'active') throw new HttpError(400, '成员不存在');
    const scope = text(req.body?.scope, { field: '门禁位置', required: true, max: 60 });
    const validFrom = req.body?.validFrom ? parseDateTime(req.body.validFrom, '生效时间') : nowIso();
    const validTo = req.body?.validTo ? parseDateTime(req.body.validTo, '失效时间') : null;
    if (validTo && new Date(validTo) <= new Date(validFrom)) throw new HttpError(400, '失效时间需晚于生效时间');
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO access_grants (user_id, scope, valid_from, valid_to, status, granted_by, granted_at, note)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(user.id, scope, validFrom, validTo, req.user.id, now, note);
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'access.grant',
        entityType: 'access_grant',
        entityId: newId,
        detail: { userId: user.id, userName: user.display_name, scope, validTo },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapGrant(db.prepare(`${GRANT_SELECT} WHERE g.id = ?`).get(id)) });
  }),
);

accessRouter.post(
  '/grants/:id/revoke',
  requireAuth,
  requirePerm('access'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM access_grants WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '授权记录不存在');
    if (target.status === 'revoked') throw new HttpError(409, '该授权已撤销');
    tx(() => {
      db.prepare("UPDATE access_grants SET status = 'revoked', revoked_at = ? WHERE id = ?").run(nowIso(), target.id);
      audit({
        actor: req.user,
        action: 'access.revoke',
        entityType: 'access_grant',
        entityId: target.id,
        detail: { scope: target.scope },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapGrant(db.prepare(`${GRANT_SELECT} WHERE g.id = ?`).get(target.id)) });
  }),
);

/* ------------------------------ 进出登记 ------------------------------ */

accessRouter.get(
  '/logs',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `SELECT l.*, u.display_name AS user_name, o.display_name AS operator_name
               FROM access_logs l
               LEFT JOIN users u ON u.id = l.user_id
               LEFT JOIN users o ON o.id = l.operator_id
               WHERE 1 = 1`;
    if (req.query.direction) {
      sql += ' AND l.direction = ?';
      params.push(String(req.query.direction));
    }
    if (req.query.from) {
      sql += ' AND l.occurred_at >= ?';
      params.push(parseDateTime(req.query.from, '起始时间'));
    }
    if (req.query.to) {
      sql += ' AND l.occurred_at <= ?';
      params.push(parseDateTime(req.query.to, '结束时间'));
    }
    sql += ' ORDER BY l.occurred_at DESC, l.id DESC LIMIT 200';
    const items = db.prepare(sql).all(...params).map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name || row.person_name,
      personName: row.person_name,
      direction: row.direction,
      location: row.location || '',
      occurredAt: row.occurred_at,
      source: row.source,
      operatorName: row.operator_name || '',
      note: row.note || '',
    }));
    const inside = db
      .prepare(
        `SELECT COUNT(*) AS c FROM access_logs a
         WHERE a.direction = 'in'
           AND a.id = (SELECT MAX(b.id) FROM access_logs b WHERE b.person_name = a.person_name)`,
      )
      .get().c;
    res.json({ items, inside });
  }),
);

accessRouter.post(
  '/logs',
  requireAuth,
  requirePerm('access'),
  ah((req, res) => {
    let userId = null;
    let personName = text(req.body?.personName, { field: '姓名', max: 40 });
    if (req.body?.userId) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.body.userId));
      if (!user) throw new HttpError(400, '成员不存在');
      userId = user.id;
      personName = user.display_name;
    }
    if (!personName) throw new HttpError(400, '请填写姓名或选择成员');
    const direction = req.body?.direction === 'out' ? 'out' : 'in';
    const location = text(req.body?.location, { field: '门禁位置', max: 60 }) || '主实验室';
    const occurredAt = req.body?.occurredAt ? parseDateTime(req.body.occurredAt, '进出时间') : nowIso();
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO access_logs
             (user_id, person_name, direction, location, occurred_at, source, operator_id, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, personName, direction, location, occurredAt, 'manual', req.user.id, note, now);
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'access.log',
        entityType: 'access_log',
        entityId: newId,
        detail: { personName, direction, location },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ id });
  }),
);
