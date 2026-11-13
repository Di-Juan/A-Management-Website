import React from 'react';
import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

interface PageStateProps {
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
}

export default function PageState({ loading, error, empty, emptyText = '暂无数据', onRetry }: PageStateProps) {
  if (loading) {
    return (
      <View className={styles.state}>
        <View className={styles.spinner} />
        <Text className={styles.text}>加载中…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className={styles.state}>
        <Text className={styles.title}>加载失败</Text>
        <Text className={styles.text}>{error}</Text>
        {onRetry ? (
          <View className={styles.retry} onClick={onRetry}>
            <Text className={styles.retryText}>重新加载</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (empty) {
    return (
      <View className={styles.state}>
        <View className={styles.emptyIcon}>
          <View className={styles.emptyLine} />
          <View className={styles.emptyLineShort} />
        </View>
        <Text className={styles.text}>{emptyText}</Text>
      </View>
    );
  }

  return null;
}
