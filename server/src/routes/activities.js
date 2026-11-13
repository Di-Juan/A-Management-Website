import express from 'express';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { HttpError, ah, clientIp, optionalNumber, parseDateTime, text } from '../helpers.js';

export const activityRouter = express.Router();

const STATUS = ['draft', 'open', 'closed', 'finished', 'cancelled'];

const mapActivity = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description || '',
  location: row.location || '',
  startAt: row.start_at,
  endAt: row.end_at,
  signupDeadline: row.signup_deadline,
  capacity: row.capacity,
  feeCents: row.fee_cents,
  status: row.status,
  creatorName: row.creator_name || '',
  signupCount: row.signup_count || 0,
  checkedInCount: row.checked_in_count || 0,
  mySignupStatus: row.my_signup_status || null,
  createdAt: row.created_at,
});

const ACTIVITY_SELECT = `
  SELECT a.*, u.display_name AS creator_name,
         (SELECT COUNT(*) FROM activity_signups s WHERE s.activity_id = a.id AND s.status = 'confirmed') AS signup_count,
         (SELECT COUNT(*) FROM activity_signups s WHERE s.activity_id = a.id AND s.checked_in_at IS NOT NULL) AS checked_in_count,
         (SELECT s.status FROM activity_signups s WHERE s.activity_id = a.id AND s.user_id = ?) AS my_signup_status
  FROM activities a
  JOIN users u ON u.id = a.created_by`;

function getActivity(id) {
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, '活动不存在');
  return row;
}

activityRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const params = [req.user.id];
    let sql = `${ACTIVITY_SELECT} WHERE 1 = 1`;
    if (req.query.status) {
      sql += ' AND a.status = ?';
      params.push(String(req.query.status));
    }
    if (req.query.mine === '1') {
      sql += ' AND a.id IN (SELECT activity_id FROM activity_signups WHERE user_id = ?)';
      params.push(req.user.id);
    }
    sql += ' ORDER BY a.start_at DESC LIMIT 100';
    const items = db.prepare(sql).all(...params).map(mapActivity);
    const open = db.prepare("SELECT COUNT(*) AS c FROM activities WHERE status = 'open'").get().c;
    res.json({ items, open });
  }),
);

activityRouter.post(
  '/',
  requireAuth,
  requirePerm('activity'),
  ah((req, res) => {
    const title = text(req.body?.title, { field: '活动名称', required: true, max: 80 });
    const description = text(req.body?.description, { field: '活动介绍', max: 1000 });
    const location = text(req.body?.location, { field: '活动地点', max: 60 });
    const startAt = parseDateTime(req.body?.startAt, '开始时间');
    const endAt = req.body?.endAt ? parseDateTime(req.body.endAt, '结束时间') : null;
    if (endAt && new Date(endAt) <= new Date(startAt)) throw new HttpError(400, '结束时间需晚于开始时间');
    const signupDeadline = req.body?.signupDeadline ? parseDateTime(req.body.signupDeadline, '报名截止时间') : null;
    if (signupDeadline && new Date(signupDeadline) > new Date(startAt)) {
      throw new HttpError(400, '报名截止时间需早于活动开始时间');
    }
    const capacity = optionalNumber(req.body?.capacity, { field: '人数上限', min: 1, max: 10000, integer: true });
    const feeCents = optionalNumber(req.body?.feeCents, { field: '报名费', min: 0, max: 10000000, integer: true }) || 0;
    const status = STATUS.includes(req.body?.status) ? req.body.status : 'open';
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO activities
             (title, description, location, start_at, end_at, signup_deadline, capacity, fee_cents,
              status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(title, description, location, startAt, endAt, signupDeadline, capacity, feeCents, status, req.user.id, now, now);
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'activity.create',
        entityType: 'activity',
        entityId: newId,
        detail: { title, startAt, capacity },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapActivity(db.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).get(req.user.id, id)) });
  }),
);

activityRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('activity'),
  ah((req, res) => {
    const target = getActivity(req.params.id);
    const title = req.body?.title === undefined ? target.title : text(req.body.title, { field: '活动名称', required: true, max: 80 });
    const description =
      req.body?.description === undefined ? target.description : text(req.body.description, { field: '活动介绍', max: 1000 });
    const location = req.body?.location === undefined ? target.location : text(req.body.location, { field: '活动地点', max: 60 });
    const startAt = req.body?.startAt ? parseDateTime(req.body.startAt, '开始时间') : target.start_at;
    const endAt = req.body?.endAt ? parseDateTime(req.body.endAt, '结束时间') : target.end_at;
    if (endAt && new Date(endAt) <= new Date(startAt)) throw new HttpError(400, '结束时间需晚于开始时间');
    const signupDeadline = req.body?.signupDeadline
      ? parseDateTime(req.body.signupDeadline, '报名截止时间')
      : target.signup_deadline;
    const capacity =
      req.body?.capacity === undefined
        ? target.capacity
        : optionalNumber(req.body.capacity, { field: '人数上限', min: 1, max: 10000, integer: true });
    const feeCents =
      req.body?.feeCents === undefined
        ? target.fee_cents
        : optionalNumber(req.body.feeCents, { field: '报名费', min: 0, max: 10000000, integer: true }) || 0;
    const status = req.body?.status === undefined ? target.status : req.body.status;
    if (!STATUS.includes(status)) throw new HttpError(400, '活动状态不正确');
    tx(() => {
      db.prepare(
        `UPDATE activities SET title = ?, description = ?, location = ?, start_at = ?, end_at = ?,
                               signup_deadline = ?, capacity = ?, fee_cents = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        title,
        description,
        location,
        startAt,
        endAt,
        signupDeadline,
        capacity,
        feeCents,
        status,
        nowIso(),
        target.id,
      );
      audit({
        actor: req.user,
        action: 'activity.update',
        entityType: 'activity',
        entityId: target.id,
        detail: { title, before: target.status, after: status },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapActivity(db.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).get(req.user.id, target.id)) });
  }),
);

activityRouter.get(
  '/:id/signups',
  requireAuth,
  ah((req, res) => {
    const activity = getActivity(req.params.id);
    if (!hasPerm(req.user, 'activity')) throw new HttpError(403, '没有权限查看报名名单');
    const rows = db
      .prepare(
        `SELECT s.*, u.display_name AS user_name, u.student_no, u.department
         FROM activity_signups s JOIN users u ON u.id = s.user_id
         WHERE s.activity_id = ? ORDER BY s.created_at`,
      )
      .all(activity.id);
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        studentNo: row.student_no || '',
        department: row.department || '',
        status: row.status,
        note: row.note || '',
        checkedInAt: row.checked_in_at,
        createdAt: row.created_at,
      })),
    });
  }),
);

activityRouter.post(
  '/:id/signup',
  requireAuth,
  ah((req, res) => {
    const activity = getActivity(req.params.id);
    if (activity.status !== 'open') throw new HttpError(409, '该活动当前未开放报名');
    if (activity.signup_deadline && activity.signup_deadline < nowIso()) {
      throw new HttpError(409, '报名已截止');
    }
    const existing = db
      .prepare('SELECT * FROM activity_signups WHERE activity_id = ? AND user_id = ?')
      .get(activity.id, req.user.id);
    if (existing && existing.status === 'confirmed') throw new HttpError(409, '你已报名该活动');
    if (activity.capacity) {
      const confirmed = db
        .prepare("SELECT COUNT(*) AS c FROM activity_signups WHERE activity_id = ? AND status = 'confirmed'")
        .get(activity.id).c;
      if (confirmed >= activity.capacity) throw new HttpError(409, '报名人数已满');
    }
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const now = nowIso();
    tx(() => {
      if (existing) {
        db.prepare(
          "UPDATE activity_signups SET status = 'confirmed', note = ?, checked_in_at = NULL, updated_at = ? WHERE id = ?",
        ).run(note, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO activity_signups (activity_id, user_id, status, note, created_at, updated_at)
           VALUES (?, ?, 'confirmed', ?, ?, ?)`,
        ).run(activity.id, req.user.id, note, now, now);
      }
      audit({
        actor: req.user,
        action: 'activity.signup',
        entityType: 'activity',
        entityId: activity.id,
        detail: { title: activity.title },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapActivity(db.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).get(req.user.id, activity.id)) });
  }),
);

activityRouter.post(
  '/:id/signup/cancel',
  requireAuth,
  ah((req, res) => {
    const activity = getActivity(req.params.id);
    const signup = db
      .prepare('SELECT * FROM activity_signups WHERE activity_id = ? AND user_id = ?')
      .get(activity.id, req.user.id);
    if (!signup || signup.status !== 'confirmed') throw new HttpError(409, '你尚未报名该活动');
    tx(() => {
      db.prepare("UPDATE activity_signups SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
        nowIso(),
        signup.id,
      );
      audit({
        actor: req.user,
        action: 'activity.signup.cancel',
        entityType: 'activity',
        entityId: activity.id,
        detail: { title: activity.title },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapActivity(db.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).get(req.user.id, activity.id)) });
  }),
);

activityRouter.post(
  '/:id/signups/:signupId/checkin',
  requireAuth,
  requirePerm('activity'),
  ah((req, res) => {
    const activity = getActivity(req.params.id);
    const signup = db
      .prepare('SELECT * FROM activity_signups WHERE id = ? AND activity_id = ?')
      .get(Number(req.params.signupId), activity.id);
    if (!signup) throw new HttpError(404, '报名记录不存在');
    if (signup.checked_in_at) throw new HttpError(409, '该成员已签到');
    tx(() => {
      db.prepare('UPDATE activity_signups SET checked_in_at = ?, updated_at = ? WHERE id = ?').run(
        nowIso(),
        nowIso(),
        signup.id,
      );
      audit({
        actor: req.user,
        action: 'activity.checkin',
        entityType: 'activity_signup',
        entityId: signup.id,
        detail: { activity: activity.title },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ ok: true });
  }),
);
