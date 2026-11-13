import React from 'react';
import { Text } from '@tarojs/components';
import styles from './index.module.scss';

const LABELS: Record<string, string> = {
  available: '可用',
  maintenance: '维护中',
  retired: '已停用',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
  completed: '已完成',
  open: '报名中',
  closed: '已截止',
  finished: '已结束',
  draft: '草稿',
  overdue: '已逾期',
  borrowed: '借出中',
  returned: '已归还',
};

const TONES: Record<string, string> = {
  available: 'success',
  approved: 'success',
  open: 'success',
  maintenance: 'warning',
  pending: 'warning',
  borrowed: 'warning',
  rejected: 'danger',
  overdue: 'danger',
  retired: 'muted',
  cancelled: 'muted',
  completed: 'muted',
  closed: 'muted',
  finished: 'muted',
  draft: 'muted',
  returned: 'muted',
};

interface StatusTagProps {
  status: string;
  label?: string;
}

export default function StatusTag({ status, label }: StatusTagProps) {
  const tone = TONES[status] || 'muted';
  return <Text className={`${styles.tag} ${styles[tone]}`}>{label || LABELS[status] || status}</Text>;
}
