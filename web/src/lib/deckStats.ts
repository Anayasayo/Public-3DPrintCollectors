import type { Board, Card } from './api';

/** A deck row as the deck page receives it. */
export interface DeckCard { id: number; qty: number; board: Board; price: number | null; card: Card }

export const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G', 'M', 'C'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export const COLOR_NAME: Record<ColorKey, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolor', C: 'Colorless' };
export const COLOR_FILL: Record<ColorKey, string> = {
  W: '#f3d772', U: '#5b8def', B: '#9b8cc4', R: '#ea6a5f', G: '#58c27d', M: '#d0b27a', C: '#c3c7d1',
};

export const TYPES = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'] as const;
export type TypeKey = (typeof TYPES)[number];
export const TYPE_PLURAL: Record<TypeKey, string> = {
  Creature: 'Creatures', Planeswalker: 'Planeswalkers', Battle: 'Battles', Instant: 'Instants', Sorcery: 'Sorceries',
  Artifact: 'Artifacts', Enchantment: 'Enchantments', Land: 'Lands', Other: 'Other',
};
export const TYPE_FILL: Record<TypeKey, string> = {
  Creature: '#ea6a5f', Planeswalker: '#b18cf0', Battle: '#f0a35e', Instant: '#5b8def', Sorcery: '#58c27d',
  Artifact: '#c3c7d1', Enchantment: '#f3d772', Land: '#5d6477', Other: '#8b93a7',
};

export const CURVE_BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

/** Name + copies of one card inside a stat bucket, for tooltips and lists. */
export interface Entry { id: number; cardId: string; name: string; qty: number; image: string | null }

const front = (s: string) => s.split('//')[0].trim();

export function colorKey(card: Card): ColorKey {
  const c = card.colors.filter(x => 'WUBRG'.includes(x));
  return c.length > 1 ? 'M' : ((c[0] as ColorKey) ?? 'C');
}

export function typeKey(card: Card): TypeKey {
  const f = front(card.typeLine);
  if (/\bLand\b/.test(f)) return 'Land';
  return TYPES.find(t => new RegExp(`\\b${t}\\b`).test(f)) ?? 'Other';
}

// Reminder text in parentheses explains keywords and tokens; it isn't what the card itself does.
const stripReminder = (s: string) => s.replace(/\([^)]*\)/g, '');

const BASIC_TYPES: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** Which colors of mana a card can make: basic land types, "Add {X}" abilities, and "any color" (read as the deck's colors). */
export function producedColors(card: Card, deckColors: string[]): Set<string> {
  const out = new Set<string>();
  const f = front(card.typeLine);
  for (const [t, c] of Object.entries(BASIC_TYPES)) if (new RegExp(`\\b${t}\\b`).test(f)) out.add(c);
  const text = stripReminder(card.oracleText.split('//')[0]);
  for (const m of text.matchAll(/\badd\b([^.]*)/gi)) {
    const clause = m[1];
    for (const s of clause.matchAll(/\{([WUBRGC])\}/g)) out.add(s[1]);
    if (/any (?:one )?colou?r|any combination of colou?rs|mana of any type/i.test(clause)) deckColors.forEach(c => out.add(c));
  }
  return out;
}

const NUMBER_WORDS = /^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|that many|a number of|twice that many|an additional|additional|\d+)\s+/i;
const COLOR_WORDS = /\b(?:white|blue|black|red|green|colorless|and)\b/gi;

