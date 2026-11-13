import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatusBadge } from '../components/UI.jsx';

const statusOf = (item) => {
  if (item.revokedAt) return 'revoked';
  if (item.expiresAt && Date.parse(item.expiresAt) < Date.now()) return 'expired';
  return 'active';
};

export default function ApiKeys() {
  const { user } = useAuth();
  const toast = useToast();
  const admin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState([]);
  const [rateLimit, setRateLimit] = useState(120);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api-keys');
      setKeys(res.items);
      setRateLimit(res.rateLimit || 120);
      if (admin) {
        const memberRes = await api.get('/api-keys/users');
        setMembers(memberRes.items);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [admin, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    const fallback = admin ? members[0]?.id || '' : '';
    setForm({ name: '', userId: fallback, expiresInDays: '' });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name };
      if (admin && form.userId) payload.userId = Number(form.userId);
      if (form.expiresInDays) payload.expiresInDays = Number(form.expiresInDays);
      const res = await api.post('/api-keys', payload);
      setForm(null);
      setCreated(res);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (item) => {
    if (!window.confirm(`撤销「${item.name}」后，使用该密钥的外部系统会立即失去访问权限，确定撤销？`)) return;
    try {
      await api.post(`/api-keys/${item.id}/revoke`, {});
      toast.success('密钥已撤销');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="API 管理"
        description="为开启「API 调用」权限的成员签发密钥，供外部系统以 HTTP 接口访问平台数据。"
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Icon name="plus" size={16} />
            新建密钥
          </button>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div>
            <h3>调用方式</h3>
            <p className="card-desc">密钥继承所属成员的模块权限，只能在授权范围内读写数据。</p>
          </div>
          <span className="badge badge-info">每分钟 {rateLimit} 次</span>
        </div>
        <pre className="api-snippet">{`GET ${window.location.origin}/api/v1/equipment
X-API-Key: cfk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</pre>
        <p className="hint">
          支持 <code>X-API-Key</code> 请求头或 <code>Authorization: ApiKey &lt;密钥&gt;</code>。密钥仅在创建时显示一次，请妥善保存；撤销或过期后立即失效。
          {admin ? ' 外部网页跨域调用需在服务端配置 CORS_ORIGINS 白名单。' : ''}
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>已签发密钥</h3>
          <span className="muted">{keys.length} 个</span>
        </div>

        {loading ? (
          <Skeleton rows={4} />
        ) : keys.length === 0 ? (
          <EmptyState
            title="还没有 API 密钥"
            description={
              admin
                ? '先在成员管理里为成员勾选「API 调用」权限，再回到这里签发密钥。'
                : '请联系管理员为你开启「API 调用」权限后签发密钥。'
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  {admin ? <th>归属成员</th> : null}
                  <th>密钥</th>
                  <th>创建时间</th>
                  <th>最近使用</th>
                  <th>有效期至</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((item) => {
                  const status = statusOf(item);
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      {admin ? (
                        <td>
                          {item.displayName}
                          <span className="muted"> · {item.username}</span>
                        </td>
                      ) : null}
                      <td>
                        <code>{item.prefix}…</code>
                      </td>
                      <td className="muted">{formatDateTime(item.createdAt)}</td>
                      <td className="muted">{item.lastUsedAt ? formatDateTime(item.lastUsedAt) : '从未使用'}</td>
                      <td className="muted">{item.expiresAt ? formatDateTime(item.expiresAt) : '永不过期'}</td>
                      <td>
                        <StatusBadge value={status} />
                      </td>
                      <td>
                        {status === 'active' ? (
                          <button type="button" className="link-btn danger" onClick={() => revoke(item)}>
                            撤销
                          </button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!form}
        title="新建 API 密钥"
        subtitle="密钥继承该成员的模块权限"
        onClose={() => setForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>
              取消
            </button>
            <button type="submit" form="api-key-form" className="btn btn-primary" disabled={saving}>
              {saving ? '生成中…' : '生成密钥'}
            </button>
          </div>
        }
      >
        <form id="api-key-form" className="form" onSubmit={submit}>
          <label className="field">
            <span>密钥名称</span>
            <input
              required
              maxLength={40}
              placeholder="例如：社团大屏数据对接"
              value={form?.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          {admin ? (
            <label className="field">
              <span>归属成员</span>
              <select value={form?.userId || ''} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                {members.length === 0 ? <option value="">暂无开启 API 权限的成员</option> : null}
                {members.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.username}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>有效期（天）</span>
            <input
              type="number"
              min={1}
              max={3650}
              placeholder="留空表示永不过期"
              value={form?.expiresInDays || ''}
              onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
            />
          </label>
          {admin && members.length === 0 ? (
            <p className="hint">还没有成员开启「API 调用」权限，请先到成员管理勾选后再签发。</p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={!!created}
        title="密钥已生成"
        subtitle="请立即复制保存，关闭后将无法再次查看完整密钥"
        onClose={() => setCreated(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setCreated(null)}>
              关闭
            </button>
            <button type="button" className="btn btn-primary" onClick={copyKey}>
              复制密钥
            </button>
          </div>
        }
      >
        <p className="hint">
          名称：{created?.name} · 归属：{created?.displayName || created?.username}
        </p>
        <pre className="api-snippet api-snippet-key">{created?.key}</pre>
        <p className="hint">调用时放入请求头：X-API-Key: {created?.prefix}…（完整密钥见上方）</p>
      </Modal>
    </div>
  );
}
