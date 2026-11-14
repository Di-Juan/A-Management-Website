import express from 'express';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { HttpError, ah, clientIp, optionalNumber, parseClock, text } from '../helpers.js';

export const dutyRouter = express.Router();

function parseDate(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00`).getTime())) {
    throw new HttpError(400, '值班日期需为 YYYY-MM-DD 格式');
  }
  return raw;
}

function getShift(id) {
  const row = db.prepare('SELECT * FROM duty_shifts WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, '值班班次不存在');
  return row;
}

function withAssignments(shifts) {
  if (shifts.length === 0) return [];
  const ids = shifts.map((shift) => shift.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT a.*, u.display_name AS user_name, u.student_no, u.phone
       FROM duty_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.shift_id IN (${placeholders})
       ORDER BY a.created_at`,
    )
    .all(...ids);
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.shift_id)) grouped.set(row.shift_id, []);
    grouped.get(row.shift_id).push({
      id: row.id,
      shiftId: row.shift_id,
      userId: row.user_id,
      userName: row.user_name,
      studentNo: row.student_no || '',
      phone: row.phone || '',
      status: row.status,
      presence: row.presence || 'off',
      presenceAt: row.presence_at || '',
      note: row.note || '',
      createdAt: row.created_at,
    });
  });
  return shifts.map((shift) => ({
    id: shift.id,
    date: shift.date,
    startTime: shift.start_time,
    endTime: shift.end_time,
    location: shift.location || '',
    capacity: shift.capacity,
    note: shift.note || '',
    assignments: grouped.get(shift.id) || [],
  }));
}

dutyRouter.get(
  '/shifts',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = 'SELECT * FROM duty_shifts WHERE 1 = 1';
    if (req.query.from) {
      sql += ' AND date >= ?';
      params.push(parseDate(req.query.from));
    }
    if (req.query.to) {
      sql += ' AND date <= ?';
      params.push(parseDate(req.query.to));
    }
    sql += ' ORDER BY date ASC, start_time ASC LIMIT 200';
    const shifts = db.prepare(sql).all(...params);
    res.json({ items: withAssignments(shifts) });
  }),
);

dutyRouter.post(
  '/shifts',
  requireAuth,
  requirePerm('duty'),
  ah((req, res) => {
    const date = parseDate(req.body?.date);
    const startTime = parseClock(req.body?.startTime, '开始时间');
    const endTime = parseClock(req.body?.endTime, '结束时间');
    if (endTime <= startTime) throw new HttpError(400, '结束时间需晚于开始时间');
    const location = text(req.body?.location, { field: '值班地点', max: 60 });
    const capacity = optionalNumber(req.body?.capacity, { field: '需要人数', min: 1, max: 20, integer: true }) || 1;
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const duplicate = db
      .prepare('SELECT 1 FROM duty_shifts WHERE date = ? AND start_time = ? AND location IS ?')
      .get(date, startTime, location || null);
    if (duplicate) throw new HttpError(409, '同一时间地点已存在值班班次');
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO duty_shifts (date, start_time, end_time, location, capacity, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(date, startTime, endTime, location, capacity, note, req.user.id, now);
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'duty.shift.create',
        entityType: 'duty_shift',
        entityId: newId,
        detail: { date, startTime, endTime, location, capacity },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ items: withAssignments([getShift(id)]) });
  }),
);

