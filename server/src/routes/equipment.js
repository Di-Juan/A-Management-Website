import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { UPLOAD_DIR } from '../config.js';
import {
  HttpError,
  ah,
  clientIp,
  optionalNumber,
  parseDateTime,
  parseNumber,
  text,
} from '../helpers.js';

export const equipmentRouter = express.Router();
export const consumableRouter = express.Router();
export const borrowRouter = express.Router();

const EQUIPMENT_CATEGORY = ['printer', 'instrument', 'other'];
const EQUIPMENT_STATUS = ['available', 'maintenance', 'retired'];
const JOB_STATUS = ['queued', 'printing', 'done', 'failed', 'cancelled'];

const MODEL_EXT = new Set(['.stl', '.obj', '.3mf', '.gcode', '.step', '.stp', '.zip']);
const modelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!MODEL_EXT.has(path.extname(file.originalname).toLowerCase())) {
      cb(new HttpError(400, '模型文件仅支持 STL / OBJ / 3MF / GCODE / STEP / ZIP'));
      return;
    }
    cb(null, true);
  },
});

const mapEquipment = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  category: row.category,
  typeName: row.type_name || '',
  location: row.location || '',
  status: row.status,
  requiresApproval: !!row.requires_approval,
  note: row.note || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const BOOKING_SELECT = `
  SELECT b.*, u.display_name AS user_name, e.name AS equipment_name, e.code AS equipment_code,
         r.display_name AS reviewer_name
  FROM equipment_bookings b
  JOIN users u ON u.id = b.user_id
  JOIN equipment e ON e.id = b.equipment_id
  LEFT JOIN users r ON r.id = b.reviewed_by`;

const mapBooking = (row) => ({
  id: row.id,
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name,
  equipmentCode: row.equipment_code,
  userId: row.user_id,
  userName: row.user_name,
  startAt: row.start_at,
  endAt: row.end_at,
  purpose: row.purpose,
  status: row.status,
  reviewedBy: row.reviewed_by,
  reviewerName: row.reviewer_name || '',
  reviewedAt: row.reviewed_at,
  rejectReason: row.reject_reason || '',
  createdAt: row.created_at,
});

const JOB_SELECT = `
  SELECT j.*, u.display_name AS user_name, e.name AS equipment_name, e.code AS equipment_code,
         c.name AS material_name, c.unit AS material_unit
  FROM print_jobs j
  JOIN users u ON u.id = j.user_id
  JOIN equipment e ON e.id = j.equipment_id
  LEFT JOIN consumables c ON c.id = j.material_id`;

const mapJob = (row) => ({
  id: row.id,
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name,
  equipmentCode: row.equipment_code,
  userId: row.user_id,
  userName: row.user_name,
  bookingId: row.booking_id,
  title: row.title,
  fileName: row.file_name || '',
  fileSize: row.file_size || 0,
  hasFile: !!row.file_stored,
  materialId: row.material_id,
  materialName: row.material_name || '',
  materialUnit: row.material_unit || 'g',
  weightGrams: row.weight_grams,
  estMinutes: row.est_minutes,
  status: row.status,
  note: row.note || '',
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
});

const mapConsumable = (row) => ({
  id: row.id,
  name: row.name,
  spec: row.spec || '',
  unit: row.unit,
  stock: Number(row.stock),
  warnThreshold: Number(row.warn_threshold),
  unitPriceCents: row.unit_price_cents,
  note: row.note || '',
  archived: !!row.archived,
  lowStock: Number(row.stock) <= Number(row.warn_threshold),
  updatedAt: row.updated_at,
});

const mapMaintenance = (row) => ({
  id: row.id,
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name,
  type: row.type,
  content: row.content,
  costCents: row.cost_cents,
  performedBy: row.performed_by || '',
  performedAt: row.performed_at,
  nextDueAt: row.next_due_at,
  operatorName: row.operator_name,
  createdAt: row.created_at,
});

const mapBorrow = (row) => ({
  id: row.id,
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name,
  equipmentCode: row.equipment_code,
  userId: row.user_id,
  userName: row.user_name,
  borrowedAt: row.borrowed_at,
  dueAt: row.due_at,
  returnedAt: row.returned_at,
  status: row.status === 'borrowed' && row.due_at < nowIso() ? 'overdue' : row.status,
  conditionNote: row.condition_note || '',
  reviewerName: row.reviewer_name || '',
  createdAt: row.created_at,
});

