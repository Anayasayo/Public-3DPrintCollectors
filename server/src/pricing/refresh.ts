import { db, getSetting, setSetting } from '../db/index.js';
import { getJustTcgKey } from '../config.js';
import { lookupBatch, mapCondition, mapPrinting, JustTcgError, type JustTcgLookup } from './justtcg.js';
import { snapshotToday } from './valuation.js';

export interface RefreshState {
  running: boolean;
  queued: number;
  done: number;
  requests: number;
  pricesSaved: number;
  lastError?: string;
  lastRunAt?: string;
  message?: string;
}

export const refreshState: RefreshState = { running: false, queued: 0, done: 0, requests: 0, pricesSaved: 0 };

export function limits() {
  return {
    daily: Number(getSetting('justtcg_daily_limit') ?? 100),
    perMinute: Number(getSetting('justtcg_per_minute') ?? 10),
    batch: Number(getSetting('justtcg_batch_size') ?? 20),
    staleHours: Number(getSetting('refresh_stale_hours') ?? 20),
  };
}

export function usageToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  return getSetting('justtcg_usage_date') === today ? Number(getSetting('justtcg_usage_count') ?? 0) : 0;
}

function recordUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const n = usageToday() + 1;
  setSetting('justtcg_usage_date', today);
  setSetting('justtcg_usage_count', String(n));
}

interface Task {
  scryfallId: string;
  kind: 'main' | 'etched';
  lookup: JustTcgLookup;
}

