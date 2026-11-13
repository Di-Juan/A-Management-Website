import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { VERSION, WEB_DIST } from './config.js';
import { initData } from './db.js';
import { authRouter } from './routes/auth.js';
import { summaryRouter } from './routes/summary.js';
import { attachmentRouter, transactionRouter } from './routes/transactions.js';
import { userRouter } from './routes/users.js';
import { categoryRouter } from './routes/categories.js';
import { logRouter } from './routes/logs.js';
import { exportRouter } from './routes/export.js';
import { collectionFileRouter, collectionRouter } from './routes/collections.js';
import { settingsRouter } from './routes/settings.js';
import { borrowRouter, consumableRouter, equipmentRouter } from './routes/equipment.js';
import { inventoryRouter } from './routes/inventory.js';
import { accessRouter } from './routes/access.js';
import { activityRouter } from './routes/activities.js';
import { dutyRouter } from './routes/duty.js';
import { documentRouter } from './routes/documents.js';
import { importRouter } from './routes/imports.js';
import { apiKeyRouter } from './routes/apikeys.js';
import { systemRouter } from './routes/system.js';

/** 允许跨域访问的站点，逗号分隔，例如 CORS_ORIGINS=https://a.com,https://b.com */
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export function createApp() {
  initData();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowAll = CORS_ORIGINS.includes('*');
    if (origin && (allowAll || CORS_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/v1/health', (req, res) => {
    res.json({ ok: true, version: VERSION, time: new Date().toISOString() });
  });

  app.use('/api/v1', settingsRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/summary', summaryRouter);
  app.use('/api/v1/transactions', transactionRouter);
  app.use('/api/v1/attachments', attachmentRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/categories', categoryRouter);
  app.use('/api/v1/logs', logRouter);
  app.use('/api/v1/export', exportRouter);
  app.use('/api/v1/collections', collectionRouter);
  app.use('/api/v1/collection-attachments', collectionFileRouter);
  app.use('/api/v1/equipment', equipmentRouter);
  app.use('/api/v1/consumables', consumableRouter);
  app.use('/api/v1/borrows', borrowRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/access', accessRouter);
  app.use('/api/v1/activities', activityRouter);
  app.use('/api/v1/duty', dutyRouter);
  app.use('/api/v1/documents', documentRouter);
  app.use('/api/v1/imports', importRouter);
  app.use('/api/v1/api-keys', apiKeyRouter);
  app.use('/api/v1/system', systemRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res
        .type('text/plain')
        .send('科协运营管理平台 API 已启动。开发模式请访问 Vite 地址（默认 http://localhost:5173）。');
    });
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? '文件过大，请检查该类型文件的大小限制'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? '上传文件数量超出限制'
            : '文件上传失败';
      return res.status(400).json({ error: message });
    }

    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: status >= 500 ? '服务器内部错误，请稍后重试' : err.message });
  });

  return app;
}
