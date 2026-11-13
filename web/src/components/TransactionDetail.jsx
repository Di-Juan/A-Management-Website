import { useCallback, useEffect, useState } from 'react';
import { api, canEditRecord, formatDate, formatDateTime, money } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { AttachmentGallery, EmptyState, Modal, Skeleton, TypeBadge } from './UI.jsx';
import TransactionModal from './TransactionModal.jsx';

export default function TransactionDetailModal({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/transactions/${id}`);
      setDetail(data.transaction);
    } catch (err) {
      toast.error(err.message);
      onClose();
    } finally {
      setLoading(false);
    }
  }, [id, toast, onClose]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const remove = async () => {
    if (!detail) return;
    if (
      !window.confirm(
        `确定删除这条${detail.type === 'income' ? '收入' : '支出'}记录吗？删除后仍会保留操作日志。`,
      )
    )
      return;
    try {
      await api.del(`/transactions/${detail.id}`);
      toast.success('记录已删除');
      onChanged?.();
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const editable = detail ? canEditRecord(user, detail) : false;

  return (
    <>
      <Modal
        open={!!id}
        onClose={onClose}
        title="账单详情"
        width={600}
        footer={
          editable && detail ? (
            <div className="modal-actions">
              <button type="button" className="btn btn-danger-ghost" onClick={remove}>
                删除记录
              </button>
              <div className="spacer" />
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                关闭
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                编辑
              </button>
            </div>
          ) : (
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                关闭
              </button>
            </div>
          )
        }
      >
        {loading || !detail ? (
          <Skeleton lines={5} />
        ) : (
          <div className="detail">
            <div className={`detail-hero ${detail.type}`}>
              <div className="detail-type">
                <TypeBadge type={detail.type} />
                <span className="detail-date">{formatDate(detail.occurredAt)}</span>
              </div>
              <div className="detail-amount">{money(detail.amountCents)}</div>
              <div className="detail-reason">{detail.reason}</div>
            </div>

            <dl className="detail-grid">
              <div>
                <dt>分类</dt>
                <dd>{detail.categoryName}</dd>
              </div>
              <div>
                <dt>对方</dt>
                <dd>{detail.counterparty || '—'}</dd>
              </div>
              <div>
                <dt>经办账号</dt>
                <dd>
                  {detail.operatorName}
                  <span className="muted"> @{detail.operatorUsername}</span>
                </dd>
              </div>
              <div>
                <dt>录入时间</dt>
                <dd>{formatDateTime(detail.createdAt)}</dd>
              </div>
              {detail.updatedAt !== detail.createdAt ? (
                <div>
                  <dt>最后修改</dt>
                  <dd>{formatDateTime(detail.updatedAt)}</dd>
                </div>
              ) : null}
              <div>
                <dt>备注</dt>
                <dd>{detail.note || '—'}</dd>
              </div>
            </dl>

            <div className="detail-vouchers">
              <h4>凭证（{detail.attachments?.length || 0}）</h4>
              {detail.attachments?.length ? (
                <AttachmentGallery items={detail.attachments} />
              ) : (
                <EmptyState
                  icon="image"
                  title="暂无凭证"
                  description={editable ? '可点击“编辑”补充凭证截图' : '该笔收支未上传凭证'}
                />
              )}
            </div>
          </div>
        )}
      </Modal>

      {editing && detail ? (
        <TransactionModal
          open={editing}
          record={detail}
          onClose={() => setEditing(false)}
          onSaved={() => {
            load();
            onChanged?.();
          }}
        />
      ) : null}
    </>
  );
}
