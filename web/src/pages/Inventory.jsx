import { useCallback, useEffect, useState } from 'react';
import { api, canUse, formatDateTime, toLocalInput } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatStrip, StatusBadge, Tabs } from '../components/UI.jsx';
import { EquipmentManageTable, EquipmentModal } from '../components/EquipmentModal.jsx';

const emptyItem = { name: '', spec: '', package: '', location: '', quantity: '', unit: '个', warnThreshold: '', note: '' };

export default function Inventory() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = canUse(user, 'inventory');

  const [tab, setTab] = useState('items');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ kinds: 0, total: 0, low: 0 });
  const [onlyLow, setOnlyLow] = useState(false);
  const [keyword, setKeyword] = useState('');

  const [borrows, setBorrows] = useState([]);
  const [borrowSummary, setBorrowSummary] = useState({ borrowed: 0, overdue: 0, returned: 0 });
  const [availableEquipment, setAvailableEquipment] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [equipForm, setEquipForm] = useState(null);
  const [borrowFilter, setBorrowFilter] = useState('');

  const [itemForm, setItemForm] = useState(null);
  const [stockForm, setStockForm] = useState(null);
  const [logs, setLogs] = useState(null);
  const [borrowForm, setBorrowForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemRes, borrowRes, equipmentRes] = await Promise.all([
        api.get(`/inventory${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`),
        api.get('/borrows'),
        api.get('/equipment'),
      ]);
      setItems(itemRes.items);
      setSummary(itemRes.summary);
      setBorrows(borrowRes.items);
      setBorrowSummary(borrowRes.summary);
      const instrumentList = equipmentRes.items.filter((item) => item.category === 'instrument');
      setInstruments(instrumentList);
      setAvailableEquipment(instrumentList.filter((item) => item.status === 'available'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [keyword, toast]);

  useEffect(() => {
    const timer = setTimeout(load, keyword ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, keyword]);

  const visibleItems = onlyLow ? items.filter((item) => item.lowStock) : items;
  const visibleBorrows = borrowFilter ? borrows.filter((item) => item.status === borrowFilter) : borrows;

  const submitItem = async (event) => {
    event.preventDefault();
    const form = itemForm;
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        spec: form.spec,
        package: form.package,
        location: form.location,
        unit: form.unit,
        warnThreshold: form.warnThreshold || 0,
        note: form.note,
      };
      if (form.id) await api.patch(`/inventory/${form.id}`, payload);
      else await api.post('/inventory', { ...payload, quantity: form.quantity || 0 });
      toast.success(form.id ? '物料已更新' : '物料已入库');
      setItemForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitStock = async (event) => {
    event.preventDefault();
    if (!stockForm) return;
    setSaving(true);
    try {
      await api.post(`/inventory/${stockForm.id}/stock`, {
        delta: stockForm.direction === 'out' ? -Math.abs(Number(stockForm.amount)) : Math.abs(Number(stockForm.amount)),
        reason: stockForm.direction === 'out' ? 'issue' : 'purchase',
        ref: stockForm.ref,
        note: stockForm.note,
      });
      toast.success('库存已更新');
      setStockForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openLogs = async (item) => {
    try {
      const res = await api.get(`/inventory/${item.id}/logs`);
      setLogs({ item, items: res.items });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitBorrow = async (event) => {
    event.preventDefault();
    if (!borrowForm) return;
    setSaving(true);
    try {
      await api.post('/borrows', {
        equipmentId: Number(borrowForm.equipmentId),
        dueAt: borrowForm.dueAt,
        conditionNote: borrowForm.conditionNote,
      });
      toast.success('借用登记成功');
      setBorrowForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const returnBorrow = async (item) => {
    const note = window.prompt('归还说明（可留空）') ?? null;
    if (note === null) return;
    try {
      await api.post(`/borrows/${item.id}/return`, { conditionNote: note });
      toast.success('已登记归还');
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

  return (
    <div className="page">
      <PageHeader
        title="库存与借还"
        description="元器件库存出入库流水，以及仪器设备的借出、归还与逾期跟踪。"
        actions={
          <div className="row-actions">
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setEquipForm({})}>
                <Icon name="cpu" size={16} />
                登记仪器
              </button>
            ) : null}
            {manage ? (
              <button type="button" className="btn btn-primary" onClick={() => setItemForm({ ...emptyItem })}>
                <Icon name="plus" size={16} />
                新增物料
              </button>
            ) : null}
          </div>
        }
      />

      <StatStrip
        items={[
          { label: '物料种类', value: summary.kinds, hint: '种' },
          { label: '库存总量', value: summary.total, hint: '件' },
          { label: '低库存', value: summary.low, tone: 'warn', hint: '种' },
          { label: '借出未还', value: borrowSummary.borrowed, tone: 'info', hint: '台' },
          { label: '已逾期', value: borrowSummary.overdue, tone: 'danger', hint: '台' },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'items', label: '元器件库存', count: summary.low },
          { value: 'equipment', label: '仪器设备', count: instruments.length },
          { value: 'borrows', label: '设备借还', count: borrowSummary.borrowed },
        ]}
      />

      {loading ? (
        <div className="table-card">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {!loading && tab === 'items' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <div className="filter-row">
              <input
                className="input"
                placeholder="搜索名称 / 规格 / 封装"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <label className="checkbox-inline">
                <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
                只看低库存
              </label>
            </div>
          </div>
          {visibleItems.length === 0 ? (
            <EmptyState icon="box" title="没有物料" description="建立库存台账后可登记领用与补充。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>物料</th>
                  <th>规格 / 封装</th>
                  <th>位置</th>
                  <th>库存</th>
                  <th>预警线</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} className={item.lowStock ? 'row-warn' : ''}>
                    <td>
                      <strong>{item.name}</strong>
                      {item.lowStock ? <div className="small text-warn">需要补货</div> : null}
                    </td>
                    <td>
                      {item.spec || '-'}
                      {item.package ? <div className="muted small">{item.package}</div> : null}
                    </td>
                    <td>{item.location || '-'}</td>
                    <td>
                      {item.quantity} {item.unit}
                    </td>
                    <td>
                      {item.warnThreshold} {item.unit}
                    </td>
                    <td className="col-actions">
                      <button type="button" className="link-btn" onClick={() => openLogs(item)}>
                        流水
                      </button>
                      {manage ? (
                        <>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setStockForm({ id: item.id, name: item.name, direction: 'in', amount: '', ref: '', note: '' })}
                          >
                            出入库
                          </button>
                          <button type="button" className="link-btn" onClick={() => setItemForm({ ...item })}>
                            编辑
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

      {!loading && tab === 'equipment' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {instruments.length} 台仪器，借还在“设备借还”中登记</span>
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setEquipForm({})}>
                <Icon name="plus" size={16} />
                登记仪器
              </button>
            ) : null}
          </div>
          <EquipmentManageTable
            items={instruments}
            manage={manage}
            onEdit={(item) => setEquipForm(item)}
            onRemove={removeEquipment}
            onBook={(item) => setBorrowForm({ equipmentId: String(item.id), dueAt: '', conditionNote: '' })}
            emptyText="还没有登记仪器设备"
          />
        </div>
      ) : null}

      {!loading && tab === 'borrows' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <div className="chips">
              {[
                { value: '', label: '全部' },
                { value: 'borrowed', label: '借出中' },
                { value: 'overdue', label: '已逾期' },
                { value: 'returned', label: '已归还' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`chip ${borrowFilter === item.value ? 'active' : ''}`}
                  onClick={() => setBorrowFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={availableEquipment.length === 0}
              onClick={() =>
                setBorrowForm({
                  equipmentId: availableEquipment[0]?.id || '',
                  dueAt: toLocalInput(new Date(Date.now() + 24 * 3600 * 1000)),
                  conditionNote: '',
                })
              }
            >
              <Icon name="plus" size={16} />
              借用设备
            </button>
          </div>
          {visibleBorrows.length === 0 ? (
            <EmptyState icon="cpu" title="没有借用记录" description="仪器借出后会在此跟踪归还与逾期。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>借用人</th>
                  <th>借出时间</th>
                  <th>应还时间</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleBorrows.map((item) => (
                  <tr key={item.id} className={item.status === 'overdue' ? 'row-warn' : ''}>
                    <td>
                      <strong>{item.equipmentName}</strong>
                      <div className="muted small">{item.equipmentCode}</div>
                    </td>
                    <td>{item.userName}</td>
                    <td className="nowrap">{formatDateTime(item.borrowedAt)}</td>
                    <td className="nowrap">
                      {formatDateTime(item.dueAt)}
                      {item.returnedAt ? <div className="muted small">归还 {formatDateTime(item.returnedAt)}</div> : null}
                    </td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td className="col-actions">
                      {manage && item.status !== 'returned' ? (
                        <button type="button" className="link-btn" onClick={() => returnBorrow(item)}>
                          登记归还
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

      <Modal
        open={!!itemForm}
        title={itemForm?.id ? '编辑物料' : '新增物料'}
        onClose={() => setItemForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setItemForm(null)}>
              取消
            </button>
            <button type="submit" form="item-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="item-form" className="form form-grid" onSubmit={submitItem}>
          <label className="field">
            <span>名称</span>
            <input
              required
              placeholder="STM32F103C8T6"
              value={itemForm?.name || ''}
              onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>规格</span>
            <input
              value={itemForm?.spec || ''}
              onChange={(e) => setItemForm({ ...itemForm, spec: e.target.value })}
            />
          </label>
          <label className="field">
            <span>封装</span>
            <input
              placeholder="LQFP48"
              value={itemForm?.package || ''}
              onChange={(e) => setItemForm({ ...itemForm, package: e.target.value })}
            />
          </label>
          <label className="field">
            <span>存放位置</span>
            <input
              placeholder="A 柜 3 层"
              value={itemForm?.location || ''}
              onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })}
            />
          </label>
          {!itemForm?.id ? (
            <label className="field">
              <span>初始数量</span>
              <input
                type="number"
                min="0"
                value={itemForm?.quantity || ''}
                onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
              />
            </label>
          ) : null}
          <label className="field">
            <span>单位</span>
            <input
              value={itemForm?.unit || '个'}
              onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
            />
          </label>
          <label className="field">
            <span>预警阈值</span>
            <input
              type="number"
              min="0"
              value={itemForm?.warnThreshold || ''}
              onChange={(e) => setItemForm({ ...itemForm, warnThreshold: e.target.value })}
            />
          </label>
          <label className="field field-full">
            <span>备注</span>
            <input
              value={itemForm?.note || ''}
              onChange={(e) => setItemForm({ ...itemForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!stockForm}
        title={`物料出入库 · ${stockForm?.name || ''}`}
        onClose={() => setStockForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStockForm(null)}>
              取消
            </button>
            <button type="submit" form="item-stock-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认'}
            </button>
          </div>
        }
      >
        <form id="item-stock-form" className="form" onSubmit={submitStock}>
          <label className="field">
            <span>方向</span>
            <select
              value={stockForm?.direction || 'in'}
              onChange={(e) => setStockForm({ ...stockForm, direction: e.target.value })}
            >
              <option value="in">采购入库</option>
              <option value="out">领用出库</option>
            </select>
          </label>
          <label className="field">
            <span>数量</span>
            <input
              type="number"
              min="0"
              required
              value={stockForm?.amount || ''}
              onChange={(e) => setStockForm({ ...stockForm, amount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>关联单据</span>
            <input
              placeholder="采购单号 / 项目名称"
              value={stockForm?.ref || ''}
              onChange={(e) => setStockForm({ ...stockForm, ref: e.target.value })}
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input
              value={stockForm?.note || ''}
              onChange={(e) => setStockForm({ ...stockForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal open={!!logs} title={`库存流水 · ${logs?.item?.name || ''}`} onClose={() => setLogs(null)}>
        {logs?.items?.length ? (
          <table className="table table-compact">
            <thead>
              <tr>
                <th>时间</th>
                <th>变动</th>
                <th>原因</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              {logs.items.map((item) => (
                <tr key={item.id}>
                  <td className="nowrap">{formatDateTime(item.createdAt)}</td>
                  <td className={item.delta < 0 ? 'text-danger' : 'text-ok'}>
                    {item.delta > 0 ? '+' : ''}
                    {item.delta}
                  </td>
                  <td>
                    {{
                      purchase: '采购入库',
                      issue: '领用出库',
                      return: '归还',
                      adjust: '盘点调整',
                      scrap: '报废',
                    }[item.reason] || item.reason}
                    {item.ref ? <div className="muted small">{item.ref}</div> : null}
                  </td>
                  <td>{item.operatorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="box" title="暂无流水" description="出入库操作都会留下记录。" />
        )}
      </Modal>

      <EquipmentModal
        open={!!equipForm}
        initial={equipForm}
        lockCategory="instrument"
        onClose={() => setEquipForm(null)}
        onSaved={load}
      />

      <Modal
        open={!!borrowForm}
        title="借用仪器设备"
        subtitle="借用期间该设备对其他成员不可再借"
        onClose={() => setBorrowForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setBorrowForm(null)}>
              取消
            </button>
            <button type="submit" form="borrow-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认借用'}
            </button>
          </div>
        }
      >
        <form id="borrow-form" className="form" onSubmit={submitBorrow}>
          <label className="field">
            <span>设备</span>
            <select
              required
              value={borrowForm?.equipmentId || ''}
              onChange={(e) => setBorrowForm({ ...borrowForm, equipmentId: e.target.value })}
            >
              <option value="">请选择设备</option>
              {availableEquipment.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（{item.code}）
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>应还时间</span>
            <input
              type="datetime-local"
              required
              value={borrowForm?.dueAt || ''}
              onChange={(e) => setBorrowForm({ ...borrowForm, dueAt: e.target.value })}
            />
          </label>
          <label className="field">
            <span>借用说明</span>
            <input
              placeholder="用途、配件清单"
              value={borrowForm?.conditionNote || ''}
              onChange={(e) => setBorrowForm({ ...borrowForm, conditionNote: e.target.value })}
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
