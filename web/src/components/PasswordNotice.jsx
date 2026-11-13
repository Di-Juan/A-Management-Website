import { useState } from 'react';
import { api, setToken } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { Modal } from './UI.jsx';

const EMPTY_FORM = { oldPassword: '', newPassword: '', confirm: '' };

/** 普通成员使用初始密码时只做提示，不强制修改 */
export default function PasswordNotice() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user?.mustChangePassword || user.role !== 'member' || dismissed) return null;

  const close = () => {
    setOpen(false);
    setError('');
    setForm(EMPTY_FORM);
  };

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
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="password-notice">
        <Icon name="key" size={16} />
        <span>你仍在使用初始密码，建议尽快修改以保护账号安全。</span>
        <button type="button" className="link link-btn" onClick={() => setOpen(true)}>
          修改密码
        </button>
        <button
          type="button"
          className="icon-btn password-notice-close"
          onClick={() => setDismissed(true)}
          aria-label="暂不修改"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <Modal
        open={open}
        onClose={close}
        title="修改密码"
        subtitle="普通成员不强制修改，建议换成只有自己知道的密码"
        width={440}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>
              取消
            </button>
            <button type="submit" form="member-password-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '保存新密码'}
            </button>
          </div>
        }
      >
        <form id="member-password-form" className="form" onSubmit={submit}>
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
    </>
  );
}
