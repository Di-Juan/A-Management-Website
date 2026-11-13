import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { DATA_DIR, VERSION } from '../config.js';
import { requireAuth, requireRole } from '../auth.js';
import { ah } from '../helpers.js';
import { listBackups } from '../backup.js';

export const systemRouter = express.Router();

const WORKER_URL = process.env.WORKER_URL || `http://127.0.0.1:${process.env.WORKER_PORT || 8788}`;

/** 探测维护容器；未部署或挂掉时不影响本接口返回 */
async function probeWorker() {
  try {
    const res = await fetch(`${WORKER_URL}/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
    return { online: true, ...(await res.json()) };
  } catch (err) {
    return { online: false, error: err.name === 'TimeoutError' ? '连接超时' : '未启动或不可达' };
  }
}

systemRouter.get(
  '/status',
  requireAuth,
  requireRole('admin'),
  ah(async (req, res) => {
    let dbSize = 0;
    try {
      dbSize = fs.statSync(path.join(DATA_DIR, 'classfund.db')).size;
    } catch {
      /* 首次启动文件可能尚未落盘 */
    }
    const backups = listBackups();
    res.json({
      app: {
        version: VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        dataDir: DATA_DIR,
        dbSize,
      },
      worker: await probeWorker(),
      backup: { count: backups.length, latest: backups[0] || null },
      time: new Date().toISOString(),
    });
  }),
);
