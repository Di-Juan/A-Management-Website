import { useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { getToken } from '../services/session';
import { silentWechatLogin } from '../services/api';

/** 页面级登录守卫：无 token 时先尝试微信免密登录，失败再跳登录页；返回是否已就绪 */
export function useAuthGuard(): boolean {
  const [ready, setReady] = useState(false);

  useDidShow(async () => {
    if (getToken()) {
      setReady(true);
      return;
    }
    const ok = await silentWechatLogin();
    if (ok) {
      setReady(true);
      return;
    }
    setReady(false);
    Taro.reLaunch({ url: '/pages/login/index' });
  });

  return ready;
}
