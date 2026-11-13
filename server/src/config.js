import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'server', 'data');

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const WEB_DIST = path.join(ROOT_DIR, 'web', 'dist');

export const PORT = Number(process.env.PORT || 8787);
export const HOST = process.env.HOST || '0.0.0.0';

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(DATA_DIR, 'jwt.secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
})();

export const VERSION = '1.0.0';