function getEquipment(id) {
  const row = db.prepare('SELECT * FROM equipment WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, '设备不存在');
  return row;
}

/* ------------------------------- 设备台账 ------------------------------- */

equipmentRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = 'SELECT * FROM equipment WHERE 1 = 1';
    if (req.query.category) {
      sql += ' AND category = ?';
      params.push(String(req.query.category));
    }
    if (req.query.status) {
      sql += ' AND status = ?';
      params.push(String(req.query.status));
    }
    if (req.query.q) {
      sql += ' AND (name LIKE ? OR code LIKE ? OR location LIKE ? OR type_name LIKE ?)';
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY code';
    const items = db
      .prepare(sql)
      .all(...params)
      .map(mapEquipment);
    const summary = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM equipment WHERE status = 'available') AS available,
           (SELECT COUNT(*) FROM equipment WHERE status = 'maintenance') AS maintenance,
           (SELECT COUNT(*) FROM equipment WHERE status = 'retired') AS retired,
           (SELECT COUNT(*) FROM equipment_bookings WHERE status = 'pending') AS pendingBookings`,
      )
      .get();
    res.json({ items, summary });
  }),
);

equipmentRouter.get(
  '/types',
  requireAuth,
  ah((req, res) => {
    const rows = db
      .prepare(
        `SELECT type_name AS name, category, COUNT(*) AS count
         FROM equipment WHERE type_name IS NOT NULL AND type_name <> ''
         GROUP BY type_name, category ORDER BY count DESC, type_name`,
      )
      .all();
    res.json({ items: rows.map((row) => ({ name: row.name, category: row.category, count: row.count })) });
  }),
);

equipmentRouter.post(
  '/',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const code = text(req.body?.code, { field: '设备编号', required: true, max: 30 });
    const name = text(req.body?.name, { field: '设备名称', required: true, max: 60 });
    const category = EQUIPMENT_CATEGORY.includes(req.body?.category) ? req.body.category : 'other';
    const typeName = text(req.body?.typeName, { field: '设备类型', max: 40 });
    const status = EQUIPMENT_STATUS.includes(req.body?.status) ? req.body.status : 'available';
    const location = text(req.body?.location, { field: '存放位置', max: 60 });
    const note = text(req.body?.note, { field: '备注', max: 500 });
    if (db.prepare('SELECT 1 FROM equipment WHERE code = ?').get(code)) {
      throw new HttpError(409, '设备编号已存在');
    }
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO equipment (code, name, category, type_name, location, status, requires_approval, note,
                                  created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          code,
          name,
          category,
          typeName,
          location,
          status,
          req.body?.requiresApproval === false ? 0 : 1,
          note,
          now,
          now,
        );
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'equipment.create',
        entityType: 'equipment',
        entityId: newId,
        detail: { code, name, category },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapEquipment(getEquipment(id)) });
  }),
);

equipmentRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const target = getEquipment(req.params.id);
    const name = req.body?.name === undefined ? target.name : text(req.body.name, { field: '设备名称', required: true, max: 60 });
    const category = req.body?.category === undefined ? target.category : req.body.category;
    if (!EQUIPMENT_CATEGORY.includes(category)) throw new HttpError(400, '设备类别不正确');
    const typeName =
      req.body?.typeName === undefined ? target.type_name : text(req.body.typeName, { field: '设备类型', max: 40 });
    const status = req.body?.status === undefined ? target.status : req.body.status;
    if (!EQUIPMENT_STATUS.includes(status)) throw new HttpError(400, '设备状态不正确');
    const location =
      req.body?.location === undefined ? target.location : text(req.body.location, { field: '存放位置', max: 60 });
    const note = req.body?.note === undefined ? target.note : text(req.body.note, { field: '备注', max: 500 });
    const requiresApproval =
      req.body?.requiresApproval === undefined ? target.requires_approval : req.body.requiresApproval === false ? 0 : 1;

    tx(() => {
      db.prepare(
        `UPDATE equipment SET name = ?, category = ?, type_name = ?, status = ?, location = ?, note = ?,
                              requires_approval = ?, updated_at = ?
         WHERE id = ?`,
      ).run(name, category, typeName, status, location, note, requiresApproval, nowIso(), target.id);
      audit({
        actor: req.user,
        action: 'equipment.update',
        entityType: 'equipment',
        entityId: target.id,
        detail: { code: target.code, before: { status: target.status, name: target.name }, after: { status, name } },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapEquipment(getEquipment(target.id)) });
  }),
);

equipmentRouter.delete(
  '/:id',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const target = getEquipment(req.params.id);
    const activeBookings = db
      .prepare("SELECT COUNT(*) AS c FROM equipment_bookings WHERE equipment_id = ? AND status IN ('pending','approved')")
      .get(target.id).c;
    const activeBorrows = db
      .prepare("SELECT COUNT(*) AS c FROM borrow_records WHERE equipment_id = ? AND status != 'returned'")
      .get(target.id).c;
    if (activeBookings > 0 || activeBorrows > 0) {
      throw new HttpError(409, '该设备存在进行中的预约或借用，不能删除');
    }
    const historyCount = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM equipment_bookings WHERE equipment_id = ?) +
           (SELECT COUNT(*) FROM print_jobs WHERE equipment_id = ?) +
           (SELECT COUNT(*) FROM maintenance_logs WHERE equipment_id = ?) +
           (SELECT COUNT(*) FROM borrow_records WHERE equipment_id = ?) AS c`,
      )
      .get(target.id, target.id, target.id, target.id).c;
    if (historyCount > 0) {
      throw new HttpError(409, '该设备已有历史预约/打印/维护记录，无法删除，可把状态改为「停用」');
    }
    tx(() => {
      db.prepare('DELETE FROM equipment WHERE id = ?').run(target.id);
      audit({
        actor: req.user,
        action: 'equipment.delete',
        entityType: 'equipment',
        entityId: target.id,
        detail: { code: target.code, name: target.name },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.status(204).end();
  }),
);

/* ------------------------------- 设备预约 ------------------------------- */

equipmentRouter.get(
  '/bookings',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `${BOOKING_SELECT} WHERE 1 = 1`;
    if (req.query.status) {
      sql += ' AND b.status = ?';
      params.push(String(req.query.status));
    }
    if (req.query.equipmentId) {
      sql += ' AND b.equipment_id = ?';
      params.push(Number(req.query.equipmentId));
    }
    if (req.query.mine === '1') {
      sql += ' AND b.user_id = ?';
      params.push(req.user.id);
    }
    if (req.query.from) {
      sql += ' AND b.end_at >= ?';
      params.push(parseDateTime(req.query.from, '起始日期'));
    }
    sql += ' ORDER BY b.start_at DESC LIMIT 200';
    const items = db
      .prepare(sql)
      .all(...params)
      .map(mapBooking);
    const pending = db.prepare("SELECT COUNT(*) AS c FROM equipment_bookings WHERE status = 'pending'").get().c;
    res.json({ items, pending });
  }),
);

