import { db } from '../db/index.js';
import { HttpError, addDeckCard, createDeck } from '../decks/service.js';
import { getCards, type Condition, type Finish } from '../scryfall/cards.js';
import type { Board } from '../decks/validateCommander.js';

export interface CommitRow {
  scryfallId: string;
  qty: number;
  finish: Finish;
  condition: Condition;
  action: 'import' | 'skip' | 'misc';
  board?: Board | null;
  altCommander?: boolean;
  binder?: string;
  deck?: string;
  purchasePrice?: number | null;
  notes?: string;
}

export interface CommitRequest {
  filename?: string;
  format?: string;
  destination: 'collection' | 'deck' | 'wishlist';
  binderId?: number | null;      // collection: target binder (ignored when useFileBinders and row has one)
  useFileBinders?: boolean;
  deckId?: number | null;        // deck: add to existing deck
  deckName?: string;             // deck: create new deck with this name
  splitByDeckColumn?: boolean;   // deck: one deck per "Deck" column value
  commanderScryfallIds?: string[]; // deck: force these as commander(s)
  rows: CommitRow[];
}

function binderIdByName(name: string): number {
  const found = db.prepare('SELECT id FROM binders WHERE name = ?').get(name) as { id: number } | undefined;
  if (found) return found.id;
  return Number(db.prepare("INSERT INTO binders (name, kind) VALUES (?, 'binder')").run(name).lastInsertRowid);
}

export function commitImport(req: CommitRequest) {
  const rows = req.rows.filter(r => r.action !== 'skip' && r.qty > 0);
  const cards = getCards(rows.map(r => r.scryfallId));
  for (const r of rows) {
    const c = cards.get(r.scryfallId);
    if (!c) throw new HttpError(400, `Unknown card id ${r.scryfallId}`);
    if (!['NM', 'LP', 'MP'].includes(r.condition)) throw new HttpError(400, `Condition must be NM, LP or MP (${c.name}).`);
    if (!c.finishes.includes(r.finish)) throw new HttpError(400, `${c.name} (${c.set.toUpperCase()} #${c.number}) has no ${r.finish} finish.`);
  }
  const result = { imported: 0, toMisc: 0, skipped: req.rows.length - rows.length, deckIds: [] as number[] };

  db.transaction(() => {
    const toMisc = db.prepare("INSERT INTO misc_items (scryfall_id, finish, condition, qty, reason) VALUES (?,?,?,?, ?)");
    for (const r of rows.filter(r => r.action === 'misc')) {
      toMisc.run(r.scryfallId, r.finish, r.condition, r.qty, `Imported from ${req.filename ?? 'file'}`);
      result.toMisc += r.qty;
    }
    const toImport = rows.filter(r => r.action === 'import');

    if (req.destination === 'collection') {
      const find = db.prepare('SELECT id FROM collection_items WHERE scryfall_id = ? AND finish = ? AND condition = ? AND binder_id = ? AND source_deck_id IS NULL');
      const upd = db.prepare('UPDATE collection_items SET qty = qty + ? WHERE id = ?');
      const ins = db.prepare('INSERT INTO collection_items (scryfall_id, finish, condition, qty, binder_id, purchase_price, notes) VALUES (?,?,?,?,?,?,?)');
      for (const r of toImport) {
        const binderId = req.useFileBinders && r.binder ? binderIdByName(r.binder) : req.binderId ?? 1;
        const existing = find.get(r.scryfallId, r.finish, r.condition, binderId) as { id: number } | undefined;
        if (existing && r.purchasePrice == null) upd.run(r.qty, existing.id);
        else ins.run(r.scryfallId, r.finish, r.condition, r.qty, binderId, r.purchasePrice ?? null, r.notes ?? null);
        result.imported += r.qty;
      }
    } else if (req.destination === 'wishlist') {
      const ins = db.prepare('INSERT INTO wishlist_items (scryfall_id, finish, condition, qty, notes) VALUES (?,?,?,?,?)');
      for (const r of toImport) { ins.run(r.scryfallId, r.finish, r.condition, r.qty, r.notes ?? null); result.imported += r.qty; }
    } else {
      const groups = new Map<string, CommitRow[]>();
      for (const r of toImport) {
        const g = req.splitByDeckColumn && r.deck ? r.deck : '';
        groups.set(g, [...(groups.get(g) ?? []), r]);
      }
      for (const [groupName, groupRows] of groups) {
        const deckId = req.deckId && !groupName
          ? req.deckId
          : createDeck(groupName || req.deckName || (req.filename ?? 'Imported deck').replace(/\.[^.]+$/, ''));
        result.deckIds.push(deckId);
        const forced = new Set(req.commanderScryfallIds ?? []);
        for (const r of groupRows) {
          const board: Board = forced.size ? (forced.has(r.scryfallId) ? 'commander' : (r.board === 'commander' ? 'main' : r.board ?? 'main')) : (r.board ?? 'main');
          addDeckCard(deckId, { scryfallId: r.scryfallId, finish: r.finish, condition: r.condition, qty: r.qty, board, altCommander: r.altCommander }, { log: true });
          result.imported += r.qty;
        }
      }
    }
    db.prepare('INSERT INTO import_jobs (filename, format, destination, rows_total, rows_imported) VALUES (?,?,?,?,?)')
      .run(req.filename ?? null, req.format ?? null, req.destination, req.rows.length, result.imported);
  })();
  return result;
}
