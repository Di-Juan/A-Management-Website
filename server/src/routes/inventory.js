import express from 'express';
import { db, audit, nowIso, tx } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { HttpError, ah, clientIp, optionalNumber, parseNumber, text } from '../helpers.js';

export const inventoryRouter = express.Router();

const mapItem = (row) => ({
  id: row.id,
  name: row.name,
  spec: row.spec || '',
  package: row.package || '',
  location: row.location || '',
  quantity: row.quantity,
  unit: row.unit,
  warnThreshold: row.warn_threshold,
  note: row.note || '',
  archived: !!row.archived,
  lowStock: row.quantity <= row.warn_threshold,
  updatedAt: row.updated_at,
});

inventoryRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const params = [];
    let sql = 'SELECT * FROM inventory_items WHERE archived = 0';
    if (req.query.q) {
      sql += ' AND (name LIKE ? OR spec LIKE ? OR package LIKE ? OR location LIKE ?)';
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY name';
    let items = db
      .prepare(sql)
      .all(...params)
      .map(mapItem);
    if (req.query.low === '1') items = items.filter((item) => item.lowStock);
    const summary = db
      .prepare(
        `SELECT COUNT(*) AS kinds, COALESCE(SUM(quantity), 0) AS total,
                SUM(CASE WHEN quantity <= warn_threshold THEN 1 ELSE 0 END) AS low
         FROM inventory_items WHERE archived = 0`,
      )
      .get();
    res.json({ items, summary });
  }),
);

inventoryRouter.post(
  '/',
  requireAuth,
  requirePerm('inventory'),
  ah((req, res) => {
    const name = text(req.body?.name, { field: '物料名称', required: true, max: 60 });
    const spec = text(req.body?.spec, { field: '规格', max: 80 });
    const pack = text(req.body?.package, { field: '封装', max: 60 });
    const location = text(req.body?.location, { field: '存放位置', max: 60 });
    const unit = text(req.body?.unit, { field: '单位', max: 10 }) || '个';
    const quantity = optionalNumber(req.body?.quantity, { field: '初始数量', min: 0, max: 1000000, integer: true }) || 0;
    const warnThreshold =
      optionalNumber(req.body?.warnThreshold, { field: '预警阈值', min: 0, max: 1000000, integer: true }) || 0;
    const note = text(req.body?.note, { field: '备注', max: 300 });
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO inventory_items
             (name, spec, package, location, quantity, unit, warn_threshold, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(name, spec, pack, location, quantity, unit, warnThreshold, note, now, now);
      const newId = Number(result.lastInsertRowid);
      if (quantity > 0) {
        db.prepare(
          `INSERT INTO inventory_logs (item_id, delta, reason, note, operator_id, created_at)
           VALUES (?, ?, 'purchase', '初始入库', ?, ?)`,
        ).run(newId, quantity, req.user.id, now);
      }
      audit({
        actor: req.user,
        action: 'inventory.create',
        entityType: 'inventory_item',
        entityId: newId,
        detail: { name, quantity },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ item: mapItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id)) });
  }),
);

inventoryRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('inventory'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '物料不存在');
    const name = req.body?.name === undefined ? target.name : text(req.body.name, { field: '物料名称', required: true, max: 60 });
    const spec = req.body?.spec === undefined ? target.spec : text(req.body.spec, { field: '规格', max: 80 });
    const pack = req.body?.package === undefined ? target.package : text(req.body.package, { field: '封装', max: 60 });
    const location =
      req.body?.location === undefined ? target.location : text(req.body.location, { field: '存放位置', max: 60 });
    const unit = req.body?.unit === undefined ? target.unit : text(req.body.unit, { field: '单位', max: 10 }) || target.unit;
    const warnThreshold =
      req.body?.warnThreshold === undefined
        ? target.warn_threshold
        : optionalNumber(req.body.warnThreshold, { field: '预警阈值', min: 0, max: 1000000, integer: true }) || 0;
    const note = req.body?.note === undefined ? target.note : text(req.body.note, { field: '备注', max: 300 });
    const archived = req.body?.archived === undefined ? target.archived : req.body.archived ? 1 : 0;
    tx(() => {
      db.prepare(
        `UPDATE inventory_items SET name = ?, spec = ?, package = ?, location = ?, unit = ?,
                                    warn_threshold = ?, note = ?, archived = ?, updated_at = ?
         WHERE id = ?`,
      ).run(name, spec, pack, location, unit, warnThreshold, note, archived, nowIso(), target.id);
      audit({
        actor: req.user,
        action: 'inventory.update',
        entityType: 'inventory_item',
        entityId: target.id,
        detail: { name },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(target.id)) });
  }),
);

inventoryRouter.post(
  '/:id/stock',
  requireAuth,
  requirePerm('inventory'),
  ah((req, res) => {
    const target = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(req.params.id));
    if (!target) throw new HttpError(404, '物料不存在');
    const reason = ['purchase', 'issue', 'return', 'adjust', 'scrap'].includes(req.body?.reason)
      ? req.body.reason
      : 'purchase';
    const delta = parseNumber(req.body?.delta, { field: '变动数量', min: -1000000, max: 1000000, integer: true });
    if (delta === 0) throw new HttpError(400, '变动数量不能为 0');
    if (target.quantity + delta < 0) throw new HttpError(409, `库存不足，当前剩余 ${target.quantity}${target.unit}`);
    const ref = text(req.body?.ref, { field: '关联单据', max: 60 });
    const note = text(req.body?.note, { field: '备注', max: 200 });
    const now = nowIso();
    tx(() => {
      db.prepare('UPDATE inventory_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(
        delta,
        now,
        target.id,
      );
      db.prepare(
        `INSERT INTO inventory_logs (item_id, delta, reason, ref, note, operator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(target.id, delta, reason, ref, note, req.user.id, now);
      audit({
        actor: req.user,
        action: 'inventory.stock',
        entityType: 'inventory_item',
        entityId: target.id,
        detail: { name: target.name, delta, reason },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ item: mapItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(target.id)) });
  }),
);

inventoryRouter.get(
  '/:id/logs',
  requireAuth,
  ah((req, res) => {
    const rows = db
      .prepare(
        `SELECT l.*, u.display_name AS operator_name
         FROM inventory_logs l JOIN users u ON u.id = l.operator_id
         WHERE l.item_id = ? ORDER BY l.created_at DESC LIMIT 100`,
      )
      .all(Number(req.params.id));
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        delta: row.delta,
        reason: row.reason,
        ref: row.ref || '',
        note: row.note || '',
        operatorName: row.operator_name,
        createdAt: row.created_at,
      })),
    });
  }),
);