equipmentRouter.post(
  '/bookings',
  requireAuth,
  ah((req, res) => {
    const equipment = getEquipment(req.body?.equipmentId);
    if (equipment.status === 'retired') throw new HttpError(409, '该设备已停用，无法预约');
    if (equipment.status === 'maintenance') throw new HttpError(409, '该设备正在维护，暂不可预约');
    const startAt = parseDateTime(req.body?.startAt, '开始时间');
    const endAt = parseDateTime(req.body?.endAt, '结束时间');
    if (new Date(endAt) <= new Date(startAt)) throw new HttpError(400, '结束时间需晚于开始时间');
    const purpose = text(req.body?.purpose, { field: '预约用途', required: true, max: 200 });
    const conflict = db
      .prepare(
        `SELECT 1 FROM equipment_bookings
         WHERE equipment_id = ? AND status IN ('pending','approved') AND start_at < ? AND end_at > ?`,
      )
      .get(equipment.id, endAt, startAt);
    if (conflict) throw new HttpError(409, '该时间段已被预约，请选择其他时间');
    const pendingSame = db
      .prepare(
        `SELECT 1 FROM equipment_bookings
         WHERE equipment_id = ? AND user_id = ? AND status = 'pending' AND start_at < ? AND end_at > ?`,
      )
      .get(equipment.id, req.user.id, endAt, startAt);
    if (pendingSame) throw new HttpError(409, '你已有重叠时间段的待审核预约');

    const autoApprove = !equipment.requires_approval;
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO equipment_bookings
             (equipment_id, user_id, start_at, end_at, purpose, status, reviewed_by, reviewed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          equipment.id,
          req.user.id,
          startAt,
          endAt,
          purpose,
          autoApprove ? 'approved' : 'pending',
          autoApprove ? req.user.id : null,
          autoApprove ? now : null,
          now,
          now,
        );
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'equipment.book',
        entityType: 'equipment_booking',
        entityId: newId,
        detail: { equipment: equipment.name, startAt, endAt, autoApprove },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    const item = db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
    res.status(201).json({ item: mapBooking(item) });
  }),
);

