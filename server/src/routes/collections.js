import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, audit, nowIso, tx } from '../db.js';
import { hasPerm, requireAuth, requirePerm } from '../auth.js';
import { UPLOAD_DIR } from '../config.js';
import { HttpError, ah, clientIp, parseAmountCents, parseDateOnly, text } from '../helpers.js';

export const collectionRouter = express.Router();
export const collectionFileRouter = express.Router();

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

const canReview = (user) => user.role === 'admin' || (hasPerm(user, 'finance') && !!user.can_income);

function readCollectionPayload(body) {
  const title = text(body?.title, { field: '收款名称', required: true, max: 60 });
  const amountCents = parseAmountCents(body?.amount);
  const dueDate = body?.dueDate ? parseDateOnly(body.dueDate, '截止日期') : null;
  const note = text(body?.note, { field: '说明', max: 500 });
  return { title, amountCents, dueDate, note };
}

function attachmentsFor(paymentIds) {
  if (!paymentIds.length) return new Map();
  const placeholders = paymentIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, payment_id, original_name, mime, size, created_at
       FROM payment_attachments WHERE payment_id IN (${placeholders}) ORDER BY id`,
    )
    .all(...paymentIds);
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.payment_id) || [];
    list.push({
      id: row.id,
      originalName: row.original_name,
      mime: row.mime,
      size: row.size,
      createdAt: row.created_at,
    });
    map.set(row.payment_id, list);
  }
  return map;
}

function mapPayment(row, attachments = []) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    amountCents: row.amount_cents,
    note: row.note,
    status: row.status,
    rejectReason: row.reject_reason,
    reviewedAt: row.reviewed_at,
    reviewedByName: row.reviewed_by_name || null,
    transactionId: row.transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments,
  };
}

function collectionStats(collectionId, memberCount, amountCents) {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         COALESCE(SUM(CASE WHEN status = 'approved' THEN amount_cents ELSE 0 END), 0) AS collected
       FROM collection_payments WHERE collection_id = ?`,
    )
    .get(collectionId);
  const approvedCount = Number(row.approved || 0);
  return {
    memberCount,
    approvedCount,
    pendingCount: Number(row.pending || 0),
    rejectedCount: Number(row.rejected || 0),
    collectedCents: Number(row.collected || 0),
    expectedCents: memberCount * amountCents,
  };
}

function activeMemberCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;
}

collectionRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, u.display_name AS created_by_name
         FROM collections c JOIN users u ON u.id = c.created_by
         ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.created_at DESC`,
      )
      .all();
    const memberCount = activeMemberCount();
    const myPayments = db
      .prepare(
        `SELECT p.*, u.username, u.display_name, r.display_name AS reviewed_by_name
         FROM collection_payments p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN users r ON r.id = p.reviewed_by
         WHERE p.user_id = ?`,
      )
      .all(req.user.id);
    const attachmentMap = attachmentsFor(myPayments.map((p) => p.id));
    const myMap = new Map(
      myPayments.map((p) => [p.collection_id, mapPayment(p, attachmentMap.get(p.id) || [])]),
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        amountCents: row.amount_cents,
        dueDate: row.due_date,
        note: row.note,
        status: row.status,
        createdByName: row.created_by_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stats: collectionStats(row.id, memberCount, row.amount_cents),
        myPayment: myMap.get(row.id) || null,
      })),
      canManage: canReview(req.user),
    });
  }),
);

collectionRouter.post(
  '/',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    if (!canReview(req.user)) throw new HttpError(403, '没有发布收款台账的权限');
    const payload = readCollectionPayload(req.body || {});
    const now = nowIso();
    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO collections (title, amount_cents, due_date, note, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
        )
        .run(
          payload.title,
          payload.amountCents,
          payload.dueDate,
          payload.note || null,
          req.user.id,
          now,
          now,
        );
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'collection.create',
        entityType: 'collection',
        entityId: newId,
        detail: { title: payload.title, amountCents: payload.amountCents, dueDate: payload.dueDate },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });
    res.status(201).json({ id });
  }),
);

collectionRouter.patch(
  '/:id',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    if (!canReview(req.user)) throw new HttpError(403, '没有管理收款台账的权限');
    const id = Number.parseInt(req.params.id, 10);
    const current = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, '收款任务不存在');

    const payload = readCollectionPayload(req.body || {});
    const status =
      req.body?.status === 'closed' ? 'closed' : req.body?.status === 'open' ? 'open' : current.status;
    const paymentCount = db
      .prepare('SELECT COUNT(*) AS c FROM collection_payments WHERE collection_id = ?')
      .get(id).c;
    if (payload.amountCents !== current.amount_cents && paymentCount > 0) {
      throw new HttpError(409, '已有成员提交缴纳记录，不能再修改收款金额');
    }

    tx(() => {
      db.prepare(
        `UPDATE collections SET title = ?, amount_cents = ?, due_date = ?, note = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(payload.title, payload.amountCents, payload.dueDate, payload.note || null, status, nowIso(), id);
      audit({
        actor: req.user,
        action: 'collection.update',
        entityType: 'collection',
        entityId: id,
        detail: {
          before: { title: current.title, amountCents: current.amount_cents, status: current.status },
          after: { title: payload.title, amountCents: payload.amountCents, status },
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ ok: true });
  }),
);

