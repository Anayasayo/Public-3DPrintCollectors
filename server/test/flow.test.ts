/**
 * End-to-end service flow against a temp copy of the catalog:
 * import decklist -> fix to 100 -> add to collection -> swap cards -> sync -> misc -> round-trip export.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as XLSX from 'xlsx';
import { db } from '../src/db/index.js';
import { parseTxt } from '../src/import/parseTxt.js';
import { resolveRow } from '../src/import/resolve.js';
import { commitImport } from '../src/import/commit.js';
import { readSheet, sheetToRows } from '../src/import/parseSheet.js';
import { exportWorkbook, exportDeckTxt } from '../src/export/export.js';
import {
  addDeckCard, addDeckToCollection, changeDeckCard, getDeck, removeDeckCard, setAltCommander, syncDeckChanges, pendingNet,
} from '../src/decks/service.js';
import { collectionSummary } from '../src/pricing/valuation.js';

const hasCatalog = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as any).n > 1000;
const d = hasCatalog ? describe : describe.skip;

function importTxt(text: string, destination: 'deck' | 'collection', deckName = 'Test Deck') {
  const rows = parseTxt(text).map(p => resolveRow(p));
  const unresolved = rows.filter(r => r.status === 'unresolved');
  expect(unresolved.map(r => r.raw)).toEqual([]);
  return commitImport({
    destination, deckName, filename: 'test.txt',
    rows: rows.map(r => ({ scryfallId: r.scryfallId!, qty: r.qty, finish: r.finish, condition: r.condition, action: 'import' as const, board: r.board as any })),
  });
}

d('deck -> collection flow', () => {
  let deckId: number;

  beforeAll(() => {
    const list = [
      'Commander', "1 Krenko, Mob Boss (DDT) 52", '', 'Deck',
      '1 Sol Ring (C21) 263', '1 Arcane Signet', '1 Goblin Chieftain', '1 Lightning Bolt', '1 Skirk Prospector',
      '90 Mountain',
    ].join('\n');
    const res = importTxt(list, 'deck', 'Krenko Test');
    deckId = res.deckIds[0];
  });

  it('imports the decklist exactly and counts 96/100', () => {
    const deck = getDeck(deckId);
    const krenko = deck.cards.find(c => c.board === 'commander')!;
    expect(krenko.card.name).toBe('Krenko, Mob Boss');
    expect(krenko.card.set).toBe('ddt');
    expect(deck.cards.find(c => c.card.name === 'Sol Ring')!.card.set).toBe('c21');
    expect(deck.validation.count).toBe(96);
    expect(deck.validation.legal).toBe(false);
  });

  it('reaches a legal 100 and adds to collection', () => {
    const mountain = getDeck(deckId).cards.find(c => c.card.name === 'Mountain')!;
    addDeckCard(deckId, { scryfallId: mountain.card.id, finish: mountain.finish, condition: 'NM', qty: 4, board: 'main' });
    const deck = getDeck(deckId);
    expect(deck.validation.count).toBe(100);
    expect(deck.validation.issues.filter(i => i.level === 'error')).toEqual([]);
    const before = collectionSummary().cards;
    addDeckToCollection(deckId);
    expect(collectionSummary().cards).toBe(before + 100);
    expect(getDeck(deckId).deck.status).toBe('in_collection');
  });

  it('tracks swaps as pending, then sync sends removals to Misc', () => {
    const deck = getDeck(deckId);
    const bolt = deck.cards.find(c => c.card.name === 'Lightning Bolt')!;
    const prospector = deck.cards.find(c => c.card.name === 'Skirk Prospector')!;
    removeDeckCard(deckId, bolt.id);
    removeDeckCard(deckId, prospector.id);
    const shock = resolveRow({ line: 1, raw: 'Shock', qty: 1, name: 'Shock' });
    const guide = resolveRow({ line: 1, raw: 'Goblin Guide', qty: 1, name: 'Goblin Guide' });
    addDeckCard(deckId, { scryfallId: shock.scryfallId!, finish: shock.finish, condition: 'LP', qty: 1, board: 'main' });
    addDeckCard(deckId, { scryfallId: guide.scryfallId!, finish: guide.finish, condition: 'NM', qty: 1, board: 'main' });
    // Re-grade the Sol Ring: same physical card, so it should NOT go to Misc
    const sol = getDeck(deckId).cards.find(c => c.card.name === 'Sol Ring')!;
    changeDeckCard(deckId, sol.id, { condition: 'MP' });

    expect(getDeck(deckId).pendingCount).toBe(5);
    const { net, regrades } = pendingNet(deckId);
    expect([...net.values()].sort()).toEqual([-1, -1, 1, 1]);
    expect(regrades).toHaveLength(1);

    const summary = syncDeckChanges(deckId);
    expect(summary).toEqual({ added: 2, toMisc: 2, regraded: 1 });
    const misc = db.prepare('SELECT c.name FROM misc_items m JOIN cards c ON c.id = m.scryfall_id ORDER BY c.name').all().map((r: any) => r.name);
    expect(misc).toEqual(['Lightning Bolt', 'Skirk Prospector']);
    expect(getDeck(deckId).pendingCount).toBe(0);
    // Collection binder mirrors the deck: still 100 cards, Sol Ring now MP
    const binderCards = db.prepare('SELECT SUM(qty) AS n FROM collection_items WHERE source_deck_id = ?').get(deckId) as any;
    expect(binderCards.n).toBe(100);
    const solItem = db.prepare("SELECT ci.condition FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id WHERE c.name = 'Sol Ring' AND ci.source_deck_id = ?").get(deckId) as any;
    expect(solItem.condition).toBe('MP');
  });

  it('short-lists optional commanders and round-trips them through the .txt export', () => {
    // Krenko, Mob Boss is mono-red: another mono-red legend qualifies, a green one never does.
    const tinStreet = resolveRow({ line: 1, raw: 'x', qty: 1, name: 'Krenko, Tin Street Kingpin' });
    const selvala = resolveRow({ line: 1, raw: 'x', qty: 1, name: 'Selvala, Heart of the Wilds' });
    addDeckCard(deckId, { scryfallId: tinStreet.scryfallId!, finish: tinStreet.finish, condition: 'NM', qty: 1, board: 'main' });
    addDeckCard(deckId, { scryfallId: selvala.scryfallId!, finish: selvala.finish, condition: 'NM', qty: 1, board: 'main' });

    const deck = getDeck(deckId);
    const eligible = deck.cards.filter(c => (c as any).canBeCommander).map(c => c.card.name);
    expect(eligible).toContain('Krenko, Tin Street Kingpin');
    expect(eligible).not.toContain('Selvala, Heart of the Wilds'); // mono-green, wrong identity
    expect(eligible).not.toContain('Sol Ring');
    expect(eligible).not.toContain('Mountain');

    const target = deck.cards.find(c => c.card.name === 'Krenko, Tin Street Kingpin')!;
    setAltCommander(deckId, target.id, true);
    const after = getDeck(deckId);
    const marked = after.cards.filter(c => (c as any).altCommander);
    expect(marked.map(c => c.card.name)).toEqual([target.card.name]);
    expect(after.validation.count).toBe(102); // the two extra legends are part of the 99 count, marking one changes nothing

    const txt = exportDeckTxt(deckId);
    expect(txt).toContain('// OPTIONAL COMMANDERS');
    const reimported = parseTxt(txt).map(p => resolveRow(p));
    const row = reimported.find(r => r.scryfallId === target.card.id)!;
    expect(row.altCommander).toBe(true);
    expect(row.board).toBe('main');
    expect(reimported.filter(r => r.board === 'commander')).toHaveLength(1);

    setAltCommander(deckId, target.id, false);
    expect(getDeck(deckId).cards.filter(c => (c as any).altCommander)).toHaveLength(0);
  });

  it('refuses an optional commander that is the wrong colour or not a legal commander', () => {
    const deck = getDeck(deckId);
    const sol = deck.cards.find(c => c.card.name === 'Sol Ring')!;
    expect(() => setAltCommander(deckId, sol.id, true)).toThrow(/legendary creature with the same colour identity/);
  });

  it('steps a clashing second commander down to optional in one click', () => {
    const tin = () => getDeck(deckId).cards.find(c => c.card.name === 'Krenko, Tin Street Kingpin')!;
    const boss = () => getDeck(deckId).cards.find(c => c.card.name === 'Krenko, Mob Boss')!;
    expect((boss() as any).canMakeOptional).toBe(false); // a lone commander never gets the button
    expect(() => setAltCommander(deckId, boss().id, true)).toThrow(/can't be made optional/);

    changeDeckCard(deckId, tin().id, { board: 'commander' }); // two Krenkos can't partner
    const clash = getDeck(deckId);
    expect(clash.validation.issues.find(i => i.code === 'bad-pair')?.message).toMatch(/press Make optional/);
    expect((clash.cards.find(c => c.id === tin().id) as any).canMakeOptional).toBe(true);

    setAltCommander(deckId, tin().id, true);
    const after = getDeck(deckId);
    expect(after.validation.commanders).toEqual(['Krenko, Mob Boss']);
    expect(tin()).toMatchObject({ board: 'main', altCommander: true });
    expect(after.validation.issues.find(i => i.code === 'bad-pair')).toBeUndefined();
    setAltCommander(deckId, tin().id, false);
  });

  it('exports the deck as text that re-imports to the same printings', () => {
    const txt = exportDeckTxt(deckId);
    const reimported = parseTxt(txt).map(p => resolveRow(p));
    const original = getDeck(deckId).cards;
    expect(reimported.every(r => r.status === 'resolved')).toBe(true);
    for (const c of original) {
      const r = reimported.find(x => x.scryfallId === c.card.id && x.board === c.board);
      expect(r?.qty, c.card.name).toBe(c.qty);
      expect(r?.finish).toBe(c.finish);
    }
  });

  it('round-trips the collection through the Excel export', () => {
    const buf = exportWorkbook(['collection']);
    const { rows } = sheetToRows(readSheet(buf, 'export.xlsx'));
    const resolved = rows.map(p => resolveRow(p));
    expect(resolved.every(r => r.status === 'resolved' && r.matchedBy === 'scryfall_id')).toBe(true);
    const fromFile = resolved.reduce((n, r) => n + r.qty, 0);
    expect(fromFile).toBe(collectionSummary().cards);
    const wb = XLSX.read(buf);
    expect(wb.SheetNames).toEqual(['Collection']);
  });

  it('flags HP cards during import', () => {
    const [row] = parseTxt('1 Sol Ring (C21) 263 *HP*').map(p => resolveRow(p));
    expect(row.status).toBe('flagged');
    expect(row.condition).toBe('MP');
  });

  it('ignores a collector number that points at a different card', () => {
    // 2X2 #190 is "Call to the Feast", not Atraxa — the name must win.
    const [row] = parseTxt("1 Atraxa, Praetors' Voice (2X2) 190").map(p => resolveRow(p));
    expect(row.card!.name).toBe("Atraxa, Praetors' Voice");
    expect(row.issues.join(' ')).toContain('Call to the Feast');
  });

  it('defaults a bare card name to an ordinary set, not a memorabilia printing', () => {
    const [row] = parseTxt('1 Black Lotus').map(p => resolveRow(p));
    expect(row.card!.set).not.toBe('ovnt');
  });

  it('marks name-only imports with many printings as ambiguous with a default pick', () => {
    const [row] = parseTxt('1 Sol Ring').map(p => resolveRow(p));
    expect(row.status).toBe('ambiguous');
    expect(row.candidates!.length).toBeGreaterThan(10);
    expect(row.card!.styles).toEqual([]);
  });
});