equipmentRouter.post(
  '/bookings/:id/review',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM equipment_bookings WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '预约不存在');
    if (target.status !== 'pending') throw new HttpError(409, '该预约已处理，不能重复审核');
    const result = req.body?.result === 'reject' ? 'reject' : 'approve';
    const reason = text(req.body?.reason, { field: '审核意见', max: 200 });
    if (result === 'reject' && !reason) throw new HttpError(400, '驳回时请填写原因');
    const now = nowIso();
    tx(() => {
      const changed = db
        .prepare(
          `UPDATE equipment_bookings
           SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(result === 'approve' ? 'approved' : 'rejected', req.user.id, now, reason || null, now, target.id).changes;
      if (changed === 0) throw new HttpError(409, '该预约已被其他人处理，请刷新');
      audit({
        actor: req.user,
        action: 'equipment.review',
        entityType: 'equipment_booking',
        entityId: target.id,
        detail: { result, reason },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapBooking(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(target.id)) });
  }),
);

equipmentRouter.post(
  '/bookings/:id/cancel',
  requireAuth,
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM equipment_bookings WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '预约不存在');
    const isOwner = target.user_id === req.user.id;
    if (!isOwner && !hasPerm(req.user, 'equipment')) {
      throw new HttpError(403, '只能取消自己的预约');
    }
    if (!['pending', 'approved'].includes(target.status)) throw new HttpError(409, '该预约当前不可取消');
    tx(() => {
      db.prepare("UPDATE equipment_bookings SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
        nowIso(),
        target.id,
      );
      audit({
        actor: req.user,
        action: 'equipment.cancel',
        entityType: 'equipment_booking',
        entityId: target.id,
        detail: { byOwner: isOwner },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapBooking(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(target.id)) });
  }),
);

equipmentRouter.post(
  '/bookings/:id/complete',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM equipment_bookings WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '预约不存在');
    if (target.status !== 'approved') throw new HttpError(409, '只有已通过的预约可以标记完成');
    tx(() => {
      db.prepare("UPDATE equipment_bookings SET status = 'completed', updated_at = ? WHERE id = ?").run(
        nowIso(),
        target.id,
      );
      audit({
        actor: req.user,
        action: 'equipment.complete',
        entityType: 'equipment_booking',
        entityId: target.id,
        detail: {},
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapBooking(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(target.id)) });
  }),
);

/* ------------------------------- 打印任务 ------------------------------- */

equipmentRouter.get(
  '/print-jobs',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `${JOB_SELECT} WHERE 1 = 1`;
    if (req.query.status) {
      sql += ' AND j.status = ?';
      params.push(String(req.query.status));
    }
    if (req.query.mine === '1') {
      sql += ' AND j.user_id = ?';
      params.push(req.user.id);
    }
    sql += ' ORDER BY j.created_at DESC LIMIT 200';
    const items = db
      .prepare(sql)
      .all(...params)
      .map(mapJob);
    const stats = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM print_jobs WHERE status = 'queued') AS queued,
           (SELECT COUNT(*) FROM print_jobs WHERE status = 'printing') AS printing,
           (SELECT COUNT(*) FROM print_jobs WHERE status = 'done') AS done,
           (SELECT COALESCE(SUM(weight_grams), 0) FROM print_jobs WHERE status = 'done') AS grams`,
      )
      .get();
    res.json({ items, stats });
  }),
);

