import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setToken } from './api.js';

const AuthContext = createContext(null);
const ToastContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState({ className: '科协运营平台', term: '', version: '' });
  const [loading, setLoading] = useState(true);

  const loadMeta = useCallback(async () => {
    try {
      const data = await api.get('/meta');
      setMeta(data);
    } catch {
      /* 忽略元信息加载失败 */
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [, me] = await Promise.all([loadMeta(), api.get('/auth/me').catch(() => null)]);
      if (!active) return;
      if (me?.user) setUser(me.user);
      setLoading(false);
    })();

    const onUnauthorized = () => setUser(null);
    window.addEventListener('cf:unauthorized', onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener('cf:unauthorized', onUnauthorized);
    };
  }, [loadMeta]);

  const login = useCallback(async (username, password) => {
    const data = await api.post('/auth/login', { username, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* 忽略登出接口异常 */
    }
    setToken('');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, meta, login, logout, refreshUser, loadMeta }),
    [user, loading, meta, login, logout, refreshUser, loadMeta],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message, type = 'success') => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((list) => [...list.slice(-3), { id, message, type }]);
      setTimeout(() => remove(id), 3800);
    },
    [remove],
  );

  const value = useMemo(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`} onClick={() => remove(toast.id)}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