/** Every printing the user owns, wants, or has in a deck/misc, stalest first. */
export function buildQueue(opts: { ids?: string[]; force?: boolean } = {}): Task[] {
  const { staleHours } = limits();
  const idFilter = opts.ids?.length ? `AND c.id IN (${opts.ids.map(() => '?').join(',')})` : '';
  const rows = db.prepare(`
    WITH tracked AS (
      SELECT scryfall_id FROM collection_items UNION SELECT scryfall_id FROM deck_cards
      UNION SELECT scryfall_id FROM wishlist_items UNION SELECT scryfall_id FROM misc_items
    )
    SELECT c.id, c.finishes, c.tcgplayer_id, c.tcgplayer_etched_id,
      pm.last_attempt AS main_at, pe.last_attempt AS etched_at
    FROM cards c
    ${opts.ids?.length ? '' : 'JOIN tracked t ON t.scryfall_id = c.id'}
    LEFT JOIN price_lookups pm ON pm.scryfall_id = c.id AND pm.kind = 'main'
    LEFT JOIN price_lookups pe ON pe.scryfall_id = c.id AND pe.kind = 'etched'
    WHERE 1=1 ${idFilter}`).all(...(opts.ids ?? [])) as any[];

  const cutoff = Date.now() - staleHours * 3600_000;
  const isStale = (at: string | null) => opts.force || !at || Date.parse(at.replace(' ', 'T') + 'Z') < cutoff;
  const tasks: (Task & { at: string | null })[] = [];
  for (const r of rows) {
    const finishes: string[] = JSON.parse(r.finishes);
    const needsMain = finishes.includes('nonfoil') || finishes.includes('foil') || (finishes.includes('etched') && !r.tcgplayer_etched_id);
    if (needsMain && isStale(r.main_at)) {
      tasks.push({ scryfallId: r.id, kind: 'main', at: r.main_at,
        lookup: r.tcgplayer_id ? { tcgplayerId: String(r.tcgplayer_id) } : { scryfallId: r.id } });
    }
    if (finishes.includes('etched') && r.tcgplayer_etched_id && isStale(r.etched_at)) {
      tasks.push({ scryfallId: r.id, kind: 'etched', at: r.etched_at, lookup: { tcgplayerId: String(r.tcgplayer_etched_id) } });
    }
  }
  tasks.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  return tasks;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function saveBatch(tasks: Task[], cards: Awaited<ReturnType<typeof lookupBatch>>['cards']): number {
  const upsert = db.prepare(`INSERT INTO prices (scryfall_id, finish, condition, source, price, fetched_at)
    VALUES (?, ?, ?, 'justtcg', ?, datetime('now'))
    ON CONFLICT(scryfall_id, finish, condition, source) DO UPDATE SET price=excluded.price, fetched_at=excluded.fetched_at`);
  const hist = db.prepare('INSERT OR IGNORE INTO price_history (date, scryfall_id, finish, condition, price) VALUES (?, ?, ?, ?, ?)');
  const mark = db.prepare(`INSERT INTO price_lookups (scryfall_id, kind, last_attempt, found) VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(scryfall_id, kind) DO UPDATE SET last_attempt=excluded.last_attempt, found=excluded.found`);
  let saved = 0;
  db.transaction(() => {
    for (const task of tasks) {
      const match = cards.find(c =>
        (task.lookup.tcgplayerId && String(c.tcgplayerId) === task.lookup.tcgplayerId) ||
        (task.lookup.scryfallId && c.scryfallId === task.lookup.scryfallId));
      let found = 0;
      for (const v of match?.variants ?? []) {
        const condition = mapCondition(v.condition);
        const finish = mapPrinting(v.printing, task.kind === 'etched');
        if (!condition || !finish || v.price == null) continue;
        upsert.run(task.scryfallId, finish, condition, v.price);
        for (const h of v.priceHistory ?? []) {
          hist.run(new Date(h.t * 1000).toISOString().slice(0, 10), task.scryfallId, finish, condition, h.p);
        }
        found = 1;
        saved++;
      }
      mark.run(task.scryfallId, task.kind, found);
    }
  })();
  return saved;
}

/**
 * Refresh JustTCG prices for tracked cards (or specific ids), respecting the plan's
 * batch size, per-minute and daily request limits.
 */
export async function runRefresh(opts: { ids?: string[]; force?: boolean } = {}): Promise<RefreshState> {
  if (refreshState.running) return refreshState;
  if (!getJustTcgKey()) {
    refreshState.lastError = 'No JustTCG API key configured. Add it on the Settings page.';
    return refreshState;
  }
  const lim = limits();
  const queue = buildQueue(opts);
  Object.assign(refreshState, { running: true, queued: queue.length, done: 0, requests: 0, pricesSaved: 0, lastError: undefined, message: undefined });
  const gap = Math.ceil(60_000 / Math.max(1, lim.perMinute)) + 250;
  try {
    for (let i = 0; i < queue.length; i += lim.batch) {
      if (usageToday() >= lim.daily) {
        refreshState.message = `Daily JustTCG limit (${lim.daily} requests) reached. ${queue.length - i} lookups will continue tomorrow.`;
        break;
      }
      const tasks = queue.slice(i, i + lim.batch);
      if (refreshState.requests > 0) await sleep(gap);
      try {
        const result = await lookupBatch(tasks.map(t => t.lookup));
        recordUsage();
        refreshState.requests++;
        if (result.requestsRemaining != null) setSetting('justtcg_remaining', String(result.requestsRemaining));
        if (result.plan) setSetting('justtcg_plan', result.plan);
        refreshState.pricesSaved += saveBatch(tasks, result.cards);
      } catch (e: any) {
        if (e instanceof JustTcgError && e.status === 429) {
          refreshState.message = 'JustTCG rate limit hit - try again later.';
          break;
        }
        if (e instanceof JustTcgError && (e.status === 401 || e.status === 403)) throw new Error('JustTCG rejected the API key (check it on Settings).');
        throw e;
      }
      refreshState.done = Math.min(queue.length, i + tasks.length);
    }
    snapshotToday();
  } catch (e: any) {
    refreshState.lastError = e?.message ?? String(e);
    console.error('[pricing] refresh failed:', e);
  } finally {
    refreshState.running = false;
    refreshState.lastRunAt = new Date().toISOString();
    setSetting('last_price_refresh', refreshState.lastRunAt);
  }
  return refreshState;
}