equipmentRouter.post(
  '/print-jobs',
  requireAuth,
  modelUpload.single('file'),
  ah((req, res) => {
    const equipment = getEquipment(req.body?.equipmentId);
    if (equipment.category !== 'printer') throw new HttpError(400, '请选择 3D 打印机');
    if (equipment.status !== 'available') throw new HttpError(409, '该打印机当前不可用');
    const title = text(req.body?.title, { field: '任务名称', required: true, max: 80 });
    const fileName = req.file
      ? text(req.file.originalname, { field: '模型文件名', max: 120 })
      : text(req.body?.fileName, { field: '模型文件名', max: 120 });
    const note = text(req.body?.note, { field: '备注', max: 500 });
    const weightGrams = optionalNumber(req.body?.weightGrams, { field: '预计耗材', min: 0, max: 100000, integer: true });
    const estMinutes = optionalNumber(req.body?.estMinutes, { field: '预计时长', min: 0, max: 100000, integer: true });
    let materialId = null;
    if (req.body?.materialId) {
      const material = db.prepare('SELECT * FROM consumables WHERE id = ?').get(Number(req.body.materialId));
      if (!material) throw new HttpError(400, '耗材不存在');
      materialId = material.id;
    }
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO print_jobs
             (equipment_id, user_id, booking_id, title, file_name, file_stored, file_size, material_id,
              weight_grams, est_minutes, status, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        )
        .run(
          equipment.id,
          req.user.id,
          req.body?.bookingId ? Number(req.body.bookingId) : null,
          title,
          fileName,
          req.file ? req.file.filename : null,
          req.file ? req.file.size : null,
          materialId,
          weightGrams,
          estMinutes,
          note,
          now,
          now,
        );
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'print.create',
        entityType: 'print_job',
        entityId: newId,
        detail: { title, equipment: equipment.name, weightGrams },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapJob(db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id)) });
  }),
);

equipmentRouter.get(
  '/print-jobs/:id/file',
  requireAuth,
  ah((req, res) => {
    const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(Number(req.params.id));
    if (!job) throw new HttpError(404, '打印任务不存在');
    if (!job.file_stored) throw new HttpError(404, '该任务没有上传模型文件');
    const filePath = path.join(UPLOAD_DIR, job.file_stored);
    if (!fs.existsSync(filePath)) throw new HttpError(404, '模型文件已丢失');
    res.download(filePath, job.file_name || job.file_stored);
  }),
);

