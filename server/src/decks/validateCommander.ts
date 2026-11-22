/**
 * Commander deck-construction validator (pure, no DB access).
 *
 * Rules implemented (WotC Commander format page + Comprehensive Rules 903, current as of 2026):
 *  - Exactly 100 cards including the commander(s). A companion sits outside the 100; maybeboard is ignored.
 *  - Commander: a legendary creature, legendary Vehicle, or legendary Spacecraft with P/T (903.3, updated with
 *    Edge of Eternities, July 2025), or any card that says "can be your commander".
 *  - Two commanders only via Partner, Partner with [name], Partner—[variant], Friends forever,
 *    Choose a Background + Background, or Doctor's companion + Time Lord Doctor.
 *  - Singleton by English card name, except basic lands and cards that allow any number / up to N copies.
 *  - Every card's color identity must be within the commanders' combined color identity.
 *  - Cards banned (or not legal) in Commander are not allowed.
 *  - Brackets: Game Changers count 0 in brackets 1-2, at most 3 in bracket 3, any number in 4-5 (advisory).
 */

export type Board = 'commander' | 'main' | 'companion' | 'maybe';

export interface DeckEntry {
  name: string;
  qty: number;
  board: Board;
  typeLine: string;
  oracleText: string;
  colorIdentity: string[];
  commanderLegality: string | null;
  gameChanger: boolean;
  power?: string | null;
  toughness?: string | null;
}

export interface Issue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  cards?: string[];
}

export interface ValidationResult {
  legal: boolean;
  count: number;
  target: number;
  commanders: string[];
  colorIdentity: string[];
  gameChangers: string[];
  minimumBracket: number;
  issues: Issue[];
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20,
};

const isLegendary = (e: DeckEntry) => /\bLegendary\b/i.test(e.typeLine);
const frontType = (e: DeckEntry) => e.typeLine.split('//')[0];

export function isCommanderEligible(e: DeckEntry): boolean {
  if (/can be your commander/i.test(e.oracleText)) return true;
  if (!isLegendary(e)) return false;
  const t = frontType(e);
  if (/\bCreature\b/.test(t)) return true;
  if (/\bVehicle\b/.test(t)) return true;
  if (/\bSpacecraft\b/.test(t) && e.power != null && e.power !== '') return true;
  return false;
}

/**
 * Can this card stand in for the deck's commander? It must be a legendary creature (front face) that is
 * legal in Commander and shares the commander's exact colour identity. Deliberately narrower than
 * isCommanderEligible: "can be your commander" planeswalkers, Vehicles and Spacecraft are not offered.
 *
 * Colour identity is not the mana cost: it is every colour the card brings to the command zone —
 * mana symbols in the cost, in the rules text (Ashling, the Limitless costs {2}{R} but its abilities
 * use all five colours, so it is a WUBRG commander), in activated abilities (Kenrith), hybrid symbols
 * (Jegantha), colour indicators, and the mana a basic land type produces (Dryad Arbor). Scryfall's
 * `color_identity` already accounts for all of that, so an exact set match is the right test.
 */
export function isAlternativeCommander(
  card: Pick<DeckEntry, 'typeLine' | 'oracleText' | 'colorIdentity' | 'commanderLegality'> & { power?: string | null },
  commanderIdentity: string[],
): boolean {
  if (card.commanderLegality === 'banned' || card.commanderLegality === 'not_legal') return false;
  const front = card.typeLine.split('//')[0];
  if (!/\bLegendary\b/.test(front) || !/\bCreature\b/.test(front)) return false;
  if (!commanderIdentity.length) return true; // no commander chosen yet — anything eligible can be short-listed
  const a = sortColors(card.colorIdentity).join('');
  return a === sortColors(commanderIdentity).join('');
}

export function isBasicLand(e: Pick<DeckEntry, 'typeLine'>): boolean {
  return /\bBasic\b/.test(e.typeLine) && /\bLand\b/.test(e.typeLine);
}

/** Max copies allowed by the card itself (Infinity for "any number"), or 1. */
export function copyLimit(e: DeckEntry): number {
  if (isBasicLand(e)) return Infinity;
  if (/A deck can have any number of cards named/i.test(e.oracleText)) return Infinity;
  const m = e.oracleText.match(/A deck can have up to (\w+) cards named/i);
  if (m) return NUMBER_WORDS[m[1].toLowerCase()] ?? (Number(m[1]) || 1);
  return 1;
}

