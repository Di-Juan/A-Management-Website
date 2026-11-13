import { useCallback, useEffect, useState } from 'react';
import { api, canUse, formatDateTime, toLocalInput } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatStrip, StatusBadge, Tabs } from '../components/UI.jsx';

export default function Access() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = canUse(user, 'access');

  const [tab, setTab] = useState('requests');
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [pending, setPending] = useState(0);
  const [grants, setGrants] = useState([]);
  const [logs, setLogs] = useState([]);
  const [inside, setInside] = useState(0);
  const [members, setMembers] = useState([]);
  const [requestFilter, setRequestFilter] = useState('');

  const [requestForm, setRequestForm] = useState(null);
  const [grantForm, setGrantForm] = useState(null);
  const [logForm, setLogForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestRes, grantRes, logRes, memberRes] = await Promise.all([
        api.get('/access/requests'),
        api.get('/access/grants'),
        api.get('/access/logs'),
        api.get('/users/options'),
      ]);
      setRequests(requestRes.items);
      setPending(requestRes.pending);
      setGrants(grantRes.items);
      setLogs(logRes.items);
      setInside(logRes.inside);
      setMembers(memberRes.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleRequests = requestFilter ? requests.filter((item) => item.status === requestFilter) : requests;
  const activeGrants = grants.filter((item) => item.status === 'active').length;

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!requestForm) return;
    setSaving(true);
    try {
      await api.post('/access/requests', {
        purpose: requestForm.purpose,
        location: requestForm.location,
        startAt: requestForm.startAt,
        endAt: requestForm.endAt,
      });
      toast.success('门禁申请已提交');
      setRequestForm(null);
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
      await api.post(`/access/requests/${item.id}/review`, { result, reason });
      toast.success(result === 'approve' ? '已通过，授权同步生效' : '已驳回');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cancelRequest = async (item) => {
    if (!window.confirm('确定取消该门禁申请吗？')) return;
    try {
      await api.post(`/access/requests/${item.id}/cancel`, {});
      toast.success('申请已取消');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitGrant = async (event) => {
    event.preventDefault();
    if (!grantForm) return;
    setSaving(true);
    try {
      await api.post('/access/grants', {
        userId: Number(grantForm.userId),
        scope: grantForm.scope,
        validFrom: grantForm.validFrom,
        validTo: grantForm.validTo || undefined,
        note: grantForm.note,
      });
      toast.success('授权已添加');
      setGrantForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (item) => {
    if (!window.confirm(`确定撤销「${item.userName}」的 ${item.scope} 授权吗？`)) return;
    try {
      await api.post(`/access/grants/${item.id}/revoke`, {});
      toast.success('授权已撤销');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitLog = async (event) => {
    event.preventDefault();
    if (!logForm) return;
    setSaving(true);
    try {
      await api.post('/access/logs', {
        userId: logForm.userId || undefined,
        personName: logForm.userId ? undefined : logForm.personName,
        direction: logForm.direction,
        location: logForm.location,
        occurredAt: logForm.occurredAt,
        note: logForm.note,
      });
      toast.success('进出记录已登记');
      setLogForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="门禁管理"
        description="门禁使用申请、审批授权与人员进出登记，授权到期自动失效。"
        actions={
          manage ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                setLogForm({
                  userId: user.id,
                  personName: '',
                  direction: 'in',
                  location: '主实验室',
                  occurredAt: toLocalInput(new Date()),
                  note: '',
                })
              }
            >
              <Icon name="plus" size={16} />
              登记进出
            </button>
          ) : null
        }
      />

      <StatStrip
        items={[
          { label: '待审核申请', value: pending, tone: 'pending', hint: '条' },
          { label: '生效授权', value: activeGrants, tone: 'ok', hint: '条' },
          { label: '当前在室内', value: inside, tone: 'info', hint: '人' },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'requests', label: '门禁申请', count: pending },
          { value: 'grants', label: '授权记录' },
          { value: 'logs', label: '进出登记' },
        ]}
      />

      {loading ? (
        <div className="table-card">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {!loading && tab === 'requests' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <div className="chips">
              {[
                { value: '', label: '全部' },
                { value: 'pending', label: '待审核' },
                { value: 'approved', label: '已通过' },
                { value: 'rejected', label: '已驳回' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`chip ${requestFilter === item.value ? 'active' : ''}`}
                  onClick={() => setRequestFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setRequestForm({
                  purpose: '',
                  location: '主实验室',
                  startAt: toLocalInput(new Date()),
                  endAt: toLocalInput(new Date(Date.now() + 4 * 3600 * 1000)),
                })
              }
            >
              <Icon name="plus" size={16} />
              申请门禁
            </button>
          </div>
          {visibleRequests.length === 0 ? (
            <EmptyState icon="door" title="没有门禁申请" description="成员提交申请后，管理员在设备间或实验室使用前审批。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>申请人</th>
                  <th>事由</th>
                  <th>门禁位置</th>
                  <th>使用时段</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.userName}</strong>
                      {item.studentNo ? <div className="muted small">{item.studentNo}</div> : null}
                    </td>
                    <td className="wrap">{item.purpose}</td>
                    <td>{item.location || '-'}</td>
                    <td className="nowrap">
                      {formatDateTime(item.startAt)}
                      <div className="muted small">至 {formatDateTime(item.endAt)}</div>
                    </td>
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
                      {(item.userId === user.id || manage) && ['pending', 'approved'].includes(item.status) ? (
                        <button type="button" className="link-btn danger" onClick={() => cancelRequest(item)}>
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

      {!loading && tab === 'grants' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {grants.length} 条授权记录</span>
            {manage ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setGrantForm({ userId: members[0]?.id || '', scope: '主实验室', validFrom: '', validTo: '', note: '' })}
              >
                <Icon name="plus" size={16} />
                新增授权
              </button>
            ) : null}
          </div>
          {grants.length === 0 ? (
            <EmptyState icon="shield" title="暂无授权" description="门禁申请通过后会自动生成授权记录。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>门禁位置</th>
                  <th>有效期</th>
                  <th>状态</th>
                  <th>授权人</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.userName}</strong>
                      {item.studentNo ? <div className="muted small">{item.studentNo}</div> : null}
                    </td>
                    <td>{item.scope}</td>
                    <td className="nowrap">
                      {formatDateTime(item.validFrom)}
                      <div className="muted small">至 {item.validTo ? formatDateTime(item.validTo) : '长期'}</div>
                    </td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td>{item.grantorName || '-'}</td>
                    <td className="col-actions">
                      {manage && item.status === 'active' ? (
                        <button type="button" className="link-btn danger" onClick={() => revoke(item)}>
                          撤销
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

      {!loading && tab === 'logs' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">最近 {logs.length} 条进出记录</span>
          </div>
          {logs.length === 0 ? (
            <EmptyState icon="door" title="暂无进出记录" description="登记后可按时间追溯实验室人员进出情况。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>人员</th>
                  <th>方向</th>
                  <th>位置</th>
                  <th>登记人</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((item) => (
                  <tr key={item.id}>
                    <td className="nowrap">{formatDateTime(item.occurredAt)}</td>
                    <td>{item.personName}</td>
                    <td>
                      <span className={`badge ${item.direction === 'in' ? 'badge-ok' : 'badge-muted'}`}>
                        {item.direction === 'in' ? '进入' : '离开'}
                      </span>
                    </td>
                    <td>{item.location || '-'}</td>
                    <td>{item.operatorName || '-'}</td>
                    <td className="wrap">{item.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      <Modal
        open={!!requestForm}
        title="申请门禁使用"
        subtitle="审批通过后自动生成对应时段的门禁授权"
        onClose={() => setRequestForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setRequestForm(null)}>
              取消
            </button>
            <button type="submit" form="request-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '提交申请'}
            </button>
          </div>
        }
      >
        <form id="request-form" className="form" onSubmit={submitRequest}>
          <label className="field">
            <span>申请事由</span>
            <input
              required
              placeholder="例如：夜间调试机器人"
              value={requestForm?.purpose || ''}
              onChange={(e) => setRequestForm({ ...requestForm, purpose: e.target.value })}
            />
          </label>
          <label className="field">
            <span>门禁位置</span>
            <input
              value={requestForm?.location || ''}
              onChange={(e) => setRequestForm({ ...requestForm, location: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>开始时间</span>
              <input
                type="datetime-local"
                required
                value={requestForm?.startAt || ''}
                onChange={(e) => setRequestForm({ ...requestForm, startAt: e.target.value })}
              />
            </label>
            <label className="field">
              <span>结束时间</span>
              <input
                type="datetime-local"
                required
                value={requestForm?.endAt || ''}
                onChange={(e) => setRequestForm({ ...requestForm, endAt: e.target.value })}
              />
            </label>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!grantForm}
        title="新增门禁授权"
        onClose={() => setGrantForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setGrantForm(null)}>
              取消
            </button>
            <button type="submit" form="grant-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="grant-form" className="form" onSubmit={submitGrant}>
          <label className="field">
            <span>成员</span>
            <select
              required
              value={grantForm?.userId || ''}
              onChange={(e) => setGrantForm({ ...grantForm, userId: e.target.value })}
            >
              <option value="">请选择成员</option>
              {members.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                  {item.department ? `（${item.department}）` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>门禁位置</span>
            <input
              required
              value={grantForm?.scope || ''}
              onChange={(e) => setGrantForm({ ...grantForm, scope: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>生效时间</span>
              <input
                type="datetime-local"
                value={grantForm?.validFrom || ''}
                onChange={(e) => setGrantForm({ ...grantForm, validFrom: e.target.value })}
              />
            </label>
            <label className="field">
              <span>失效时间</span>
              <input
                type="datetime-local"
                value={grantForm?.validTo || ''}
                onChange={(e) => setGrantForm({ ...grantForm, validTo: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>备注</span>
            <input
              value={grantForm?.note || ''}
              onChange={(e) => setGrantForm({ ...grantForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!logForm}
        title="登记进出"
        onClose={() => setLogForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setLogForm(null)}>
              取消
            </button>
            <button type="submit" form="log-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="log-form" className="form" onSubmit={submitLog}>
          <label className="field">
            <span>人员</span>
            <select
              required
              value={logForm?.userId || ''}
              onChange={(e) => setLogForm({ ...logForm, userId: e.target.value })}
            >
              <option value="">请选择成员</option>
              {members.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>方向</span>
              <select
                value={logForm?.direction || 'in'}
                onChange={(e) => setLogForm({ ...logForm, direction: e.target.value })}
              >
                <option value="in">进入</option>
                <option value="out">离开</option>
              </select>
            </label>
            <label className="field">
              <span>发生时间</span>
              <input
                type="datetime-local"
                required
                value={logForm?.occurredAt || ''}
                onChange={(e) => setLogForm({ ...logForm, occurredAt: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>门禁位置</span>
            <input
              value={logForm?.location || ''}
              onChange={(e) => setLogForm({ ...logForm, location: e.target.value })}
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input
              value={logForm?.note || ''}
              onChange={(e) => setLogForm({ ...logForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
