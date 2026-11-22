import { db, getSetting } from '../db/index.js';

/** Whether to fall back to Scryfall's TCGplayer market price when JustTCG has no price for a printing/condition. */
export function useMarketFallback(): boolean {
  return getSetting('market_fallback') !== '0';
}

/**
 * SQL fragments that price rows of a table alias `t` having scryfall_id/finish/condition columns.
 * Requires the query to also join `cards c ON c.id = t.scryfall_id`.
 */
export function priceSql(t: string) {
  const fb = useMarketFallback()
    ? `(CASE ${t}.finish WHEN 'foil' THEN c.scryfall_usd_foil WHEN 'etched' THEN c.scryfall_usd_etched ELSE c.scryfall_usd END)`
    : 'NULL';
  return {
    join: `LEFT JOIN current_prices cp ON cp.scryfall_id = ${t}.scryfall_id AND cp.finish = ${t}.finish AND cp.condition = ${t}.condition`,
    price: `COALESCE(cp.price, ${fb})`,
    source: `CASE WHEN cp.price IS NOT NULL THEN cp.source WHEN ${fb} IS NOT NULL THEN 'scryfall_market' END`,
    fetchedAt: 'cp.fetched_at',
  };
}

export interface ValueSummary {
  total: number;
  cards: number;
  entries: number;
  unpriced: number;
}

export function collectionSummary(where = '1=1', params: unknown[] = []): ValueSummary {
  const p = priceSql('ci');
  const row = db.prepare(`SELECT COALESCE(SUM(ci.qty * ${p.price}), 0) AS total, COALESCE(SUM(ci.qty), 0) AS cards,
      COUNT(*) AS entries, SUM(CASE WHEN ${p.price} IS NULL THEN 1 ELSE 0 END) AS unpriced
    FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id ${p.join} WHERE ${where}`).get(...params) as any;
  return { total: round(row.total), cards: row.cards, entries: row.entries, unpriced: row.unpriced ?? 0 };
}

export function round(n: number) {
  return Math.round((n ?? 0) * 100) / 100;
}

/** All NM/LP/MP prices for a set of printings: key `${id}|${finish}|${condition}`. */
export function pricesForCards(ids: string[]): Record<string, { price: number; source: string; fetchedAt: string }> {
  const out: Record<string, { price: number; source: string; fetchedAt: string }> = {};
  if (!ids.length) return out;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = db.prepare(`SELECT * FROM current_prices WHERE scryfall_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as any[];
    for (const r of rows) out[`${r.scryfall_id}|${r.finish}|${r.condition}`] = { price: r.price, source: r.source, fetchedAt: r.fetched_at };
  }
  return out;
}

/** Record today's price for every tracked printing plus today's collection total. */
export function snapshotToday() {
  const today = new Date().toISOString().slice(0, 10);
  db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO price_history (date, scryfall_id, finish, condition, price)
      SELECT ?, scryfall_id, finish, condition, price FROM current_prices WHERE price IS NOT NULL`).run(today);
    const s = collectionSummary();
    db.prepare('INSERT OR REPLACE INTO value_history (date, total, card_count) VALUES (?, ?, ?)').run(today, s.total, s.cards);
  })();
}