equipmentRouter.patch(
  '/print-jobs/:id',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(Number(req.params.id));
    if (!job) throw new HttpError(404, '打印任务不存在');
    const status = req.body?.status === undefined ? job.status : req.body.status;
    if (!JOB_STATUS.includes(status)) throw new HttpError(400, '任务状态不正确');
    if (job.status === 'done' || job.status === 'cancelled') throw new HttpError(409, '该任务已结束，不能再变更状态');
    if (status === 'queued' && job.status !== 'queued') throw new HttpError(409, '不能退回队列');

    const now = nowIso();
    tx(() => {
      if (status === 'done') {
        const grams = Number(job.weight_grams || 0);
        if (job.material_id && grams > 0) {
          const material = db.prepare('SELECT * FROM consumables WHERE id = ?').get(job.material_id);
          if (!material) throw new HttpError(409, '关联耗材已被删除，无法结算');
          if (Number(material.stock) < grams) {
            throw new HttpError(409, `耗材「${material.name}」库存不足（剩余 ${material.stock}${material.unit}）`);
          }
          db.prepare('UPDATE consumables SET stock = stock - ?, updated_at = ? WHERE id = ?').run(
            grams,
            now,
            material.id,
          );
          db.prepare(
            `INSERT INTO consumable_logs (consumable_id, delta, reason, ref_type, ref_id, note, operator_id, created_at)
             VALUES (?, ?, 'print', 'print_job', ?, ?, ?, ?)`,
          ).run(material.id, -grams, job.id, `打印任务「${job.title}」结算`, req.user.id, now);
        }
      }
      db.prepare(
        `UPDATE print_jobs SET status = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      ).run(
        status,
        status === 'printing' ? job.started_at || now : job.started_at,
        status === 'done' || status === 'failed' ? now : job.finished_at,
        now,
        job.id,
      );
      audit({
        actor: req.user,
        action: 'print.update',
        entityType: 'print_job',
        entityId: job.id,
        detail: { title: job.title, before: job.status, after: status },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapJob(db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(job.id)) });
  }),
);

/* ------------------------------- 维护记录 ------------------------------- */

equipmentRouter.get(
  '/maintenance',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `SELECT m.*, e.name AS equipment_name, u.display_name AS operator_name
               FROM maintenance_logs m
               JOIN equipment e ON e.id = m.equipment_id
               JOIN users u ON u.id = m.operator_id
               WHERE 1 = 1`;
    if (req.query.equipmentId) {
      sql += ' AND m.equipment_id = ?';
      params.push(Number(req.query.equipmentId));
    }
    sql += ' ORDER BY m.performed_at DESC LIMIT 200';
    res.json({ items: db.prepare(sql).all(...params).map(mapMaintenance) });
  }),
);

equipmentRouter.post(
  '/maintenance',
  requireAuth,
  requirePerm('equipment'),
  ah((req, res) => {
    const equipment = getEquipment(req.body?.equipmentId);
    const type = ['routine', 'repair', 'inspection'].includes(req.body?.type) ? req.body.type : 'routine';
    const content = text(req.body?.content, { field: '维护内容', required: true, max: 500 });
    const costCents = optionalNumber(req.body?.costCents, { field: '维护费用', min: 0, max: 100000000, integer: true }) || 0;
    const performedBy = text(req.body?.performedBy, { field: '执行人', max: 40 });
    const performedAt = req.body?.performedAt
      ? parseDateTime(req.body.performedAt, '维护时间')
      : nowIso();
    const nextDueAt = req.body?.nextDueAt ? parseDateTime(req.body.nextDueAt, '下次维护时间') : null;
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO maintenance_logs
             (equipment_id, type, content, cost_cents, performed_by, performed_at, next_due_at, operator_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(equipment.id, type, content, costCents, performedBy, performedAt, nextDueAt, req.user.id, now);
      const newId = Number(result.lastInsertRowid);
      if (type === 'repair') {
        db.prepare("UPDATE equipment SET status = 'available', updated_at = ? WHERE id = ?").run(now, equipment.id);
      }
      audit({
        actor: req.user,
        action: 'equipment.maintenance',
        entityType: 'equipment',
        entityId: equipment.id,
        detail: { type, content, costCents },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    const row = db
      .prepare(
        `SELECT m.*, e.name AS equipment_name, u.display_name AS operator_name
         FROM maintenance_logs m JOIN equipment e ON e.id = m.equipment_id JOIN users u ON u.id = m.operator_id
         WHERE m.id = ?`,
      )
      .get(id);
    res.status(201).json({ item: mapMaintenance(row) });
  }),
);

/* -------------------------------- 耗材 -------------------------------- */

consumableRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const items = db
      .prepare('SELECT * FROM consumables WHERE archived = 0 ORDER BY name')
      .all()
      .map(mapConsumable);
    res.json({ items });
  }),
);

consumableRouter.post(
  '/',
  requireAuth,
  requirePerm('equipment', 'inventory'),
  ah((req, res) => {
    const name = text(req.body?.name, { field: '耗材名称', required: true, max: 60 });
    const spec = text(req.body?.spec, { field: '规格', max: 60 });
    const unit = text(req.body?.unit, { field: '单位', max: 10 }) || 'g';
    const stock = optionalNumber(req.body?.stock, { field: '初始库存', min: 0, max: 1000000 }) || 0;
    const warnThreshold = optionalNumber(req.body?.warnThreshold, { field: '预警阈值', min: 0, max: 1000000 }) || 0;
    const unitPriceCents =
      optionalNumber(req.body?.unitPriceCents, { field: '单价', min: 0, max: 100000000, integer: true }) || 0;
    const note = text(req.body?.note, { field: '备注', max: 300 });
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO consumables (name, spec, unit, stock, warn_threshold, unit_price_cents, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(name, spec, unit, stock, warnThreshold, unitPriceCents, note, now, now);
      const newId = Number(result.lastInsertRowid);
      if (stock > 0) {
        db.prepare(
          `INSERT INTO consumable_logs (consumable_id, delta, reason, note, operator_id, created_at)
           VALUES (?, ?, 'restock', '初始入库', ?, ?)`,
        ).run(newId, stock, req.user.id, now);
      }
      audit({
        actor: req.user,
        action: 'consumable.create',
        entityType: 'consumable',
        entityId: newId,
        detail: { name, stock, unit },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapConsumable(db.prepare('SELECT * FROM consumables WHERE id = ?').get(id)) });
  }),
);

consumableRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('equipment', 'inventory'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM consumables WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '耗材不存在');
    const name = req.body?.name === undefined ? target.name : text(req.body.name, { field: '耗材名称', required: true, max: 60 });
    const spec = req.body?.spec === undefined ? target.spec : text(req.body.spec, { field: '规格', max: 60 });
    const unit = req.body?.unit === undefined ? target.unit : text(req.body.unit, { field: '单位', max: 10 }) || target.unit;
    const warnThreshold =
      req.body?.warnThreshold === undefined
        ? target.warn_threshold
        : optionalNumber(req.body.warnThreshold, { field: '预警阈值', min: 0, max: 1000000 }) || 0;
    const unitPriceCents =
      req.body?.unitPriceCents === undefined
        ? target.unit_price_cents
        : optionalNumber(req.body.unitPriceCents, { field: '单价', min: 0, max: 100000000, integer: true }) || 0;
    const note = req.body?.note === undefined ? target.note : text(req.body.note, { field: '备注', max: 300 });
    const archived = req.body?.archived === undefined ? target.archived : req.body.archived ? 1 : 0;
    tx(() => {
      db.prepare(
        `UPDATE consumables SET name = ?, spec = ?, unit = ?, warn_threshold = ?, unit_price_cents = ?,
                                note = ?, archived = ?, updated_at = ?
         WHERE id = ?`,
      ).run(name, spec, unit, warnThreshold, unitPriceCents, note, archived, nowIso(), target.id);
      audit({
        actor: req.user,
        action: 'consumable.update',
        entityType: 'consumable',
        entityId: target.id,
        detail: { name },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapConsumable(db.prepare('SELECT * FROM consumables WHERE id = ?').get(target.id)) });
  }),
);

consumableRouter.post(
  '/:id/stock',
  requireAuth,
  requirePerm('equipment', 'inventory'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM consumables WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '耗材不存在');
    const reason = ['restock', 'adjust', 'scrap'].includes(req.body?.reason) ? req.body.reason : 'restock';
    const delta = parseNumber(req.body?.delta, { field: '变动数量', min: -1000000, max: 1000000 });
    if (delta === 0) throw new HttpError(400, '变动数量不能为 0');
    if (Number(target.stock) + delta < 0) throw new HttpError(409, '库存不足，无法扣减');
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const now = nowIso();
    tx(() => {
      db.prepare('UPDATE consumables SET stock = stock + ?, updated_at = ? WHERE id = ?').run(delta, now, target.id);
      db.prepare(
        `INSERT INTO consumable_logs (consumable_id, delta, reason, note, operator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(target.id, delta, reason, note, req.user.id, now);
      audit({
        actor: req.user,
        action: 'consumable.stock',
        entityType: 'consumable',
        entityId: target.id,
        detail: { name: target.name, delta, reason },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapConsumable(db.prepare('SELECT * FROM consumables WHERE id = ?').get(target.id)) });
  }),
);

consumableRouter.get(
  '/:id/logs',
  requireAuth,
  ah((req, res) => {
    const rows = db
      .prepare(
        `SELECT l.*, u.display_name AS operator_name
         FROM consumable_logs l JOIN users u ON u.id = l.operator_id
         WHERE l.consumable_id = ? ORDER BY l.created_at DESC LIMIT 100`,
      )
      .all(Number(req.params.id));
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        delta: Number(row.delta),
        reason: row.reason,
        note: row.note || '',
        operatorName: row.operator_name,
        createdAt: row.created_at,
      })),
    });
  }),
);

