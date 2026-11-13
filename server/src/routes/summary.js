import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { ah } from '../helpers.js';
import { balanceSummary, buildFilters, mapTransaction, TX_SELECT } from '../ledger.js';

export const summaryRouter = express.Router();

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

summaryRouter.get(
  '/operations',
  requireAuth,
  ah((req, res) => {
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const pendingBookings = db
      .prepare(`SELECT COUNT(*) AS c FROM equipment_bookings WHERE status = 'pending'`)
      .get().c;
    const pendingAccess = db
      .prepare(`SELECT COUNT(*) AS c FROM access_requests WHERE status = 'pending'`)
      .get().c;
    const openActivities = db.prepare(`SELECT COUNT(*) AS c FROM activities WHERE status = 'open'`).get().c;

    const lowConsumables = db
      .prepare(
        `SELECT name, stock AS quantity, unit, warn_threshold AS warn
         FROM consumables WHERE stock <= warn_threshold`,
      )
      .all()
      .map((row) => ({ ...row, kind: 'consumable' }));
    const lowItems = db
      .prepare(
        `SELECT name, quantity, unit, warn_threshold AS warn
         FROM inventory_items WHERE quantity <= warn_threshold`,
      )
      .all()
      .map((row) => ({ ...row, kind: 'item' }));
    const lowStockList = [...lowConsumables, ...lowItems];

    const myBorrowed = db
      .prepare(
        `SELECT COUNT(*) AS c FROM borrow_records
         WHERE user_id = ? AND status IN ('borrowed', 'overdue')`,
      )
      .get(req.user.id).c;
    const myOverdue = db
      .prepare(`SELECT COUNT(*) AS c FROM borrow_records WHERE user_id = ? AND status = 'overdue'`)
      .get(req.user.id).c;

    const shifts = db
      .prepare(
        `SELECT id, date, start_time, end_time, location, capacity, note
         FROM duty_shifts WHERE date = ? ORDER BY start_time`,
      )
      .all(today);
    const assignees = db.prepare(
      `SELECT da.shift_id, da.user_id, u.display_name, da.status
       FROM duty_assignments da JOIN users u ON u.id = da.user_id
       WHERE da.shift_id IN (${shifts.map(() => '?').join(',') || 'NULL'})`,
    );
    const assigneeRows = shifts.length ? assignees.all(...shifts.map((s) => s.id)) : [];

    res.json({
      pendingBookings,
      pendingAccess,
      openActivities,
      lowStock: lowStockList.length,
      lowStockPreview: lowStockList.slice(0, 4),
      myBorrowed,
      myOverdue,
      todayDuty: {
        total: shifts.length,
        mine: assigneeRows.some((row) => row.user_id === req.user.id),
        shifts: shifts.map((shift) => {
          const people = assigneeRows.filter((row) => row.shift_id === shift.id);
          return {
            id: shift.id,
            startTime: shift.start_time,
            endTime: shift.end_time,
            location: shift.location,
            capacity: shift.capacity,
            note: shift.note,
            assignees: people.map((row) => row.display_name),
            mine: people.some((row) => row.user_id === req.user.id),
          };
        }),
      },
    });
  }),
);

summaryRouter.get(
  '/',
  requireAuth,
  ah((req, res) => {
    const rangeFilters = {
      from: req.query.from || null,
      to: req.query.to || null,
      type: req.query.type || null,
    };
    const { whereSql, params } = buildFilters(rangeFilters);

    const rangeTotals = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_cents END), 0) AS income_cents,
           COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_cents END), 0) AS expense_cents,
           COUNT(*) AS count
         FROM transactions t WHERE ${whereSql}`,
      )
      .get(...params);

    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthKey(d));
    }

    const monthlyRows = db
      .prepare(
        `SELECT substr(occurred_at, 1, 7) AS month,
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income_cents,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense_cents
         FROM transactions
         WHERE deleted_at IS NULL AND substr(occurred_at, 1, 7) >= ?
         GROUP BY month`,
      )
      .all(months[0]);
    const monthlyMap = new Map(monthlyRows.map((r) => [r.month, r]));

    const byCategory = db
      .prepare(
        `SELECT c.id, COALESCE(c.name, '未分类') AS name, t.type, SUM(t.amount_cents) AS amount_cents
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${whereSql}
         GROUP BY c.id, t.type
         ORDER BY amount_cents DESC`,
      )
      .all(...params)
      .map((r) => ({
        categoryId: r.id,
        name: r.name,
        type: r.type,
        amountCents: r.amount_cents,
      }));

    const voucherCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM attachments a
         JOIN transactions t ON t.id = a.transaction_id
         WHERE a.deleted_at IS NULL AND ${whereSql}`,
      )
      .get(...params).c;

    const currentMonth = monthKey(now);
    const thisMonth = monthlyMap.get(currentMonth);

    const recentRows = db.prepare(`${TX_SELECT} WHERE t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 6`).all();

    res.json({
      balance: balanceSummary(),
      range: {
        incomeCents: rangeTotals.income_cents,
        expenseCents: rangeTotals.expense_cents,
        netCents: rangeTotals.income_cents - rangeTotals.expense_cents,
        count: rangeTotals.count,
        voucherCount,
      },
      thisMonth: {
        month: currentMonth,
        incomeCents: thisMonth?.income_cents ?? 0,
        expenseCents: thisMonth?.expense_cents ?? 0,
      },
      monthly: months.map((m) => ({
        month: m,
        incomeCents: monthlyMap.get(m)?.income_cents ?? 0,
        expenseCents: monthlyMap.get(m)?.expense_cents ?? 0,
      })),
      byCategory,
      recent: recentRows.map((r) => mapTransaction(r)),
    });
  }),
);
