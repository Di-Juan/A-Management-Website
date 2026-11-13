import { useCallback, useEffect, useState } from 'react';
import Icon from '../icons.jsx';
import { api, downloadFile, formatDateTime, ROLE_LABEL, setToken } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { PageHeader, RoleBadge, Skeleton } from '../components/UI.jsx';

function formatUptime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

export default function Settings() {
  const { user, meta, loadMeta, refreshUser } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';

  const [className, setClassName] = useState('');
  const [term, setTerm] = useState('');
  const [orgName, setOrgName] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  const [passwords, setPasswords] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [categories, setCategories] = useState([]);
  const [categoryInputs, setCategoryInputs] = useState({ income: '', expense: '' });
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);

  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    setClassName(meta.className || '');
    setTerm(meta.term || '');
    setOrgName(meta.orgName || '');
  }, [meta]);

  useEffect(() => {
    setProfileName(user?.displayName || '');
  }, [user?.displayName]);

  const loadCategories = useCallback(async () => {
    try {
      const data = await api.get('/categories?all=1');
      setCategories(data.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCategoriesLoading(false);
    }
  }, [toast]);

  const loadBackups = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.get('/admin/backups');
      setBackups(data.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBackupLoading(false);
    }
  }, [isAdmin, toast]);

  const loadStatus = useCallback(async () => {
    if (!isAdmin) return;
    setStatusLoading(true);
    try {
      const data = await api.get('/system/status');
      setStatus(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStatusLoading(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    loadCategories();
    loadBackups();
    loadStatus();
  }, [loadCategories, loadBackups, loadStatus]);

  const saveInfo = async (event) => {
    event.preventDefault();
    setSavingInfo(true);
    try {
      await api.patch('/settings', { className, term, orgName });
      await loadMeta();
      toast.success('班级信息已保存');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingInfo(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch('/auth/profile', { displayName: profileName.trim() });
      await refreshUser();
      toast.success('姓名已更新');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirm) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await api.post('/auth/change-password', {
        oldPassword: passwords.oldPassword,
        newPassword: passwords.newPassword,
      });
      if (res?.token) setToken(res.token);
      setPasswords({ oldPassword: '', newPassword: '', confirm: '' });
      await refreshUser();
      toast.success('密码已修改');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const addCategory = async (type) => {
    const name = categoryInputs[type].trim();
    if (!name) return;
    try {
      await api.post('/categories', { name, type });
      setCategoryInputs((prev) => ({ ...prev, [type]: '' }));
      loadCategories();
      toast.success('分类已添加');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleCategory = async (category) => {
    try {
      await api.patch(`/categories/${category.id}`, { archived: !category.archived });
      loadCategories();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeCategory = async (category) => {
    if (!window.confirm(`确定删除分类「${category.name}」吗？`)) return;
    try {
      await api.del(`/categories/${category.id}`);
      loadCategories();
      toast.success('分类已删除');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      await api.post('/admin/backups');
      await loadBackups();
      toast.success('备份已生成');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const downloadBackup = async (name) => {
    try {
      await downloadFile(`/admin/backups/${name}`, name);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const renderCategoryColumn = (type, title) => {
    const list = categories.filter((c) => c.type === type);
    return (
      <div className="category-column">
        <h4>{title}</h4>
        <div className="category-add">
          <input
            type="text"
            placeholder="新增分类名称"
            value={categoryInputs[type]}
            maxLength={20}
            onChange={(e) => setCategoryInputs((prev) => ({ ...prev, [type]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && addCategory(type)}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addCategory(type)}>
            <Icon name="plus" size={14} />
            添加
          </button>
        </div>
        <ul className="category-manage-list">
          {list.map((category) => (
            <li key={category.id} className={category.archived ? 'archived' : ''}>
              <div>
                <span>{category.name}</span>
                <em>{category.usageCount} 笔</em>
              </div>
              <div className="row-actions">
                <button type="button" className="link link-btn" onClick={() => toggleCategory(category)}>
                  {category.archived ? '启用' : '停用'}
                </button>
                {category.usageCount === 0 ? (
                  <button
                    type="button"
                    className="link link-btn danger"
                    onClick={() => removeCategory(category)}
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </li>
          ))}
          {list.length === 0 ? <li className="muted">暂无分类</li> : null}
        </ul>
      </div>
    );
  };

  return (
    <div className="page">
      <PageHeader title="设置" description="账号安全、班级信息、分类与数据备份" />

      <div className="settings-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>账号信息</h3>
              <p className="card-desc">当前登录的账号与权限</p>
            </div>
            <RoleBadge role={user?.role} />
          </div>
          <dl className="detail-grid compact">
            <div>
              <dt>姓名</dt>
              <dd>{user?.displayName}</dd>
            </div>
            <div>
              <dt>登录账号</dt>
              <dd>@{user?.username}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{ROLE_LABEL[user?.role]}</dd>
            </div>
          </dl>

          <form className="form profile-form" onSubmit={saveProfile}>
            <h4>我的姓名</h4>
            <div className="profile-form-row">
              <input
                type="text"
                maxLength={30}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                aria-label="我的姓名"
              />
              <button type="submit" className="btn btn-ghost" disabled={savingProfile}>
                {savingProfile ? '保存中…' : '保存姓名'}
              </button>
            </div>
          </form>

          <form className="form password-form" onSubmit={changePassword}>
            <h4>修改密码</h4>
            <label className="field">
              <span>当前密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={passwords.oldPassword}
                onChange={(e) => setPasswords({ ...passwords, oldPassword: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="8 位以上，含字母和数字"
                  value={passwords.newPassword}
                  onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                />
              </label>
              <label className="field">
                <span>确认新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={savingPassword}>
              {savingPassword ? '提交中…' : '更新密码'}
            </button>
          </form>
        </section>

        {isAdmin ? (
          <section className="card">
            <div className="card-head">
              <div>
                <h3>组织信息</h3>
                <p className="card-desc">显示在登录页、侧边栏与导出账单中</p>
              </div>
            </div>
            <form className="form" onSubmit={saveInfo}>
              <label className="field">
                <span>组织名称</span>
                <input
                  type="text"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  maxLength={40}
                />
              </label>
              <label className="field">
                <span>学期</span>
                <input type="text" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={40} />
              </label>
              <label className="field">
                <span>管理组织</span>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  maxLength={40}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={savingInfo}>
                {savingInfo ? '保存中…' : '保存组织信息'}
              </button>
            </form>
          </section>
        ) : null}

        {isAdmin ? (
          <section className="card settings-wide">
            <div className="card-head">
              <div>
                <h3>分类管理</h3>
                <p className="card-desc">停用后不再出现在记账选项中，历史账单不受影响</p>
              </div>
            </div>
            {categoriesLoading ? (
              <Skeleton lines={4} />
            ) : (
              <div className="category-columns">
                {renderCategoryColumn('expense', '支出分类')}
                {renderCategoryColumn('income', '收入分类')}
              </div>
            )}
          </section>
        ) : null}

        {isAdmin ? (
          <section className="card settings-wide">
            <div className="card-head">
              <div>
                <h3>运行状态</h3>
                <p className="card-desc">应用与维护容器的健康状况，以及最近一次数据备份</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={loadStatus}
                disabled={statusLoading}
              >
                <Icon name="refresh" size={14} />
                {statusLoading ? '刷新中…' : '刷新'}
              </button>
            </div>
            {statusLoading && !status ? (
              <Skeleton lines={3} />
            ) : status ? (
              <div className="status-grid">
                <div className="status-item">
                  <span className="status-dot online" />
                  <div>
                    <strong>应用服务</strong>
                    <span>
                      在线 · v{status.app.version} · 已运行 {formatUptime(status.app.uptimeSeconds)}
                    </span>
                    <em>
                      Node {status.app.node} · 内存 {status.app.memoryMB} MB
                    </em>
                  </div>
                </div>
                <div className="status-item">
                  <span className={`status-dot ${status.worker.online ? 'online' : 'offline'}`} />
                  <div>
                    <strong>维护服务（worker）</strong>
                    <span>
                      {status.worker.online ? '在线' : '离线'} ·{' '}
                      {status.worker.lastRunAt
                        ? `最近执行 ${formatDateTime(status.worker.lastRunAt)}`
                        : status.worker.error || '暂无执行记录'}
                    </span>
                    <em>
                      {status.worker.intervalMs
                        ? `每 ${Math.round(status.worker.intervalMs / 1000)} 秒收敛过期数据并检查备份`
                        : '独立容器，与主应用共享数据卷'}
                    </em>
                  </div>
                </div>
                <div className="status-item">
                  <span className="status-dot online" />
                  <div>
                    <strong>数据存储</strong>
                    <span>SQLite · {(status.app.dbSize / 1024 / 1024).toFixed(2)} MB</span>
                    <em>{status.app.dataDir}</em>
                  </div>
                </div>
                <div className="status-item">
                  <span className={`status-dot ${status.backup.latest ? 'online' : 'offline'}`} />
                  <div>
                    <strong>最近备份</strong>
                    <span>
                      {status.backup.latest
                        ? `${status.backup.latest.name} · ${(status.backup.latest.size / 1024 / 1024).toFixed(2)} MB`
                        : '暂无备份文件'}
                    </span>
                    <em>
                      {status.backup.latest
                        ? `共 ${status.backup.count} 份 · ${formatDateTime(status.backup.latest.createdAt)}`
                        : '每日自动备份，保留最近 14 天'}
                    </em>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">暂时无法获取运行状态</p>
            )}
          </section>
        ) : null}

        {isAdmin ? (
          <section className="card settings-wide">
            <div className="card-head">
              <div>
                <h3>数据备份</h3>
                <p className="card-desc">每天自动备份数据库，保留最近 14 天</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={createBackup}
                disabled={backupBusy}
              >
                <Icon name="refresh" size={14} />
                {backupBusy ? '备份中…' : '立即备份'}
              </button>
            </div>
            {backupLoading ? (
              <Skeleton lines={3} />
            ) : backups.length === 0 ? (
              <p className="muted">暂无备份文件</p>
            ) : (
              <ul className="backup-list">
                {backups.map((item) => (
                  <li key={item.name}>
                    <span className="backup-icon">
                      <Icon name="database" size={16} />
                    </span>
                    <div className="backup-main">
                      <strong>{item.name}</strong>
                      <span>
                        {formatDateTime(item.createdAt)} · {(item.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => downloadBackup(item.name)}
                    >
                      <Icon name="download" size={14} />
                      下载
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <p className="settings-footer">
        科协运营管理平台 v{meta.version || '1.0.0'} · 数据存储于服务器本地 SQLite，接口可复用于后续微信小程序
      </p>
    </div>
  );
}
