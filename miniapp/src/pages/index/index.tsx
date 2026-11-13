import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { getUser } from '../../services/session';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import { formatTime, greeting } from '../../utils/format';
import type { OperationsSummary } from '../../types';
import styles from './index.module.scss';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const STAT_ITEMS = [
  { key: 'pendingBookings', label: '待审核预约', hint: '条', tone: 'warn' },
  { key: 'pendingAccess', label: '待处理门禁', hint: '条', tone: 'info' },
  { key: 'openActivities', label: '开放活动', hint: '个', tone: 'success' },
  { key: 'lowStock', label: '低库存预警', hint: '项', tone: 'danger' },
] as const;

const QUICK_ENTRIES = [
  { label: '设备预约', desc: '查看与预约', icon: '约', color: '#0f766e', url: '/pages/equipment/index', tab: true },
  { label: '库存查询', desc: '耗材与元器件', icon: '库', color: '#0e7490', url: '/pages/inventory/index', tab: true },
  { label: '我的预约', desc: '进度与取消', icon: '我', color: '#b45309', url: '/pages/my-bookings/index', tab: false },
  { label: '活动报名', desc: '近期活动', icon: '活', color: '#7c3aed', url: '/pages/activities/index', tab: false },
];

export default function Home() {
  const ready = useAuthGuard();
  const user = getUser();
  const [data, setData] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<OperationsSummary>('/summary/operations');
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  useDidShow(() => {
    if (ready) load();
  });

  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });

  const openQuick = (item: (typeof QUICK_ENTRIES)[number]) => {
    if (item.tab) {
      Taro.switchTab({ url: item.url });
      return;
    }
    Taro.navigateTo({ url: item.url });
  };

  const now = new Date();

  return (
    <View className='page'>
      <View className={styles.hero}>
        <View className={styles.heroTop}>
          <View>
            <Text className={styles.greeting}>
              {greeting()}，{user?.displayName || user?.username || '同学'}
            </Text>
            <Text className={styles.date}>
              {now.getMonth() + 1} 月 {now.getDate()} 日 · {WEEKDAYS[now.getDay()]}
            </Text>
          </View>
          <View className={styles.avatar}>
            <Text className={styles.avatarText}>{(user?.displayName || user?.username || '科').slice(0, 1)}</Text>
          </View>
        </View>
        <View className={styles.heroFoot}>
          <Text className={styles.heroRole}>{user?.role === 'admin' ? '管理员' : '成员'}</Text>
          <Text className={styles.heroTip}>科协运营管理平台</Text>
        </View>
      </View>

      <PageState loading={loading && !data} error={error} onRetry={load} />

      {data ? (
        <>
          {data.myBorrowed > 0 ? (
            <View className={`${styles.alert} ${data.myOverdue > 0 ? styles.alertDanger : ''}`}>
              <Text className={styles.alertText}>
                我有 {data.myBorrowed} 件设备未归还
                {data.myOverdue > 0 ? `，其中 ${data.myOverdue} 件已逾期` : ''}
              </Text>
              <Text
                className={styles.alertAction}
                onClick={() => Taro.showToast({ title: '请在网页端办理归还', icon: 'none' })}
              >
                去处理
              </Text>
            </View>
          ) : null}

          <View className={styles.statGrid}>
            {STAT_ITEMS.map((item) => (
              <View key={item.key} className={styles.statCard}>
                <Text className={`${styles.statValue} ${styles[item.tone]}`}>{data[item.key]}</Text>
                <View className={styles.statMeta}>
                  <Text className={styles.statLabel}>{item.label}</Text>
                  <Text className={styles.statHint}>{item.hint}</Text>
                </View>
              </View>
            ))}
          </View>

          <View className='section-head'>
            <Text className='section-title'>快捷入口</Text>
          </View>
          <View className={styles.quickGrid}>
            {QUICK_ENTRIES.map((item) => (
              <View key={item.label} className={styles.quickItem} onClick={() => openQuick(item)}>
                <View className={styles.quickIcon} style={{ background: `${item.color}14`, color: item.color }}>
                  <Text className={styles.quickIconText}>{item.icon}</Text>
                </View>
                <Text className={styles.quickLabel}>{item.label}</Text>
                <Text className={styles.quickDesc}>{item.desc}</Text>
              </View>
            ))}
          </View>

          <View className='section-head'>
            <Text className='section-title'>今日值班</Text>
            <Text
              className='section-more'
              onClick={() => Taro.navigateTo({ url: '/pages/documents/index?type=duty' })}
            >
              查看资料
            </Text>
          </View>
          <View className='card'>
            {data.todayDuty.total === 0 ? (
              <View className={styles.emptyRow}>
                <Text className={styles.emptyText}>今天暂无值班安排</Text>
              </View>
            ) : (
              data.todayDuty.shifts.map((shift) => (
                <View key={shift.id} className={styles.dutyItem}>
                  <View className={`${styles.dutyTime} ${shift.mine ? styles.dutyMine : ''}`}>
                    <Text className={styles.dutyTimeText}>{formatTime(shift.startTime)}</Text>
                    <Text className={styles.dutyTimeSub}>至 {formatTime(shift.endTime)}</Text>
                  </View>
                  <View className={styles.dutyInfo}>
                    <Text className={styles.dutyTitle}>
                      {shift.location || '值班室'}
                      {shift.mine ? ' · 我在岗' : ''}
                    </Text>
                    <Text className={styles.dutyPeople}>
                      {shift.assignees.length ? shift.assignees.join('、') : '暂未排人'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {data.lowStockPreview.length > 0 ? (
            <>
              <View className='section-head'>
                <Text className='section-title'>库存预警</Text>
                <Text className='section-more' onClick={() => Taro.switchTab({ url: '/pages/inventory/index' })}>
                  查看全部
                </Text>
              </View>
              <View className='card'>
                {data.lowStockPreview.map((item, index) => (
                  <View key={`${item.name}-${index}`} className={styles.stockItem}>
                    <View className={styles.stockDot} />
                    <Text className={styles.stockName}>{item.name}</Text>
                    <Text className={styles.stockValue}>
                      剩 {item.quantity}
                      {item.unit}
                    </Text>
                    <Text className={styles.stockWarn}>警戒 {item.warn}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
