import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { getToken } from '../../services/session';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import { API_BASE_URL } from '../../config';
import { formatDateTime } from '../../utils/format';
import styles from './index.module.scss';

interface DocumentItem {
  id: number;
  title: string;
  category: string;
  description: string;
  originalName: string;
  mime: string;
  size: number;
  uploaderName: string;
  createdAt: string;
}

export default function Documents() {
  const ready = useAuthGuard();
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<{ items: DocumentItem[]; categories: typeof categories }>('/documents');
      setItems(res.items);
      setCategories(res.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '资料加载失败');
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
      return item.title.toLowerCase().includes(key) || item.originalName.toLowerCase().includes(key);
    });
  }, [items, category, keyword]);

  const download = async (item: DocumentItem) => {
    if (process.env.TARO_ENV === 'h5') {
      Taro.showToast({ title: '请在网页端下载该资料', icon: 'none' });
      return;
    }
    setDownloading(item.id);
    try {
      const res = await Taro.downloadFile({
        url: `${API_BASE_URL}/documents/${item.id}/download?download=1`,
        header: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.statusCode !== 200) {
        throw new Error(`下载失败（${res.statusCode}）`);
      }
      await Taro.openDocument({ filePath: res.tempFilePath, showMenu: true });
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '下载失败', icon: 'none' });
    } finally {
      setDownloading(0);
    }
  };

  const sizeText = (size: number) => {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
  };

  return (
    <View className='page'>
      <View className={styles.search}>
        <Input
          className={styles.searchInput}
          placeholder='搜索资料标题或文件名'
          placeholderClass={styles.placeholder}
          value={keyword}
          onInput={(event) => setKeyword(event.detail.value)}
        />
      </View>

      <ScrollView scrollX className={styles.chips} showScrollbar={false}>
        <View
          className={`${styles.chip} ${category === '' ? styles.chipActive : ''}`}
          onClick={() => setCategory('')}
        >
          <Text className={styles.chipText}>全部</Text>
        </View>
        {categories.map((item) => (
          <View
            key={item.category}
            className={`${styles.chip} ${category === item.category ? styles.chipActive : ''}`}
            onClick={() => setCategory(item.category)}
          >
            <Text className={styles.chipText}>
              {item.category}（{item.count}）
            </Text>
          </View>
        ))}
      </ScrollView>

      <PageState loading={loading && items.length === 0} error={error} onRetry={load} />

      {!loading || items.length > 0 ? (
        visible.length === 0 && !error ? (
          <PageState empty emptyText='暂无资料' />
        ) : (
          <View className={styles.list}>
            {visible.map((item) => (
              <View key={item.id} className={styles.card}>
                <View className={styles.icon}>
                  <Text className={styles.iconText}>
                    {item.originalName.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOC'}
                  </Text>
                </View>
                <View className={styles.info}>
                  <Text className={styles.title}>{item.title}</Text>
                  <Text className={styles.meta}>
                    {item.category} · {sizeText(item.size)} · {item.uploaderName}
                  </Text>
                  <Text className={styles.time}>{formatDateTime(item.createdAt)}</Text>
                </View>
                <View
                  className={`${styles.download} ${downloading === item.id ? styles.downloading : ''}`}
                  onClick={() => download(item)}
                >
                  <Text className={styles.downloadText}>{downloading === item.id ? '…' : '下载'}</Text>
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}
