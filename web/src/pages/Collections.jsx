import { useCallback, useEffect, useState } from 'react';
import Icon from '../icons.jsx';
import { api, canManageCollections, formatDate, formatDateTime, money, todayString } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { AttachmentGallery, EmptyState, FilePicker, Modal, PageHeader, Skeleton } from '../components/UI.jsx';

const paymentFileUrl = (item) => `/api/v1/collection-attachments/${item.id}/file`;

const PAYMENT_STATUS = {
  pending: { label: '待审核', className: 'badge-pending' },
  approved: { label: '已通过', className: 'badge-income' },
  rejected: { label: '已驳回', className: 'badge-expense' },
};

function PaymentStatus({ status, reason }) {
  const config = PAYMENT_STATUS[status] || { label: status, className: '' };
  return (
    <span className={`badge ${config.className}`} title={reason || ''}>
      {config.label}
    </span>
  );
}

export default function Collections() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = canManageCollections(user);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', amount: '', dueDate: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [detail, setDetail] = useState(null);
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [includeMap, setIncludeMap] = useState({});
  const [bulkInclude, setBulkInclude] = useState(true);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(0);

  const [payTarget, setPayTarget] = useState(null);
  const [payFiles, setPayFiles] = useState([]);
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState('');
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/collections');
      setItems(data.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm({ title: '', amount: '', dueDate: todayString(), note: '' });
    setFormError('');
    setCreateOpen(true);
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.post('/collections', form);
      toast.success('收款任务已发布');
      setCreateOpen(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item) => {
    try {
      await api.patch(`/collections/${item.id}`, {
        title: item.title,
        amount: (item.amountCents / 100).toFixed(2),
        dueDate: item.dueDate || '',
        note: item.note || '',
        status: item.status === 'open' ? 'closed' : 'open',
      });
      toast.success(item.status === 'open' ? '收款已结束' : '收款已重新开启');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadPayments = useCallback(
    async (collection) => {
      setPaymentsLoading(true);
      try {
        const data = await api.get(`/collections/${collection.id}/payments`);
        setPayments(data.items);
        setIncludeMap(Object.fromEntries(data.items.map((p) => [p.id, true])));
      } catch (err) {
        toast.error(err.message);
      } finally {
        setPaymentsLoading(false);
      }
    },
    [toast],
  );

  const openDetail = (item) => {
    setDetail(item);
    setPayments([]);
    setBulkInclude(true);
    setRejectingId(null);
    setRejectReason('');
    loadPayments(item);
  };

  const pendingPayments = payments.filter((payment) => payment.status === 'pending');

  const approveAll = async () => {
    if (!detail || pendingPayments.length === 0) return;
    const hint = bulkInclude ? '审核通过后将计入班费收入。' : '本次审核通过不会计入班费收入。';
    if (!window.confirm(`确定通过全部 ${pendingPayments.length} 笔待审核缴纳？${hint}`)) return;
    setReviewBusy(-1);
    try {
      const result = await api.post(`/collections/${detail.id}/payments/approve-all`, {
        createTransaction: bulkInclude,
      });
      toast.success(`已通过 ${result.approved} 笔缴纳`);
      await loadPayments(detail);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReviewBusy(0);
    }
  };

  const review = async (payment, action) => {
    setReviewBusy(payment.id);
    try {
      await api.post(`/collections/payments/${payment.id}/review`, {
        action,
        createTransaction: action === 'approve' ? includeMap[payment.id] !== false : false,
        reason: action === 'reject' ? rejectReason.trim() : undefined,
      });
      toast.success(action === 'approve' ? '已审核通过' : '已驳回');
      setRejectingId(null);
      setRejectReason('');
      await loadPayments(detail);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReviewBusy(0);
    }
  };

  const openPay = (item) => {
    setPayTarget(item);
    setPayFiles([]);
    setPayNote('');
    setPayError('');
  };

  const submitPay = async (event) => {
    event.preventDefault();
    if (payFiles.length === 0) {
      setPayError('请至少上传一张缴纳凭证');
      return;
    }
    setPayError('');
    setPaying(true);
    try {
      await api.upload(`/collections/${payTarget.id}/payments`, payFiles, { note: payNote });
      toast.success('缴纳凭证已提交，等待审核');
      setPayTarget(null);
      load();
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="收款台账"
        description="发布收款任务，成员上传缴纳凭证，管理员或财务员审核"
        actions={
          canManage ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Icon name="plus" size={16} />
              发布收款
            </button>
          ) : null
        }
      />

      {loading ? (
        <Skeleton lines={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title="暂无收款任务"
          description={
            canManage ? '发布一个收款任务，成员即可上传缴纳凭证。' : '管理员发布收款后会显示在这里。'
          }
        />
      ) : (
        <div className="collection-grid">
          {items.map((item) => {
            const pct = item.stats.memberCount
              ? Math.min(100, (item.stats.approvedCount / item.stats.memberCount) * 100)
              : 0;
            const mine = item.myPayment;
            const canPay = item.status === 'open' && (!mine || mine.status === 'rejected');
            return (
              <article className="card collection-card" key={item.id}>
                <div className="collection-head">
                  <div>
                    <h3>{item.title}</h3>
                    <p className="muted collection-sub">
                      {item.createdByName} · 截止 {item.dueDate ? formatDate(item.dueDate) : '不限'}
                    </p>
                  </div>
                  <span className={`badge ${item.status === 'open' ? 'badge-income' : 'badge-muted'}`}>
                    {item.status === 'open' ? '进行中' : '已结束'}
                  </span>
                </div>

                <div className="collection-amount">
                  {money(item.amountCents)}
                  <span>/ 人</span>
                </div>
                {item.note ? <p className="collection-note">{item.note}</p> : null}

                <div className="progress">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="collection-stats">
                  <span>
                    已通过 {item.stats.approvedCount}/{item.stats.memberCount} 人
                  </span>
                  <span>
                    {money(item.stats.collectedCents)} / {money(item.stats.expectedCents)}
                  </span>
                </div>
                {item.stats.pendingCount > 0 ? (
                  <p className="hint">{item.stats.pendingCount} 笔待审核</p>
                ) : null}

                {mine ? (
                  <div className="my-payment">
                    <span>我的缴纳</span>
                    <PaymentStatus status={mine.status} reason={mine.rejectReason} />
                    {mine.status === 'rejected' && mine.rejectReason ? (
                      <em>驳回原因：{mine.rejectReason}</em>
                    ) : null}
                  </div>
                ) : (
                  <div className="my-payment">
                    <span>我的缴纳</span>
                    <span className="muted">尚未提交</span>
                  </div>
                )}

                <div className="collection-actions">
                  {canManage ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDetail(item)}>
                      <Icon name="users" size={14} />
                      查看缴纳
                    </button>
                  ) : null}
                  {canPay ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => openPay(item)}>
                      {mine?.status === 'rejected' ? '重新提交' : '去缴纳'}
                    </button>
                  ) : null}
                  {canManage ? (
                    <button type="button" className="link link-btn" onClick={() => toggleStatus(item)}>
                      {item.status === 'open' ? '结束收款' : '重新开启'}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="发布收款"
        subtitle="金额按人固定，成员提交后由管理员或财务员审核"
        width={520}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="submit" form="collection-create-form" className="btn btn-primary" disabled={saving}>
              {saving ? '发布中…' : '发布收款'}
            </button>
          </div>
        }
      >
        <form id="collection-create-form" className="form" onSubmit={submitCreate}>
          <label className="field">
            <span>收款名称</span>
            <input
              type="text"
              maxLength={60}
              placeholder="如：2026 秋季班费"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>每人金额（元）</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="如：100.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label className="field">
              <span>截止日期</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>说明</span>
            <textarea
              rows={3}
              maxLength={500}
              placeholder="用途、注意事项等（选填）"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          {formError ? <div className="form-error">{formError}</div> : null}
        </form>
      </Modal>

      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `缴纳：${payTarget.title}` : ''}
        subtitle={payTarget ? `每人 ${money(payTarget.amountCents)}，请上传支付截图等凭证` : ''}
        width={520}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setPayTarget(null)}>
              取消
            </button>
            <button type="submit" form="collection-pay-form" className="btn btn-primary" disabled={paying}>
              {paying ? '提交中…' : '提交缴纳凭证'}
            </button>
          </div>
        }
      >
        <form id="collection-pay-form" className="form" onSubmit={submitPay}>
          <label className="field">
            <span>缴纳凭证</span>
            <FilePicker files={payFiles} onChange={setPayFiles} max={6} />
          </label>
          <label className="field">
            <span>备注</span>
            <textarea
              rows={2}
              maxLength={300}
              placeholder="如：微信转账，姓名（选填）"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />
          </label>
          {payError ? <div className="form-error">{payError}</div> : null}
        </form>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.title} · 缴纳记录` : ''}
        subtitle={
          detail
            ? `应收 ${money(detail.stats.expectedCents)}，已收 ${money(detail.stats.collectedCents)}`
            : ''
        }
        width={720}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
              关闭
            </button>
          </div>
        }
      >
        {paymentsLoading ? (
          <Skeleton lines={5} />
        ) : payments.length === 0 ? (
          <p className="muted">暂无成员提交缴纳记录</p>
        ) : (
          <>
            {pendingPayments.length ? (
              <div className="bulk-review">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={bulkInclude}
                    onChange={(e) => setBulkInclude(e.target.checked)}
                  />
                  全部通过时计入班费收入
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={reviewBusy !== 0}
                  onClick={approveAll}
                >
                  <Icon name="check" size={14} />
                  全部通过（{pendingPayments.length} 笔）
                </button>
              </div>
            ) : null}
            <div className="payment-list">
              {payments.map((payment) => (
                <div className="payment-row" key={payment.id}>
                  <div className="payment-main">
                    <div className="payment-title">
                      <strong>{payment.displayName}</strong>
                      <span className="muted">@{payment.username}</span>
                      <PaymentStatus status={payment.status} reason={payment.rejectReason} />
                    </div>
                    <div className="muted payment-sub">
                      {money(payment.amountCents)} · {formatDateTime(payment.createdAt)}
                    </div>
                    {payment.note ? <p className="payment-note">{payment.note}</p> : null}
                    {payment.rejectReason ? (
                      <p className="payment-note">驳回原因：{payment.rejectReason}</p>
                    ) : null}
                    {payment.attachments.length ? (
                      <AttachmentGallery items={payment.attachments} fileUrl={paymentFileUrl} />
                    ) : null}
                    {payment.status === 'pending' ? (
                      <div className="review-box">
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={includeMap[payment.id] !== false}
                            onChange={(e) =>
                              setIncludeMap((prev) => ({ ...prev, [payment.id]: e.target.checked }))
                            }
                          />
                          审核通过后计入班费收入
                        </label>
                        <div className="review-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={reviewBusy === payment.id}
                            onClick={() => review(payment, 'approve')}
                          >
                            <Icon name="check" size={14} />
                            通过
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={reviewBusy === payment.id}
                            onClick={() => {
                              setRejectingId(payment.id);
                              setRejectReason('');
                            }}
                          >
                            驳回
                          </button>
                        </div>
                        {rejectingId === payment.id ? (
                          <div className="reject-box">
                            <input
                              type="text"
                              maxLength={200}
                              placeholder="请填写驳回原因"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={reviewBusy === payment.id}
                              onClick={() => review(payment, 'reject')}
                            >
                              确认驳回
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