collectionRouter.get(
  '/:id/payments',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    if (!canReview(req.user)) throw new HttpError(403, '没有查看缴纳记录的权限');
    const id = Number.parseInt(req.params.id, 10);
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
    if (!collection) throw new HttpError(404, '收款任务不存在');

    const rows = db
      .prepare(
        `SELECT p.*, u.username, u.display_name, r.display_name AS reviewed_by_name
         FROM collection_payments p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN users r ON r.id = p.reviewed_by
         WHERE p.collection_id = ?
         ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, p.created_at DESC`,
      )
      .all(id);
    const attachmentMap = attachmentsFor(rows.map((row) => row.id));
    res.json({
      items: rows.map((row) => mapPayment(row, attachmentMap.get(row.id) || [])),
      stats: collectionStats(id, activeMemberCount(), collection.amount_cents),
    });
  }),
);

collectionRouter.post(
  '/:id/payments',
  requireAuth,
  upload.array('files', 6),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
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

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
    if (!collection) {
      cleanup();
      throw new HttpError(404, '收款任务不存在');
    }
    if (collection.status !== 'open') {
      cleanup();
      throw new HttpError(409, '该收款已结束，不能再提交');
    }

    const existing = db
      .prepare('SELECT * FROM collection_payments WHERE collection_id = ? AND user_id = ?')
      .get(id, req.user.id);
    if (existing?.status === 'approved') {
      cleanup();
      throw new HttpError(409, '该笔缴纳已审核通过，无需重复提交');
    }
    if (existing?.status === 'pending') {
      cleanup();
      throw new HttpError(409, '已提交缴纳凭证，请等待审核');
    }
    if (files.length === 0) {
      cleanup();
      throw new HttpError(400, '请至少上传一张缴纳凭证');
    }

    const note = text(req.body?.note, { field: '备注', max: 300 });
    const now = nowIso();

    try {
      const paymentId = tx(() => {
        let id2;
        if (existing) {
          const oldFiles = db
            .prepare('SELECT stored_name FROM payment_attachments WHERE payment_id = ?')
            .all(existing.id);
          db.prepare('DELETE FROM payment_attachments WHERE payment_id = ?').run(existing.id);
          for (const old of oldFiles) {
            try {
              fs.unlinkSync(path.join(UPLOAD_DIR, old.stored_name));
            } catch {
              /* ignore */
            }
          }
          db.prepare(
            `UPDATE collection_payments
             SET amount_cents = ?, note = ?, status = 'pending', reviewed_by = NULL,
                 reviewed_at = NULL, reject_reason = NULL, updated_at = ?
             WHERE id = ?`,
          ).run(collection.amount_cents, note || null, now, existing.id);
          id2 = existing.id;
        } else {
          const result = db
            .prepare(
              `INSERT INTO collection_payments
                 (collection_id, user_id, amount_cents, note, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
            )
            .run(id, req.user.id, collection.amount_cents, note || null, now, now);
          id2 = Number(result.lastInsertRowid);
        }

        const insertAttachment = db.prepare(
          `INSERT INTO payment_attachments
             (payment_id, original_name, stored_name, mime, size, sha256, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const file of files) {
          const buffer = fs.readFileSync(path.join(UPLOAD_DIR, file.filename));
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          insertAttachment.run(
            id2,
            Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 160),
            file.filename,
            file.mimetype,
            file.size,
            sha256,
            req.user.id,
            now,
          );
        }

        audit({
          actor: req.user,
          action: 'collection.pay',
          entityType: 'collection',
          entityId: id,
          detail: { paymentId: id2, title: collection.title, count: files.length },
          ip: clientIp(req),
          userAgent: req.headers['user-agent'],
        });
        return id2;
      });
      res.status(201).json({ id: paymentId });
    } catch (err) {
      cleanup();
      throw err;
    }
  }),
);

