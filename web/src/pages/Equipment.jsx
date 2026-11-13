import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, canUse, downloadFile, formatDateTime, toLocalInput } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatStrip, StatusBadge, Tabs } from '../components/UI.jsx';
import { EQUIPMENT_CATEGORY_LABEL, EquipmentModal } from '../components/EquipmentModal.jsx';

const CATEGORY_LABEL = EQUIPMENT_CATEGORY_LABEL;

export default function Equipment() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = canUse(user, 'equipment');

  const [tab, setTab] = useState('list');
  const [loading, setLoading] = useState(true);
  const [equipment, setEquipment] = useState([]);
  const [summary, setSummary] = useState({ available: 0, maintenance: 0, retired: 0, pendingBookings: 0 });
  const [bookings, setBookings] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [bookingFilter, setBookingFilter] = useState('');
  const [types, setTypes] = useState([]);

  const [equipmentForm, setEquipmentForm] = useState(null);
  const [bookingForm, setBookingForm] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState(null);
  const [logForm, setLogForm] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [equipmentRes, bookingRes, maintenanceRes, typeRes] = await Promise.all([
        api.get('/equipment'),
        api.get('/equipment/bookings'),
        api.get('/equipment/maintenance'),
        api.get('/equipment/types'),
      ]);
      setEquipment(equipmentRes.items);
      setSummary(equipmentRes.summary);
      setBookings(bookingRes.items);
      setMaintenance(maintenanceRes.items);
      setTypes(typeRes.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleBookings = useMemo(
    () => (bookingFilter ? bookings.filter((item) => item.status === bookingFilter) : bookings),
    [bookings, bookingFilter],
  );

  const submitBooking = async (event) => {
    event.preventDefault();
    if (!bookingForm) return;
    setSaving(true);
    try {
      await api.post('/equipment/bookings', {
        equipmentId: Number(bookingForm.equipmentId),
        startAt: bookingForm.startAt,
        endAt: bookingForm.endAt,
        purpose: bookingForm.purpose,
      });
      toast.success('预约已提交');
      setBookingForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitMaintenance = async (event) => {
    event.preventDefault();
    if (!maintenanceForm) return;
    setSaving(true);
    try {
      await api.post('/equipment/maintenance', {
        equipmentId: Number(maintenanceForm.equipmentId),
        type: maintenanceForm.type,
        content: maintenanceForm.content,
        costCents: Math.round(Number(maintenanceForm.costYuan || 0) * 100),
        performedBy: maintenanceForm.performedBy,
        performedAt: maintenanceForm.performedAt,
        nextDueAt: maintenanceForm.nextDueAt || undefined,
      });
      toast.success('维护记录已保存');
      setMaintenanceForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const review = async (item, result) => {
    const reason = result === 'reject' ? window.prompt('请填写驳回原因') : '';
    if (result === 'reject' && !reason) return;
    try {
      await api.post(`/equipment/bookings/${item.id}/review`, { result, reason });
      toast.success(result === 'approve' ? '预约已通过' : '预约已驳回');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cancelBooking = async (item) => {
    if (!window.confirm('确定取消该预约吗？')) return;
    try {
      await api.post(`/equipment/bookings/${item.id}/cancel`, {});
      toast.success('预约已取消');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const completeBooking = async (item) => {
    try {
      await api.post(`/equipment/bookings/${item.id}/complete`, {});
      toast.success('已标记为完成');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeEquipment = async (item) => {
    if (!window.confirm(`确定删除设备「${item.name}」吗？`)) return;
    try {
      await api.del(`/equipment/${item.id}`);
      toast.success('设备已删除');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openBooking = (equipmentId) => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(Date.now() + 3 * 60 * 60 * 1000);
    setBookingForm({
      equipmentId: equipmentId || equipment[0]?.id || '',
      startAt: toLocalInput(start),
      endAt: toLocalInput(end),
      purpose: '',
    });
  };

  const submitLogExport = async (event) => {
    event.preventDefault();
    const type = logForm?.type || '';
    setExporting(true);
    try {
      await downloadFile(
        `/export/equipment-logs${type ? `?type=${encodeURIComponent(type)}` : ''}`,
        `设备日志_${type || '全部'}.xlsx`,
      );
      toast.success('设备日志已导出');
      setLogForm(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="设备预约"
        description="3D 打印机与仪器设备的台账、时段预约和审核，避免时间冲突。"
        actions={
          <div className="row-actions">
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setLogForm({ type: '' })}>
                <Icon name="download" size={16} />
                导出设备日志
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={() => openBooking()}>
              <Icon name="plus" size={16} />
              新建预约
            </button>
          </div>
        }
      />

      <StatStrip
        items={[
          { label: '可用设备', value: summary.available, hint: '台' },
          { label: '维护中', value: summary.maintenance, tone: 'warn', hint: '台' },
          { label: '待审核预约', value: summary.pendingBookings, tone: 'pending', hint: '条' },
          { label: '设备总数', value: equipment.length, hint: '台' },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'list', label: '设备台账' },
          { value: 'bookings', label: '预约记录', count: summary.pendingBookings },
          { value: 'maintenance', label: '维护记录' },
        ]}
      />

      {loading ? (
        <div className="table-card">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {!loading && tab === 'list' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {equipment.length} 台设备</span>
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setEquipmentForm({})}>
                <Icon name="plus" size={16} />
                登记设备
              </button>
            ) : null}
          </div>
          {equipment.length === 0 ? (
            <EmptyState icon="cpu" title="还没有设备" description="先登记设备，成员才能提交预约。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>类别</th>
                  <th>位置</th>
                  <th>状态</th>
                  <th>预约规则</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <div className="muted small">{item.code}</div>
                    </td>
                    <td>{item.typeName || CATEGORY_LABEL[item.category] || item.category}</td>
                    <td>{item.location || '-'}</td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td>{item.requiresApproval ? '需审核' : '免审核'}</td>
                    <td className="col-actions">
                      <button type="button" className="link-btn" onClick={() => openBooking(item.id)}>
                        预约
                      </button>
                      {manage ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => setEquipmentForm({ ...item })}>
                            编辑
                          </button>
                          <button type="button" className="link-btn danger" onClick={() => removeEquipment(item)}>
                            删除
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {!loading && tab === 'bookings' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <div className="chips">
              {[
                { value: '', label: '全部' },
                { value: 'pending', label: '待审核' },
                { value: 'approved', label: '已通过' },
                { value: 'completed', label: '已完成' },
                { value: 'rejected', label: '已驳回' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`chip ${bookingFilter === item.value ? 'active' : ''}`}
                  onClick={() => setBookingFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {visibleBookings.length === 0 ? (
            <EmptyState icon="calendar" title="没有预约记录" description="选择设备后即可提交时段预约。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>申请人</th>
                  <th>时段</th>
                  <th>用途</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleBookings.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.equipmentName}</strong>
                      <div className="muted small">{item.equipmentCode}</div>
                    </td>
                    <td>{item.userName}</td>
                    <td className="nowrap">
                      {formatDateTime(item.startAt)}
                      <div className="muted small">至 {formatDateTime(item.endAt)}</div>
                    </td>
                    <td className="wrap">{item.purpose}</td>
                    <td>
                      <StatusBadge value={item.status} />
                      {item.rejectReason ? <div className="muted small">{item.rejectReason}</div> : null}
                    </td>
                    <td className="col-actions">
                      {manage && item.status === 'pending' ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => review(item, 'approve')}>
                            通过
                          </button>
                          <button type="button" className="link-btn danger" onClick={() => review(item, 'reject')}>
                            驳回
                          </button>
                        </>
                      ) : null}
                      {manage && item.status === 'approved' ? (
                        <button type="button" className="link-btn" onClick={() => completeBooking(item)}>
                          标记完成
                        </button>
                      ) : null}
                      {(item.userId === user.id || manage) && ['pending', 'approved'].includes(item.status) ? (
                        <button type="button" className="link-btn danger" onClick={() => cancelBooking(item)}>
                          取消
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {!loading && tab === 'maintenance' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">维护记录 {maintenance.length} 条</span>
            {manage ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setMaintenanceForm({
                    equipmentId: equipment[0]?.id || '',
                    type: 'routine',
                    content: '',
                    costYuan: '',
                    performedBy: user.displayName || '',
                    performedAt: toLocalInput(new Date()),
                    nextDueAt: '',
                  })
                }
              >
                <Icon name="plus" size={16} />
                新增维护记录
              </button>
            ) : null}
          </div>
          {maintenance.length === 0 ? (
            <EmptyState icon="shield" title="暂无维护记录" description="保养、维修与巡检记录都会归档在这里。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>类型</th>
                  <th>维护内容</th>
                  <th>费用</th>
                  <th>执行人</th>
                  <th>维护时间</th>
                </tr>
              </thead>
              <tbody>
                {maintenance.map((item) => (
                  <tr key={item.id}>
                    <td>{item.equipmentName}</td>
                    <td>{item.type === 'repair' ? '维修' : item.type === 'inspection' ? '巡检' : '保养'}</td>
                    <td className="wrap">{item.content}</td>
                    <td>{(item.costCents / 100).toFixed(2)} 元</td>
                    <td>{item.performedBy || item.operatorName}</td>
                    <td className="nowrap">{formatDateTime(item.performedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      <EquipmentModal
        open={!!equipmentForm}
        initial={equipmentForm}
        onClose={() => setEquipmentForm(null)}
        onSaved={load}
      />

      <Modal
        open={!!bookingForm}
        title="新建设备预约"
        subtitle="提交后由设备管理员审核，冲突时段会被自动拦截"
        onClose={() => setBookingForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setBookingForm(null)}>
              取消
            </button>
            <button type="submit" form="booking-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '提交预约'}
            </button>
          </div>
        }
      >
        <form id="booking-form" className="form" onSubmit={submitBooking}>
          <label className="field">
            <span>设备</span>
            <select
              required
              value={bookingForm?.equipmentId || ''}
              onChange={(e) => setBookingForm({ ...bookingForm, equipmentId: e.target.value })}
            >
              <option value="">请选择设备</option>
              {equipment
                .filter((item) => item.status === 'available')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.code}）
                  </option>
                ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>开始时间</span>
              <input
                type="datetime-local"
                required
                value={bookingForm?.startAt || ''}
                onChange={(e) => setBookingForm({ ...bookingForm, startAt: e.target.value })}
              />
            </label>
            <label className="field">
              <span>结束时间</span>
              <input
                type="datetime-local"
                required
                value={bookingForm?.endAt || ''}
                onChange={(e) => setBookingForm({ ...bookingForm, endAt: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>预约用途</span>
            <input
              required
              placeholder="例如：结构件打印 / 电路调试"
              value={bookingForm?.purpose || ''}
              onChange={(e) => setBookingForm({ ...bookingForm, purpose: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!maintenanceForm}
        title="新增维护记录"
        subtitle="维修记录保存后，设备会自动恢复为可用状态"
        onClose={() => setMaintenanceForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMaintenanceForm(null)}>
              取消
            </button>
            <button type="submit" form="maintenance-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="maintenance-form" className="form" onSubmit={submitMaintenance}>
          <div className="form-grid">
            <label className="field">
              <span>设备</span>
              <select
                required
                value={maintenanceForm?.equipmentId || ''}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, equipmentId: e.target.value })}
              >
                <option value="">请选择设备</option>
                {equipment.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.code}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>类型</span>
              <select
                value={maintenanceForm?.type || 'routine'}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, type: e.target.value })}
              >
                <option value="routine">保养</option>
                <option value="repair">维修</option>
                <option value="inspection">巡检</option>
              </select>
            </label>
            <label className="field">
              <span>维护时间</span>
              <input
                type="datetime-local"
                required
                value={maintenanceForm?.performedAt || ''}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, performedAt: e.target.value })}
              />
            </label>
            <label className="field">
              <span>费用（元）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={maintenanceForm?.costYuan || ''}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, costYuan: e.target.value })}
              />
            </label>
            <label className="field">
              <span>执行人</span>
              <input
                value={maintenanceForm?.performedBy || ''}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, performedBy: e.target.value })}
              />
            </label>
            <label className="field">
              <span>下次维护时间</span>
              <input
                type="datetime-local"
                value={maintenanceForm?.nextDueAt || ''}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, nextDueAt: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>维护内容</span>
            <textarea
              rows={3}
              required
              placeholder="例如：更换喷嘴并校准热床"
              value={maintenanceForm?.content || ''}
              onChange={(e) => setMaintenanceForm({ ...maintenanceForm, content: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!logForm}
        title="导出设备日志"
        subtitle="导出设备台账与预约、打印、维护、借还记录，可选择全部设备或某一设备类型"
        onClose={() => setLogForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setLogForm(null)}>
              取消
            </button>
            <button type="submit" form="log-export-form" className="btn btn-primary" disabled={exporting}>
              {exporting ? '导出中…' : '导出 Excel'}
            </button>
          </div>
        }
      >
        <form id="log-export-form" className="form" onSubmit={submitLogExport}>
          <label className="field">
            <span>设备类型</span>
            <select value={logForm?.type || ''} onChange={(e) => setLogForm({ ...logForm, type: e.target.value })}>
              <option value="">全部设备（{equipment.length} 台）</option>
              {types.map((item) => (
                <option key={`${item.category}-${item.name}`} value={item.name}>
                  {item.name}（{item.count} 台）
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            导出文件包含「导出说明、设备台账、预约记录、打印任务、维护记录、借还记录」六个工作表，时间按本地时区显示。
          </p>
        </form>
      </Modal>
    </div>
  );
}
