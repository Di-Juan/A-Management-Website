export class HttpError extends Error {
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const ah = (fn) => (req, res, next) => {
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
    return result;
  } catch (err) {
    next(err);
  }
};

export function text(value, { field = '内容', min = 0, max = 200, required = false } = {}) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (required && str.length < Math.max(min, 1)) throw new HttpError(400, `${field}不能为空`);
  if (str.length > max) throw new HttpError(400, `${field}不能超过 ${max} 个字符`);
  if (str.length > 0 && str.length < min) throw new HttpError(400, `${field}至少 ${min} 个字符`);
  return str;
}

export function parseAmountCents(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new HttpError(400, '金额格式不正确');
  const raw = String(value ?? '')
    .trim()
    .replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new HttpError(400, '金额需为最多两位小数的正数');
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HttpError(400, '金额必须大于 0');
  if (cents > 1_000_000_000) throw new HttpError(400, '单笔金额不能超过 1000 万元');
  return cents;
}

export function parseDateOnly(value, field = '日期') {
  const str = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) throw new HttpError(400, `${field}格式需为 YYYY-MM-DD`);
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(m) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    throw new HttpError(400, `${field}不是有效日期`);
  }
  return str;
}

export function optionalDate(value, field = '日期') {
  if (value === undefined || value === null || value === '') return null;
  return parseDateOnly(value, field);
}

export function intParam(value, fallback, { min = 1, max = 100 } = {}) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

export function pageParams(query, defaultSize = 20) {
  const page = intParam(query.page, 1, { min: 1, max: 1_000_000 });
  const pageSize = intParam(query.pageSize, defaultSize, { min: 1, max: 200 });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function publicUser(user) {
  if (!user) return null;
  let perms = [];
  try {
    const parsed = JSON.parse(user.perms || '[]');
    if (Array.isArray(parsed)) perms = parsed;
  } catch {
    perms = [];
  }
  const isAdmin = user.role === 'admin';
  const finance = isAdmin || perms.includes('finance');
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    mustChangePassword: !!user.must_change_password,
    canIncome: finance && (isAdmin || !!user.can_income),
    canExpense: finance && (isAdmin || !!user.can_expense),
    perms: isAdmin
      ? ['finance', 'equipment', 'inventory', 'access', 'activity', 'duty', 'doc', 'api']
      : perms,
    studentNo: user.student_no || '',
    department: user.department || '',
    phone: user.phone || '',
    joinedAt: user.joined_at || '',
    wxBound: !!user.wx_openid,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

/** 解析 "YYYY-MM-DD HH:mm" 或 ISO 时间，统一存 UTC ISO 字符串 */
export function parseDateTime(value, field = '时间') {
  const raw = String(value ?? '').trim();
  if (!raw) throw new HttpError(400, `${field}不能为空`);
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${field}格式不正确`);
  return date.toISOString();
}

export function optionalDateTime(value, field = '时间') {
  if (value === undefined || value === null || value === '') return null;
  return parseDateTime(value, field);
}

/** 解析 HH:mm 时间点 */
export function parseClock(value, field = '时间') {
  const raw = String(value ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new HttpError(400, `${field}需为 HH:mm 格式`);
  return raw;
}

export function parseNumber(value, { field = '数值', min = 0, max = 1_000_000, integer = false } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new HttpError(400, `${field}格式不正确`);
  if (integer && !Number.isInteger(num)) throw new HttpError(400, `${field}需为整数`);
  if (num < min || num > max) throw new HttpError(400, `${field}需在 ${min} 到 ${max} 之间`);
  return num;
}

export function optionalNumber(value, options) {
  if (value === undefined || value === null || value === '') return null;
  return parseNumber(value, options);
}

export function boolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}
