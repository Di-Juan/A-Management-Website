const TOKEN_KEY = 'cf_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, headers = {}, formData = null } = {}) {
  const token = getToken();
  const finalHeaders = { ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !formData) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (formData) payload = formData;

  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: finalHeaders,
      body: payload,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络后重试');
  }

  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (res.status === 401) {
      setToken('');
      window.dispatchEvent(new CustomEvent('cf:unauthorized'));
    }
    throw new ApiError(res.status, data?.error || `请求失败（${res.status}）`, data);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, files, fields = {}, fileField = 'files') => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) formData.append(key, value);
    }
    for (const file of files) formData.append(fileField, file);
    return request(path, { method: 'POST', formData });
  },
};

export async function downloadFile(path, fallbackName) {
  const token = getToken();
  const res = await fetch(`/api/v1${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = '下载失败，请稍后重试';
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      setToken('');
      window.dispatchEvent(new CustomEvent('cf:unauthorized'));
    }
    throw new ApiError(res.status, message);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="([^"]+)"/i.exec(disposition);
  let filename = fallbackName;
  if (match) {
    try {
      filename = decodeURIComponent(match[1]);
    } catch {
      /* ignore */
    }
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const ROLE_LABEL = { admin: '管理员', member: '成员' };
export const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '成员' },
];

/** 运营模块权限：与后端 PERM_KEYS 对应，管理员默认拥有全部 */
export const PERM_OPTIONS = [
  { value: 'finance', label: '经费台账', hint: '记账、收款单与导出账单，收入/支出可再细分' },
  { value: 'equipment', label: '设备与预约', hint: '3D 打印机、设备台账与预约审核' },
  { value: 'inventory', label: '库存与借还', hint: '元器件出入库、仪器设备借还' },
  { value: 'access', label: '门禁管理', hint: '门禁申请审核、授权与进出登记' },
  { value: 'activity', label: '活动报名', hint: '活动发布、报名名单与签到' },
  { value: 'duty', label: '值班安排', hint: '值班班次与排班' },
  { value: 'doc', label: '资料归档', hint: '项目资料上传与归档' },
  { value: 'api', label: 'API 调用', hint: '允许管理员为其签发 API Key，供外部系统调用' },
];
export const PERM_LABEL = Object.fromEntries(PERM_OPTIONS.map((opt) => [opt.value, opt.label]));

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(cents) {
  const value = Number(cents || 0) / 100;
  return `¥${moneyFormatter.format(value)}`;
}

export function plainMoney(cents) {
  return moneyFormatter.format(Number(cents || 0) / 100);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = String(dateStr).slice(0, 10).split('-');
  if (!year || !month || !day) return dateStr;
  const current = new Date();
  if (Number(year) === current.getFullYear()) return `${Number(month)} 月 ${Number(day)} 日`;
  return `${year}-${month}-${day}`;
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatDateTime(value).slice(0, 10);
}

export function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthStartString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function canExport(user) {
  return user?.role === 'admin' || user?.role === 'finance';
}

export function canManageCollections(user) {
  return canRecord(user, 'income');
}

export function canRecord(user, type) {
  if (user?.role === 'admin') return true;
  if (user?.role !== 'finance') return false;
  return type === 'income' ? !!user.canIncome : !!user.canExpense;
}

export function canManage(user) {
  return canRecord(user, 'income') || canRecord(user, 'expense');
}

export function canEditRecord(user, record) {
  if (!user || !record) return false;
  if (user.role === 'admin') return true;
  return user.role === 'finance' && record.operatorId === user.id && canRecord(user, record.type);
}

export function canUse(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.perms) && user.perms.includes(perm);
}

export function canUseAny(user, perms) {
  return perms.some((perm) => canUse(user, perm));
}

/** ISO 时间 -> datetime-local 输入框值（本地时区） */
export function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 服务端返回的本地 ISO -> 日期输入框值 */
export function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatClock(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
