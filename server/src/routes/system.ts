import { Router } from 'express';
import multer from 'multer';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db, getSetting, setSetting, migrate } from '../db/index.js';
import { BACKUP_DIR, DB_PATH, getJustTcgKey, setEnvValue } from '../config.js';
import { catalogSize, getCards } from '../scryfall/cards.js';
import { checkForCatalogUpdate, syncCatalog, syncState } from '../scryfall/sync.js';
import { collectionSummary, priceSql, round } from '../pricing/valuation.js';
import { limits, refreshState, runRefresh, usageToday } from '../pricing/refresh.js';
import { listDecks, HttpError } from '../decks/service.js';
import { heartbeat, tabClosed } from '../idle.js';

export const system = Router();

// ---- Dashboard ----
function movers(days: number, limit = 8) {
  const rows = db.prepare(`
    WITH cur AS (
      SELECT ci.scryfall_id, ci.finish, ci.condition, SUM(ci.qty) AS qty, cp.price
      FROM collection_items ci JOIN current_prices cp ON cp.scryfall_id = ci.scryfall_id AND cp.finish = ci.finish AND cp.condition = ci.condition
      WHERE cp.price IS NOT NULL GROUP BY ci.scryfall_id, ci.finish, ci.condition
    ),
    old AS (
      SELECT cur.scryfall_id, cur.finish, cur.condition,
        (SELECT ph.price FROM price_history ph WHERE ph.scryfall_id = cur.scryfall_id AND ph.finish = cur.finish AND ph.condition = cur.condition
           AND ph.date <= date('now', ?) ORDER BY ph.date DESC LIMIT 1) AS old_price
      FROM cur
    )
    SELECT cur.*, old.old_price, cur.price - old.old_price AS change,
      CASE WHEN old.old_price > 0 THEN (cur.price - old.old_price) / old.old_price * 100 END AS pct
    FROM cur JOIN old USING (scryfall_id, finish, condition) WHERE old.old_price IS NOT NULL AND cur.price != old.old_price
  `).all(`-${days} days`) as any[];
  const cards = getCards(rows.map(r => r.scryfall_id));
  const view = (r: any) => ({
    card: cards.get(r.scryfall_id), finish: r.finish, condition: r.condition, qty: r.qty,
    price: r.price, oldPrice: r.old_price, change: round(r.change), pct: r.pct != null ? Math.round(r.pct * 10) / 10 : null,
  });
  const sorted = [...rows].sort((a, b) => b.change - a.change);
  return {
    gainers: sorted.filter(r => r.change > 0).slice(0, limit).map(view),
    losers: sorted.filter(r => r.change < 0).reverse().slice(0, limit).map(view),
  };
}

