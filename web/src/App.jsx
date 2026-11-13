import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, canExport, canUseAny, setToken } from './api.js';
import { useAuth, useToast } from './context.jsx';
import Icon from './icons.jsx';
import Layout from './components/Layout.jsx';
import { Modal } from './components/UI.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ledger from './pages/Ledger.jsx';
import Collections from './pages/Collections.jsx';
import Export from './pages/Export.jsx';
import Logs from './pages/Logs.jsx';
import Members from './pages/Members.jsx';
import Settings from './pages/Settings.jsx';
import Equipment from './pages/Equipment.jsx';
import Printing from './pages/Printing.jsx';
import Inventory from './pages/Inventory.jsx';
import Access from './pages/Access.jsx';
import Activities from './pages/Activities.jsx';
import Documents from './pages/Documents.jsx';
import ApiKeys from './pages/ApiKeys.jsx';

function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark">
        <Icon name="cpu" size={24} strokeWidth={1.7} />
      </div>
      <span>正在加载科协运营平台…</span>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function RequireExport({ children }) {
  const { user } = useAuth();
  if (!canExport(user)) return <Navigate to="/" replace />;
  return children;
}

function RequirePerm({ perms, children }) {
  const { user } = useAuth();
  if (!canUseAny(user, perms)) return <Navigate to="/" replace />;
  return children;
}

function ForcePasswordModal() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user?.mustChangePassword) return null;
  // 普通成员仅提示，不强制修改
  if (user.role === 'member') return null;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.newPassword !== form.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/auth/change-password', {
        oldPassword: form.oldPassword,
        newPassword: form.newPassword,
      });
      if (res?.token) setToken(res.token);
      await refreshUser();
      toast.success('密码已更新');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="请修改初始密码"
      subtitle="为了账本安全，首次登录需要设置新密码"
      onClose={() => {}}
      width={440}
      footer={
        <div className="modal-actions">
          <button type="submit" form="force-password-form" className="btn btn-primary" disabled={saving}>
            {saving ? '提交中…' : '设置新密码'}
          </button>
        </div>
      }
    >
      <form id="force-password-form" className="form" onSubmit={submit}>
        <label className="field">
          <span>当前密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={form.oldPassword}
            onChange={(e) => setForm({ ...form, oldPassword: e.target.value })}
          />
        </label>
        <label className="field">
          <span>新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="8 位以上，需同时包含字母和数字"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          />
        </label>
        <label className="field">
          <span>确认新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route
            path="equipment"
            element={
              <RequirePerm perms={['equipment']}>
                <Equipment />
              </RequirePerm>
            }
          />
          <Route
            path="printing"
            element={
              <RequirePerm perms={['equipment']}>
                <Printing />
              </RequirePerm>
            }
          />
          <Route
            path="inventory"
            element={
              <RequirePerm perms={['inventory']}>
                <Inventory />
              </RequirePerm>
            }
          />
          <Route
            path="access"
            element={
              <RequirePerm perms={['access']}>
                <Access />
              </RequirePerm>
            }
          />
          <Route
            path="activities"
            element={
              <RequirePerm perms={['activity', 'duty']}>
                <Activities />
              </RequirePerm>
            }
          />
          <Route
            path="documents"
            element={
              <RequirePerm perms={['doc']}>
                <Documents />
              </RequirePerm>
            }
          />
          <Route path="ledger" element={<Ledger />} />
          <Route path="collections" element={<Collections />} />
          <Route
            path="export"
            element={
              <RequireExport>
                <Export />
              </RequireExport>
            }
          />
          <Route
            path="logs"
            element={
              <RequireAdmin>
                <Logs />
              </RequireAdmin>
            }
          />
          <Route
            path="members"
            element={
              <RequireAdmin>
                <Members />
              </RequireAdmin>
            }
          />
          <Route
            path="api-keys"
            element={
              <RequirePerm perms={['api']}>
                <ApiKeys />
              </RequirePerm>
            }
          />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ForcePasswordModal />
    </>
  );
}
