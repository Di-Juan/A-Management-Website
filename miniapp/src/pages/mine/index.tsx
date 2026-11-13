import React, { useCallback, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { clearSession, getUser, saveUser } from '../../services/session';
import { getWechatCode, isWechatMiniProgram } from '../../services/wechat';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { APP_VERSION } from '../../config';
import type { User } from '../../types';
import styles from './index.module.scss';

const PERM_LABELS: Record<string, string> = {
  finance: '经费台账',
  equipment: '设备管理',
  inventory: '库存管理',
  access: '门禁',
  activity: '活动',
  duty: '值班',
  doc: '资料',
  api: 'API 调用',
};

const MENU = [
  { label: '我的预约', desc: '查看预约进度与取消', icon: '约', url: '/pages/my-bookings/index' },
  { label: '活动报名', desc: '浏览近期活动', icon: '活', url: '/pages/activities/index' },
  { label: '资料库', desc: '文档与表格归档', icon: '资', url: '/pages/documents/index' },
];

export default function Mine() {
  const ready = useAuthGuard();
  const [user, setUser] = useState<User | null>(getUser());
  const [wxBound, setWxBound] = useState(!!getUser()?.wxBound);
  const [wxConfigured, setWxConfigured] = useState(true);
  const [wxBusy, setWxBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      setUser(res.user);
      setWxBound(!!res.user.wxBound);
      saveUser(res.user);
    } catch (err) {
      console.warn('[Mine] 刷新用户信息失败', err);
    }
  }, []);

  const loadWxStatus = useCallback(async () => {
    try {
      const res = await api.get<{ configured: boolean; bound: boolean }>('/auth/wechat/status');
      setWxConfigured(res.configured);
      setWxBound(res.bound);
    } catch (err) {
      console.warn('[Mine] 获取微信绑定状态失败', err);
    }
  }, []);

  useDidShow(() => {
    if (ready) {
      load();
      loadWxStatus();
    }
  });

  const toggleWechat = async () => {
    if (!isWechatMiniProgram) {
      Taro.showToast({ title: '请在微信小程序中操作', icon: 'none' });
      return;
    }
    setWxBusy(true);
    try {
      if (wxBound) {
        await api.del('/auth/wechat/bind');
        setWxBound(false);
        Taro.showToast({ title: '已解绑微信', icon: 'success' });
      } else {
        const code = await getWechatCode();
        const res = await api.post<{ user: User }>('/auth/wechat/bind', { code });
        setUser(res.user);
        setWxBound(true);
        saveUser(res.user);
        Taro.showToast({ title: '绑定成功', icon: 'success' });
      }
    } catch (err) {
      Taro.showToast({
        title: err instanceof ApiError ? err.message : '操作失败，请重试',
        icon: 'none',
        duration: 2200,
      });
    } finally {
      setWxBusy(false);
    }
  };

  const logout = async () => {
    const res = await Taro.showModal({ title: '退出登录', content: '确定要退出当前账号吗？' });
    if (!res.confirm) return;
    clearSession();
    Taro.reLaunch({ url: '/pages/login/index' });
  };

  const perms = user?.role === 'admin' ? Object.keys(PERM_LABELS) : user?.perms || [];

  return (
    <View className='page'>
      <View className={styles.profile}>
        <View className={styles.avatar}>
          <Text className={styles.avatarText}>{(user?.displayName || user?.username || '科').slice(0, 1)}</Text>
        </View>
        <View className={styles.profileInfo}>
          <View className={styles.nameRow}>
            <Text className={styles.name}>{user?.displayName || user?.username || '未登录'}</Text>
            <Text className={`${styles.roleTag} ${user?.role === 'admin' ? styles.roleAdmin : ''}`}>
              {user?.role === 'admin' ? '管理员' : '成员'}
            </Text>
          </View>
          <Text className={styles.account}>账号：{user?.username || '—'}</Text>
          <Text className={styles.account}>
            {user?.department || '未填写部门'}
            {user?.studentNo ? ` · ${user.studentNo}` : ''}
          </Text>
        </View>
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>我的权限</Text>
        <View className={styles.permWrap}>
          {perms.length === 0 ? (
            <Text className={styles.permEmpty}>暂未分配运营权限</Text>
          ) : (
            perms.map((perm) => (
              <Text key={perm} className={styles.permTag}>
                {PERM_LABELS[perm] || perm}
              </Text>
            ))
          )}
        </View>
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>常用功能</Text>
        {MENU.map((item) => (
          <View
            key={item.label}
            className={styles.menuItem}
            onClick={() => Taro.navigateTo({ url: item.url })}
          >
            <View className={styles.menuIcon}>
              <Text className={styles.menuIconText}>{item.icon}</Text>
            </View>
            <View className={styles.menuInfo}>
              <Text className={styles.menuLabel}>{item.label}</Text>
              <Text className={styles.menuDesc}>{item.desc}</Text>
            </View>
            <Text className={styles.menuArrow}>›</Text>
          </View>
        ))}
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>账号安全</Text>
        <View className={styles.menuItem} onClick={wxBusy ? undefined : toggleWechat}>
          <View className={styles.menuIcon}>
            <Text className={styles.menuIconText}>微</Text>
          </View>
          <View className={styles.menuInfo}>
            <Text className={styles.menuLabel}>微信免密登录</Text>
            <Text className={styles.menuDesc}>
              {!isWechatMiniProgram
                ? '请在微信小程序中绑定'
                : !wxConfigured
                  ? '服务端未配置微信 AppID，暂不可用'
                  : wxBound
                    ? '已绑定，可随时解绑'
                    : '绑定后下次打开无需输入密码'}
            </Text>
          </View>
          <Text className={`${styles.wxStatus} ${wxBound ? styles.wxStatusOn : ''}`}>
            {wxBusy ? '处理中…' : wxBound ? '已绑定' : '未绑定'}
          </Text>
        </View>
      </View>

      {user?.role === 'admin' ? (
        <View className={styles.adminTip}>
          <Text className={styles.adminTipText}>管理员可在网页端进行成员、权限、API 密钥与数据备份管理。</Text>
        </View>
      ) : null}

      <View className={styles.logout} onClick={logout}>
        <Text className={styles.logoutText}>退出登录</Text>
      </View>

      <Text className={styles.version}>科协运营管理平台 v{APP_VERSION}</Text>
    </View>
  );
}