system.get('/dashboard', (req, res) => {
  const days = Number(req.query.days ?? 7);
  const summary = collectionSummary();
  const p = priceSql('ci');
  const top = db.prepare(`SELECT ci.scryfall_id, ci.finish, ci.condition, SUM(ci.qty) AS qty, ${p.price} AS price, ${p.source} AS source
    FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id ${p.join}
    GROUP BY ci.scryfall_id, ci.finish, ci.condition HAVING price IS NOT NULL ORDER BY price DESC LIMIT 12`).all() as any[];
  const topCards = getCards(top.map(t => t.scryfall_id));
  const history = db.prepare('SELECT date, total, card_count AS cards FROM value_history ORDER BY date').all();
  const binders = db.prepare(`SELECT b.id, b.name, b.kind, COALESCE(SUM(ci.qty), 0) AS cards, COALESCE(SUM(ci.qty * ${p.price}), 0) AS value
    FROM binders b LEFT JOIN collection_items ci ON ci.binder_id = b.id LEFT JOIN cards c ON c.id = ci.scryfall_id ${p.join}
    GROUP BY b.id HAVING cards > 0 ORDER BY value DESC`).all() as any[];
  const byCondition = db.prepare(`SELECT ci.condition, SUM(ci.qty) AS cards, COALESCE(SUM(ci.qty * ${p.price}), 0) AS value
    FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id ${p.join} GROUP BY ci.condition`).all() as any[];
  const wp = priceSql('w');
  const alerts = db.prepare(`SELECT w.id, w.scryfall_id, w.target_price, ${wp.price} AS price FROM wishlist_items w JOIN cards c ON c.id = w.scryfall_id ${wp.join}
    WHERE w.target_price IS NOT NULL AND ${wp.price} IS NOT NULL AND ${wp.price} <= w.target_price`).all() as any[];
  const alertCards = getCards(alerts.map(a => a.scryfall_id));
  const miscCount = (db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM misc_items').get() as any).n;
  res.json({
    summary,
    history,
    movers: movers(days),
    days,
    topCards: top.map(t => ({ card: topCards.get(t.scryfall_id), finish: t.finish, condition: t.condition, qty: t.qty, price: t.price, source: t.source })),
    binders: binders.map(b => ({ ...b, value: round(b.value) })),
    byCondition: byCondition.map(b => ({ ...b, value: round(b.value) })),
    decks: listDecks(),
    wishlistAlerts: alerts.map(a => ({ id: a.id, card: alertCards.get(a.scryfall_id), price: a.price, targetPrice: a.target_price })),
    miscCount,
    lastPriceRefresh: getSetting('last_price_refresh') ?? null,
    hasApiKey: !!getJustTcgKey(),
    catalogSize: catalogSize(),
  });
});

// ---- Set completion ----
system.get('/sets', (req, res) => {
  const all = req.query.all === '1';
  const rows = db.prepare(`
    SELECT s.code, s.name, s.set_type, s.released_at, s.icon_svg_uri,
      (SELECT COUNT(*) FROM cards c WHERE c.set_code = s.code) AS total,
      (SELECT COUNT(DISTINCT c.collector_number) FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id WHERE c.set_code = s.code) AS owned
    FROM sets s ${all ? '' : 'WHERE EXISTS (SELECT 1 FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id WHERE c.set_code = s.code)'}
    ORDER BY s.released_at DESC`).all() as any[];
  res.json(rows.filter(r => r.total > 0).map(r => ({ ...r, pct: r.total ? Math.round((r.owned / r.total) * 1000) / 10 : 0 })));
});

system.get('/sets/:code', (req, res) => {
  const code = req.params.code.toLowerCase();
  const set = db.prepare('SELECT * FROM sets WHERE code = ?').get(code);
  if (!set) throw new HttpError(404, 'Set not found');
  const rows = db.prepare(`SELECT c.id, (SELECT COALESCE(SUM(qty),0) FROM collection_items ci WHERE ci.scryfall_id = c.id) AS owned,
      COALESCE((SELECT price FROM current_prices cp WHERE cp.scryfall_id = c.id AND cp.condition = 'NM' AND cp.finish = 'nonfoil'), c.scryfall_usd, c.scryfall_usd_foil) AS price
    FROM cards c WHERE c.set_code = ? ORDER BY CAST(c.collector_number AS INTEGER), c.collector_number`).all(code) as any[];
  const cards = getCards(rows.map(r => r.id));
  const list = rows.map(r => ({ card: cards.get(r.id), owned: r.owned, price: r.price }));
  const missing = list.filter(l => !l.owned);
  res.json({ set, cards: list, owned: list.length - missing.length, total: list.length, missingCost: round(missing.reduce((t, m) => t + (m.price ?? 0), 0)) });
});

// ---- Settings ----
function settingsView() {
  const key = getJustTcgKey();
  return {
    hasApiKey: !!key,
    apiKeyPreview: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null,
    limits: limits(),
    usageToday: usageToday(),
    requestsRemaining: getSetting('justtcg_remaining') ? Number(getSetting('justtcg_remaining')) : null,
    plan: getSetting('justtcg_plan') ?? null,
    marketFallback: getSetting('market_fallback') !== '0',
    defaultCondition: getSetting('default_condition') ?? 'NM',
    catalogSyncedAt: getSetting('catalog_synced_at') ?? null,
    catalogSize: catalogSize(),
    lastPriceRefresh: getSetting('last_price_refresh') ?? null,
    refresh: refreshState,
    dbPath: DB_PATH,
  };
}

system.get('/settings', (_req, res) => res.json(settingsView()));

system.put('/settings', (req, res) => {
  const b = z.object({
    justtcgKey: z.string().optional(),
    dailyLimit: z.number().int().positive().optional(),
    perMinute: z.number().int().positive().optional(),
    batchSize: z.number().int().min(1).max(200).optional(),
    staleHours: z.number().positive().optional(),
    marketFallback: z.boolean().optional(),
    defaultCondition: z.enum(['NM', 'LP', 'MP']).optional(),
  }).parse(req.body);
  if (b.justtcgKey !== undefined) {
    const k = b.justtcgKey.trim();
    if (k && !/^[\w\-.]+$/.test(k)) throw new HttpError(400, 'That does not look like an API key.');
    setEnvValue('JUSTTCG_API_KEY', k);
  }
  if (b.dailyLimit) setSetting('justtcg_daily_limit', String(b.dailyLimit));
  if (b.perMinute) setSetting('justtcg_per_minute', String(b.perMinute));
  if (b.batchSize) setSetting('justtcg_batch_size', String(b.batchSize));
  if (b.staleHours) setSetting('refresh_stale_hours', String(b.staleHours));
  if (b.marketFallback !== undefined) setSetting('market_fallback', b.marketFallback ? '1' : '0');
  if (b.defaultCondition) setSetting('default_condition', b.defaultCondition);
  res.json(settingsView());
});

system.post('/catalog/sync', (_req, res) => {
  void syncCatalog();
  res.json({ started: true });
});
let lastPriceCheckAt = 0;

/**
 * Runs whenever the app is opened (server start or a page load): look for new Scryfall cards and
 * refresh prices that have gone stale. Both are throttled to once per 30 minutes; the price refresh
 * only touches cards older than the stale window and still respects the JustTCG daily limit.
 */
export function onAppOpened() {
  void checkForCatalogUpdate();
  if (getJustTcgKey() && Date.now() - lastPriceCheckAt > 30 * 60_000) {
    lastPriceCheckAt = Date.now();
    void runRefresh();
  }
}

system.post('/app/opened', (_req, res) => {
  onAppOpened();
  res.json({ ok: true });
});
// Tab presence, for stopping the server when the app is closed (see idle.ts).
const tabId = z.object({ tabId: z.string().min(1).max(64) });
system.post('/app/heartbeat', (req, res) => {
  heartbeat(tabId.parse(req.body).tabId);
  res.json({ ok: true });
});
system.post('/app/closing', (req, res) => {
  tabClosed(tabId.parse(req.body).tabId);
  res.json({ ok: true });
});
system.get('/catalog/status', (_req, res) => res.json({ ...syncState, catalogSize: catalogSize() }));

// ---- Backups ----
/**
 * Tables holding the user's own data. The Scryfall catalog (cards/sets) is ~90 MB and can always be
 * re-downloaded, so backups copy only these — which keeps each one well under a megabyte.
 */
const USER_TABLES = [
  'binders', 'collection_items', 'tags', 'item_tags', 'wishlist_items', 'decks', 'deck_cards', 'deck_changes',
  'misc_items', 'prices', 'price_lookups', 'price_history', 'value_history', 'import_jobs', 'settings',
];

function copyUserTables(from: Database.Database, to: Database.Database) {
  to.pragma('foreign_keys = OFF');
  to.transaction(() => {
    for (const table of USER_TABLES) {
      to.prepare(`DELETE FROM ${table}`).run();
      const rows = from.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const ins = to.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) ins.run(...cols.map(c => r[c] as never));
    }
  })();
  to.pragma('foreign_keys = ON');
}

