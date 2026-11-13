import Taro from '@tarojs/taro';
import type { User } from '../types';

const TOKEN_KEY = 'kx_token';
const USER_KEY = 'kx_user';

export const getToken = (): string => Taro.getStorageSync(TOKEN_KEY) || '';

export const getUser = (): User | null => {
  const raw = Taro.getStorageSync(USER_KEY);
  return raw ? (raw as User) : null;
};

export const saveSession = (token: string, user: User): void => {
  Taro.setStorageSync(TOKEN_KEY, token);
  Taro.setStorageSync(USER_KEY, user);
};

export const saveUser = (user: User): void => {
  Taro.setStorageSync(USER_KEY, user);
};

export const clearSession = (): void => {
  Taro.removeStorageSync(TOKEN_KEY);
  Taro.removeStorageSync(USER_KEY);
};
