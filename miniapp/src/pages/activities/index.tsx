import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import StatusTag from '../../components/StatusTag';
import { formatDateTime } from '../../utils/format';
import type { Activity } from '../../types';
import styles from './index.module.scss';

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'open', label: '报名中' },
  { value: 'finished', label: '已结束' },
];

export default function Activities() {
  const ready = useAuthGuard();
  const [items, setItems] = useState<Activity[]>([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<{ items: Activity[] }>('/activities');
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '活动加载失败');
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

  const visible = useMemo(
    () => (filter ? items.filter((item) => item.status === filter) : items),
    [items, filter],
  );

  const signup = async (item: Activity) => {
    try {
      await api.post(`/activities/${item.id}/signup`, {});
      Taro.showToast({ title: '报名成功', icon: 'success' });
      await load();
    } catch (err) {
      Taro.showToast({ title: err instanceof ApiError ? err.message : '报名失败', icon: 'none' });
    }
  };

  const cancel = async (item: Activity) => {
    const res = await Taro.showModal({ title: '取消报名', content: `确定取消「${item.title}」的报名吗？` });
    if (!res.confirm) return;
    try {
      await api.post(`/activities/${item.id}/signup/cancel`, {});
      Taro.showToast({ title: '已取消报名', icon: 'success' });
      await load();
    } catch (err) {
      Taro.showToast({ title: err instanceof ApiError ? err.message : '操作失败', icon: 'none' });
    }
  };

  return (
    <View className='page'>
      <View className={styles.filters}>
        {FILTERS.map((item) => (
          <View
            key={item.value || 'all'}
            className={`${styles.filter} ${filter === item.value ? styles.filterActive : ''}`}
            onClick={() => setFilter(item.value)}
          >
            <Text className={styles.filterText}>{item.label}</Text>
          </View>
        ))}
      </View>

      <PageState loading={loading && items.length === 0} error={error} onRetry={load} />

      {!loading || items.length > 0 ? (
        visible.length === 0 && !error ? (
          <PageState empty emptyText='暂无活动' />
        ) : (
          <View className={styles.list}>
            {visible.map((item) => {
              const full = item.capacity !== null && item.signupCount >= item.capacity;
              const signed = item.mySignupStatus === 'confirmed';
              return (
                <View key={item.id} className={styles.card}>
                  <View className={styles.top}>
                    <Text className={styles.title}>{item.title}</Text>
                    <StatusTag status={item.status} />
                  </View>
                  <Text className={styles.desc}>{item.description || '暂无活动介绍'}</Text>
                  <View className={styles.metaRow}>
                    <Text className={styles.metaLabel}>时间</Text>
                    <Text className={styles.metaValue}>{formatDateTime(item.startAt)}</Text>
                  </View>
                  <View className={styles.metaRow}>
                    <Text className={styles.metaLabel}>地点</Text>
                    <Text className={styles.metaValue}>{item.location || '待定'}</Text>
                  </View>
                  <View className={styles.metaRow}>
                    <Text className={styles.metaLabel}>报名</Text>
                    <Text className={styles.metaValue}>
                      {item.signupCount}
                      {item.capacity ? ` / ${item.capacity}` : ''} 人
                      {item.feeCents > 0 ? ` · 费用 ${(item.feeCents / 100).toFixed(2)} 元` : ''}
                    </Text>
                  </View>

                  <View className={styles.foot}>
                    <Text className={styles.creator}>由 {item.creatorName || '管理员'} 发布</Text>
                    {item.status === 'open' ? (
                      signed ? (
                        <Text className={styles.cancel} onClick={() => cancel(item)}>
                          取消报名
                        </Text>
                      ) : (
                        <View
                          className={`${styles.signupBtn} ${full ? styles.signupDisabled : ''}`}
                          onClick={() => (full ? Taro.showToast({ title: '名额已满', icon: 'none' }) : signup(item))}
                        >
                          <Text className={styles.signupText}>{full ? '名额已满' : '立即报名'}</Text>
                        </View>
                      )
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )
      ) : null}
    </View>
  );
}