dutyRouter.patch(
  '/shifts/:id',
  requireAuth,
  requirePerm('duty'),
  ah((req, res) => {
    const target = getShift(req.params.id);
    const date = req.body?.date === undefined ? target.date : parseDate(req.body.date);
    const startTime = req.body?.startTime === undefined ? target.start_time : parseClock(req.body.startTime, '开始时间');
    const endTime = req.body?.endTime === undefined ? target.end_time : parseClock(req.body.endTime, '结束时间');
    if (endTime <= startTime) throw new HttpError(400, '结束时间需晚于开始时间');
    const location =
      req.body?.location === undefined ? target.location : text(req.body.location, { field: '值班地点', max: 60 });
    const capacity =
      req.body?.capacity === undefined
        ? target.capacity
        : optionalNumber(req.body.capacity, { field: '需要人数', min: 1, max: 20, integer: true }) || 1;
    const note = req.body?.note === undefined ? target.note : text(req.body.note, { field: '备注', max: 200 });
    tx(() => {
      db.prepare(
        'UPDATE duty_shifts SET date = ?, start_time = ?, end_time = ?, location = ?, capacity = ?, note = ? WHERE id = ?',
      ).run(date, startTime, endTime, location, capacity, note, target.id);
      audit({
        actor: req.user,
        action: 'duty.shift.update',
        entityType: 'duty_shift',
        entityId: target.id,
        detail: { date, startTime, endTime, capacity },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ items: withAssignments([getShift(target.id)]) });
  }),
);

dutyRouter.delete(
  '/shifts/:id',
  requireAuth,
  requirePerm('duty'),
  ah((req, res) => {
    const target = getShift(req.params.id);
    tx(() => {
      db.prepare('DELETE FROM duty_assignments WHERE shift_id = ?').run(target.id);
      db.prepare('DELETE FROM duty_shifts WHERE id = ?').run(target.id);
      audit({
        actor: req.user,
        action: 'duty.shift.delete',
        entityType: 'duty_shift',
        entityId: target.id,
        detail: { date: target.date, startTime: target.start_time },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.status(204).end();
  }),
);

dutyRouter.post(
  '/shifts/:id/assign',
  requireAuth,
  ah((req, res) => {
    const shift = getShift(req.params.id);
    const isSelf = !req.body?.userId || Number(req.body.userId) === req.user.id;
    if (!isSelf && !hasPerm(req.user, 'duty')) throw new HttpError(403, '不能替他人排班');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.body?.userId || req.user.id));
    if (!user || user.status !== 'active') throw new HttpError(400, '成员不存在');
    const assigned = db.prepare('SELECT COUNT(*) AS c FROM duty_assignments WHERE shift_id = ?').get(shift.id).c;
    if (assigned >= shift.capacity) throw new HttpError(409, '该班次人数已满');
    if (db.prepare('SELECT 1 FROM duty_assignments WHERE shift_id = ? AND user_id = ?').get(shift.id, user.id)) {
      throw new HttpError(409, '该成员已在此班次');
    }
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const now = nowIso();
    tx(() => {
      db.prepare(
        `INSERT INTO duty_assignments (shift_id, user_id, status, note, created_at)
         VALUES (?, ?, 'assigned', ?, ?)`,
      ).run(shift.id, user.id, note, now);
      audit({
        actor: req.user,
        action: 'duty.assign',
        entityType: 'duty_shift',
        entityId: shift.id,
        detail: { userId: user.id, userName: user.display_name, date: shift.date },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ items: withAssignments([getShift(shift.id)]) });
  }),
);

dutyRouter.delete(
  '/shifts/:id/assignments/:assignmentId',
  requireAuth,
  ah((req, res) => {
    const shift = getShift(req.params.id);
    const assignment = db
      .prepare('SELECT * FROM duty_assignments WHERE id = ? AND shift_id = ?')
      .get(Number(req.params.assignmentId), shift.id);
    if (!assignment) throw new HttpError(404, '排班记录不存在');
    if (assignment.user_id !== req.user.id && !hasPerm(req.user, 'duty')) {
      throw new HttpError(403, '只能取消自己的值班');
    }
    tx(() => {
      db.prepare('DELETE FROM duty_assignments WHERE id = ?').run(assignment.id);
      audit({
        actor: req.user,
        action: 'duty.unassign',
        entityType: 'duty_shift',
        entityId: shift.id,
        detail: { userId: assignment.user_id, date: shift.date },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.status(204).end();
  }),
);

dutyRouter.patch(
  '/assignments/:id/presence',
  requireAuth,
  ah((req, res) => {
    const assignment = db.prepare('SELECT * FROM duty_assignments WHERE id = ?').get(Number(req.params.id));
    if (!assignment) throw new HttpError(404, '排班记录不存在');
    if (assignment.user_id !== req.user.id && !hasPerm(req.user, 'duty')) {
      throw new HttpError(403, '只能修改自己的在岗状态');
    }
    const presence = String(req.body?.presence ?? '').trim();
    if (!['on', 'away', 'off'].includes(presence)) {
      throw new HttpError(400, '在岗状态需为 on / away / off');
    }
    const shift = getShift(assignment.shift_id);
    const now = nowIso();
    tx(() => {
      db.prepare('UPDATE duty_assignments SET presence = ?, presence_at = ? WHERE id = ?').run(
        presence,
        now,
        assignment.id,
      );
      audit({
        actor: req.user,
        action: 'duty.presence',
        entityType: 'duty_assignment',
        entityId: assignment.id,
        detail: { presence, date: shift.date, startTime: shift.start_time, userId: assignment.user_id },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ items: withAssignments([shift]) });
  }),
);

dutyRouter.post(
  '/assignments/:id/checkin',
  requireAuth,
  ah((req, res) => {
    const assignment = db.prepare('SELECT * FROM duty_assignments WHERE id = ?').get(Number(req.params.id));
    if (!assignment) throw new HttpError(404, '排班记录不存在');
    if (assignment.user_id !== req.user.id && !hasPerm(req.user, 'duty')) {
      throw new HttpError(403, '只能为自己签到');
    }
    if (assignment.status === 'checked_in') throw new HttpError(409, '该值班已签到');
    const shift = getShift(assignment.shift_id);
    tx(() => {
      db.prepare("UPDATE duty_assignments SET status = 'checked_in' WHERE id = ?").run(assignment.id);
      audit({
        actor: req.user,
        action: 'duty.checkin',
        entityType: 'duty_assignment',
        entityId: assignment.id,
        detail: { date: shift.date, startTime: shift.start_time },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ items: withAssignments([shift]) });
  }),
);
