import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { audit, getSetting, setSetting, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { BACKUP_DIR, VERSION } from '../config.js';
import { HttpError, ah, clientIp, text } from '../helpers.js';
import { dailyBackup, listBackups } from '../backup.js';

export const settingsRouter = express.Router();

settingsRouter.get(
  '/meta',
  ah((req, res) => {
    res.json({
      className: getSetting('class_name', '科协运营平台'),
      term: getSetting('term', ''),
      orgName: getSetting('org_name', ''),
      version: VERSION,
    });
  }),
);

settingsRouter.get(
  '/settings',
  requireAuth,
  ah((req, res) => {
    res.json({
      className: getSetting('class_name', ''),
      term: getSetting('term', ''),
      orgName: getSetting('org_name', ''),
    });
  }),
);

settingsRouter.patch(
  '/settings',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const className = text(req.body?.className, { field: '组织名称', required: true, max: 40 });
    const term = text(req.body?.term, { field: '学期', max: 40 });
    const orgName = text(req.body?.orgName, { field: '管理组织', max: 40 });

    tx(() => {
      setSetting('class_name', className);
      setSetting('term', term);
      setSetting('org_name', orgName);
      audit({
        actor: req.user,
        action: 'settings.update',
        entityType: 'settings',
        detail: { className, term, orgName },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });
    res.json({ className, term, orgName });
  }),
);

settingsRouter.get(
  '/admin/backups',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    res.json({ items: listBackups() });
  }),
);

settingsRouter.post(
  '/admin/backups',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const dateKey = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `classfund-${dateKey}.db`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    const created = dailyBackup(req.user);
    if (!created) throw new HttpError(500, '备份失败，请查看服务器日志');
    res.json({ ok: true, item: listBackups()[0] });
  }),
);

settingsRouter.get(
  '/admin/backups/:name',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const name = String(req.params.name || '');
    if (!/^classfund-\d{4}-\d{2}-\d{2}\.db$/.test(name)) throw new HttpError(400, '备份文件名不正确');
    const filePath = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(filePath)) throw new HttpError(404, '备份不存在');
    audit({
      actor: req.user,
      action: 'backup.download',
      entityType: 'backup',
      detail: { file: name },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    fs.createReadStream(filePath).pipe(res);
  }),
);
