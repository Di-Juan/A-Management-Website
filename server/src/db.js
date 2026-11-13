import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'classfund.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'finance', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    can_income INTEGER NOT NULL DEFAULT 1,
    can_expense INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by INTEGER,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    sort INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (name, type)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category_id INTEGER REFERENCES categories (id),
    reason TEXT NOT NULL,
    counterparty TEXT,
    note TEXT,
    occurred_at TEXT NOT NULL,
    operator_id INTEGER NOT NULL REFERENCES users (id),
    version INTEGER NOT NULL DEFAULT 1,
    client_request_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions (occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions (type);
  CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions (category_id);
  CREATE INDEX IF NOT EXISTS idx_tx_operator ON transactions (operator_id);

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions (id),
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_att_tx ON attachments (transaction_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    detail TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_log_created ON audit_logs (created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_log_action ON audit_logs (action);
  CREATE INDEX IF NOT EXISTS idx_log_actor ON audit_logs (actor_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    due_date TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_by INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_collection_status ON collections (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS collection_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections (id),
    user_id INTEGER NOT NULL REFERENCES users (id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER REFERENCES users (id),
    reviewed_at TEXT,
    reject_reason TEXT,
    transaction_id INTEGER REFERENCES transactions (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (collection_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_payment_collection ON collection_payments (collection_id, status);
  CREATE INDEX IF NOT EXISTS idx_payment_user ON collection_payments (user_id);

  CREATE TABLE IF NOT EXISTS payment_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL REFERENCES collection_payments (id),
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_payment_att ON payment_attachments (payment_id);
`);

/* ---------- 科协运营模块：设备、打印、耗材、门禁、库存、活动、值班、资料 ---------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('printer', 'instrument', 'other')),
    location TEXT,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance', 'retired')),
    requires_approval INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS equipment_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment (id),
    user_id INTEGER NOT NULL REFERENCES users (id),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
    reviewed_by INTEGER REFERENCES users (id),
    reviewed_at TEXT,
    reject_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_booking_equipment ON equipment_bookings (equipment_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_booking_user ON equipment_bookings (user_id);
  CREATE INDEX IF NOT EXISTS idx_booking_status ON equipment_bookings (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment (id),
    user_id INTEGER NOT NULL REFERENCES users (id),
    booking_id INTEGER REFERENCES equipment_bookings (id),
    title TEXT NOT NULL,
    file_name TEXT,
    material_id INTEGER REFERENCES consumables (id),
    weight_grams INTEGER,
    est_minutes INTEGER,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'printing', 'done', 'failed', 'cancelled')),
    note TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_job_equipment ON print_jobs (equipment_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_job_user ON print_jobs (user_id);
  CREATE INDEX IF NOT EXISTS idx_job_status ON print_jobs (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS consumables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spec TEXT,
    unit TEXT NOT NULL DEFAULT 'g',
    stock REAL NOT NULL DEFAULT 0,
    warn_threshold REAL NOT NULL DEFAULT 0,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS consumable_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consumable_id INTEGER NOT NULL REFERENCES consumables (id),
    delta REAL NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('print', 'restock', 'adjust', 'scrap')),
    ref_type TEXT,
    ref_id INTEGER,
    note TEXT,
    operator_id INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_consumable_log ON consumable_logs (consumable_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment (id),
    type TEXT NOT NULL DEFAULT 'routine' CHECK (type IN ('routine', 'repair', 'inspection')),
    content TEXT NOT NULL,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    performed_by TEXT,
    performed_at TEXT NOT NULL,
    next_due_at TEXT,
    operator_id INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_maintenance_equipment ON maintenance_logs (equipment_id, performed_at DESC);

  CREATE TABLE IF NOT EXISTS borrow_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment (id),
    user_id INTEGER NOT NULL REFERENCES users (id),
    borrowed_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    returned_at TEXT,
    status TEXT NOT NULL DEFAULT 'borrowed' CHECK (status IN ('borrowed', 'returned', 'overdue')),
    condition_note TEXT,
    reviewer_id INTEGER REFERENCES users (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_borrow_status ON borrow_records (status, due_at);
  CREATE INDEX IF NOT EXISTS idx_borrow_user ON borrow_records (user_id);

  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spec TEXT,
    package TEXT,
    location TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '个',
    warn_threshold INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES inventory_items (id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('purchase', 'issue', 'return', 'adjust', 'scrap')),
    ref TEXT,
    note TEXT,
    operator_id INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inventory_log ON inventory_logs (item_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users (id),
    purpose TEXT NOT NULL,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
    reviewed_by INTEGER REFERENCES users (id),
    reviewed_at TEXT,
    reject_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_access_request_status ON access_requests (status, start_at DESC);
  CREATE INDEX IF NOT EXISTS idx_access_request_user ON access_requests (user_id);

  CREATE TABLE IF NOT EXISTS access_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users (id),
    scope TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    granted_by INTEGER REFERENCES users (id),
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_grant_user ON access_grants (user_id, status);

  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users (id),
    person_name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    location TEXT,
    occurred_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'card')),
    operator_id INTEGER REFERENCES users (id),
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_logs (occurred_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT,
    signup_deadline TEXT,
    capacity INTEGER,
    fee_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'open', 'closed', 'finished', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activity_status ON activities (status, start_at DESC);

  CREATE TABLE IF NOT EXISTS activity_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES activities (id),
    user_id INTEGER NOT NULL REFERENCES users (id),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    note TEXT,
    checked_in_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (activity_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_signup_activity ON activity_signups (activity_id, status);

  CREATE TABLE IF NOT EXISTS duty_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    capacity INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_by INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_shift_date ON duty_shifts (date, start_time);

  CREATE TABLE IF NOT EXISTS duty_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES duty_shifts (id),
    user_id INTEGER NOT NULL REFERENCES users (id),
    status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'checked_in', 'absent')),
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (shift_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_duty_user ON duty_assignments (user_id);

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    description TEXT,
    tags TEXT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'admin')),
    uploader_id INTEGER NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_document_category ON documents (category, created_at DESC);
`);

export const nowIso = () => new Date().toISOString();

/** 旧库升级：为已存在的 users 表补充字段，保证旧库平滑升级 */
const userColumns = new Set(
  db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((col) => col.name),
);
if (!userColumns.has('can_income')) {
  db.exec('ALTER TABLE users ADD COLUMN can_income INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.has('can_expense')) {
  db.exec('ALTER TABLE users ADD COLUMN can_expense INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.has('student_no')) {
  db.exec('ALTER TABLE users ADD COLUMN student_no TEXT');
}
if (!userColumns.has('department')) {
  db.exec('ALTER TABLE users ADD COLUMN department TEXT');
}
if (!userColumns.has('phone')) {
  db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
}
if (!userColumns.has('perms')) {
  db.exec("ALTER TABLE users ADD COLUMN perms TEXT NOT NULL DEFAULT '[]'");
}
if (!userColumns.has('joined_at')) {
  db.exec('ALTER TABLE users ADD COLUMN joined_at TEXT');
}
/** 旧库升级：token 版本号，改密/重置密码后自增，使旧 token 立即失效 */
if (!userColumns.has('token_version')) {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}
/** 旧库升级：微信 openid，用于小程序首次绑定后的免密登录 */
if (!userColumns.has('wx_openid')) {
  db.exec('ALTER TABLE users ADD COLUMN wx_openid TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_openid ON users (wx_openid) WHERE wx_openid IS NOT NULL');

/** 旧库升级：财务员角色并入成员，财务能力改由「经费台账」权限控制 */
const legacyFinanceUsers = db.prepare("SELECT id, perms FROM users WHERE role = 'finance'").all();
if (legacyFinanceUsers.length > 0) {
  const updateLegacyRole = db.prepare('UPDATE users SET role = ?, perms = ? WHERE id = ?');
  for (const row of legacyFinanceUsers) {
    let perms = [];
    try {
      const parsed = JSON.parse(row.perms || '[]');
      if (Array.isArray(parsed)) perms = parsed;
    } catch {
      perms = [];
    }
    if (!perms.includes('finance')) perms.push('finance');
    updateLegacyRole.run('member', JSON.stringify(perms), row.id);
  }
}

/** 登录失败计数落库，重启或多实例下依然生效 */
db.exec(`
  CREATE TABLE IF NOT EXISTS login_failures (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    first_at INTEGER NOT NULL
  )
`);

/** 外部调用凭证：只保存 key 的 sha256，明文仅在创建时返回一次 */
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT,
    last_used_at TEXT,
    revoked_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
  CREATE TABLE IF NOT EXISTS api_rate (
    key_id INTEGER PRIMARY KEY REFERENCES api_keys(id),
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  );
`);

/** 旧库升级：打印任务支持上传模型文件 */
const printJobColumns = new Set(
  db
    .prepare('PRAGMA table_info(print_jobs)')
    .all()
    .map((col) => col.name),
);
if (!printJobColumns.has('file_stored')) {
  db.exec('ALTER TABLE print_jobs ADD COLUMN file_stored TEXT');
}
if (!printJobColumns.has('file_size')) {
  db.exec('ALTER TABLE print_jobs ADD COLUMN file_size INTEGER');
}

/** 旧库升级：设备支持自定义类型名称（类似收支分类，可自行命名） */
const equipmentColumns = new Set(
  db
    .prepare('PRAGMA table_info(equipment)')
    .all()
    .map((col) => col.name),
);
if (!equipmentColumns.has('type_name')) {
  db.exec('ALTER TABLE equipment ADD COLUMN type_name TEXT');
}

/** 同步事务：BEGIN IMMEDIATE 立即获取写锁，避免并发写入互相覆盖 */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

export function audit({
  actor,
  action,
  entityType = null,
  entityId = null,
  detail = null,
  ip = null,
  userAgent = null,
}) {
  db.prepare(
    `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, detail, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    actor?.id ?? null,
    actor?.display_name ?? actor?.username ?? 'system',
    action,
    entityType,
    entityId,
    detail ? JSON.stringify(detail) : null,
    ip,
    userAgent,
    nowIso(),
  );
}

export function initData() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  tx(() => {
    if (userCount === 0) {
      const hash = bcrypt.hashSync('Admin@123456', 10);
      db.prepare(
        `INSERT INTO users (username, password_hash, display_name, role, status, must_change_password, created_at)
         VALUES (?, ?, ?, 'admin', 'active', 1, ?)`,
      ).run('admin', hash, '管理员', nowIso());
    }

    // 清理过期的登录失败计数
    db.prepare('DELETE FROM login_failures WHERE first_at < ?').run(Date.now() - 24 * 60 * 60 * 1000);

    const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
    if (catCount === 0) {
      const insert = db.prepare('INSERT INTO categories (name, type, sort, created_at) VALUES (?, ?, ?, ?)');
      const defaults = [
        ['会费收入', 'income', 1],
        ['活动收入', 'income', 2],
        ['赞助', 'income', 3],
        ['其他收入', 'income', 4],
        ['活动支出', 'expense', 1],
        ['学习用品', 'expense', 2],
        ['社团建设', 'expense', 3],
        ['聚餐', 'expense', 4],
        ['礼物', 'expense', 5],
        ['交通', 'expense', 6],
        ['其他支出', 'expense', 7],
      ];
      for (const [name, type, sort] of defaults) insert.run(name, type, sort, nowIso());
    }

    if (!db.prepare("SELECT 1 FROM settings WHERE key = 'class_name'").get()) {
      setSetting('class_name', '英才科协');
      setSetting('term', '2026 秋季学期');
      setSetting('org_name', '科协运营中心');
    }
    // 旧版班费系统的默认值迁移为科协名称
    const legacyName = db.prepare("SELECT value FROM settings WHERE key = 'class_name'").get()?.value;
    if (legacyName === '高一（1）班') {
      setSetting('class_name', '英才科协');
      if (db.prepare("SELECT value FROM settings WHERE key = 'org_name'").get()?.value === '高一（1）班') {
        setSetting('org_name', '科协运营中心');
      }
    }
  });
}