export async function backupNow(label = 'manual') {
  const file = path.join(BACKUP_DIR, `collection-${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.db`);
  const out = new Database(file);
  migrate(out);
  copyUserTables(db, out);
  out.close();
  // keep the 20 most recent backups
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse();
  for (const f of files.slice(20)) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return path.basename(file);
}

system.get('/backups', (_req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse()
    .map(f => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
  res.json(files);
});

system.post('/backups', async (_req, res) => res.json({ file: await backupNow('manual') }));

/** Download a fresh backup as one file, for moving the data to another machine. */
system.get('/backups/download', async (_req, res) => {
  const file = await backupNow('download');
  res.download(path.join(BACKUP_DIR, file), `3DPrintCollectors-backup-${new Date().toISOString().slice(0, 10)}.db`);
});

/**
 * Restore from a backup file picked on this machine — a downloaded backup, a file from another machine's
 * data/backups folder, or even a whole collection.db. It is checked, upgraded to the current schema,
 * kept in data/backups, and then restored like any other backup.
 */
const uploadBackup = multer({
  storage: multer.diskStorage({
    destination: BACKUP_DIR,
    filename: (_req, _f, cb) => cb(null, `collection-${new Date().toISOString().replace(/[:.]/g, '-')}-uploaded.db`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});
system.post('/backups/upload', uploadBackup.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a backup file first.');
  const file = req.file.filename;
  const fail = (msg: string): never => { fs.rmSync(req.file!.path, { force: true }); throw new HttpError(400, msg); };
  const head = Buffer.alloc(16);
  const fd = fs.openSync(req.file.path, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\0') fail("That file isn't a 3DPrintCollectors backup (.db).");
  try {
    const conn = new Database(req.file.path);
    try {
      if (!conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'collection_items'").get()) {
        throw new Error('not ours');
      }
      migrate(conn); // backups from an older version gain any newer columns
    } finally {
      conn.close();
    }
  } catch {
    fail("That file isn't a 3DPrintCollectors backup (.db).");
  }
  await restoreBackup(file);
  res.json({ ok: true, file });
});

system.post('/backups/restore', async (req, res) => {
  const { file } = z.object({ file: z.string().regex(/^collection-[\w\-]+\.db$/) }).parse(req.body);
  await restoreBackup(file);
  res.json({ ok: true });
});

async function restoreBackup(file: string) {
  const src = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(src)) throw new HttpError(404, 'Backup not found');
  // Cards in the backup point at the card catalog; restoring before it exists would leave them unreadable.
  if (syncState.running || catalogSize() === 0) {
    throw new HttpError(409, 'The card catalog is still downloading. Wait until it finishes (see the top of the page), then restore again.');
  }
  await backupNow('before-restore');
  const from = new Database(src, { readonly: true });
  try {
    copyUserTables(from, db); // the card catalog in the live database is left alone
  } finally {
    from.close();
  }
}
