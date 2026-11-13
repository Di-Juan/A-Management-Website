import { useEffect, useRef, useState } from 'react';
import { api, canRecord, todayString } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { AttachmentGallery, FilePicker, Modal } from './UI.jsx';

export default function TransactionModal({ open, onClose, onSaved, record = null, defaultType = 'expense' }) {
  const { user } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [type, setType] = useState(defaultType);
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayString());
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);
  const [existing, setExisting] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef('');

  const canIncome = canRecord(user, 'income');
  const canExpense = canRecord(user, 'expense');
  const pickType = (preferred) => {
    if (canRecord(user, preferred)) return preferred;
    if (canIncome) return 'income';
    if (canExpense) return 'expense';
    return preferred;
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
    setFiles([]);
    const nextType = pickType(record?.type || defaultType);
    setType(nextType);
    setAmount(record ? (record.amountCents / 100).toFixed(2) : '');
    setOccurredAt(record?.occurredAt || todayString());
    setCategoryId(record?.categoryId ? String(record.categoryId) : '');
    setReason(record?.reason || '');
    setCounterparty(record?.counterparty || '');
    setNote(record?.note || '');
    setExisting(record?.attachments || []);
    requestIdRef.current = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

    api
      .get('/categories')
      .then((data) => {
        setCategories(data.items);
        if (!record) {
          const first = data.items.find((c) => c.type === nextType);
          if (first) setCategoryId(String(first.id));
        }
      })
      .catch((err) => setError(err.message));
  }, [open, record, defaultType, user]);

  const options = categories.filter((c) => c.type === type);

  const changeType = (next) => {
    setType(next);
    const nextOptions = categories.filter((c) => c.type === next);
    if (!nextOptions.some((c) => String(c.id) === categoryId)) {
      setCategoryId(nextOptions[0] ? String(nextOptions[0].id) : '');
    }
  };

  const removeExisting = async (item) => {
    if (!window.confirm(`确定删除凭证「${item.originalName}」吗？`)) return;
    try {
      await api.del(`/attachments/${item.id}`);
      setExisting((list) => list.filter((a) => a.id !== item.id));
      toast.success('凭证已删除');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canRecord(user, type)) {
      setError('没有该类型的记账权限');
      return;
    }
    setError('');

    const numeric = Number(String(amount).replace(/,/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('请输入大于 0 的金额');
      return;
    }
    if (!reason.trim()) {
      setError('请填写收支原因');
      return;
    }
    if (!occurredAt) {
      setError('请选择收支日期');
      return;
    }

    setSaving(true);
    const payload = {
      type,
      amount: numeric.toFixed(2),
      occurredAt,
      categoryId: categoryId || null,
      reason: reason.trim(),
      counterparty: counterparty.trim(),
      note: note.trim(),
    };

    try {
      let saved;
      if (record) {
        const data = await api.patch(`/transactions/${record.id}`, { ...payload, version: record.version });
        saved = data.transaction;
      } else {
        const data = await api.post('/transactions', { ...payload, clientRequestId: requestIdRef.current });
        saved = data.transaction;
      }

      let uploadFailed = 0;
      if (files.length > 0) {
        try {
          await api.upload(`/transactions/${saved.id}/attachments`, files);
        } catch {
          uploadFailed = files.length;
        }
      }

      toast.success(record ? '账单已更新' : '账单已记录');
      if (uploadFailed) toast.error(`${uploadFailed} 个凭证上传失败，可在详情中重新上传`);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) {
        toast.error('记录已被他人修改，请关闭后刷新重试');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={record ? '编辑账单' : '记一笔'}
      subtitle={record ? `录入人 ${record.operatorName}` : '收支与凭证会同步记录到操作日志'}
      width={640}
      footer={
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="submit" form="tx-form" className="btn btn-primary" disabled={saving}>
            {saving ? '保存中…' : record ? '保存修改' : '确认记账'}
          </button>
        </div>
      }
    >
      <form id="tx-form" className="form" onSubmit={submit}>
        <div className="segmented">
          <button
            type="button"
            className={type === 'expense' ? 'seg active expense' : 'seg'}
            onClick={() => changeType('expense')}
            disabled={!canExpense}
          >
            支出
          </button>
          <button
            type="button"
            className={type === 'income' ? 'seg active income' : 'seg'}
            onClick={() => changeType('income')}
            disabled={!canIncome}
          >
            收入
          </button>
        </div>
        {!canIncome || !canExpense ? (
          <p className="hint">你当前只有{canIncome ? '收入' : '支出'}记账权限，如需调整请联系管理员。</p>
        ) : null}

        <div className="form-grid">
          <label className="field">
            <span>金额（元）</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              autoFocus
            />
          </label>
          <label className="field">
            <span>收支日期</span>
            <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </label>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>分类</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">未分类</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>对方（选填）</span>
            <input
              type="text"
              placeholder="如：文具店 / 班费收缴"
              value={counterparty}
              maxLength={60}
              onChange={(e) => setCounterparty(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>收支原因</span>
          <input
            type="text"
            placeholder="写清楚这笔钱的用途，例如：秋游包车费用"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <label className="field">
          <span>备注（选填）</span>
          <textarea
            rows={2}
            placeholder="补充说明，如参与人数、发票号等"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="field">
          <span>凭证截图</span>
          {existing.length > 0 ? (
            <div className="existing-vouchers">
              <AttachmentGallery items={existing} onDelete={removeExisting} />
              <p className="hint">点击图片可查看大图，删除操作会记录到日志</p>
            </div>
          ) : null}
          <FilePicker files={files} onChange={setFiles} />
        </div>

        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  );
}
