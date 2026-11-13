import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../icons.jsx';
import { useAuth } from '../context.jsx';

export default function Login() {
  const { user, login, meta } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-brand">
          <div className="brand-mark light">
            <Icon name="cpu" size={24} strokeWidth={1.7} />
          </div>
          <span>科协运营</span>
        </div>
        <div className="login-copy">
          <h1>
            每一项运营
            <br />
            都井井有条
          </h1>
          <p>设备预约、门禁授权、耗材库存、活动与值班统一管理，成员协作清晰可查。</p>
        </div>
        <ul className="login-points">
          <li>
            <Icon name="receipt" size={18} />
            <div>
              <strong>运营留痕</strong>
              <span>预约、借还、出入库与门禁记录完整保存</span>
            </div>
          </li>
          <li>
            <Icon name="shield" size={18} />
            <div>
              <strong>权限分级</strong>
              <span>按部门分配模块权限，敏感资料仅管理员可见</span>
            </div>
          </li>
          <li>
            <Icon name="download" size={18} />
            <div>
              <strong>一键对账</strong>
              <span>导出经费明细、凭证与运营数据</span>
            </div>
          </li>
        </ul>
        <div className="login-term">{meta.term || '学生科协 · 运营管理'}</div>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <div className="login-heading">
            <h2>登录 {meta.className || '科协运营平台'}</h2>
            <p>请使用管理员分配的账号登录</p>
          </div>

          <label className="field">
            <span>登录账号</span>
            <div className="input-with-icon">
              <Icon name="user" size={17} />
              <input
                type="text"
                autoComplete="username"
                placeholder="请输入账号"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </div>
          </label>

          <label className="field">
            <span>密码</span>
            <div className="input-with-icon">
              <Icon name="lock" size={17} />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </button>

          <p className="login-tip">忘记密码请联系班级管理员重置</p>
          <div className="login-meta">
            {meta.orgName || '科协运营管理平台'} · v{meta.version || '1.0.0'}
          </div>
        </form>
      </section>
    </div>
  );
}
