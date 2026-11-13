import express from 'express';
import { db, audit, nowIso } from '../db.js';
import {
  COOKIE_NAME,
  TOKEN_TTL,
  clearLoginFail,
  checkLoginThrottle,
  hashPassword,
  recordLoginFail,
  requireAuth,
  signToken,
  verifyPassword,
} from '../auth.js';
import { HttpError, ah, clientIp, publicUser, text } from '../helpers.js';

export const authRouter = express.Router();

const wechatConfig = () => ({
  appid: String(process.env.WX_APPID || '').trim(),
  secret: String(process.env.WX_SECRET || '').trim(),
});

const wechatConfigured = () => {
  const { appid, secret } = wechatConfig();
  return Boolean(appid && secret);
};

/** 用小程序 wx.login 的 code 换取 openid（AppSecret 只留在服务端） */
async function code2Session(code) {
  if (!wechatConfigured()) throw new HttpError(503, '服务端未配置 WX_APPID / WX_SECRET，暂不支持微信登录');
  const { appid, secret } = wechatConfig();
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('[wechat] code2session 失败', err);
    throw new HttpError(502, '微信登录服务暂不可用，请稍后重试');
  }
  if (data.errcode) throw new HttpError(400, `微信登录失败：${data.errmsg || data.errcode}`);
  if (!data.openid) throw new HttpError(400, '微信登录失败：未获取到 openid');
  return data.openid;
}

function issueSession(user, req, res) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ token, expiresIn: TOKEN_TTL, user: publicUser({ ...user, last_login_at: nowIso() }) });
}

authRouter.post(
  '/login',
  ah((req, res) => {
    const username = text(req.body?.username, { field: '账号', required: true, max: 40 });
    const password = String(req.body?.password ?? '');
    if (!password) throw new HttpError(400, '密码不能为空');

    const ip = clientIp(req);
    const throttleKey = `${ip}|${username.toLowerCase()}`;
    if (!checkLoginThrottle(throttleKey)) {
      throw new HttpError(429, '登录失败次数过多，请 15 分钟后再试');
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFail(throttleKey);
      throw new HttpError(401, '账号或密码不正确');
    }
    if (user.status !== 'active') throw new HttpError(403, '该账号已被停用，请联系管理员');

    clearLoginFail(throttleKey);
    audit({
      actor: user,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      detail: { username: user.username },
      ip,
      userAgent: req.headers['user-agent'],
    });
    issueSession(user, req, res);
  }),
);

/* ------------------------------- 微信小程序 ------------------------------- */

authRouter.get(
  '/wechat/status',
  requireAuth,
  ah((req, res) => {
    res.json({ configured: wechatConfigured(), bound: !!req.user.wx_openid });
  }),
);

// 首次使用：账号密码登录后，用一次 wx.login 的 code 完成绑定
authRouter.post(
  '/wechat/bind',
  requireAuth,
  ah(async (req, res) => {
    const code = text(req.body?.code, { field: '微信登录凭证', required: true, max: 200 });
    const openid = await code2Session(code);
    const occupied = db.prepare('SELECT id, username FROM users WHERE wx_openid = ?').get(openid);
    if (occupied && occupied.id !== req.user.id) {
      throw new HttpError(409, '该微信已绑定其他账号，请先解绑');
    }
    db.prepare('UPDATE users SET wx_openid = ? WHERE id = ?').run(openid, req.user.id);
    audit({
      actor: req.user,
      action: 'auth.wechat_bind',
      entityType: 'user',
      entityId: req.user.id,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  }),
);

authRouter.delete(
  '/wechat/bind',
  requireAuth,
  ah((req, res) => {
    db.prepare('UPDATE users SET wx_openid = NULL WHERE id = ?').run(req.user.id);
    audit({
      actor: req.user,
      action: 'auth.wechat_unbind',
      entityType: 'user',
      entityId: req.user.id,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  }),
);

// 已绑定微信的用户：小程序启动时静默换取登录态，实现免密登录
authRouter.post(
  '/wechat/login',
  ah(async (req, res) => {
    const code = text(req.body?.code, { field: '微信登录凭证', required: true, max: 200 });
    const openid = await code2Session(code);
    const user = db.prepare('SELECT * FROM users WHERE wx_openid = ?').get(openid);
    if (!user) throw new HttpError(404, '该微信尚未绑定账号，请先用账号密码登录并绑定');
    if (user.status !== 'active') throw new HttpError(403, '该账号已被停用，请联系管理员');
    audit({
      actor: user,
      action: 'auth.login.wechat',
      entityType: 'user',
      entityId: user.id,
      detail: { username: user.username },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    issueSession(user, req, res);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  ah((req, res) => {
    res.json({ user: publicUser(req.user) });
  }),
);

authRouter.post(
  '/logout',
  ah((req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  ah((req, res) => {
    const displayName = text(req.body?.displayName, { field: '姓名', required: true, max: 30 });
    const current = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id);
    if (current.display_name !== displayName) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user.id);
      audit({
        actor: req.user,
        action: 'user.profile_update',
        entityType: 'user',
        entityId: req.user.id,
        detail: { before: { displayName: current.display_name }, after: { displayName } },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  ah((req, res) => {
    const oldPassword = String(req.body?.oldPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (newPassword.length < 8) throw new HttpError(400, '新密码至少 8 位');
    if (newPassword.length > 64) throw new HttpError(400, '新密码不能超过 64 位');
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new HttpError(400, '新密码需同时包含字母和数字');
    }
    if (newPassword === oldPassword) throw new HttpError(400, '新密码不能与旧密码相同');

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(oldPassword, row.password_hash)) throw new HttpError(400, '当前密码不正确');

    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?',
    ).run(hashPassword(newPassword), req.user.id);
    audit({
      actor: req.user,
      action: 'auth.change_password',
      entityType: 'user',
      entityId: req.user.id,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    // 旧 token 已随 token_version 失效，给当前设备换发新 token
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const token = signToken(updated);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === '1',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, token, user: publicUser(updated) });
  }),
);
