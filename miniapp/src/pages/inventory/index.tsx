import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Input, Switch } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import type { Consumable, InventoryItem } from '../../types';
import styles from './index.module.scss';

type Tab = 'consumable' | 'item';

export default function InventoryPage() {
  const ready = useAuthGuard();
  const [tab, setTab] = useState<Tab>('consumable');
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [consumableRes, itemRes] = await Promise.all([
        api.get<{ items: Consumable[] }>('/consumables'),
        api.get<{ items: InventoryItem[] }>('/inventory'),
      ]);
      setConsumables(consumableRes.items);
      setItems(itemRes.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '库存加载失败');
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

  const lowConsumables = consumables.filter((item) => item.lowStock).length;
  const lowItems = items.filter((item) => item.lowStock).length;

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (tab === 'consumable') {
      return consumables.filter((item) => {
        if (lowOnly && !item.lowStock) return false;
        if (!key) return true;
        return item.name.toLowerCase().includes(key) || (item.spec || '').toLowerCase().includes(key);
      });
    }
    return items.filter((item) => {
      if (lowOnly && !item.lowStock) return false;
      if (!key) return true;
      return (
        item.name.toLowerCase().includes(key) ||
        (item.spec || '').toLowerCase().includes(key) ||
        (item.package || '').toLowerCase().includes(key)
      );
    });
  }, [tab, consumables, items, keyword, lowOnly]);

  return (
    <View className='page'>
      <View className={styles.head}>
        <View>
          <Text className={styles.title}>库存查询</Text>
          <Text className={styles.subtitle}>
            耗材预警 {lowConsumables} 项 · 元器件预警 {lowItems} 项
          </Text>
        </View>
      </View>

      <View className={styles.tabs}>
        <View
          className={`${styles.tab} ${tab === 'consumable' ? styles.tabActive : ''}`}
          onClick={() => setTab('consumable')}
        >
          <Text className={styles.tabText}>耗材</Text>
          <Text className={styles.tabCount}>{consumables.length}</Text>
        </View>
        <View className={`${styles.tab} ${tab === 'item' ? styles.tabActive : ''}`} onClick={() => setTab('item')}>
          <Text className={styles.tabText}>元器件</Text>
          <Text className={styles.tabCount}>{items.length}</Text>
        </View>
      </View>

      <View className={styles.search}>
        <Input
          className={styles.searchInput}
          placeholder={tab === 'consumable' ? '搜索耗材名称或规格' : '搜索名称、规格或封装'}
          placeholderClass={styles.placeholder}
          value={keyword}
          onInput={(event) => setKeyword(event.detail.value)}
        />
      </View>

      <View className={styles.switchRow}>
        <Text className={styles.switchLabel}>只看低库存</Text>
        <Switch checked={lowOnly} color='#0f766e' onChange={(event) => setLowOnly(event.detail.value)} />
      </View>

      <PageState loading={loading && consumables.length + items.length === 0} error={error} onRetry={load} />

      {!loading || consumables.length + items.length > 0 ? (
        visible.length === 0 && !error ? (
          <PageState empty emptyText={lowOnly ? '没有低库存项' : '没有匹配的库存'} />
        ) : (
          <View className={styles.list}>
            {tab === 'consumable'
              ? (visible as Consumable[]).map((item) => (
                  <View key={`c-${item.id}`} className={styles.card}>
                    <View className={styles.cardTop}>
                      <View className={styles.icon}>
                        <Text className={styles.iconText}>耗</Text>
                      </View>
                      <View className={styles.info}>
                        <View className={styles.nameRow}>
                          <Text className={styles.name}>{item.name}</Text>
                          {item.lowStock ? <Text className={styles.lowTag}>库存偏低</Text> : null}
                        </View>
                        <Text className={styles.meta}>{item.spec || '未填写规格'}</Text>
                      </View>
                    </View>
                    <View className={styles.foot}>
                      <Text className={styles.warn}>警戒线 {item.warnThreshold}{item.unit}</Text>
                      <Text className={`${styles.quantity} ${item.lowStock ? styles.quantityLow : ''}`}>
                        {item.stock}
                        <Text className={styles.unit}>{item.unit}</Text>
                      </Text>
                    </View>
                  </View>
                ))
              : (visible as InventoryItem[]).map((item) => (
                  <View key={`i-${item.id}`} className={styles.card}>
                    <View className={styles.cardTop}>
                      <View className={styles.icon}>
                        <Text className={styles.iconText}>元</Text>
                      </View>
                      <View className={styles.info}>
                        <View className={styles.nameRow}>
                          <Text className={styles.name}>{item.name}</Text>
                          {item.lowStock ? <Text className={styles.lowTag}>库存偏低</Text> : null}
                        </View>
                        <Text className={styles.meta}>
                          {[item.spec, item.package, item.location].filter(Boolean).join(' · ') || '未填写规格'}
                        </Text>
                      </View>
                    </View>
                    <View className={styles.foot}>
                      <Text className={styles.warn}>警戒线 {item.warnThreshold}{item.unit}</Text>
                      <Text className={`${styles.quantity} ${item.lowStock ? styles.quantityLow : ''}`}>
                        {item.quantity}
                        <Text className={styles.unit}>{item.unit}</Text>
                      </Text>
                    </View>
                  </View>
                ))}
          </View>
        )
      ) : null}
    </View>
  );
}
