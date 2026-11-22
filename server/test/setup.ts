// Integration tests run against a throwaway copy of the local catalog database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = path.join(root, 'data', 'collection.db');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3dpc-test-'));
const dest = path.join(dir, 'test.db');
if (fs.existsSync(src)) {
  const Database = (await import('better-sqlite3')).default;
  await new Database(src, { readonly: true }).backup(dest);
  const t = new Database(dest);
  for (const table of ['collection_items', 'item_tags', 'wishlist_items', 'deck_changes', 'deck_cards', 'decks', 'misc_items', 'prices', 'price_history', 'value_history', 'price_lookups', 'import_jobs']) {
    t.exec(`DELETE FROM ${table}`);
  }
  t.exec("DELETE FROM binders WHERE id != 1; DELETE FROM settings;");
  t.close();
}
process.env.DB_PATH = dest;
process.env.DATA_DIR = dir;
process.env.JUSTTCG_API_KEY = '';
