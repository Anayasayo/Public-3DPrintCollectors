import { db } from '../db/index.js';
import { getCards, type Card, type Condition, type Finish } from '../scryfall/cards.js';
import { priceSql, round } from '../pricing/valuation.js';
import { isAlternativeCommander, validateCommanderDeck, type Board, type DeckEntry } from './validateCommander.js';

export interface DeckCardInput {
  scryfallId: string;
  altCommander?: boolean;
  finish: Finish;
  condition: Condition;
  qty: number;
  board?: Board;
}

interface DeckRow { id: number; name: string; status: 'draft' | 'in_collection'; target_bracket: number | null; notes: string | null; binder_id: number | null; created_at: string; updated_at: string }
interface DeckCardRow { id: number; deck_id: number; scryfall_id: string; finish: Finish; condition: Condition; qty: number; board: Board; alt_commander: number }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function deckRow(id: number): DeckRow {
  const d = db.prepare('SELECT * FROM decks WHERE id = ?').get(id) as DeckRow | undefined;
  if (!d) throw new HttpError(404, 'Deck not found');
  return d;
}

const touch = (id: number) => db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(id);

function logChange(deck: DeckRow, c: {
  action: 'add' | 'remove' | 'change'; board: Board; qty: number;
  before?: { scryfall_id: string; finish: string; condition: string };
  after?: { scryfall_id: string; finish: string; condition: string };
  tracked?: boolean;
}) {
  const tracked = c.tracked ?? (deck.status === 'in_collection' && c.board !== 'maybe');
  db.prepare(`INSERT INTO deck_changes (deck_id, action, board, qty, before_scryfall_id, before_finish, before_condition,
      after_scryfall_id, after_finish, after_condition, tracked, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, ${tracked ? 'NULL' : "datetime('now')"})`)
    .run(deck.id, c.action, c.board, c.qty, c.before?.scryfall_id ?? null, c.before?.finish ?? null, c.before?.condition ?? null,
      c.after?.scryfall_id ?? null, c.after?.finish ?? null, c.after?.condition ?? null, tracked ? 1 : 0);
}

function assertPrinting(scryfallId: string, finish: Finish) {
  const card = getCards([scryfallId]).get(scryfallId);
  if (!card) throw new HttpError(400, `Unknown card ${scryfallId}`);
  if (!card.finishes.includes(finish)) throw new HttpError(400, `${card.name} (${card.set.toUpperCase()} #${card.number}) doesn't come in ${finish}.`);
  return card;
}

export function createDeck(name: string, targetBracket?: number | null, notes?: string): number {
  const r = db.prepare('INSERT INTO decks (name, target_bracket, notes) VALUES (?, ?, ?)').run(name.trim() || 'Untitled deck', targetBracket ?? null, notes ?? null);
  return Number(r.lastInsertRowid);
}

