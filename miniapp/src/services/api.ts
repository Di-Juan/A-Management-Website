import Taro from '@tarojs/taro';
import { API_BASE_URL } from '../config';
import { clearSession, getToken, saveSession } from './session';
import { getWechatCode, isWechatMiniProgram } from './wechat';
import type { LoginResult } from '../types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  data?: Record<string, unknown>;
  /** 登录接口不需要携带 token */
  auth?: boolean;
  /** 401 后已用微信免密重试过一次，避免死循环 */
  retried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const token = options.auth === false ? '' : getToken();
  console.info(`[API] ${method} ${path}`);

  try {
    const res = await Taro.request({
      url: `${API_BASE_URL}${path}`,
      method,
      data: options.data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (res.statusCode === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/wechat/')) {
      clearSession();
      if (!options.retried && (await silentWechatLogin())) {
        return request<T>(path, { ...options, retried: true });
      }
      console.warn('[API] 登录状态失效，返回登录页');
      Taro.reLaunch({ url: '/pages/login/index' });
      throw new ApiError('登录已失效，请重新登录', 401);
    }

    if (res.statusCode >= 400) {
      const message = (res.data as { error?: string } | undefined)?.error || '请求失败';
      console.error(`[API] ${path} -> ${res.statusCode}: ${message}`);
      throw new ApiError(message, res.statusCode);
    }

    return res.data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error(`[API] ${path} 网络异常`, err);
    throw new ApiError('网络连接失败，请检查后端服务是否可访问', 0);
  }
}

let silentLoginTask: Promise<boolean> | null = null;

/**
 * 静默免密登录：已绑定微信的账号在 token 过期或缺失时自动换取新 token。
 * 未绑定、非小程序端或服务端未配置时返回 false。
 */
export function silentWechatLogin(): Promise<boolean> {
  if (!isWechatMiniProgram) return Promise.resolve(false);
  if (!silentLoginTask) {
    silentLoginTask = (async () => {
      try {
        const code = await getWechatCode();
        const res = await request<LoginResult>('/auth/wechat/login', {
          method: 'POST',
          data: { code },
          auth: false,
          retried: true,
        });
        saveSession(res.token, res.user);
        console.info('[API] 微信免密登录成功', res.user.username);
        return true;
      } catch (err) {
        console.warn('[API] 微信免密登录不可用', err);
        return false;
      } finally {
        silentLoginTask = null;
      }
    })();
  }
  return silentLoginTask;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: Record<string, unknown>) => request<T>(path, { method: 'POST', data }),
  patch: <T>(path: string, data?: Record<string, unknown>) => request<T>(path, { method: 'PATCH', data }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  login: <T>(path: string, data: Record<string, unknown>) =>
    request<T>(path, { method: 'POST', data, auth: false }),
};
