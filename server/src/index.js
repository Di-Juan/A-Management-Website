import { HOST, PORT, VERSION } from './config.js';
import { createApp } from './app.js';
import { startBackupTimer } from './backup.js';

const app = createApp();
if (process.env.WORKER_ENABLED === '1') {
  console.log('维护任务由 worker 容器负责，本进程不再重复执行备份。');
} else {
  startBackupTimer();
}

const server = app.listen(PORT, HOST, () => {
  console.log(`科协运营管理平台已启动: http://localhost:${PORT} (v${VERSION})`);
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
