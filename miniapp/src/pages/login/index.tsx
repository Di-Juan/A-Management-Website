import React, { useEffect, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { api, ApiError, silentWechatLogin } from '../../services/api';
import { getToken, saveSession } from '../../services/session';
import { getWechatCode, isWechatMiniProgram } from '../../services/wechat';
import { API_BASE_URL } from '../../config';
import type { LoginResult } from '../../types';
import styles from './index.module.scss';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) {
      Taro.switchTab({ url: '/pages/index/index' });
      return;
    }
    // 已绑定微信的账号无需手动登录
    silentWechatLogin().then((ok) => {
      if (ok) Taro.switchTab({ url: '/pages/index/index' });
    });
  }, []);

  const wechatLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const code = await getWechatCode();
      const res = await api.login<LoginResult>('/auth/wechat/login', { code });
      saveSession(res.token, res.user);
      Taro.switchTab({ url: '/pages/index/index' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('该微信尚未绑定账号，请先用账号密码登录，并在「我的」中完成绑定');
      } else {
        setError(err instanceof ApiError ? err.message : '微信登录失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.login<LoginResult>('/auth/login', {
        username: username.trim(),
        password,
      });
      saveSession(res.token, res.user);
      console.info('[Login] 登录成功', res.user.username);
      if (res.user.mustChangePassword) {
        Taro.showToast({ title: '请尽快在网页端修改初始密码', icon: 'none', duration: 2500 });
      }
      Taro.switchTab({ url: '/pages/index/index' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '登录失败，请稍后重试';
      setError(message);
      console.error('[Login] 登录失败', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.hero}>
        <View className={styles.logo}>
          <View className={styles.logoInner} />
        </View>
        <Text className={styles.title}>科协运营管理平台</Text>
        <Text className={styles.subtitle}>设备预约 · 库存查询 · 活动报名</Text>
      </View>

      <View className={styles.form}>
        <View className={styles.field}>
          <Text className={styles.label}>账号</Text>
          <Input
            className={styles.input}
            placeholder='请输入学号或账号'
            placeholderClass={styles.placeholder}
            value={username}
            onInput={(event) => setUsername(event.detail.value)}
          />
        </View>
        <View className={styles.field}>
          <Text className={styles.label}>密码</Text>
          <Input
            className={styles.input}
            password
            placeholder='请输入密码'
            placeholderClass={styles.placeholder}
            value={password}
            onInput={(event) => setPassword(event.detail.value)}
            onConfirm={submit}
          />
        </View>

        {error ? <Text className={styles.error}>{error}</Text> : null}

        <View className={`${styles.submit} ${loading ? styles.submitDisabled : ''}`} onClick={submit}>
          <Text className={styles.submitText}>{loading ? '登录中…' : '登录'}</Text>
        </View>

        {isWechatMiniProgram ? (
          <View className={styles.wechat} onClick={wechatLogin}>
            <Text className={styles.wechatText}>微信一键登录（已绑定）</Text>
          </View>
        ) : null}

        <Text className={styles.hint}>账号由管理员开通，忘记密码请联系管理员重置</Text>
        <Text className={styles.hint}>首次登录后可在「我的」绑定微信，之后自动免密登录</Text>
      </View>

      <Text className={styles.endpoint}>服务地址：{API_BASE_URL}</Text>
    </View>
  );
}
