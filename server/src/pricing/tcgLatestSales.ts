/**
 * On-demand "average of the 5 most recent sales" from TCGplayer's public product page data feed.
 *
 * NOTE: this endpoint is undocumented (it is what tcgplayer.com's own "Latest Sales" panel calls).
 * It can change or be blocked at any time and automated use is a grey area under TCGplayer's terms,
 * so the app only calls it when the user clicks "Last 5 sales" on a single card.
 */
import { db } from '../db/index.js';
import type { Card, Condition, Finish } from '../scryfall/cards.js';

const CONDITION_NAMES: Record<Condition, string> = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played' };

export interface Sale {
  condition: string;
  variant: string;
  language: string;
  quantity: number;
  price: number;
  shipping: number;
  orderDate: string;
  title?: string;
}

export interface Last5Result {
  condition: Condition;
  finish: Finish;
  average: number | null;
  sales: Sale[];
}

async function fetchLatestSales(productId: number, offset = 0): Promise<Sale[]> {
  const res = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales?mpfev=3000`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://www.tcgplayer.com',
      Referer: 'https://www.tcgplayer.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 3DPrintCollectors/1.0',
    },
    body: JSON.stringify({ conditions: [], languages: [], variants: [], listingType: 'All', offset, limit: 25, time: Date.now() }),
  });
  if (!res.ok) throw new Error(`TCGplayer latest sales returned HTTP ${res.status}`);
  const json: any = await res.json();
  return (json.data ?? []).map((d: any) => ({
    condition: String(d.condition ?? ''),
    variant: String(d.variant ?? ''),
    language: String(d.language ?? ''),
    quantity: Number(d.quantity ?? 1),
    price: Number(d.purchasePrice ?? 0),
    shipping: Number(d.shippingPrice ?? 0),
    orderDate: String(d.orderDate ?? ''),
    title: d.title,
  }));
}

function variantMatches(variant: string, finish: Finish): boolean {
  const v = variant.toLowerCase();
  if (finish === 'nonfoil') return !v.includes('foil');
  return v.includes('foil');
}

/**
 * Fetches recent sales for a card and stores the average of the 5 most recent sales for each
 * condition (NM/LP/MP) of the requested finish. Returns the per-condition results.
 */
export async function refreshLast5(card: Card, finish: Finish): Promise<Last5Result[]> {
  const productId = finish === 'etched' && card.tcgplayerEtchedId ? card.tcgplayerEtchedId : card.tcgplayerId;
  if (!productId) throw new Error('This printing has no TCGplayer product ID, so sales history is unavailable.');

  // Pull up to 4 pages (100 sales) so rarer conditions still get samples.
  const all: Sale[] = [];
  for (let page = 0; page < 4; page++) {
    const sales = await fetchLatestSales(productId, page * 25);
    all.push(...sales);
    if (sales.length < 25) break;
    const enough = (['NM', 'LP', 'MP'] as Condition[]).every(c =>
      all.filter(s => s.condition === CONDITION_NAMES[c] && variantMatches(s.variant, finish)).length >= 5);
    if (enough) break;
  }
  all.sort((a, b) => Date.parse(b.orderDate) - Date.parse(a.orderDate));

  const upsert = db.prepare(`INSERT INTO prices (scryfall_id, finish, condition, source, price, sample_size, fetched_at)
    VALUES (?, ?, ?, 'tcg_last5', ?, ?, datetime('now'))
    ON CONFLICT(scryfall_id, finish, condition, source) DO UPDATE SET price=excluded.price, sample_size=excluded.sample_size, fetched_at=excluded.fetched_at`);

  const results: Last5Result[] = [];
  for (const condition of ['NM', 'LP', 'MP'] as Condition[]) {
    const sales = all
      .filter(s => s.condition === CONDITION_NAMES[condition] && variantMatches(s.variant, finish))
      .filter(s => !s.language || s.language === 'English' || card.lang !== 'en')
      .slice(0, 5);
    const average = sales.length ? Math.round((sales.reduce((t, s) => t + s.price, 0) / sales.length) * 100) / 100 : null;
    if (average != null) upsert.run(card.id, finish, condition, average, sales.length);
    results.push({ condition, finish, average, sales });
  }
  return results;
}
