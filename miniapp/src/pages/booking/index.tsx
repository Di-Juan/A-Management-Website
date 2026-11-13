import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Textarea, Picker } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { api, ApiError } from '../../services/api';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import PageState from '../../components/PageState';
import { currentTime, todayString } from '../../utils/format';
import type { Equipment } from '../../types';
import styles from './index.module.scss';

export default function BookingPage() {
  const ready = useAuthGuard();
  const router = useRouter();
  const initialId = Number(router.params.equipmentId || 0);

  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [equipmentId, setEquipmentId] = useState(initialId);
  const [startDate, setStartDate] = useState(todayString());
  const [startTime, setStartTime] = useState(currentTime());
  const [endDate, setEndDate] = useState(todayString());
  const [endTime, setEndTime] = useState('22:00');
  const [purpose, setPurpose] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<{ items: Equipment[] }>('/equipment');
      setEquipment(res.items);
      if (!initialId) {
        const firstAvailable = res.items.find((item) => item.status === 'available');
        if (firstAvailable) setEquipmentId(firstAvailable.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '设备加载失败');
    } finally {
      setLoading(false);
    }
  }, [initialId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const available = equipment.filter((item) => item.status === 'available');
  const selected = equipment.find((item) => item.id === equipmentId);
  const selectedIndex = Math.max(
    0,
    available.findIndex((item) => item.id === equipmentId),
  );

  const submit = async () => {
    if (!equipmentId) {
      Taro.showToast({ title: '请选择设备', icon: 'none' });
      return;
    }
    if (!purpose.trim()) {
      Taro.showToast({ title: '请填写预约用途', icon: 'none' });
      return;
    }
    const start = new Date(`${startDate}T${startTime}:00`).getTime();
    const end = new Date(`${endDate}T${endTime}:00`).getTime();
    if (!start || !end || end <= start) {
      Taro.showToast({ title: '结束时间需晚于开始时间', icon: 'none' });
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/equipment/bookings', {
        equipmentId,
        startAt: `${startDate} ${startTime}`,
        endAt: `${endDate} ${endTime}`,
        purpose: purpose.trim(),
      });
      Taro.showToast({ title: selected?.requiresApproval ? '已提交，等待审核' : '预约成功', icon: 'success' });
      setTimeout(() => {
        Taro.navigateBack({ delta: 1 });
      }, 900);
    } catch (err) {
      Taro.showToast({
        title: err instanceof ApiError ? err.message : '预约失败',
        icon: 'none',
        duration: 2200,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className={styles.page}>
      <PageState loading={loading} error={error} onRetry={load} />

      {!loading && !error ? (
        <>
          <View className={styles.card}>
            <Text className={styles.cardTitle}>选择设备</Text>
            {available.length === 0 ? (
              <Text className={styles.hint}>当前没有可预约的设备</Text>
            ) : (
              <Picker
                mode='selector'
                range={available.map((item) => `${item.name}（${item.code}）`)}
                value={selectedIndex}
                onChange={(event) => {
                  const item = available[Number(event.detail.value)];
                  if (item) setEquipmentId(item.id);
                }}
              >
                <View className={styles.pickerRow}>
                  <Text className={styles.pickerValue}>
                    {selected ? `${selected.name}（${selected.code}）` : '请选择设备'}
                  </Text>
                  <Text className={styles.pickerArrow}>›</Text>
                </View>
              </Picker>
            )}
            {selected ? (
              <Text className={styles.deviceMeta}>
                {selected.typeName || selected.code} · {selected.location || '未标注位置'}
              </Text>
            ) : null}
          </View>

          <View className={styles.card}>
            <Text className={styles.cardTitle}>预约时段</Text>
            <View className={styles.timeRow}>
              <View className={styles.timeCol}>
                <Text className={styles.fieldLabel}>开始</Text>
                <View className={styles.selectors}>
                  <Picker mode='date' value={startDate} onChange={(event) => setStartDate(event.detail.value)}>
                    <View className={styles.selector}>
                      <Text className={styles.selectorText}>{startDate}</Text>
                    </View>
                  </Picker>
                  <Picker mode='time' value={startTime} onChange={(event) => setStartTime(event.detail.value)}>
                    <View className={styles.selector}>
                      <Text className={styles.selectorText}>{startTime}</Text>
                    </View>
                  </Picker>
                </View>
              </View>
              <View className={styles.timeCol}>
                <Text className={styles.fieldLabel}>结束</Text>
                <View className={styles.selectors}>
                  <Picker mode='date' value={endDate} onChange={(event) => setEndDate(event.detail.value)}>
                    <View className={styles.selector}>
                      <Text className={styles.selectorText}>{endDate}</Text>
                    </View>
                  </Picker>
                  <Picker mode='time' value={endTime} onChange={(event) => setEndTime(event.detail.value)}>
                    <View className={styles.selector}>
                      <Text className={styles.selectorText}>{endTime}</Text>
                    </View>
                  </Picker>
                </View>
              </View>
            </View>
          </View>

          <View className={styles.card}>
            <Text className={styles.cardTitle}>用途说明</Text>
            <Textarea
              className={styles.textarea}
              placeholder='简单说明实验、课程或项目用途'
              placeholderClass={styles.placeholder}
              maxlength={200}
              value={purpose}
              onInput={(event) => setPurpose(event.detail.value)}
            />
            <Text className={styles.counter}>{purpose.length}/200</Text>
          </View>

          <View className={styles.tip}>
            <Text className={styles.tipText}>
              {selected?.requiresApproval
                ? '该设备需要管理员审核，请留意预约状态'
                : '预约提交后立即生效，请按时使用并归还'}
            </Text>
          </View>

          <View className={`${styles.submit} ${submitting ? styles.submitDisabled : ''}`} onClick={submit}>
            <Text className={styles.submitText}>{submitting ? '提交中…' : '提交预约'}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}
