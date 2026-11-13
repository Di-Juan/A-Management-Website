import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, DATA_DIR } from './config.js';
import { db } from './db.js';

const KEEP_DAYS = 14;

export function dailyBackup(actor = null) {
  try {
    const dateKey = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `classfund-${dateKey}.db`);
    if (fs.existsSync(target)) return null;

    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(path.join(DATA_DIR, 'classfund.db'), target);

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((name) => /^classfund-\d{4}-\d{2}-\d{2}\.db$/.test(name))
      .sort()
      .reverse();
    for (const stale of files.slice(KEEP_DAYS)) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, stale));
      } catch {
        /* ignore */
      }
    }

    if (actor) {
      db.prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, detail, created_at)
         VALUES (?, ?, 'backup.create', 'backup', NULL, ?, ?)`,
      ).run(
        actor.id,
        actor.display_name,
        JSON.stringify({ file: path.basename(target) }),
        new Date().toISOString(),
      );
    }
    return target;
  } catch (err) {
    console.error('[backup] 自动备份失败:', err.message);
    return null;
  }
}

export function listBackups() {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function startBackupTimer() {
  dailyBackup();
  const timer = setInterval(() => dailyBackup(), 6 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}