/* ------------------------------- 设备借还 ------------------------------- */

const BORROW_SELECT = `
  SELECT b.*, e.name AS equipment_name, e.code AS equipment_code, u.display_name AS user_name,
         r.display_name AS reviewer_name
  FROM borrow_records b
  JOIN equipment e ON e.id = b.equipment_id
  JOIN users u ON u.id = b.user_id
  LEFT JOIN users r ON r.id = b.reviewer_id`;

borrowRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = `${BORROW_SELECT} WHERE 1 = 1`;
    if (req.query.status) {
      sql += ' AND b.status = ?';
      params.push(String(req.query.status));
    }
    if (req.query.mine === '1') {
      sql += ' AND b.user_id = ?';
      params.push(req.user.id);
    }
    sql += ' ORDER BY b.borrowed_at DESC LIMIT 200';
    const items = db
      .prepare(sql)
      .all(...params)
      .map(mapBorrow);
    const summary = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM borrow_records WHERE status = 'borrowed') AS borrowed,
           (SELECT COUNT(*) FROM borrow_records WHERE status = 'borrowed' AND due_at < ?) AS overdue,
           (SELECT COUNT(*) FROM borrow_records WHERE status = 'returned') AS returned`,
      )
      .get(nowIso());
    res.json({ items, summary });
  }),
);

borrowRouter.post(
  '/',
  requireAuth,
  ah((req, res) => {
    const equipment = getEquipment(req.body?.equipmentId);
    if (equipment.status !== 'available') throw new HttpError(409, '该设备当前不可借用');
    const active = db
      .prepare("SELECT 1 FROM borrow_records WHERE equipment_id = ? AND status != 'returned'")
      .get(equipment.id);
    if (active) throw new HttpError(409, '该设备已被借出，尚未归还');
    let userId = req.user.id;
    if (req.body?.userId && req.body.userId !== req.user.id) {
      if (!hasPerm(req.user, 'inventory')) throw new HttpError(403, '不能替他人借用设备');
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.body.userId));
      if (!target || target.status !== 'active') throw new HttpError(400, '借用人不存在');
      userId = target.id;
    }
    const dueAt = parseDateTime(req.body?.dueAt, '归还时间');
    if (new Date(dueAt) <= new Date()) throw new HttpError(400, '归还时间需晚于当前时间');
    const conditionNote = text(req.body?.conditionNote, { field: '借用说明', max: 300 });
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO borrow_records
             (equipment_id, user_id, borrowed_at, due_at, status, condition_note, reviewer_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'borrowed', ?, ?, ?, ?)`,
        )
        .run(equipment.id, userId, now, dueAt, conditionNote, req.user.id, now, now);
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'borrow.create',
        entityType: 'borrow_record',
        entityId: newId,
        detail: { equipment: equipment.name, dueAt, userId },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapBorrow(db.prepare(`${BORROW_SELECT} WHERE b.id = ?`).get(id)) });
  }),
);

