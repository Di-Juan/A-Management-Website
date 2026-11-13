import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config.js';
import { db } from './db.js';

export const COOKIE_NAME = 'cf_token';
export const TOKEN_TTL = '7d';

/** 运营模块权限键：管理员默认拥有全部权限，其他账号按需勾选 */
export const PERM_KEYS = ['finance', 'equipment', 'inventory', 'access', 'activity', 'duty', 'doc', 'api'];
export const PERM_LABEL = {
  finance: '经费台账',
  equipment: '设备与预约',
  inventory: '库存与借还',
  access: '门禁管理',
  activity: '活动报名',
  duty: '值班安排',
  doc: '资料归档',
  api: 'API 调用',
};

export function parsePerms(value) {
  if (Array.isArray(value)) return value.filter((item) => PERM_KEYS.includes(item));
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item) => PERM_KEYS.includes(item)) : [];
  } catch {
    return [];
  }
}

export function hasPerm(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return parsePerms(user.perms).includes(key);
}

export function hasAnyPerm(user, keys) {
  return keys.some((key) => hasPerm(user, key));
}

export function requirePerm(...keys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (!hasAnyPerm(req.user, keys)) return res.status(403).json({ error: '没有权限执行该操作' });
    next();
  };
}

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, ver: Number(user.token_version || 0) },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

export function readToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  if (typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

export const API_KEY_PREFIX = 'cfk_';
export const API_RATE_LIMIT = Number(process.env.API_RATE_LIMIT || 120);

export const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

export function generateApiKey() {
  const key = `${API_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function readApiKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization || '';
  const matched = /^ApiKey\s+(.+)$/i.exec(auth);
  return matched ? matched[1].trim() : null;
}

function userFromApiKey(req) {
  const key = readApiKey(req);
  if (!key) return null;
  const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hashApiKey(key));
  if (!row || row.revoked_at) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;

  // 单密钥每分钟调用上限
  const now = Date.now();
  const windowStart = now - (now % 60000);
  const rate = db.prepare('SELECT window_start AS ws, count FROM api_rate WHERE key_id = ?').get(row.id);
  const count = rate && rate.ws === windowStart ? rate.count + 1 : 1;
  if (count > API_RATE_LIMIT) {
    const err = new Error(`API 调用频率超限（每分钟最多 ${API_RATE_LIMIT} 次），请稍后重试`);
    err.status = 429;
    throw err;
  }
  db.prepare(
    `INSERT INTO api_rate (key_id, window_start, count) VALUES (?, ?, ?)
     ON CONFLICT(key_id) DO UPDATE SET window_start = excluded.window_start, count = excluded.count`,
  ).run(row.id, windowStart, count);
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), row.id);

  const user = db
    .prepare(
      `SELECT id, username, display_name, role, status, must_change_password, can_income, can_expense,
              perms, student_no, department, phone, joined_at, token_version
       FROM users WHERE id = ?`,
    )
    .get(row.user_id);
  if (!user || user.status !== 'active') return null;
  if (!hasPerm(user, 'api')) return null;
  req.apiKeyId = row.id;
  return user;
}

export function resolveUser(req) {
  const apiUser = userFromApiKey(req);
  if (apiUser) return apiUser;

  const token = readToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare(
        `SELECT id, username, display_name, role, status, must_change_password, can_income, can_expense,
                perms, student_no, department, phone, joined_at, token_version, wx_openid
         FROM users WHERE id = ?`,
      )
      .get(payload.uid);
    if (!user || user.status !== 'active') return null;
    // 改密/重置密码后 token_version 自增，旧 token 立即失效
    if (Number(payload.ver || 0) !== Number(user.token_version || 0)) return null;
    return user;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '没有权限执行该操作' });
    next();
  };
}

/** 登录失败限流：同一 IP+账号 15 分钟内最多 5 次失败，计数落库以便重启/多实例生效 */
const FAIL_WINDOW = 15 * 60 * 1000;
const FAIL_LIMIT = 5;

export function checkLoginThrottle(key) {
  const entry = db
    .prepare('SELECT count, first_at AS firstAt FROM login_failures WHERE key = ?')
    .get(key);
  if (!entry) return true;
  if (Date.now() - entry.firstAt > FAIL_WINDOW) {
    db.prepare('DELETE FROM login_failures WHERE key = ?').run(key);
    return true;
  }
  return entry.count < FAIL_LIMIT;
}

export function recordLoginFail(key) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO login_failures (key, count, first_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ? - first_at > ${FAIL_WINDOW} THEN 1 ELSE count + 1 END,
       first_at = CASE WHEN ? - first_at > ${FAIL_WINDOW} THEN ? ELSE first_at END`,
  ).run(key, now, now, now, now);
}

export function clearLoginFail(key) {
  db.prepare('DELETE FROM login_failures WHERE key = ?').run(key);
}
