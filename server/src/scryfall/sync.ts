import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { db, setSetting, getSetting } from '../db/index.js';
import { USER_AGENT } from '../config.js';

const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

export interface SyncState {
  running: boolean;
  phase: string;
  processed: number;
  error?: string;
  finishedAt?: string;
}

export const syncState: SyncState = { running: false, phase: 'idle', processed: 0 };

const COLS = [
  'id', 'oracle_id', 'name', 'front_name', 'lang', 'set_code', 'set_name', 'collector_number', 'rarity', 'released_at',
  'layout', 'finishes', 'border_color', 'frame', 'frame_effects', 'full_art', 'promo', 'promo_types', 'variation',
  'type_line', 'mana_cost', 'cmc', 'power', 'toughness', 'colors', 'color_identity', 'oracle_text', 'keywords',
  'commander_legality', 'game_changer', 'tcgplayer_id', 'tcgplayer_etched_id', 'image_small', 'image_normal', 'image_back',
  'scryfall_usd', 'scryfall_usd_foil', 'scryfall_usd_etched',
];

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

/** Map a Scryfall card object to a `cards` row (array in COLS order). Returns null for cards we skip. */
export function mapScryfallCard(c: any): unknown[] | null {
  if (c.digital || c.layout === 'art_series') return null;
  const faces: any[] = c.card_faces ?? [];
  const f0 = faces[0] ?? {};
  const f1 = faces[1] ?? {};
  const oracle = c.oracle_text ?? (faces.length ? faces.map(f => f.oracle_text ?? '').join('\n//\n') : null);
  return [
    c.id, c.oracle_id ?? f0.oracle_id ?? null, c.name, f0.name ?? c.name, c.lang ?? 'en', c.set, c.set_name, c.collector_number,
    c.rarity, c.released_at, c.layout,
    JSON.stringify(c.finishes ?? []), c.border_color, c.frame, JSON.stringify(c.frame_effects ?? []),
    c.full_art ? 1 : 0, c.promo ? 1 : 0, JSON.stringify(c.promo_types ?? []), c.variation ? 1 : 0,
    c.type_line ?? f0.type_line ?? null, c.mana_cost ?? f0.mana_cost ?? null, c.cmc ?? 0,
    c.power ?? f0.power ?? null, c.toughness ?? f0.toughness ?? null,
    JSON.stringify(c.colors ?? f0.colors ?? []), JSON.stringify(c.color_identity ?? []), oracle,
    JSON.stringify(c.keywords ?? []), c.legalities?.commander ?? null, c.game_changer ? 1 : 0,
    c.tcgplayer_id ?? null, c.tcgplayer_etched_id ?? null,
    c.image_uris?.small ?? f0.image_uris?.small ?? null,
    c.image_uris?.normal ?? f0.image_uris?.normal ?? null,
    c.image_uris ? null : f1.image_uris?.normal ?? null,
    num(c.prices?.usd), num(c.prices?.usd_foil), num(c.prices?.usd_etched),
  ];
}

function upsertStatement() {
  const updates = COLS.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(',');
  return db.prepare(`INSERT INTO cards (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${updates}`);
}

export async function syncSets() {
  const res = await fetch('https://api.scryfall.com/sets', { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall sets: HTTP ${res.status}`);
  const json: any = await res.json();
  const stmt = db.prepare(`INSERT INTO sets (code, name, set_type, released_at, card_count, icon_svg_uri, parent_set_code)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, set_type=excluded.set_type,
    released_at=excluded.released_at, card_count=excluded.card_count, icon_svg_uri=excluded.icon_svg_uri, parent_set_code=excluded.parent_set_code`);
  db.transaction(() => {
    for (const s of json.data) {
      if (s.digital) continue;
      stmt.run(s.code, s.name, s.set_type, s.released_at ?? null, s.card_count ?? 0, s.icon_svg_uri ?? null, s.parent_set_code ?? null);
    }
  })();
}

async function fetchBulkIndex(): Promise<any> {
  const res = await fetch('https://api.scryfall.com/bulk-data/default-cards', { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall bulk index: HTTP ${res.status}`);
  return res.json();
}

/** Downloads Scryfall's default_cards bulk file (gzipped JSONL) and upserts every paper card. */
export async function syncCatalog(prefetchedIndex?: any): Promise<void> {
  if (syncState.running) return;
  Object.assign(syncState, { running: true, phase: 'Fetching bulk data index', processed: 0, error: undefined });
  try {
    await syncSets();
    const idx: any = prefetchedIndex ?? await fetchBulkIndex();
    const url: string = idx.jsonl_download_uri ?? idx.download_uri;
    syncState.phase = 'Downloading card catalog';
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`Scryfall bulk download: HTTP ${res.status}`);

    let input: NodeJS.ReadableStream = Readable.fromWeb(res.body as any);
    if (url.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    const stmt = upsertStatement();
    const insertMany = db.transaction((rows: unknown[][]) => { for (const r of rows) stmt.run(...r); });
    let batch: unknown[][] = [];
    syncState.phase = 'Importing cards';
    for await (let line of rl) {
      line = line.trim();
      if (!line || line === '[' || line === ']') continue;
      if (line.endsWith(',')) line = line.slice(0, -1);
      const row = mapScryfallCard(JSON.parse(line));
      if (!row) continue;
      batch.push(row);
      if (batch.length >= 2000) {
        insertMany(batch);
        syncState.processed += batch.length;
        batch = [];
      }
    }
    if (batch.length) { insertMany(batch); syncState.processed += batch.length; }
    syncState.phase = 'done';
    syncState.finishedAt = new Date().toISOString();
    setSetting('catalog_synced_at', syncState.finishedAt);
    if (idx.updated_at) setSetting('catalog_bulk_updated_at', idx.updated_at);
  } catch (e: any) {
    syncState.error = e?.message ?? String(e);
    syncState.phase = 'error';
    console.error('[catalog] sync failed:', e);
  } finally {
    syncState.running = false;
  }
}

let lastCheckAt = 0;
const CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Asks Scryfall (one small request) whether a newer bulk file exists than the one we last imported,
 * and re-imports if so. Scryfall regenerates the file daily, so new sets show up within a day of
 * being added there. Throttled so page reloads don't hammer the API; offline failures are ignored.
 */
export async function checkForCatalogUpdate(force = false): Promise<void> {
  if (syncState.running || (!force && Date.now() - lastCheckAt < CHECK_INTERVAL_MS)) return;
  lastCheckAt = Date.now();
  try {
    const idx = await fetchBulkIndex();
    const empty = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as any).n === 0;
    const imported = getSetting('catalog_bulk_updated_at');
    if (empty || !imported || Date.parse(idx.updated_at) > Date.parse(imported)) await syncCatalog(idx);
  } catch (e) {
    console.error('[catalog] update check failed:', (e as Error)?.message ?? e);
  }
}