collectionRouter.post(
  '/payments/:id/review',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    if (!canReview(req.user)) throw new HttpError(403, '没有审核缴纳记录的权限');
    const paymentId = Number.parseInt(req.params.id, 10);
    const action = req.body?.action;
    if (action !== 'approve' && action !== 'reject') throw new HttpError(400, '审核操作不正确');

    const payment = db
      .prepare(
        `SELECT p.*, c.title, c.note AS collection_note, u.display_name
         FROM collection_payments p
         JOIN collections c ON c.id = p.collection_id
         JOIN users u ON u.id = p.user_id
         WHERE p.id = ?`,
      )
      .get(paymentId);
    if (!payment) throw new HttpError(404, '缴纳记录不存在');
    if (payment.status !== 'pending') throw new HttpError(409, '该缴纳记录已审核，请刷新页面');
    if (action === 'reject' && !req.body?.reason) throw new HttpError(400, '请填写驳回原因');

    const createTransaction = action === 'approve' && req.body?.createTransaction !== false;
    const reason = action === 'reject' ? text(req.body.reason, { field: '驳回原因', max: 200 }) : null;
    const now = nowIso();

    tx(() => {
      let transactionId = null;
      if (createTransaction) {
        const txReason = `收款台账：${payment.title} - ${payment.display_name}`.slice(0, 200);
        const inserted = db
          .prepare(
            `INSERT INTO transactions
               (type, amount_cents, category_id, reason, counterparty, note, occurred_at,
                operator_id, version, client_request_id, created_at, updated_at)
             VALUES ('income', ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(
            payment.amount_cents,
            txReason,
            payment.display_name,
            payment.collection_note || null,
            now.slice(0, 10),
            req.user.id,
            `collection-payment:${payment.id}`,
            now,
            now,
          );
        transactionId = Number(inserted.lastInsertRowid);
      }

      const updated = db
        .prepare(
          `UPDATE collection_payments
           SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ?, transaction_id = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          action === 'approve' ? 'approved' : 'rejected',
          req.user.id,
          now,
          reason,
          transactionId,
          now,
          payment.id,
        );
      if (updated.changes === 0) throw new HttpError(409, '该缴纳记录已被他人审核，请刷新页面');

      audit({
        actor: req.user,
        action: 'collection.review',
        entityType: 'collection',
        entityId: payment.collection_id,
        detail: {
          paymentId: payment.id,
          result: action,
          createTransaction,
          transactionId,
          reason,
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });

    res.json({ ok: true });
  }),
);

collectionRouter.post(
  '/:id/payments/approve-all',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    if (!canReview(req.user)) throw new HttpError(403, '没有审核缴纳记录的权限');
    const collectionId = Number.parseInt(req.params.id, 10);
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId);
    if (!collection) throw new HttpError(404, '收款任务不存在');

    const pendingRows = db
      .prepare(
        `SELECT p.*, u.display_name FROM collection_payments p
         JOIN users u ON u.id = p.user_id
         WHERE p.collection_id = ? AND p.status = 'pending' ORDER BY p.id`,
      )
      .all(collectionId);
    if (pendingRows.length === 0) {
      res.json({ approved: 0 });
      return;
    }

    const createTransaction = req.body?.createTransaction !== false;
    const now = nowIso();
    let approved = 0;

    tx(() => {
      const insertTx = db.prepare(
        `INSERT INTO transactions
           (type, amount_cents, category_id, reason, counterparty, note, occurred_at,
            operator_id, version, client_request_id, created_at, updated_at)
         VALUES ('income', ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      );
      const updatePayment = db.prepare(
        `UPDATE collection_payments
         SET status = 'approved', reviewed_by = ?, reviewed_at = ?, reject_reason = NULL,
             transaction_id = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      );

      for (const payment of pendingRows) {
        let transactionId = null;
        if (createTransaction) {
          const txReason = `收款台账：${collection.title} - ${payment.display_name}`.slice(0, 200);
          const inserted = insertTx.run(
            payment.amount_cents,
            txReason,
            payment.display_name,
            collection.note || null,
            now.slice(0, 10),
            req.user.id,
            `collection-payment:${payment.id}`,
            now,
            now,
          );
          transactionId = Number(inserted.lastInsertRowid);
        }
        const updated = updatePayment.run(req.user.id, now, transactionId, now, payment.id);
        if (updated.changes === 0) throw new HttpError(409, '有缴纳记录已被他人审核，请刷新页面');
        approved += 1;
      }

      audit({
        actor: req.user,
        action: 'collection.review_all',
        entityType: 'collection',
        entityId: collectionId,
        detail: { count: approved, createTransaction },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });

    res.json({ approved });
  }),
);

collectionFileRouter.get(
  '/:id/file',
  requireAuth,
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = db
      .prepare(
        `SELECT a.*, p.user_id FROM payment_attachments a
         JOIN collection_payments p ON p.id = a.payment_id
         WHERE a.id = ?`,
      )
      .get(id);
    if (!row) throw new HttpError(404, '凭证不存在');
    if (req.user.id !== row.user_id && !canReview(req.user)) {
      throw new HttpError(403, '没有查看该凭证的权限');
    }
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
