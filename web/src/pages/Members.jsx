import { useCallback, useEffect, useState } from 'react';
import Icon from '../icons.jsx';
import { api, formatDateTime, PERM_LABEL, PERM_OPTIONS, ROLE_OPTIONS } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { EmptyState, Modal, PageHeader, RoleBadge, Skeleton } from '../components/UI.jsx';

const togglePerm = (list, key) =>
  list.includes(key) ? list.filter((item) => item !== key) : [...list, key];

export default function Members() {
  const { user: currentUser, refreshUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    role: 'member',
    password: '',
    canIncome: true,
    canExpense: true,
    perms: [],
    studentNo: '',
    department: '',
    phone: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [permTarget, setPermTarget] = useState(null);
  const [permForm, setPermForm] = useState({
    perms: [],
    canIncome: false,
    canExpense: false,
    studentNo: '',
    department: '',
    phone: '',
  });
  const [permError, setPermError] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    startUsername: '',
    count: '10',
    role: 'member',
    namePrefix: '成员',
    password: '',
    canIncome: true,
    canExpense: true,
    perms: [],
  });
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/users');
      setUsers(data.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const createUser = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!form.username.trim() || !form.displayName.trim()) {
      setFormError('请填写登录账号和姓名');
      return;
    }
    setSaving(true);
    try {
      await api.post('/users', form);
      toast.success('账号已创建，请将初始密码告知成员');
      setCreateOpen(false);
      setForm({
        username: '',
        displayName: '',
        role: 'member',
        password: '',
        canIncome: true,
        canExpense: true,
        perms: [],
        studentNo: '',
        department: '',
        phone: '',
      });
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const patchUser = async (target, patch) => {
    try {
      await api.patch(`/users/${target.id}`, patch);
      toast.success('账号信息已更新');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openPerm = (item) => {
    setPermTarget(item);
    setPermForm({
      perms: Array.isArray(item.perms) ? item.perms.filter((key) => PERM_LABEL[key]) : [],
      canIncome: !!item.canIncome,
      canExpense: !!item.canExpense,
      studentNo: item.studentNo || '',
      department: item.department || '',
      phone: item.phone || '',
    });
    setPermError('');
  };

  const submitPerm = async (event) => {
    event.preventDefault();
    setPermError('');
    setSaving(true);
    try {
      await api.patch(`/users/${permTarget.id}`, {
        perms: permForm.perms,
        canIncome: permForm.canIncome,
        canExpense: permForm.canExpense,
        studentNo: permForm.studentNo.trim(),
        department: permForm.department.trim(),
        phone: permForm.phone.trim(),
      });
      if (permTarget.id === currentUser?.id) await refreshUser();
      toast.success('成员权限已更新');
      setPermTarget(null);
      load();
    } catch (err) {
      setPermError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async (event) => {
    event.preventDefault();
    setResetError('');
    setSaving(true);
    try {
      await api.post(`/users/${resetTarget.id}/reset-password`, { password: newPassword });
      toast.success('密码已重置，成员下次登录需修改密码');
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setResetError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openBatch = () => {
    setBatchForm({
      startUsername: '',
      count: '10',
      role: 'member',
      namePrefix: '成员',
      password: '',
      canIncome: true,
      canExpense: true,
      perms: [],
    });
    setBatchError('');
    setBatchResult(null);
    setBatchOpen(true);
  };

  const submitBatch = async (event) => {
    event.preventDefault();
    setBatchError('');
    setSaving(true);
    try {
      const data = await api.post('/users/batch', {
        startUsername: batchForm.startUsername.trim(),
        count: Number(batchForm.count),
        role: batchForm.role,
        namePrefix: batchForm.namePrefix.trim(),
        password: batchForm.password,
        canIncome: batchForm.canIncome,
        canExpense: batchForm.canExpense,
        perms: batchForm.perms,
      });
      setBatchResult(data);
      toast.success(`已创建 ${data.count} 个账号`);
      load();
    } catch (err) {
      setBatchError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyBatchAccounts = async () => {
    if (!batchResult) return;
    try {
      await navigator.clipboard.writeText(batchResult.usernames.join('\n'));
      toast.success('账号已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选择文本复制');
    }
  };

  const submitRename = async (event) => {
    event.preventDefault();
    setRenameError('');
    setSaving(true);
    try {
      await api.patch(`/users/${renameTarget.id}`, { displayName: renameName.trim() });
      if (renameTarget.id === currentUser?.id) await refreshUser();
      toast.success('姓名已更新');
      setRenameTarget(null);
      load();
    } catch (err) {
      setRenameError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="成员管理"
        description="管理员可管理账号并按模块分配权限；成员可同时拥有经费、设备、门禁、活动等任意组合的权限。"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={openBatch}>
              <Icon name="users" size={16} />
              批量添加
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} />
              新建账号
            </button>
          </>
        }
      />

      <div className="card table-card">
        {loading ? (
          <Skeleton lines={6} height={18} />
        ) : users.length === 0 ? (
          <EmptyState icon="users" title="暂无账号" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>成员</th>
                <th>登录账号</th>
                <th>角色</th>
                <th>记账权限</th>
                <th>状态</th>
                <th className="num">记账笔数</th>
                <th>最近登录</th>
                <th className="num">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => {
                const isSelf = item.id === currentUser?.id;
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="member-cell">
                        <span className="avatar avatar-xs">{item.displayName.slice(0, 1)}</span>
                        <div>
                          <span className="cell-strong">
                            {item.displayName}
                            {isSelf ? <em className="self-tag">我</em> : null}
                            <button
                              type="button"
                              className="icon-btn name-edit"
                              title="修改姓名"
                              onClick={() => {
                                setRenameTarget(item);
                                setRenameName(item.displayName);
                                setRenameError('');
                              }}
                            >
                              <Icon name="edit" size={12} />
                            </button>
                          </span>
                          {item.mustChangePassword ? <span className="cell-sub">待修改初始密码</span> : null}
                          {item.role !== 'admin' && item.perms?.length ? (
                            <span className="cell-sub">
                              模块：{item.perms.filter((key) => PERM_LABEL[key]).map((key) => PERM_LABEL[key]).join(' · ')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="muted">@{item.username}</td>
                    <td>
                      {isSelf ? (
                        <RoleBadge role={item.role} />
                      ) : (
                        <select
                          className="select-inline"
                          value={item.role}
                          onChange={(e) => patchUser(item, { role: e.target.value })}
                        >
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {item.role === 'admin' ? (
                        <span className="perm-text">收入 / 支出</span>
                      ) : item.perms?.includes('finance') ? (
                        <div className="perm-checks">
                          <label className="check-field">
                            <input
                              type="checkbox"
                              checked={!!item.canIncome}
                              onChange={(e) =>
                                patchUser(item, {
                                  canIncome: e.target.checked,
                                  canExpense: !!item.canExpense,
                                })
                              }
                            />
                            收入
                          </label>
                          <label className="check-field">
                            <input
                              type="checkbox"
                              checked={!!item.canExpense}
                              onChange={(e) =>
                                patchUser(item, { canIncome: !!item.canIncome, canExpense: e.target.checked })
                              }
                            />
                            支出
                          </label>
                        </div>
                      ) : (
                        <span className="muted">不可记账</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-dot ${item.status}`}>
                        {item.status === 'active' ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="num">{item.transactionCount}</td>
                    <td className="muted nowrap">
                      {item.lastLoginAt ? formatDateTime(item.lastLoginAt) : '从未登录'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="link link-btn" onClick={() => openPerm(item)}>
                          权限
                        </button>
                        <button
                          type="button"
                          className="link link-btn"
                          onClick={() => {
                            setResetTarget(item);
                            setNewPassword('');
                            setResetError('');
                          }}
                        >
                          重置密码
                        </button>
                        {!isSelf ? (
                          <button
                            type="button"
                            className={`link link-btn ${item.status === 'active' ? 'danger' : ''}`}
                            onClick={() =>
                              patchUser(item, { status: item.status === 'active' ? 'disabled' : 'active' })
                            }
                          >
                            {item.status === 'active' ? '停用' : '启用'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建账号"
        subtitle="管理员与财务员首次登录需修改密码，普通成员仅提示"
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="submit" form="create-user-form" className="btn btn-primary" disabled={saving}>
              {saving ? '创建中…' : '创建账号'}
            </button>
          </div>
        }
      >
        <form id="create-user-form" className="form" onSubmit={createUser}>
          <div className="form-grid">
            <label className="field">
              <span>登录账号</span>
              <input
                type="text"
                placeholder="如：zhangsan"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label className="field">
              <span>显示姓名</span>
              <input
                type="text"
                placeholder="如：张三"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>角色</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                    {opt.value === 'admin' ? '（全部权限）' : '（按下方勾选）'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>初始密码</span>
              <input
                type="text"
                placeholder="8 位以上，含字母和数字"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
          </div>
          {form.role !== 'admin' && form.perms.includes('finance') ? (
            <div className="field">
              <span>经费权限</span>
              <div className="perm-checks">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.canIncome}
                    onChange={(e) => setForm({ ...form, canIncome: e.target.checked })}
                  />
                  可录入收入
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.canExpense}
                    onChange={(e) => setForm({ ...form, canExpense: e.target.checked })}
                  />
                  可录入支出
                </label>
              </div>
            </div>
          ) : null}
          {form.role === 'admin' ? (
            <p className="hint">管理员拥有全部模块与收入/支出权限，无需单独勾选。</p>
          ) : null}
          {form.role !== 'admin' ? (
            <div className="field">
              <span>模块权限</span>
              <div className="perm-checks">
                {PERM_OPTIONS.map((opt) => (
                  <label className="check-field" key={opt.value} title={opt.hint}>
                    <input
                      type="checkbox"
                      checked={form.perms.includes(opt.value)}
                      onChange={() => setForm({ ...form, perms: togglePerm(form.perms, opt.value) })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <p className="hint">勾选后该成员可进入对应运营模块，可任意组合；未勾选的模块接口也会拒绝访问。</p>
            </div>
          ) : null}
          <div className="form-grid">
            <label className="field">
              <span>学号</span>
              <input
                type="text"
                maxLength={30}
                placeholder="选填"
                value={form.studentNo}
                onChange={(e) => setForm({ ...form, studentNo: e.target.value })}
              />
            </label>
            <label className="field">
              <span>部门 / 组别</span>
              <input
                type="text"
                maxLength={40}
                placeholder="如：技术部"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>联系方式</span>
            <input
              type="text"
              maxLength={40}
              placeholder="手机号 / 微信等（选填）"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          {formError ? <div className="form-error">{formError}</div> : null}
        </form>
      </Modal>

      <Modal
        open={!!permTarget}
        onClose={() => setPermTarget(null)}
        title={`账号权限 · ${permTarget?.displayName || ''}`}
        subtitle={permTarget ? `登录账号 @${permTarget.username}` : ''}
        width={540}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setPermTarget(null)}>
              取消
            </button>
            <button type="submit" form="perm-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="perm-form" className="form" onSubmit={submitPerm}>
          {permTarget?.role === 'admin' ? (
            <p className="hint">管理员默认拥有全部模块与记账权限，如需限制请先调整角色。</p>
          ) : (
            <div className="field">
              <span>可访问模块</span>
              <div className="perm-checks">
                {PERM_OPTIONS.map((opt) => (
                  <label className="check-field" key={opt.value} title={opt.hint}>
                    <input
                      type="checkbox"
                      checked={permForm.perms.includes(opt.value)}
                      onChange={() =>
                        setPermForm({ ...permForm, perms: togglePerm(permForm.perms, opt.value) })
                      }
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <p className="hint">未勾选的模块不会出现在该成员的侧边栏，后端接口也会拒绝访问。</p>
              {permForm.perms.includes('finance') ? (
                <div className="perm-checks" style={{ marginTop: 10 }}>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={permForm.canIncome}
                      onChange={(e) => setPermForm({ ...permForm, canIncome: e.target.checked })}
                    />
                    可录入收入
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={permForm.canExpense}
                      onChange={(e) => setPermForm({ ...permForm, canExpense: e.target.checked })}
                    />
                    可录入支出
                  </label>
                </div>
              ) : null}
            </div>
          )}
          <div className="form-grid">
            <label className="field">
              <span>学号</span>
              <input
                type="text"
                maxLength={30}
                value={permForm.studentNo}
                onChange={(e) => setPermForm({ ...permForm, studentNo: e.target.value })}
              />
            </label>
            <label className="field">
              <span>部门 / 组别</span>
              <input
                type="text"
                maxLength={40}
                value={permForm.department}
                onChange={(e) => setPermForm({ ...permForm, department: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>联系方式</span>
            <input
              type="text"
              maxLength={40}
              value={permForm.phone}
              onChange={(e) => setPermForm({ ...permForm, phone: e.target.value })}
            />
          </label>
          {permError ? <div className="form-error">{permError}</div> : null}
        </form>
      </Modal>

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={`重置密码 · ${resetTarget?.displayName || ''}`}
        width={460}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setResetTarget(null)}>
              取消
            </button>
            <button type="submit" form="reset-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认重置'}
            </button>
          </div>
        }
      >
        <form id="reset-form" className="form" onSubmit={submitReset}>
          <p className="hint">
            重置后该账号需使用新密码登录；管理员会被要求立即修改，其他角色仅收到提示。
          </p>
          <label className="field">
            <span>新密码</span>
            <input
              type="text"
              placeholder="8 位以上，含字母和数字"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          {resetError ? <div className="form-error">{resetError}</div> : null}
          <p className="hint">角色说明：管理员拥有全部权限；成员按勾选的模块与经费权限使用系统。</p>
        </form>
      </Modal>

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title={batchResult ? '批量添加完成' : '批量添加账号'}
        subtitle={
          batchResult
            ? '同一批次账号初始密码相同，请及时告知成员'
            : '账号按数字依次递增生成，所有账号使用同一个初始密码'
        }
        width={560}
        footer={
          batchResult ? (
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={copyBatchAccounts}>
                复制账号
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setBatchOpen(false)}>
                完成
              </button>
            </div>
          ) : (
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setBatchOpen(false)}>
                取消
              </button>
              <button type="submit" form="batch-user-form" className="btn btn-primary" disabled={saving}>
                {saving ? '创建中…' : '批量创建'}
              </button>
            </div>
          )
        }
      >
        {batchResult ? (
          <div className="batch-result">
            <p>
              已成功创建 <strong>{batchResult.count}</strong> 个账号（
              {batchResult.startUsername} ~ {batchResult.endUsername}）。
            </p>
            <textarea readOnly rows={10} value={batchResult.usernames.join('\n')} />
            <p className="hint">账号可直接复制发给成员；初始密码为提交时填写的密码。</p>
          </div>
        ) : (
          <form id="batch-user-form" className="form" onSubmit={submitBatch}>
            <div className="form-grid">
              <label className="field">
                <span>起始账号</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="如：1001"
                  value={batchForm.startUsername}
                  onChange={(e) =>
                    setBatchForm({ ...batchForm, startUsername: e.target.value.replace(/\D/g, '') })
                  }
                />
              </label>
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={batchForm.count}
                  onChange={(e) => setBatchForm({ ...batchForm, count: e.target.value })}
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>角色</span>
                <select
                  value={batchForm.role}
                  onChange={(e) => setBatchForm({ ...batchForm, role: e.target.value })}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>姓名前缀</span>
                <input
                  type="text"
                  placeholder="如：成员"
                  value={batchForm.namePrefix}
                  onChange={(e) => setBatchForm({ ...batchForm, namePrefix: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>初始密码</span>
              <input
                type="text"
                placeholder="8 位以上，含字母和数字"
                value={batchForm.password}
                onChange={(e) => setBatchForm({ ...batchForm, password: e.target.value })}
              />
            </label>
            {batchForm.role !== 'admin' && batchForm.perms.includes('finance') ? (
              <div className="field">
                <span>经费权限</span>
                <div className="perm-checks">
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={batchForm.canIncome}
                      onChange={(e) => setBatchForm({ ...batchForm, canIncome: e.target.checked })}
                    />
                    可录入收入
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={batchForm.canExpense}
                      onChange={(e) => setBatchForm({ ...batchForm, canExpense: e.target.checked })}
                    />
                    可录入支出
                  </label>
                </div>
              </div>
            ) : null}
            {batchForm.role !== 'admin' ? (
              <div className="field">
                <span>模块权限</span>
                <div className="perm-checks">
                  {PERM_OPTIONS.map((opt) => (
                    <label className="check-field" key={opt.value} title={opt.hint}>
                      <input
                        type="checkbox"
                        checked={batchForm.perms.includes(opt.value)}
                        onChange={() =>
                          setBatchForm({ ...batchForm, perms: togglePerm(batchForm.perms, opt.value) })
                        }
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="hint">姓名会按「前缀 + 账号」生成，如“成员1001”。</p>
            {batchError ? <div className="form-error">{batchError}</div> : null}
          </form>
        )}
      </Modal>

      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="修改姓名"
        subtitle={renameTarget ? `登录账号 @${renameTarget.username}` : ''}
        width={420}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setRenameTarget(null)}>
              取消
            </button>
            <button type="submit" form="rename-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="rename-form" className="form" onSubmit={submitRename}>
          <label className="field">
            <span>姓名</span>
            <input
              type="text"
              maxLength={30}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
            />
          </label>
          {renameError ? <div className="form-error">{renameError}</div> : null}
        </form>
      </Modal>
    </div>
  );
}