export function updateDeckMeta(id: number, patch: { name?: string; targetBracket?: number | null; notes?: string | null }) {
  const d = deckRow(id);
  db.prepare('UPDATE decks SET name = ?, target_bracket = ?, notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(patch.name ?? d.name, patch.targetBracket === undefined ? d.target_bracket : patch.targetBracket, patch.notes === undefined ? d.notes : patch.notes, id);
  if (patch.name && d.binder_id) db.prepare('UPDATE binders SET name = ? WHERE id = ?').run(uniqueBinderName(`Deck: ${patch.name}`, d.binder_id), d.binder_id);
}

export function addDeckCard(deckId: number, input: DeckCardInput, opts: { log?: boolean } = {}) {
  const deck = deckRow(deckId);
  assertPrinting(input.scryfallId, input.finish);
  const board = input.board ?? 'main';
  const alt = input.altCommander && board === 'main' ? 1 : 0;
  const existing = db.prepare('SELECT * FROM deck_cards WHERE deck_id = ? AND scryfall_id = ? AND finish = ? AND condition = ? AND board = ? AND alt_commander = ?')
    .get(deckId, input.scryfallId, input.finish, input.condition, board, alt) as DeckCardRow | undefined;
  if (existing) db.prepare('UPDATE deck_cards SET qty = qty + ? WHERE id = ?').run(input.qty, existing.id);
  else db.prepare('INSERT INTO deck_cards (deck_id, scryfall_id, finish, condition, qty, board, alt_commander) VALUES (?,?,?,?,?,?,?)')
    .run(deckId, input.scryfallId, input.finish, input.condition, input.qty, board, alt);
  if (opts.log !== false) logChange(deck, { action: 'add', board, qty: input.qty, after: { scryfall_id: input.scryfallId, finish: input.finish, condition: input.condition } });
  touch(deckId);
}

export function removeDeckCard(deckId: number, deckCardId: number, qty?: number) {
  const deck = deckRow(deckId);
  const row = db.prepare('SELECT * FROM deck_cards WHERE id = ? AND deck_id = ?').get(deckCardId, deckId) as DeckCardRow | undefined;
  if (!row) throw new HttpError(404, 'Card not in deck');
  const n = Math.min(qty ?? row.qty, row.qty);
  if (n >= row.qty) db.prepare('DELETE FROM deck_cards WHERE id = ?').run(row.id);
  else db.prepare('UPDATE deck_cards SET qty = qty - ? WHERE id = ?').run(n, row.id);
  logChange(deck, { action: 'remove', board: row.board, qty: n, before: row });
  touch(deckId);
}

/** Change printing / finish / condition / board of a deck row (optionally only `qty` copies of it). */
export function changeDeckCard(deckId: number, deckCardId: number, patch: Partial<DeckCardInput>) {
  const deck = deckRow(deckId);
  const row = db.prepare('SELECT * FROM deck_cards WHERE id = ? AND deck_id = ?').get(deckCardId, deckId) as DeckCardRow | undefined;
  if (!row) throw new HttpError(404, 'Card not in deck');
  const after = {
    scryfall_id: patch.scryfallId ?? row.scryfall_id,
    finish: patch.finish ?? row.finish,
    condition: patch.condition ?? row.condition,
    board: patch.board ?? row.board,
  };
  assertPrinting(after.scryfall_id, after.finish);
  const n = Math.min(patch.qty ?? row.qty, row.qty);
  db.transaction(() => {
    if (n >= row.qty) db.prepare('DELETE FROM deck_cards WHERE id = ?').run(row.id);
    else db.prepare('UPDATE deck_cards SET qty = qty - ? WHERE id = ?').run(n, row.id);
    addDeckCard(deckId, {
      scryfallId: after.scryfall_id, finish: after.finish, condition: after.condition, qty: n, board: after.board,
      altCommander: patch.altCommander ?? !!row.alt_commander,
    }, { log: false });
    const physical = after.scryfall_id !== row.scryfall_id || after.finish !== row.finish || after.condition !== row.condition;
    const movesInOrOutOfMaybe = (row.board === 'maybe') !== (after.board === 'maybe');
    if (movesInOrOutOfMaybe) {
      // Moving to/from the maybeboard is effectively a removal/addition for the collection.
      if (after.board === 'maybe') logChange(deck, { action: 'remove', board: row.board, qty: n, before: row });
      else logChange(deck, { action: 'add', board: after.board, qty: n, after });
    } else {
      logChange(deck, { action: 'change', board: after.board, qty: n, before: row, after, tracked: physical && deck.status === 'in_collection' && after.board !== 'maybe' });
    }
  })();
  touch(deckId);
}

/** Combined colour identity of every commander except the given deck row. */
function otherCommandersIdentity(cards: { id: number; board: string; card: { colorIdentity: string[] } }[], exceptId: number): string[] {
  return [...new Set(cards.filter(c => c.board === 'commander' && c.id !== exceptId).flatMap(c => c.card.colorIdentity))];
}

/**
 * Short-list (or un-short-list) a card in the 99 as an alternative commander.
 * A card in the commander slot can also be stepped down: it moves into the 99, short-listed, leaving the other commander(s).
 */
export function setAltCommander(deckId: number, deckCardId: number, value: boolean) {
  deckRow(deckId);
  const row = db.prepare('SELECT * FROM deck_cards WHERE id = ? AND deck_id = ?').get(deckCardId, deckId) as DeckCardRow | undefined;
  if (!row) throw new HttpError(404, 'Card not in deck');
  if (value && row.board === 'commander') {
    const detail = getDeck(deckId, { light: true });
    const self = detail.cards.find(c => c.id === row.id)!;
    if (!(self as { canMakeOptional?: boolean }).canMakeOptional) {
      throw new HttpError(400, `${self.card.name} can't be made optional: that needs another commander it can't be paired with, and the same colour identity as that commander.`);
    }
    changeDeckCard(deckId, row.id, { board: 'main', altCommander: true });
    return;
  }
  if (value) {
    if (row.board !== 'main') throw new HttpError(400, 'Only cards in the 99 can be optional commanders.');
    const detail = getDeck(deckId, { light: true });
    const card = getCards([row.scryfall_id]).get(row.scryfall_id)!;
    if (!isAlternativeCommander(toDeckEntry(card, row.qty, 'main'), detail.validation.colorIdentity)) {
      throw new HttpError(400, `${card.name} can't be an optional commander: it must be a legendary creature with the same colour identity (${detail.validation.colorIdentity.join('') || 'colorless'}).`);
    }
  }
  db.prepare('UPDATE deck_cards SET alt_commander = ? WHERE id = ?').run(value ? 1 : 0, row.id);
  touch(deckId);
}

function uniqueBinderName(base: string, exceptId?: number) {
  let name = base, i = 2;
  while (db.prepare('SELECT 1 FROM binders WHERE name = ? AND id IS NOT ?').get(name, exceptId ?? null)) name = `${base} (${i++})`;
  return name;
}

/** Quick import: put every card of the deck into the collection (in a "Deck: <name>" binder). */
export function addDeckToCollection(deckId: number) {
  const deck = deckRow(deckId);
  if (deck.status === 'in_collection') throw new HttpError(400, 'This deck is already in the collection. Use "Sync changes" instead.');
  db.transaction(() => {
    const binderId = Number(db.prepare("INSERT INTO binders (name, kind, deck_id) VALUES (?, 'deck', ?)").run(uniqueBinderName(`Deck: ${deck.name}`), deckId).lastInsertRowid);
    const rows = db.prepare("SELECT * FROM deck_cards WHERE deck_id = ? AND board != 'maybe'").all(deckId) as DeckCardRow[];
    const ins = db.prepare('INSERT INTO collection_items (scryfall_id, finish, condition, qty, binder_id, source_deck_id) VALUES (?,?,?,?,?,?)');
    for (const r of rows) ins.run(r.scryfall_id, r.finish, r.condition, r.qty, binderId, deckId);
    db.prepare("UPDATE decks SET status = 'in_collection', binder_id = ?, updated_at = datetime('now') WHERE id = ?").run(binderId, deckId);
    db.prepare("UPDATE deck_changes SET synced_at = datetime('now') WHERE deck_id = ? AND synced_at IS NULL").run(deckId);
  })();
}

type Key = string;
const key = (id: string, finish: string, condition: string): Key => `${id}|${finish}|${condition}`;

/** Net effect of the pending (unsynced) changes, per printing/finish/condition. */
export function pendingNet(deckId: number) {
  const changes = db.prepare('SELECT * FROM deck_changes WHERE deck_id = ? AND tracked = 1 AND synced_at IS NULL ORDER BY id').all(deckId) as any[];
  const net = new Map<Key, number>();
  const regrades: { from: Key; to: Key; qty: number }[] = [];
  const bump = (k: Key, n: number) => net.set(k, (net.get(k) ?? 0) + n);
  for (const c of changes) {
    const before = c.before_scryfall_id ? key(c.before_scryfall_id, c.before_finish, c.before_condition) : null;
    const after = c.after_scryfall_id ? key(c.after_scryfall_id, c.after_finish, c.after_condition) : null;
    if (c.action === 'add' && after) bump(after, c.qty);
    else if (c.action === 'remove' && before) bump(before, -c.qty);
    else if (c.action === 'change' && before && after) {
      const sameCard = c.before_scryfall_id === c.after_scryfall_id && c.before_finish === c.after_finish;
      if (sameCard) regrades.push({ from: before, to: after, qty: c.qty }); // same physical card, only condition re-graded
      else { bump(before, -c.qty); bump(after, c.qty); }
    }
  }
  return { changes, net, regrades };
}

/** Apply pending changes: additions go into the collection, removals go to Miscellaneous. */
export function syncDeckChanges(deckId: number) {
  const deck = deckRow(deckId);
  if (deck.status !== 'in_collection' || !deck.binder_id) throw new HttpError(400, 'Add the deck to the collection first.');
  const { net, regrades } = pendingNet(deckId);
  const summary = { added: 0, toMisc: 0, regraded: 0 };
  db.transaction(() => {
    const findItems = db.prepare('SELECT * FROM collection_items WHERE binder_id = ? AND scryfall_id = ? AND finish = ? AND condition = ? ORDER BY id DESC');
    const takeFromBinder = (k: Key, qty: number) => {
      const [id, finish, condition] = k.split('|');
      let left = qty;
      for (const item of findItems.all(deck.binder_id, id, finish, condition) as any[]) {
        if (left <= 0) break;
        const n = Math.min(left, item.qty);
        if (n === item.qty) db.prepare('DELETE FROM collection_items WHERE id = ?').run(item.id);
        else db.prepare('UPDATE collection_items SET qty = qty - ? WHERE id = ?').run(n, item.id);
        left -= n;
      }
      return qty - left;
    };
    const addToBinder = (k: Key, qty: number) => {
      const [id, finish, condition] = k.split('|');
      const existing = findItems.get(deck.binder_id, id, finish, condition) as any;
      if (existing) db.prepare('UPDATE collection_items SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
      else db.prepare('INSERT INTO collection_items (scryfall_id, finish, condition, qty, binder_id, source_deck_id) VALUES (?,?,?,?,?,?)')
        .run(id, finish, condition, qty, deck.binder_id, deckId);
    };

    for (const r of regrades) {
      const moved = takeFromBinder(r.from, r.qty);
      if (moved) { addToBinder(r.to, moved); summary.regraded += moved; }
    }
    for (const [k, n] of net) {
      if (n > 0) { addToBinder(k, n); summary.added += n; }
      if (n < 0) {
        takeFromBinder(k, -n);
        const [id, finish, condition] = k.split('|');
        db.prepare('INSERT INTO misc_items (scryfall_id, finish, condition, qty, from_deck_id, from_deck_name, reason) VALUES (?,?,?,?,?,?,?)')
          .run(id, finish, condition, -n, deckId, deck.name, 'Removed from deck');
        summary.toMisc += -n;
      }
    }
    db.prepare("UPDATE deck_changes SET synced_at = datetime('now') WHERE deck_id = ? AND synced_at IS NULL").run(deckId);
    touch(deckId);
  })();
  return summary;
}

/** Delete a deck. For decks in the collection: keep cards (move to Main Collection), send to Misc, or remove them. */
export function deleteDeck(deckId: number, mode: 'keep' | 'misc' | 'remove' = 'keep') {
  const deck = deckRow(deckId);
  db.transaction(() => {
    if (deck.binder_id) {
      if (mode === 'keep') db.prepare('UPDATE collection_items SET binder_id = 1, source_deck_id = NULL WHERE binder_id = ?').run(deck.binder_id);
      if (mode === 'misc') {
        db.prepare(`INSERT INTO misc_items (scryfall_id, finish, condition, qty, from_deck_id, from_deck_name, reason)
          SELECT scryfall_id, finish, condition, qty, ?, ?, 'Deck deleted' FROM collection_items WHERE binder_id = ?`).run(deckId, deck.name, deck.binder_id);
      }
      if (mode !== 'keep') db.prepare('DELETE FROM collection_items WHERE binder_id = ?').run(deck.binder_id);
      db.prepare('DELETE FROM binders WHERE id = ?').run(deck.binder_id);
    }
    db.prepare('DELETE FROM decks WHERE id = ?').run(deckId);
  })();
}

export function toDeckEntry(card: Card, qty: number, board: Board): DeckEntry {
  return {
    name: card.name, qty, board, typeLine: card.typeLine, oracleText: card.oracleText, colorIdentity: card.colorIdentity,
    commanderLegality: card.commanderLegality, gameChanger: card.gameChanger, power: card.power, toughness: card.toughness,
  };
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];
export function primaryType(typeLine: string) {
  const front = typeLine.split('//')[0];
  if (/\bLand\b/.test(front)) return 'Land';
  return TYPE_ORDER.find(t => new RegExp(`\\b${t}\\b`).test(front)) ?? 'Other';
}

export function deckStats(cards: { card: Card; qty: number; board: Board; price: number | null }[]) {
  const counted = cards.filter(c => c.board === 'commander' || c.board === 'main');
  const curve: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7+': 0 };
  const types: Record<string, number> = {};
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let nonLand = 0, cmcTotal = 0;
  for (const { card, qty } of counted) {
    const t = primaryType(card.typeLine);
    types[t] = (types[t] ?? 0) + qty;
    if (t !== 'Land') {
      const bucket = card.cmc >= 7 ? '7+' : String(Math.floor(card.cmc));
      curve[bucket] += qty;
      nonLand += qty;
      cmcTotal += card.cmc * qty;
    }
    for (const m of card.manaCost.matchAll(/\{([^}]+)\}/g)) {
      for (const sym of m[1].split('/')) if (sym in pips) pips[sym] += qty;
    }
  }
  const value = round(cards.filter(c => c.board !== 'maybe').reduce((t, c) => t + (c.price ?? 0) * c.qty, 0));
  return { curve, types, pips, averageCmc: nonLand ? Math.round((cmcTotal / nonLand) * 100) / 100 : 0, value };
}

export function listDecks() {
  const decks = db.prepare('SELECT * FROM decks ORDER BY updated_at DESC').all() as DeckRow[];
  return decks.map(d => {
    const detail = getDeck(d.id, { light: true });
    return {
      id: d.id, name: d.name, status: d.status, targetBracket: d.target_bracket, updatedAt: d.updated_at,
      count: detail.validation.count, legal: detail.validation.legal, value: detail.stats.value,
      commanders: detail.cards.filter(c => c.board === 'commander').map(c => ({ name: c.card.name, image: c.card.imageSmall, artCrop: c.card.image })),
      colorIdentity: detail.validation.colorIdentity, pendingChanges: detail.pendingCount,
    };
  });
}

export function getDeck(deckId: number, opts: { light?: boolean } = {}) {
  const deck = deckRow(deckId);
  const p = priceSql('dc');
  const rows = db.prepare(`SELECT dc.*, ${p.price} AS price, ${p.source} AS price_source
    FROM deck_cards dc JOIN cards c ON c.id = dc.scryfall_id ${p.join} WHERE dc.deck_id = ?`).all(deckId) as (DeckCardRow & { price: number | null; price_source: string | null })[];
  const cardMap = getCards(rows.map(r => r.scryfall_id));
  const cards = rows.map(r => ({
    id: r.id, board: r.board, qty: r.qty, finish: r.finish, condition: r.condition, altCommander: !!r.alt_commander,
    price: r.price, priceSource: r.price_source, card: cardMap.get(r.scryfall_id)!,
  })).sort((a, b) => a.card.name.localeCompare(b.card.name));

  const validation = validateCommanderDeck(cards.map(c => toDeckEntry(c.card, c.qty, c.board)), deck.target_bracket);
  // Which cards in the 99 could take the commander's place (same colour identity, legendary creature).
  // And, when the commander slot holds commanders that can't go together, which of them could step down to optional.
  const clash = validation.issues.some(i => i.code === 'bad-pair' || i.code === 'too-many-commanders');
  for (const c of cards as (typeof cards[number] & { canBeCommander?: boolean; canMakeOptional?: boolean })[]) {
    c.canBeCommander = c.board === 'main' && isAlternativeCommander(toDeckEntry(c.card, c.qty, c.board), validation.colorIdentity);
    c.canMakeOptional = clash && c.board === 'commander'
      && isAlternativeCommander(toDeckEntry(c.card, c.qty, c.board), otherCommandersIdentity(cards, c.id));
  }
  const stats = deckStats(cards);
  const pendingCount = (db.prepare('SELECT COUNT(*) AS n FROM deck_changes WHERE deck_id = ? AND tracked = 1 AND synced_at IS NULL').get(deckId) as any).n;
  if (opts.light) return { deck, cards, validation, stats, pendingCount, changes: [], owned: [] };

  const changes = (db.prepare('SELECT * FROM deck_changes WHERE deck_id = ? ORDER BY id DESC LIMIT 300').all(deckId) as any[]);
  const changeCards = getCards(changes.flatMap(c => [c.before_scryfall_id, c.after_scryfall_id].filter(Boolean)));
  const changeView = changes.map(c => ({
    id: c.id, action: c.action, board: c.board, qty: c.qty, tracked: !!c.tracked, createdAt: c.created_at, syncedAt: c.synced_at,
    before: c.before_scryfall_id ? { card: brief(changeCards.get(c.before_scryfall_id)), finish: c.before_finish, condition: c.before_condition } : null,
    after: c.after_scryfall_id ? { card: brief(changeCards.get(c.after_scryfall_id)), finish: c.after_finish, condition: c.after_condition } : null,
  }));

  return { deck, cards, validation, stats, pendingCount, changes: changeView, owned: ownership(deck, cards) };
}

function brief(c?: Card) {
  return c ? { id: c.id, name: c.name, set: c.set, number: c.number, image: c.imageSmall, styles: c.styles } : null;
}

/** For draft decks: how many of each card are already owned (outside other decks' binders), and what the rest would cost. */
function ownership(deck: DeckRow, cards: { id: number; qty: number; board: Board; card: Card; price: number | null; finish: Finish }[]) {
  if (deck.status === 'in_collection') return cards.map(c => ({ deckCardId: c.id, ownedExact: c.qty, ownedAny: c.qty, missing: 0, missingCost: 0 }));
  const exact = db.prepare(`SELECT COALESCE(SUM(ci.qty),0) AS n FROM collection_items ci JOIN binders b ON b.id = ci.binder_id
    WHERE b.kind != 'deck' AND ci.scryfall_id = ? AND ci.finish = ?`);
  const any = db.prepare(`SELECT COALESCE(SUM(ci.qty),0) AS n FROM collection_items ci JOIN binders b ON b.id = ci.binder_id
    JOIN cards c ON c.id = ci.scryfall_id WHERE b.kind != 'deck' AND c.name = ?`);
  return cards.filter(c => c.board !== 'maybe').map(c => {
    const ownedExact = (exact.get(c.card.id, c.finish) as any).n;
    const ownedAny = (any.get(c.card.name) as any).n;
    const missing = Math.max(0, c.qty - ownedAny);
    return { deckCardId: c.id, ownedExact, ownedAny, missing, missingCost: round(missing * (c.price ?? 0)) };
  });
}
