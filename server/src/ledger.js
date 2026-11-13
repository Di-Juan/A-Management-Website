import { db } from './db.js';

export function buildFilters(query) {
  const where = ['t.deleted_at IS NULL'];
  const params = [];

  if (query.type === 'income' || query.type === 'expense') {
    where.push('t.type = ?');
    params.push(query.type);
  }
  if (query.categoryId) {
    const id = Number.parseInt(query.categoryId, 10);
    if (Number.isFinite(id)) {
      where.push('t.category_id = ?');
      params.push(id);
    }
  }
  if (query.operatorId) {
    const id = Number.parseInt(query.operatorId, 10);
    if (Number.isFinite(id)) {
      where.push('t.operator_id = ?');
      params.push(id);
    }
  }
  if (query.from) {
    where.push('t.occurred_at >= ?');
    params.push(String(query.from));
  }
  if (query.to) {
    where.push('t.occurred_at <= ?');
    params.push(String(query.to));
  }
  if (query.q) {
    const keyword = `%${String(query.q).trim().slice(0, 60)}%`;
    where.push("(t.reason LIKE ? OR IFNULL(t.counterparty, '') LIKE ? OR IFNULL(t.note, '') LIKE ?)");
    params.push(keyword, keyword, keyword);
  }
  if (query.hasVoucher === '1') {
    where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.transaction_id = t.id AND a.deleted_at IS NULL)');
  }
  return { whereSql: where.join(' AND '), params };
}

export const TX_SELECT = `
  SELECT t.*, c.name AS category_name, u.display_name AS operator_name, u.username AS operator_username,
         (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id AND a.deleted_at IS NULL) AS attachment_count
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN users u ON u.id = t.operator_id
`;

export function mapTransaction(row, attachments = null) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    amountCents: row.amount_cents,
    categoryId: row.category_id,
    categoryName: row.category_name || '未分类',
    reason: row.reason,
    counterparty: row.counterparty || '',
    note: row.note || '',
    occurredAt: row.occurred_at,
    operatorId: row.operator_id,
    operatorName: row.operator_name || '',
    operatorUsername: row.operator_username || '',
    version: row.version,
    attachmentCount: row.attachment_count ?? attachments?.length ?? 0,
    attachments: attachments ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAttachments(transactionId) {
  return db
    .prepare(
      `SELECT id, original_name, mime, size, created_at
       FROM attachments WHERE transaction_id = ? AND deleted_at IS NULL ORDER BY id`,
    )
    .all(transactionId)
    .map((a) => ({
      id: a.id,
      originalName: a.original_name,
      mime: a.mime,
      size: a.size,
      createdAt: a.created_at,
    }));
}

export function getTransaction(id) {
  const row = db.prepare(`${TX_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`).get(id);
  if (!row) return null;
  return mapTransaction(row, listAttachments(id));
}

export function queryTransactions(query) {
  const { whereSql, params } = buildFilters(query);
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(`${TX_SELECT} WHERE ${whereSql} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions t WHERE ${whereSql}`).get(...params).c;

  return { rows, total, page, pageSize };
}

export function balanceSummary() {
  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income_cents,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense_cents,
         COUNT(*) AS count
       FROM transactions WHERE deleted_at IS NULL`,
    )
    .get();
  return {
    incomeCents: totals.income_cents,
    expenseCents: totals.expense_cents,
    balanceCents: totals.income_cents - totals.expense_cents,
    count: totals.count,
  };
}
