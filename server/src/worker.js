/**
 * 后台维护进程：定时收敛过期数据、生成每日备份。
 * 与 Web 进程共享同一个数据卷，独立容器运行，互不阻塞。
 */
import http from 'node:http';
import { db, initData, nowIso } from './db.js';
import { dailyBackup } from './backup.js';

const PORT = Number(process.env.WORKER_PORT || 8788);
const INTERVAL = Number(process.env.WORKER_INTERVAL_MS || 60 * 1000);

const state = {
  startedAt: nowIso(),
  lastRunAt: null,
  lastError: null,
  counters: { overdueBorrows: 0, expiredRequests: 0, expiredGrants: 0, completedBookings: 0 },
};

function runOnce() {
  const now = nowIso();
  try {
    const overdueBorrows = db
      .prepare(
        `UPDATE borrow_records SET status = 'overdue', updated_at = ?
         WHERE status = 'borrowed' AND returned_at IS NULL AND due_at < ?`,
      )
      .run(now, now).changes;

    const expiredRequests = db
      .prepare(
        `UPDATE access_requests SET status = 'expired', updated_at = ?
         WHERE status = 'approved' AND end_at < ?`,
      )
      .run(now, now).changes;

    const expiredGrants = db
      .prepare(
        `UPDATE access_grants SET status = 'expired', revoked_at = ?
         WHERE status = 'active' AND valid_to IS NOT NULL AND valid_to < ?`,
      )
      .run(now, now).changes;

    const completedBookings = db
      .prepare(
        `UPDATE equipment_bookings SET status = 'completed', updated_at = ?
         WHERE status = 'approved' AND end_at < ?`,
      )
      .run(now, now).changes;

    state.lastRunAt = nowIso();
    state.lastError = null;
    state.counters = { overdueBorrows, expiredRequests, expiredGrants, completedBookings };

    const total = overdueBorrows + expiredRequests + expiredGrants + completedBookings;
    if (total > 0) {
      console.log(
        `[worker] 逾期借用 ${overdueBorrows} · 过期门禁 ${expiredRequests} · 失效授权 ${expiredGrants} · 结束预约 ${completedBookings}`,
      );
    }
    dailyBackup();
  } catch (err) {
    state.lastError = err.message;
    console.error('[worker] 维护任务失败:', err.message);
  }
}

const server = http.createServer((req, res) => {
  const send = (code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  if (req.url === '/health') {
    const fresh = state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) < INTERVAL * 3;
    return send(fresh ? 200 : 503, {
      ok: Boolean(fresh),
      lastRunAt: state.lastRunAt,
      lastError: state.lastError,
    });
  }
  if (req.url === '/status') {
    return send(200, { ...state, intervalMs: INTERVAL });
  }
  return send(404, { error: '接口不存在' });
});

initData();
runOnce();
const timer = setInterval(runOnce, INTERVAL);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[worker] 维护进程已启动，端口 ${PORT}，周期 ${Math.round(INTERVAL / 1000)}s`);
});

function shutdown(signal) {
  console.log(`[worker] 收到 ${signal}，正在退出...`);
  clearInterval(timer);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
