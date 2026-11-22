import { getJustTcgKey } from '../config.js';
import type { Condition, Finish } from '../scryfall/cards.js';

const BASE = 'https://api.justtcg.com/v1';

export interface JustTcgLookup {
  tcgplayerId?: string;
  scryfallId?: string;
}

export interface JustTcgVariant {
  condition: string;
  printing: string;
  price: number | null;
  lastUpdated?: number;
  priceHistory?: { p: number; t: number }[];
}

export interface JustTcgCard {
  id: string;
  name: string;
  tcgplayerId: string | null;
  scryfallId: string | null;
  variants: JustTcgVariant[];
}

export interface BatchResult {
  cards: JustTcgCard[];
  requestsRemaining?: number;
  plan?: string;
}

export class JustTcgError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export async function lookupBatch(items: JustTcgLookup[]): Promise<BatchResult> {
  const key = getJustTcgKey();
  if (!key) throw new JustTcgError('No JustTCG API key configured. Add it on the Settings page.');
  const body = items.map(i => ({ ...i, game: 'magic-the-gathering' }));
  const res = await fetch(`${BASE}/cards`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    throw new JustTcgError(json?.error || json?.message || `JustTCG HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return {
    cards: (json.data ?? []) as JustTcgCard[],
    requestsRemaining: json._metadata?.apiRequestsRemaining,
    plan: json._metadata?.apiPlan,
  };
}

/** "Near Mint" / "NM" / "Near Mint Foil" -> NM. Returns null for HP/DMG/Sealed (not tracked). */
export function mapCondition(c: string): Condition | null {
  const s = c.toLowerCase().trim();
  if (s === 'nm' || s.startsWith('near mint') || s === 'mint') return 'NM';
  if (s === 'lp' || s.startsWith('lightly played')) return 'LP';
  if (s === 'mp' || s.startsWith('moderately played')) return 'MP';
  return null;
}

/** Map a JustTCG printing label to our finish. `etchedLookup` = the lookup was for the etched TCGplayer product. */
export function mapPrinting(printing: string, etchedLookup: boolean): Finish | null {
  const s = (printing || '').toLowerCase();
  if (s.includes('etched')) return 'etched';
  if (s.includes('foil')) return etchedLookup ? 'etched' : 'foil';
  if (s === 'normal' || s === '' || s.includes('non')) return etchedLookup ? null : 'nonfoil';
  return null;
}