function lines(text: string) {
  return text.split('\n').map(l => l.replace(/\s*\(.*?\)\s*$/, '').trim());
}

function partnerInfo(e: DeckEntry) {
  const ls = lines(e.oracleText);
  const partnerWith = ls.map(l => l.match(/^Partner with (.+)$/i)?.[1]).find(Boolean);
  const partnerVariant = ls.map(l => l.match(/^Partner\s*[—-]\s*(.+)$/i)?.[1]).find(Boolean);
  return {
    partner: ls.some(l => /^Partner$/i.test(l)),
    partnerWith: partnerWith?.trim(),
    partnerVariant: partnerVariant?.trim(),
    friendsForever: ls.some(l => /^Friends forever$/i.test(l)),
    chooseBackground: ls.some(l => /^Choose a Background$/i.test(l)),
    isBackground: /\bBackground\b/.test(frontType(e)),
    doctorsCompanion: ls.some(l => /^Doctor's companion$/i.test(l)),
    isTimeLordDoctor: /\bTime Lord Doctor\b/.test(frontType(e)),
  };
}

/** Returns null if the pair is legal, otherwise a reason. */
export function checkPair(a: DeckEntry, b: DeckEntry): string | null {
  const pa = partnerInfo(a), pb = partnerInfo(b);
  if (pa.partner && pb.partner) return null;
  if (pa.partnerWith || pb.partnerWith) {
    const ok = pa.partnerWith?.toLowerCase() === b.name.toLowerCase() && pb.partnerWith?.toLowerCase() === a.name.toLowerCase();
    return ok ? null : `"Partner with" only pairs with the named card (${a.name} ↔ ${pa.partnerWith ?? '—'}, ${b.name} ↔ ${pb.partnerWith ?? '—'}).`;
  }
  if (pa.partnerVariant && pb.partnerVariant) {
    return pa.partnerVariant.toLowerCase() === pb.partnerVariant.toLowerCase()
      ? null : `Partner—${pa.partnerVariant} can't pair with Partner—${pb.partnerVariant}.`;
  }
  if (pa.friendsForever && pb.friendsForever) return null;
  if ((pa.chooseBackground && pb.isBackground) || (pb.chooseBackground && pa.isBackground)) return null;
  if ((pa.doctorsCompanion && pb.isTimeLordDoctor) || (pb.doctorsCompanion && pa.isTimeLordDoctor)) return null;
  return `${a.name} and ${b.name} can't be paired as commanders (need Partner, Friends forever, Choose a Background, or Doctor's companion).`;
}

export function sortColors(cs: Iterable<string>): string[] {
  return [...new Set(cs)].sort((x, y) => COLOR_ORDER.indexOf(x) - COLOR_ORDER.indexOf(y));
}

export function validateCommanderDeck(entries: DeckEntry[], targetBracket?: number | null): ValidationResult {
  const issues: Issue[] = [];
  const commanders = entries.filter(e => e.board === 'commander');
  const main = entries.filter(e => e.board === 'main');
  const companions = entries.filter(e => e.board === 'companion');
  const inDeck = [...commanders, ...main];
  const count = inDeck.reduce((n, e) => n + e.qty, 0);

  // 1. Deck size
  if (count < 100) issues.push({ level: 'error', code: 'size', message: `Deck has ${count} / 100 cards — add ${100 - count} more.` });
  if (count > 100) issues.push({ level: 'error', code: 'size', message: `Deck has ${count} / 100 cards — remove ${count - 100}.` });

  // 2. Commander(s)
  const cmdQty = commanders.reduce((n, e) => n + e.qty, 0);
  if (cmdQty === 0) issues.push({ level: 'error', code: 'no-commander', message: 'No commander selected.' });
  if (cmdQty > 2) issues.push({ level: 'error', code: 'too-many-commanders', message: `A deck can have at most 2 commanders (has ${cmdQty}). To keep one as a backup commander, press Make optional on it.`, cards: commanders.map(c => c.name) });
  if (commanders.length === 1 && commanders[0].qty > 1) issues.push({ level: 'error', code: 'too-many-commanders', message: 'The same card cannot be both commanders.', cards: [commanders[0].name] });

  for (const c of commanders) {
    const bg = partnerInfo(c).isBackground && commanders.some(o => o !== c && partnerInfo(o).chooseBackground);
    if (!isCommanderEligible(c) && !bg) {
      issues.push({ level: 'error', code: 'ineligible-commander', message: `${c.name} can't be a commander — it must be a legendary creature, legendary Vehicle, legendary Spacecraft with power/toughness, or say "can be your commander".`, cards: [c.name] });
    }
  }
  if (commanders.length === 2) {
    const reason = checkPair(commanders[0], commanders[1]);
    if (reason) issues.push({ level: 'error', code: 'bad-pair', message: `${reason} To keep one as a backup commander, press Make optional on it.`, cards: commanders.map(c => c.name) });
  }

  // 3. Color identity
  const identity = sortColors(commanders.flatMap(c => c.colorIdentity));
  if (commanders.length) {
    const offColor = [...main, ...companions].filter(e => e.colorIdentity.some(col => !identity.includes(col)));
    if (offColor.length) {
      issues.push({ level: 'error', code: 'color-identity', message: `${offColor.length} card(s) are outside the commander's color identity (${identity.join('') || 'colorless'}).`, cards: offColor.map(e => e.name) });
    }
  }

  // 4. Banned / not legal
  const banned = [...inDeck, ...companions].filter(e => e.commanderLegality === 'banned');
  if (banned.length) issues.push({ level: 'error', code: 'banned', message: `Banned in Commander: ${banned.map(e => e.name).join(', ')}.`, cards: banned.map(e => e.name) });
  const notLegal = [...inDeck, ...companions].filter(e => e.commanderLegality === 'not_legal');
  if (notLegal.length) issues.push({ level: 'error', code: 'not-legal', message: `Not legal in Commander: ${notLegal.map(e => e.name).join(', ')}.`, cards: notLegal.map(e => e.name) });

  // 5. Singleton
  const byName = new Map<string, { entry: DeckEntry; qty: number }>();
  for (const e of inDeck) {
    const key = e.name.toLowerCase();
    const cur = byName.get(key);
    byName.set(key, { entry: cur?.entry ?? e, qty: (cur?.qty ?? 0) + e.qty });
  }
  const dupes: string[] = [];
  for (const { entry, qty } of byName.values()) {
    const lim = copyLimit(entry);
    if (qty > lim) dupes.push(lim === 1 ? `${entry.name} ×${qty}` : `${entry.name} ×${qty} (max ${lim})`);
  }
  if (dupes.length) issues.push({ level: 'error', code: 'singleton', message: `Only one copy of each card is allowed (except basic lands): ${dupes.join(', ')}.`, cards: dupes.map(d => d.replace(/ ×.*$/, '')) });

  // 6. Companion
  const compQty = companions.reduce((n, e) => n + e.qty, 0);
  if (compQty > 1) issues.push({ level: 'error', code: 'companion', message: 'Only one companion is allowed.', cards: companions.map(c => c.name) });
  if (compQty === 1) issues.push({ level: 'info', code: 'companion', message: `Companion ${companions[0].name} sits outside the 100 — check its deck-building condition yourself.` });

  // 7. Brackets / Game Changers
  const gameChangers = inDeck.filter(e => e.gameChanger).map(e => e.name);
  const minimumBracket = gameChangers.length === 0 ? 1 : gameChangers.length <= 3 ? 3 : 4;
  if (targetBracket) {
    if (targetBracket <= 2 && gameChangers.length > 0) {
      issues.push({ level: 'warning', code: 'bracket', message: `Bracket ${targetBracket} allows no Game Changers — this deck has ${gameChangers.length}.`, cards: gameChangers });
    } else if (targetBracket === 3 && gameChangers.length > 3) {
      issues.push({ level: 'warning', code: 'bracket', message: `Bracket 3 allows up to 3 Game Changers — this deck has ${gameChangers.length}.`, cards: gameChangers });
    }
  }

  return {
    legal: !issues.some(i => i.level === 'error'),
    count,
    target: 100,
    commanders: commanders.map(c => c.name),
    colorIdentity: identity,
    gameChangers,
    minimumBracket,
    issues,
  };
}
