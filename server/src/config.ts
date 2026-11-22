import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const ENV_PATH = path.join(ROOT, '.env');
dotenv.config({ path: ENV_PATH, quiet: true });

export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'collection.db');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
export const HOST = '127.0.0.1'; // local only - never bind to 0.0.0.0
export const PORT = Number(process.env.PORT ?? 5178);
export const USER_AGENT = '3DPrintCollectors/1.0 (local collection tracker)';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

export function getJustTcgKey(): string | undefined {
  return process.env.JUSTTCG_API_KEY || undefined;
}

/** Writes/replaces a KEY=value line in the local .env file. */
export function setEnvValue(key: string, value: string) {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, line);
  else text = (text && !text.endsWith('\n') ? text + '\n' : text) + line + '\n';
  fs.writeFileSync(ENV_PATH, text);
  process.env[key] = value;
}
