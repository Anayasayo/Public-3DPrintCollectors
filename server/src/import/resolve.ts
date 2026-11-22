import { db } from '../db/index.js';
import { toCard, defaultFinish, type Card, type CardRow, type Condition, type Finish } from '../scryfall/cards.js';
import type { ParsedRow } from './types.js';

export type ResolveStatus = 'resolved' | 'ambiguous' | 'unresolved' | 'flagged';

export interface BriefCard {
  id: string; name: string; set: string; setName: string; number: string; image: string | null;
  styles: string[]; finishes: Finish[]; releasedAt: string; lang: string;
}

export interface ResolvedRow {
  line: number;
  raw: string;
  qty: number;
  status: ResolveStatus;
  matchedBy?: 'scryfall_id' | 'set_number' | 'tcgplayer_id' | 'name_set' | 'name';
  scryfallId?: string;
  card?: BriefCard;
  candidates?: BriefCard[];
  finish: Finish;
  condition: Condition;
  originalCondition?: string;
  board?: string | null;
  altCommander?: boolean;
  binder?: string;
  deck?: string;
  purchasePrice?: number | null;
  notes?: string;
  issues: string[];
}

const brief = (c: Card): BriefCard => ({
  id: c.id, name: c.name, set: c.set, setName: c.setName, number: c.number, image: c.imageSmall,
  styles: c.styles, finishes: c.finishes, releasedAt: c.releasedAt, lang: c.lang,
});

/** Set types that are unusual picks when a list only gives a card name. */
const SET_TYPE_PENALTY: Record<string, number> = {
  memorabilia: 12, funny: 12, token: 12, minigame: 12, vanguard: 12,
  promo: 6, box: 6, from_the_vault: 6, masterpiece: 6, arsenal: 6,
};

let setTypes: Map<string, string> | null = null;
function setTypeOf(code: string): string {
  if (!setTypes) setTypes = new Map((db.prepare('SELECT code, set_type FROM sets').all() as any[]).map(r => [r.code, r.set_type]));
  return setTypes.get(code) ?? '';
}

/** Newest ordinary printing: prefer plain treatments, normal sets, the requested finish and English. */
export function pickDefaultPrinting(cards: Card[], preferFoil = false): Card | undefined {
  const score = (c: Card) =>
    (c.styles.length === 0 ? 0 : 4) + (c.finishes.includes(preferFoil ? 'foil' : 'nonfoil') ? 0 : 2)
    + (c.lang === 'en' ? 0 : 8) + (SET_TYPE_PENALTY[setTypeOf(c.set)] ?? 0);
  return [...cards].sort((a, b) => score(a) - score(b) || b.releasedAt.localeCompare(a.releasedAt))[0];
}

function byName(name: string): Card[] {
  const n = name.trim();
  let rows = db.prepare('SELECT * FROM cards WHERE name = ? COLLATE NOCASE ORDER BY released_at DESC').all(n) as CardRow[];
  if (!rows.length) rows = db.prepare('SELECT * FROM cards WHERE front_name = ? COLLATE NOCASE ORDER BY released_at DESC').all(n.split(/\s*\/\/?\s*/)[0]) as CardRow[];
  if (!rows.length && n.includes('/') && !n.includes('//')) {
    rows = db.prepare('SELECT * FROM cards WHERE name = ? COLLATE NOCASE ORDER BY released_at DESC').all(n.replace(/\s*\/\s*/, ' // ')) as CardRow[];
  }
  return rows.map(toCard);
}

