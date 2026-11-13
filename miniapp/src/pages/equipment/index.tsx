import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import StatusTag from '../../components/StatusTag';
import type { Equipment, EquipmentSummary } from '../../types';
import styles from './index.module.scss';

const CATEGORIES = [
  { value: '', label: '全部' },
  { value: 'printer', label: '3D 打印机' },
  { value: 'instrument', label: '仪器设备' },
  { value: 'other', label: '其他设备' },
];

const EMPTY_SUMMARY: EquipmentSummary = { available: 0, maintenance: 0, retired: 0, pendingBookings: 0 };

export default function EquipmentPage() {
  const ready = useAuthGuard();
  const [items, setItems] = useState<Equipment[]>([]);
  const [summary, setSummary] = useState<EquipmentSummary>(EMPTY_SUMMARY);
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<{ items: Equipment[]; summary: EquipmentSummary }>('/equipment');
      setItems(res.items);
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '设备加载失败');
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

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (category && item.category !== category) return false;
      if (!key) return true;
      return (
        item.name.toLowerCase().includes(key) ||
        item.code.toLowerCase().includes(key) ||
        (item.typeName || '').toLowerCase().includes(key)
      );
    });
  }, [items, category, keyword]);

  const startBooking = (item: Equipment) => {
    if (item.status !== 'available') {
      Taro.showToast({ title: '该设备当前不可预约', icon: 'none' });
      return;
    }
    Taro.navigateTo({ url: `/pages/booking/index?equipmentId=${item.id}` });
  };

  return (
    <View className='page'>
      <View className={styles.head}>
        <View>
          <Text className={styles.title}>设备预约</Text>
          <Text className={styles.subtitle}>
            可用 {summary.available} 台 · 维护 {summary.maintenance} 台
          </Text>
        </View>
        <Text className={styles.link} onClick={() => Taro.navigateTo({ url: '/pages/my-bookings/index' })}>
          我的预约
        </Text>
      </View>

      <View className={styles.search}>
        <Input
          className={styles.searchInput}
          placeholder='搜索设备名称或编号'
          placeholderClass={styles.placeholder}
          value={keyword}
          onInput={(event) => setKeyword(event.detail.value)}
        />
      </View>

      <ScrollView scrollX className={styles.chips} showScrollbar={false}>
        {CATEGORIES.map((item) => (
          <View
            key={item.value || 'all'}
            className={`${styles.chip} ${category === item.value ? styles.chipActive : ''}`}
            onClick={() => setCategory(item.value)}
          >
            <Text className={styles.chipText}>{item.label}</Text>
          </View>
        ))}
      </ScrollView>

      <PageState loading={loading && items.length === 0} error={error} onRetry={load} />

      {!loading || items.length > 0 ? (
        visible.length === 0 && !error ? (
          <PageState empty emptyText='没有匹配的设备' />
        ) : (
          <View className={styles.list}>
            {visible.map((item) => (
              <View key={item.id} className={styles.card}>
                <View className={styles.cardTop}>
                  <View className={styles.deviceIcon}>
                    <Text className={styles.deviceIconText}>{item.name.slice(0, 1)}</Text>
                  </View>
                  <View className={styles.info}>
                    <View className={styles.nameRow}>
                      <Text className={styles.name}>{item.name}</Text>
                      <StatusTag status={item.status} />
                    </View>
                    <Text className={styles.meta}>
                      {item.typeName || item.code} · {item.location || '未标注位置'}
                    </Text>
                    <Text className={styles.note}>{item.requiresApproval ? '预约需管理员审核' : '提交后直接生效'}</Text>
                  </View>
                </View>
                <View className={styles.cardFoot}>
                  <Text className={styles.code}>{item.code}</Text>
                  <View
                    className={`${styles.bookBtn} ${item.status !== 'available' ? styles.bookBtnDisabled : ''}`}
                    onClick={() => startBooking(item)}
                  >
                    <Text className={styles.bookBtnText}>
                      {item.status === 'available' ? '立即预约' : item.status === 'maintenance' ? '维护中' : '已停用'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}
