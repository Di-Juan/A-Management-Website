import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import { useToast } from '../context.jsx';
import { Modal } from './UI.jsx';

export const EQUIPMENT_CATEGORY_LABEL = { printer: '3D 打印机', instrument: '仪器设备', other: '其他设备' };
export const EQUIPMENT_CATEGORY_OPTIONS = [
  { value: 'printer', label: '3D 打印机' },
  { value: 'instrument', label: '仪器设备' },
  { value: 'other', label: '其他设备' },
];
export const EQUIPMENT_STATUS_OPTIONS = [
  { value: 'available', label: '可用' },
  { value: 'maintenance', label: '维护中' },
  { value: 'retired', label: '已停用' },
];

export const emptyEquipment = {
  code: '',
  name: '',
  category: 'printer',
  typeName: '',
  location: '',
  status: 'available',
  requiresApproval: true,
  note: '',
};

/**
 * 设备登记/编辑弹窗。Printing、Inventory、Equipment 三个板块共用。
 * lockCategory 用于在“打印板块/仪器板块”里固定设备类别。
 */
export function EquipmentModal({ open, initial, lockCategory, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyEquipment);
  const [types, setTypes] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyEquipment, ...(initial || {}), ...(lockCategory ? { category: lockCategory } : {}) });
    api
      .get('/equipment/types')
      .then((data) => setTypes(data.items || []))
      .catch(() => setTypes([]));
  }, [open, initial, lockCategory]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category,
        typeName: form.typeName.trim(),
        location: form.location.trim(),
        status: form.status,
        requiresApproval: !!form.requiresApproval,
        note: form.note.trim(),
      };
      if (form.id) await api.patch(`/equipment/${form.id}`, payload);
      else await api.post('/equipment', payload);
      toast.success(form.id ? '设备信息已更新' : '设备已登记');
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const suggestions = types
    .filter((item) => !form.category || item.category === form.category)
    .map((item) => item.name);

  return (
    <Modal
      open={open}
      title={form.id ? '编辑设备' : '登记设备'}
      subtitle="设备编号用于现场标识，建议与资产标签一致；类型可自由命名"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" form="equipment-form" className="btn btn-primary" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <form id="equipment-form" className="form form-grid" onSubmit={submit}>
        <label className="field">
          <span>设备编号</span>
          <input
            required
            disabled={!!form.id}
            placeholder="P-3D-03"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </label>
        <label className="field">
          <span>设备名称</span>
          <input
            required
            placeholder="拓竹 P1S 3D 打印机"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>归属板块</span>
          <select
            value={form.category}
            disabled={!!lockCategory}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {EQUIPMENT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>设备类型</span>
          <input
            list="equipment-type-options"
            placeholder="如：FDM 打印机 / 示波器"
            value={form.typeName}
            onChange={(e) => setForm({ ...form, typeName: e.target.value })}
          />
          <datalist id="equipment-type-options">
            {[...new Set(suggestions)].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>状态</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {EQUIPMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>存放位置</span>
          <input
            placeholder="创客空间 A 区"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </label>
        <label className="field field-inline">
          <input
            type="checkbox"
            checked={!!form.requiresApproval}
            onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
          />
          <span>预约需要审核</span>
        </label>
        <label className="field field-full">
          <span>备注</span>
          <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
      </form>
    </Modal>
  );
}

export function EquipmentManageTable({ items, manage, onEdit, onRemove, onBook, emptyText }) {
  if (items.length === 0) {
    return (
      <div className="empty-inline">
        <Icon name="cpu" size={18} />
        <span>{emptyText || '还没有登记设备'}</span>
      </div>
    );
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>设备</th>
          <th>类型</th>
          <th>位置</th>
          <th>状态</th>
          <th>预约规则</th>
          <th className="col-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>
              <strong>{item.name}</strong>
              <div className="muted small">{item.code}</div>
            </td>
            <td>{item.typeName || EQUIPMENT_CATEGORY_LABEL[item.category] || item.category}</td>
            <td>{item.location || '-'}</td>
            <td>
              <span className={`badge ${item.status === 'available' ? 'badge-ok' : ''}`}>
                {EQUIPMENT_STATUS_OPTIONS.find((option) => option.value === item.status)?.label || item.status}
              </span>
            </td>
            <td>{item.requiresApproval ? '需审核' : '免审核'}</td>
            <td className="col-actions">
              {onBook ? (
                <button type="button" className="link-btn" onClick={() => onBook(item)}>
                  预约
                </button>
              ) : null}
              {manage ? (
                <>
                  <button type="button" className="link-btn" onClick={() => onEdit(item)}>
                    编辑
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => onRemove(item)}>
                    删除
                  </button>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