function suggestions(name: string): Card[] {
  const words = name.replace(/[^\w\s',-]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  if (!words.length) return [];
  const where = words.map(() => 'name LIKE ?').join(' AND ');
  const rows = db.prepare(`SELECT * FROM cards WHERE ${where} GROUP BY name ORDER BY length(name) LIMIT 6`).all(...words.map(w => `%${w}%`)) as CardRow[];
  return rows.map(toCard);
}

function bySetNumber(set: string, number: string): Card | undefined {
  const r = db.prepare('SELECT * FROM cards WHERE set_code = ? AND collector_number = ?').get(set.toLowerCase(), number) as CardRow | undefined
    ?? db.prepare('SELECT * FROM cards WHERE set_code = ? AND collector_number = ?').get(set.toLowerCase(), number.replace(/^0+/, '')) as CardRow | undefined;
  return r ? toCard(r) : undefined;
}

function setCodeFromName(setName: string): string[] {
  return (db.prepare('SELECT code FROM sets WHERE name = ? COLLATE NOCASE').all(setName.trim()) as { code: string }[]).map(r => r.code);
}

export function resolveRow(p: ParsedRow, opts: { defaultCondition?: Condition } = {}): ResolvedRow {
  const issues: string[] = [];
  let status: ResolveStatus = 'resolved';
  let card: Card | undefined;
  let candidates: Card[] | undefined;
  let matchedBy: ResolvedRow['matchedBy'];
  let finish = p.finish ?? undefined;

  if (p.scryfallId) {
    const r = db.prepare('SELECT * FROM cards WHERE id = ?').get(p.scryfallId) as CardRow | undefined;
    if (r) { card = toCard(r); matchedBy = 'scryfall_id'; }
  }
  if (!card && p.setCode && p.number) {
    const hit = bySetNumber(p.setCode, p.number);
    // The set/number pair wins only when it agrees with the name on the line — lists are often
    // written with the wrong collector number, and matching a different card silently is worse.
    const nameMatches = (c: Card) => {
      if (!p.name) return true;
      const want = p.name.toLowerCase().trim();
      const full = c.name.toLowerCase();
      return full === want || full.split(' // ')[0] === want || full.replace(/\s*\/\/\s*/g, ' // ') === want.replace(/\s*\/\/?\s*/g, ' // ');
    };
    if (hit && nameMatches(hit)) { card = hit; matchedBy = 'set_number'; }
    else if (hit) issues.push(`${p.setCode.toUpperCase()} #${p.number} is ${hit.name}, not "${p.name}" — matched by name instead.`);
  }
  if (!card && p.tcgplayerId) {
    const r = db.prepare('SELECT * FROM cards WHERE tcgplayer_id = ? OR tcgplayer_etched_id = ?').get(p.tcgplayerId, p.tcgplayerId) as CardRow | undefined;
    if (r) {
      card = toCard(r); matchedBy = 'tcgplayer_id';
      if (r.tcgplayer_etched_id === p.tcgplayerId) finish = 'etched';
    }
  }
  if (!card && p.name) {
    const all = byName(p.name);
    let pool = all;
    const codes = [p.setCode, ...(p.setName ? setCodeFromName(p.setName) : [])].filter(Boolean) as string[];
    if (codes.length) {
      const inSet = all.filter(c => codes.includes(c.set));
      if (inSet.length) pool = inSet;
      else issues.push(`Set "${p.setCode ?? p.setName}" not found for this card — showing all printings.`);
      if (p.number) {
        const exact = pool.find(c => c.number === p.number);
        if (exact) pool = [exact];
      }
    }
    if (pool.length === 1) { card = pool[0]; matchedBy = codes.length ? 'name_set' : 'name'; if (!codes.length && all.length === 1) status = 'resolved'; }
    else if (pool.length > 1) {
      candidates = pool;
      card = pickDefaultPrinting(pool, finish === 'foil');
      matchedBy = codes.length ? 'name_set' : 'name';
      status = 'ambiguous';
      issues.push(`${pool.length} printings match — defaulted to ${card!.set.toUpperCase()} #${card!.number}. Pick the exact one if different.`);
    }
  }
  if (!card) {
    status = 'unresolved';
    const sugg = p.name ? suggestions(p.name) : [];
    issues.push(p.name ? `No card named "${p.name}" found.` : 'Row has no card name or ID.');
    return {
      line: p.line, raw: p.raw, qty: p.qty, status, candidates: sugg.map(brief), finish: finish ?? 'nonfoil',
      condition: opts.defaultCondition ?? 'NM', board: p.board, altCommander: p.altCommander, binder: p.binder, deck: p.deck, issues,
    };
  }

  // Finish must exist for the printing
  if (!finish) finish = defaultFinish(card);
  else if (!card.finishes.includes(finish)) {
    const fallback = defaultFinish(card, finish !== 'nonfoil');
    issues.push(`${card.set.toUpperCase()} #${card.number} doesn't come in ${finish}; using ${fallback}.`);
    finish = fallback;
  }

  // Condition: only NM/LP/MP are tracked; HP/DMG get flagged for review.
  let condition: Condition = opts.defaultCondition ?? 'NM';
  if (p.condition === 'HP' || p.condition === 'DMG') {
    status = 'flagged';
    condition = 'MP';
    issues.push(`Condition "${p.conditionRaw ?? p.condition}" isn't tracked (TCGplayer NM/LP/MP only). Choose MP, skip, or send to Misc.`);
  } else if (p.condition) condition = p.condition;
  else if (p.conditionRaw) issues.push(`Unknown condition "${p.conditionRaw}" — using ${condition}.`);

  return {
    line: p.line, raw: p.raw, qty: p.qty, status, matchedBy, scryfallId: card.id, card: brief(card),
    candidates: candidates?.map(brief), finish, condition, originalCondition: p.conditionRaw, board: p.board, altCommander: p.altCommander,
    binder: p.binder, deck: p.deck, purchasePrice: p.purchasePrice, notes: p.notes, issues,
  };
}