borrowRouter.post(
  '/:id/return',
  requireAuth,
  requirePerm('inventory', 'equipment'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '借用记录不存在');
    if (target.status === 'returned') throw new HttpError(409, '该设备已归还');
    const conditionNote = text(req.body?.conditionNote, { field: '归还说明', max: 300 });
    const now = nowIso();
    tx(() => {
      db.prepare(
        `UPDATE borrow_records SET status = 'returned', returned_at = ?, condition_note = ?, reviewer_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(now, conditionNote || target.condition_note, req.user.id, now, target.id);
      audit({
        actor: req.user,
        action: 'borrow.return',
        entityType: 'borrow_record',
        entityId: target.id,
        detail: { conditionNote },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapBorrow(db.prepare(`${BORROW_SELECT} WHERE b.id = ?`).get(target.id)) });
  }),
);

borrowRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('inventory', 'equipment'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '借用记录不存在');
    if (target.status === 'returned') throw new HttpError(409, '已归还的记录不能再修改');
    const dueAt = req.body?.dueAt ? parseDateTime(req.body.dueAt, '归还时间') : target.due_at;
    tx(() => {
      db.prepare('UPDATE borrow_records SET due_at = ?, updated_at = ? WHERE id = ?').run(dueAt, nowIso(), target.id);
      audit({
        actor: req.user,
        action: 'borrow.update',
        entityType: 'borrow_record',
        entityId: target.id,
        detail: { before: target.due_at, after: dueAt },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapBorrow(db.prepare(`${BORROW_SELECT} WHERE b.id = ?`).get(target.id)) });
  }),
);