/** Names of the tokens a card's own text creates ("1/1 Soldier", "Treasure", "Copy"). Best effort from the rules text. */
export function tokensMade(card: Card): string[] {
  const text = stripReminder(card.oracleText);
  const found = new Set<string>();
  for (const m of text.matchAll(/\bcreates?\s+(.{0,90}?)\btokens?\b( that(?:'s| are) (?:a )?cop)?/gi)) {
    let p = m[1].trim();
    if (m[2] || /\bcop(?:y|ies)\b/i.test(p)) { found.add('Copy'); continue; }
    p = p.replace(NUMBER_WORDS, '').replace(/^(?:tapped|untapped|attacking|legendary|snow)\s+/gi, '').replace(/^(?:tapped and attacking)\s+/i, '');
    const pt = p.match(/\b(\d+|X)\/(\d+|X)\b/);
    if (pt) {
      const kinds = p.slice(p.indexOf(pt[0]) + pt[0].length).replace(COLOR_WORDS, '').replace(/\b(?:artifact|enchantment|creature)\b/gi, '').trim().replace(/\s+/g, ' ');
      found.add(`${pt[0]}${kinds ? ` ${kinds}` : ''}`);
    } else {
      const name = p.replace(COLOR_WORDS, '').replace(/\s+/g, ' ').trim();
      if (name && name.split(' ').length <= 3 && /^[A-Z]/.test(name)) found.add(name);
    }
  }
  return [...found];
}

function subtypes(card: Card): string[] {
  const f = front(card.typeLine);
  const i = f.indexOf('—');
  return i < 0 ? [] : f.slice(i + 1).trim().split(/\s+/).filter(Boolean);
}

const entry = (c: DeckCard): Entry => ({ id: c.id, cardId: c.card.id, name: c.card.name, qty: c.qty, image: c.card.imageSmall ?? c.card.image });

function add<K extends string>(m: Record<K, Entry[]>, k: K, c: DeckCard) { (m[k] ??= [] as Entry[]).push(entry(c)); }
export const sumQty = (list: Entry[] = []) => list.reduce((n, e) => n + e.qty, 0);

export function computeDeckStats(cards: DeckCard[], deckColors: string[]) {
  // The deck proper: commander(s) + the 99. The maybeboard and companion sit outside it.
  const deck = cards.filter(c => c.board === 'commander' || c.board === 'main');
  const count = sumQty(deck.map(entry));

  const curve = CURVE_BUCKETS.map(b => ({ bucket: b, byColor: {} as Record<ColorKey, Entry[]>, byType: {} as Record<TypeKey, Entry[]>, cards: [] as Entry[] }));
  const byType = {} as Record<TypeKey, Entry[]>;
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  const production = {} as Record<string, Entry[]>;
  const subtypeMap = new Map<string, number>();
  const tokens = new Map<string, Entry[]>();
  let spells = 0, manaTotal = 0, withSubtypes = 0;

  for (const c of deck) {
    const t = typeKey(c.card);
    add(byType, t, c);
    if (t !== 'Land') {
      const b = c.card.cmc >= 7 ? 7 : Math.max(0, Math.floor(c.card.cmc));
      const bar = curve[b];
      bar.cards.push(entry(c));
      add(bar.byColor, colorKey(c.card), c);
      add(bar.byType, t, c);
      spells += c.qty;
      manaTotal += c.card.cmc * c.qty;
    }
    for (const m of front(c.card.manaCost).matchAll(/\{([^}]+)\}/g)) {
      const sym = m[1];
      if (/^\d+$/.test(sym)) pips.generic += Number(sym) * c.qty;
      else for (const part of sym.split('/')) if (part in pips) pips[part] += c.qty;
    }
    for (const col of producedColors(c.card, deckColors)) add(production, col, c);
    const subs = t === 'Land' ? [] : subtypes(c.card); // skip Island, Plains… like ManaBox
    if (subs.length) withSubtypes += c.qty;
    for (const s of subs) subtypeMap.set(s, (subtypeMap.get(s) ?? 0) + c.qty);
    for (const tok of tokensMade(c.card)) tokens.set(tok, [...(tokens.get(tok) ?? []), entry(c)]);
  }

  const priced = cards.filter(c => c.board !== 'maybe');
  const value = priced.reduce((t, c) => t + (c.price ?? 0) * c.qty, 0);
  const valueByType = TYPES.map(t => ({
    type: t,
    value: priced.filter(c => typeKey(c.card) === t).reduce((s, c) => s + (c.price ?? 0) * c.qty, 0),
  })).filter(v => v.value > 0).sort((a, b) => b.value - a.value);
  const priciest = [...priced].filter(c => c.price).sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, 8)
    .map(c => ({ ...entry(c), price: c.price as number }));

  return {
    count, spells, manaTotal,
    averageCmc: spells ? manaTotal / spells : 0,
    lands: sumQty(byType.Land),
    curve, byType, pips, production,
    subtypes: [...subtypeMap.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n, pct: withSubtypes ? n / withSubtypes : 0 })),
    tokens: [...tokens.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, from]) => ({ name, from })),
    value, valueByType, priciest,
    unpriced: priced.filter(c => c.price == null).length,
  };
}

export type DeckStatsData = ReturnType<typeof computeDeckStats>;
