import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../icons.jsx';
import { canExport, canUse, canUseAny, ROLE_LABEL } from '../api.js';
import { useAuth } from '../context.jsx';
import PasswordNotice from './PasswordNotice.jsx';

const NAV_GROUPS = [
  {
    label: '运营',
    items: [
      { to: '/', label: '总览', icon: 'home', end: true },
      { to: '/equipment', label: '设备预约', icon: 'cpu', perm: 'equipment' },
      { to: '/printing', label: '打印与耗材', icon: 'printer', perm: 'equipment' },
      { to: '/inventory', label: '库存与借还', icon: 'box', perm: 'inventory' },
      { to: '/access', label: '门禁管理', icon: 'door', perm: 'access' },
      { to: '/activities', label: '活动与值班', icon: 'calendar', perms: ['activity', 'duty'] },
      { to: '/documents', label: '资料归档', icon: 'folder', perm: 'doc' },
    ],
  },
  {
    label: '经费',
    items: [
      { to: '/ledger', label: '经费台账', icon: 'ledger' },
      { to: '/collections', label: '收费台账', icon: 'wallet' },
      { to: '/export', label: '导出账单', icon: 'download', exportOnly: true },
    ],
  },
  {
    label: '系统',
    items: [
      { to: '/logs', label: '操作日志', icon: 'shield', admin: true },
      { to: '/members', label: '成员管理', icon: 'users', admin: true },
      { to: '/api-keys', label: 'API 管理', icon: 'key', perm: 'api' },
      { to: '/settings', label: '设置', icon: 'settings' },
    ],
  },
];

const visible = (item, user) => {
  if (item.admin && user?.role !== 'admin') return false;
  if (item.exportOnly && !canExport(user)) return false;
  if (item.perm && !canUse(user, item.perm)) return false;
  if (item.perms && !canUseAny(user, item.perms)) return false;
  return true;
};

export default function Layout() {
  const { user, meta, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const groups = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => visible(item, user)) })).filter(
    (group) => group.items.length > 0,
  );
  const initial = (user?.displayName || user?.username || '?').slice(0, 1);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${drawerOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Icon name="cpu" size={22} strokeWidth={1.7} />
          </div>
          <div className="brand-text">
            <strong>{meta.className || '英才科协'}</strong>
            <span>科协运营 · {meta.term || '2026 秋季学期'}</span>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="关闭菜单"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="nav">
          {groups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-card">
            <div className="avatar">{initial}</div>
            <div className="user-meta">
              <strong>{user?.displayName}</strong>
              <span>{ROLE_LABEL[user?.role] || ''}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={handleLogout}>
            <Icon name="logout" size={16} />
            退出登录
          </button>
        </div>
      </aside>

      {drawerOpen ? (
        <button
          type="button"
          className="drawer-mask"
          onClick={() => setDrawerOpen(false)}
          aria-label="关闭菜单"
        />
      ) : null}

      <div className="main">
        <header className="mobile-topbar">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开菜单"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="mobile-title">{meta.className || '英才科协'}</div>
          <div className="avatar avatar-sm">{initial}</div>
        </header>
        <PasswordNotice />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
