import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { getUser } from '../../services/session';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import StatusTag from '../../components/StatusTag';
import { formatDateTime } from '../../utils/format';
import type { Booking } from '../../types';
import styles from './index.module.scss';

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'completed', label: '已完成' },
];

export default function MyBookings() {
  const ready = useAuthGuard();
  const currentUser = getUser();
  const canManageEquipment =
    currentUser?.role === 'admin' || (currentUser?.perms || []).includes('equipment');
  const [items, setItems] = useState<Booking[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<{ items: Booking[] }>('/equipment/bookings?mine=1');
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '预约记录加载失败');
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

  const cancel = async (item: Booking) => {
    const res = await Taro.showModal({ title: '取消预约', content: `确定取消「${item.equipmentName}」的预约吗？` });
    if (!res.confirm) return;
    try {
      await api.post(`/equipment/bookings/${item.id}/cancel`, {});
      Taro.showToast({ title: '已取消', icon: 'success' });
      await load();
    } catch (err) {
      Taro.showToast({ title: err instanceof ApiError ? err.message : '取消失败', icon: 'none' });
    }
  };

  const complete = async (item: Booking) => {
    try {
      await api.post(`/equipment/bookings/${item.id}/complete`, {});
      Taro.showToast({ title: '已标记完成', icon: 'success' });
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
          <PageState empty emptyText='暂无预约记录' />
        ) : (
          <View className={styles.list}>
            {visible.map((item) => (
              <View key={item.id} className={styles.card}>
                <View className={styles.top}>
                  <Text className={styles.name}>{item.equipmentName}</Text>
                  <StatusTag status={item.status} />
                </View>
                <Text className={styles.code}>{item.equipmentCode}</Text>
                <View className={styles.timeBox}>
                  <Text className={styles.timeText}>{formatDateTime(item.startAt)}</Text>
                  <Text className={styles.timeArrow}>→</Text>
                  <Text className={styles.timeText}>{formatDateTime(item.endAt)}</Text>
                </View>
                <Text className={styles.purpose}>用途：{item.purpose || '未填写'}</Text>
                {item.status === 'rejected' && item.rejectReason ? (
                  <Text className={styles.reject}>驳回原因：{item.rejectReason}</Text>
                ) : null}
                <View className={styles.foot}>
                  <Text className={styles.created}>提交于 {formatDateTime(item.createdAt)}</Text>
                  {item.status === 'pending' || item.status === 'approved' ? (
                    <Text className={styles.cancel} onClick={() => cancel(item)}>
                      取消预约
                    </Text>
                  ) : null}
                  {item.status === 'approved' && canManageEquipment ? (
                    <Text className={styles.complete} onClick={() => complete(item)}>
                      标记完成
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}
