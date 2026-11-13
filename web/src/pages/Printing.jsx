import { useCallback, useEffect, useState } from 'react';
import { api, canUse, downloadFile, formatDateTime, formatSize } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatStrip, StatusBadge, Tabs } from '../components/UI.jsx';
import { EquipmentManageTable, EquipmentModal } from '../components/EquipmentModal.jsx';

const emptyJob = {
  equipmentId: '',
  title: '',
  fileName: '',
  file: null,
  materialId: '',
  weightGrams: '',
  estMinutes: '',
  note: '',
};
const emptyMaterial = { name: '', spec: '', unit: 'g', stock: '', warnThreshold: '', unitPriceYuan: '', note: '' };

export default function Printing() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = canUse(user, 'equipment');

  const [tab, setTab] = useState('jobs');
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({ queued: 0, printing: 0, done: 0, grams: 0 });
  const [materials, setMaterials] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [jobFilter, setJobFilter] = useState('');

  const [jobForm, setJobForm] = useState(null);
  const [materialForm, setMaterialForm] = useState(null);
  const [printerForm, setPrinterForm] = useState(null);
  const [stockForm, setStockForm] = useState(null);
  const [logs, setLogs] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRes, materialRes, equipmentRes] = await Promise.all([
        api.get('/equipment/print-jobs'),
        api.get('/consumables'),
        api.get('/equipment?category=printer'),
      ]);
      setJobs(jobRes.items);
      setStats(jobRes.stats);
      setMaterials(materialRes.items);
      setPrinters(equipmentRes.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submitJob = async (event) => {
    event.preventDefault();
    if (!jobForm) return;
    setSaving(true);
    try {
      const payload = {
        equipmentId: Number(jobForm.equipmentId),
        title: jobForm.title,
        fileName: jobForm.fileName,
        materialId: jobForm.materialId || undefined,
        weightGrams: jobForm.weightGrams || undefined,
        estMinutes: jobForm.estMinutes || undefined,
        note: jobForm.note,
      };
      if (jobForm.file) {
        await api.upload('/equipment/print-jobs', [jobForm.file], payload, 'file');
      } else {
        await api.post('/equipment/print-jobs', payload);
      }
      toast.success('打印任务已登记');
      setJobForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeJobStatus = async (job, status) => {
    const labels = { printing: '开始打印', done: '完成结算', failed: '标记失败', cancelled: '取消任务' };
    if (status !== 'printing' && !window.confirm(`确定${labels[status]}「${job.title}」吗？`)) return;
    try {
      await api.patch(`/equipment/print-jobs/${job.id}`, { status });
      toast.success(`任务已更新为「${labels[status]}」`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitMaterial = async (event) => {
    event.preventDefault();
    const form = materialForm;
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        spec: form.spec,
        unit: form.unit,
        warnThreshold: form.warnThreshold || 0,
        unitPriceCents: Math.round(Number(form.unitPriceYuan || 0) * 100),
        note: form.note,
      };
      if (form.id) await api.patch(`/consumables/${form.id}`, payload);
      else await api.post('/consumables', { ...payload, stock: form.stock || 0 });
      toast.success(form.id ? '耗材信息已更新' : '耗材已创建');
      setMaterialForm(null);
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
      await api.post(`/consumables/${stockForm.id}/stock`, {
        delta: stockForm.direction === 'out' ? -Math.abs(Number(stockForm.amount)) : Math.abs(Number(stockForm.amount)),
        reason: stockForm.direction === 'out' ? 'adjust' : 'restock',
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

  const openLogs = async (material) => {
    try {
      const res = await api.get(`/consumables/${material.id}/logs`);
      setLogs({ material, items: res.items });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const visibleJobs = jobFilter ? jobs.filter((job) => job.status === jobFilter) : jobs;

  const removePrinter = async (item) => {
    if (!window.confirm(`确定删除打印机「${item.name}」吗？`)) return;
    try {
      await api.del(`/equipment/${item.id}`);
      toast.success('打印机已删除');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="打印与耗材"
        description="打印机台账、打印任务与耗材结算集中在这里，耗材低于阈值自动预警。"
        actions={
          <>
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setPrinterForm({})}>
                <Icon name="plus" size={16} />
                登记打印机
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setJobForm({ ...emptyJob, equipmentId: printers[0]?.id || '' })}
              disabled={printers.length === 0}
            >
              <Icon name="plus" size={16} />
              登记打印任务
            </button>
          </>
        }
      />

      <StatStrip
        items={[
          { label: '排队中', value: stats.queued, tone: 'pending', hint: '个' },
          { label: '打印中', value: stats.printing, tone: 'info', hint: '个' },
          { label: '累计完成', value: stats.done, hint: '个' },
          { label: '已耗耗材', value: stats.grams, hint: '克' },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'jobs', label: '打印任务' },
          { value: 'printers', label: '打印机', count: printers.length },
          { value: 'materials', label: '耗材库存', count: materials.filter((item) => item.lowStock).length },
        ]}
      />

      {loading ? (
        <div className="table-card">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {!loading && tab === 'jobs' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <div className="chips">
              {[
                { value: '', label: '全部' },
                { value: 'queued', label: '排队中' },
                { value: 'printing', label: '打印中' },
                { value: 'done', label: '已完成' },
                { value: 'failed', label: '失败' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`chip ${jobFilter === item.value ? 'active' : ''}`}
                  onClick={() => setJobFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {visibleJobs.length === 0 ? (
            <EmptyState icon="printer" title="没有打印任务" description="登记任务后可跟踪排队、打印与耗材结算。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>打印机</th>
                  <th>申请人</th>
                  <th>耗材</th>
                  <th>状态</th>
                  <th>登记时间</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.title}</strong>
                      {job.fileName ? (
                        <div className="muted small">
                          {job.fileName}
                          {job.fileSize ? ` · ${formatSize(job.fileSize)}` : ''}
                          {job.hasFile ? (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => downloadFile(`/equipment/print-jobs/${job.id}/file`, job.fileName)}
                            >
                              下载
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td>{job.equipmentName}</td>
                    <td>{job.userName}</td>
                    <td>
                      {job.materialName || '-'}
                      {job.weightGrams ? (
                        <div className="muted small">
                          {job.weightGrams} {job.materialUnit}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge value={job.status} />
                    </td>
                    <td className="nowrap">{formatDateTime(job.createdAt)}</td>
                    <td className="col-actions">
                      {manage && job.status === 'queued' ? (
                        <button type="button" className="link-btn" onClick={() => changeJobStatus(job, 'printing')}>
                          开始
                        </button>
                      ) : null}
                      {manage && job.status === 'printing' ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => changeJobStatus(job, 'done')}>
                            完成
                          </button>
                          <button type="button" className="link-btn danger" onClick={() => changeJobStatus(job, 'failed')}>
                            失败
                          </button>
                        </>
                      ) : null}
                      {manage && job.status === 'queued' ? (
                        <button type="button" className="link-btn danger" onClick={() => changeJobStatus(job, 'cancelled')}>
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

      {!loading && tab === 'printers' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {printers.length} 台打印机</span>
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setPrinterForm({})}>
                <Icon name="plus" size={16} />
                登记打印机
              </button>
            ) : null}
          </div>
          <EquipmentManageTable
            items={printers}
            manage={manage}
            onEdit={(item) => setPrinterForm(item)}
            onRemove={removePrinter}
            emptyText="还没有登记打印机，登记后即可提交打印任务"
          />
        </div>
      ) : null}

      {!loading && tab === 'materials' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {materials.length} 种耗材</span>
            {manage ? (
              <button type="button" className="btn btn-ghost" onClick={() => setMaterialForm({ ...emptyMaterial })}>
                <Icon name="plus" size={16} />
                新增耗材
              </button>
            ) : null}
          </div>
          {materials.length === 0 ? (
            <EmptyState icon="box" title="还没有耗材" description="先建立耗材台账，打印完成时才能自动扣减。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>耗材</th>
                  <th>规格</th>
                  <th>库存</th>
                  <th>预警线</th>
                  <th>单价</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((item) => (
                  <tr key={item.id} className={item.lowStock ? 'row-warn' : ''}>
                    <td>
                      <strong>{item.name}</strong>
                      {item.lowStock ? <div className="small text-warn">库存偏低</div> : null}
                    </td>
                    <td>{item.spec || '-'}</td>
                    <td>
                      {item.stock} {item.unit}
                    </td>
                    <td>
                      {item.warnThreshold} {item.unit}
                    </td>
                    <td>{(item.unitPriceCents / 100).toFixed(2)} 元</td>
                    <td className="col-actions">
                      <button type="button" className="link-btn" onClick={() => openLogs(item)}>
                        流水
                      </button>
                      {manage ? (
                        <>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setStockForm({ id: item.id, name: item.name, direction: 'in', amount: '', note: '' })}
                          >
                            出入库
                          </button>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() =>
                              setMaterialForm({
                                ...item,
                                spec: item.spec,
                                unitPriceYuan: (item.unitPriceCents / 100).toFixed(2),
                              })
                            }
                          >
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

      <EquipmentModal
        open={!!printerForm}
        initial={printerForm}
        lockCategory="printer"
        onClose={() => setPrinterForm(null)}
        onSaved={load}
      />

      <Modal
        open={!!jobForm}
        title="登记打印任务"
        subtitle="任务完成后会按耗材用量自动扣减库存"
        onClose={() => setJobForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setJobForm(null)}>
              取消
            </button>
            <button type="submit" form="job-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '提交'}
            </button>
          </div>
        }
      >
        <form id="job-form" className="form" onSubmit={submitJob}>
          <div className="form-grid">
            <label className="field">
              <span>打印机</span>
              <select
                required
                value={jobForm?.equipmentId || ''}
                onChange={(e) => setJobForm({ ...jobForm, equipmentId: e.target.value })}
              >
                <option value="">请选择打印机</option>
                {printers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.code}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>任务名称</span>
              <input
                required
                placeholder="例如：机械臂底座"
                value={jobForm?.title || ''}
                onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>模型文件（可选）</span>
              <input
                type="file"
                accept=".stl,.obj,.3mf,.gcode,.step,.stp,.zip"
                onChange={(e) =>
                  setJobForm({
                    ...jobForm,
                    file: e.target.files?.[0] || null,
                    fileName: e.target.files?.[0]?.name || jobForm.fileName,
                  })
                }
              />
              <span className="hint">支持 STL / OBJ / 3MF / GCODE / STEP / ZIP，不超过 80MB</span>
            </label>
            <label className="field">
              <span>耗材</span>
              <select
                value={jobForm?.materialId || ''}
                onChange={(e) => setJobForm({ ...jobForm, materialId: e.target.value })}
              >
                <option value="">不关联耗材</option>
                {materials.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（余 {item.stock}
                    {item.unit}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>预计用量</span>
              <input
                type="number"
                min="0"
                value={jobForm?.weightGrams || ''}
                onChange={(e) => setJobForm({ ...jobForm, weightGrams: e.target.value })}
              />
            </label>
            <label className="field">
              <span>预计时长（分钟）</span>
              <input
                type="number"
                min="0"
                value={jobForm?.estMinutes || ''}
                onChange={(e) => setJobForm({ ...jobForm, estMinutes: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>备注</span>
            <input
              value={jobForm?.note || ''}
              onChange={(e) => setJobForm({ ...jobForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!materialForm}
        title={materialForm?.id ? '编辑耗材' : '新增耗材'}
        onClose={() => setMaterialForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMaterialForm(null)}>
              取消
            </button>
            <button type="submit" form="material-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="material-form" className="form form-grid" onSubmit={submitMaterial}>
          <label className="field">
            <span>名称</span>
            <input
              required
              placeholder="PLA 线材"
              value={materialForm?.name || ''}
              onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>规格</span>
            <input
              placeholder="1.75mm 白色"
              value={materialForm?.spec || ''}
              onChange={(e) => setMaterialForm({ ...materialForm, spec: e.target.value })}
            />
          </label>
          <label className="field">
            <span>单位</span>
            <input
              value={materialForm?.unit || 'g'}
              onChange={(e) => setMaterialForm({ ...materialForm, unit: e.target.value })}
            />
          </label>
          {!materialForm?.id ? (
            <label className="field">
              <span>初始库存</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={materialForm?.stock || ''}
                onChange={(e) => setMaterialForm({ ...materialForm, stock: e.target.value })}
              />
            </label>
          ) : null}
          <label className="field">
            <span>预警阈值</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={materialForm?.warnThreshold || ''}
              onChange={(e) => setMaterialForm({ ...materialForm, warnThreshold: e.target.value })}
            />
          </label>
          <label className="field">
            <span>单价（元）</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={materialForm?.unitPriceYuan || ''}
              onChange={(e) => setMaterialForm({ ...materialForm, unitPriceYuan: e.target.value })}
            />
          </label>
          <label className="field field-full">
            <span>备注</span>
            <input
              value={materialForm?.note || ''}
              onChange={(e) => setMaterialForm({ ...materialForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!stockForm}
        title={`耗材出入库 · ${stockForm?.name || ''}`}
        onClose={() => setStockForm(null)}
        width={440}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStockForm(null)}>
              取消
            </button>
            <button type="submit" form="stock-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认'}
            </button>
          </div>
        }
      >
        <form id="stock-form" className="form" onSubmit={submitStock}>
          <label className="field">
            <span>方向</span>
            <select
              value={stockForm?.direction || 'in'}
              onChange={(e) => setStockForm({ ...stockForm, direction: e.target.value })}
            >
              <option value="in">入库</option>
              <option value="out">出库 / 损耗</option>
            </select>
          </label>
          <label className="field">
            <span>数量</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={stockForm?.amount || ''}
              onChange={(e) => setStockForm({ ...stockForm, amount: e.target.value })}
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

      <Modal
        open={!!logs}
        title={`出入库流水 · ${logs?.material?.name || ''}`}
        onClose={() => setLogs(null)}
        width={520}
      >
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
                    {item.reason === 'print' ? '打印结算' : item.reason === 'restock' ? '入库' : item.reason === 'scrap' ? '报废' : '调整'}
                    {item.note ? <div className="muted small">{item.note}</div> : null}
                  </td>
                  <td>{item.operatorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="box" title="暂无流水" description="耗材的入库、打印结算都会记录在这里。" />
        )}
      </Modal>
    </div>
  );
}
