import * as XLSX from 'xlsx';
import { db } from '../db/index.js';
import { priceSql, round } from '../pricing/valuation.js';
import { styleBadges, type CardRow } from '../scryfall/cards.js';
import { getDeck } from '../decks/service.js';

const FINISH_LABEL: Record<string, string> = { nonfoil: 'Normal', foil: 'Foil', etched: 'Etched' };

function collectionRows() {
  const p = priceSql('ci');
  return db.prepare(`SELECT ci.*, c.*, ci.id AS item_id, b.name AS binder_name, ${p.price} AS price, ${p.source} AS price_source,
      (SELECT group_concat(t.name, ', ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ci.id) AS tag_names
    FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id JOIN binders b ON b.id = ci.binder_id ${p.join}
    ORDER BY c.name, c.set_code`).all() as any[];
}

export function collectionSheet() {
  return collectionRows().map(r => ({
    Name: r.name,
    'Set Code': r.set_code.toUpperCase(),
    'Set Name': r.set_name,
    'Collector Number': r.collector_number,
    Finish: FINISH_LABEL[r.finish],
    Condition: r.condition,
    Language: r.lang,
    Quantity: r.qty,
    Binder: r.binder_name,
    Styles: styleBadges(r as CardRow).join(', '),
    Rarity: r.rarity,
    'Price Each': r.price ?? '',
    'Price Source': r.price_source ?? '',
    Total: r.price != null ? round(r.price * r.qty) : '',
    'Purchase Price': r.purchase_price ?? '',
    Tags: r.tag_names ?? '',
    Notes: r.notes ?? '',
    'Scryfall ID': r.scryfall_id,
    'TCGplayer ID': (r.finish === 'etched' ? r.tcgplayer_etched_id : r.tcgplayer_id) ?? '',
  }));
}

function simpleSheet(table: 'misc_items' | 'wishlist_items') {
  const p = priceSql('t');
  const rows = db.prepare(`SELECT t.*, c.name, c.set_code, c.set_name, c.collector_number, ${p.price} AS price
    FROM ${table} t JOIN cards c ON c.id = t.scryfall_id ${p.join} ORDER BY c.name`).all() as any[];
  return rows.map(r => ({
    Name: r.name, 'Set Code': r.set_code.toUpperCase(), 'Set Name': r.set_name, 'Collector Number': r.collector_number,
    Finish: FINISH_LABEL[r.finish], Condition: r.condition, Quantity: r.qty, 'Price Each': r.price ?? '',
    ...(table === 'misc_items' ? { 'From Deck': r.from_deck_name ?? '', Reason: r.reason ?? '' } : { 'Target Price': r.target_price ?? '' }),
    'Scryfall ID': r.scryfall_id,
  }));
}

const BOARD_LABEL: Record<string, string> = { commander: 'Commander', main: 'Main', companion: 'Companion', maybe: 'Maybeboard' };
const ALT_COMMANDER_LABEL = 'Optional Commander';

export function deckSheetRows(deckIds?: number[]) {
  const ids = deckIds ?? (db.prepare('SELECT id FROM decks ORDER BY name').all() as { id: number }[]).map(d => d.id);
  const out: Record<string, unknown>[] = [];
  for (const id of ids) {
    const d = getDeck(id, { light: true });
    const order = ['commander', 'companion', 'main', 'maybe'];
    for (const c of [...d.cards].sort((a, b) => order.indexOf(a.board) - order.indexOf(b.board))) {
      out.push({
        Deck: d.deck.name, Board: c.altCommander ? ALT_COMMANDER_LABEL : BOARD_LABEL[c.board], Quantity: c.qty, Name: c.card.name, 'Set Code': c.card.set.toUpperCase(),
        'Collector Number': c.card.number, Finish: FINISH_LABEL[c.finish], Condition: c.condition,
        'Price Each': c.price ?? '', 'Scryfall ID': c.card.id,
      });
    }
  }
  return out;
}

function sheetFrom(rows: Record<string, unknown>[], fallbackHeaders: string[]) {
  const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([fallbackHeaders]);
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  ws['!cols'] = headers.map(h => ({ wch: Math.min(40, Math.max(h.length + 2, ...rows.slice(0, 200).map(r => String(r[h] ?? '').length + 1))) }));
  return ws;
}

export function exportWorkbook(parts: ('collection' | 'decks' | 'misc' | 'wishlist')[] = ['collection', 'decks', 'misc', 'wishlist'], deckIds?: number[]): Buffer {
  const wb = XLSX.utils.book_new();
  if (parts.includes('collection')) XLSX.utils.book_append_sheet(wb, sheetFrom(collectionSheet(), ['Name', 'Set Code', 'Collector Number', 'Finish', 'Condition', 'Quantity']), 'Collection');
  if (parts.includes('decks')) XLSX.utils.book_append_sheet(wb, sheetFrom(deckSheetRows(deckIds), ['Deck', 'Board', 'Quantity', 'Name', 'Set Code', 'Collector Number', 'Finish', 'Condition']), 'Decks');
  if (parts.includes('misc')) XLSX.utils.book_append_sheet(wb, sheetFrom(simpleSheet('misc_items'), ['Name', 'Set Code', 'Collector Number', 'Finish', 'Condition', 'Quantity']), 'Misc');
  if (parts.includes('wishlist')) XLSX.utils.book_append_sheet(wb, sheetFrom(simpleSheet('wishlist_items'), ['Name', 'Set Code', 'Collector Number', 'Finish', 'Condition', 'Quantity']), 'Wishlist');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: Record<string, unknown>[]) =>
  rows.length ? [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(csvCell).join(','))].join('\r\n') : '';

const COND_LONG: Record<string, string> = { NM: 'near_mint', LP: 'light_played', MP: 'played' };
const COND_MOX: Record<string, string> = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played' };

/** CSV in the app's own layout, ManaBox's layout, or Moxfield's collection layout. */
export function exportCsv(format: 'native' | 'manabox' | 'moxfield'): string {
  if (format === 'native') return toCsv(collectionSheet());
  const rows = collectionRows();
  if (format === 'manabox') {
    return toCsv(rows.map(r => ({
      Name: r.name, 'Set code': r.set_code.toUpperCase(), 'Set name': r.set_name, 'Collector number': r.collector_number,
      Foil: r.finish === 'nonfoil' ? 'normal' : r.finish, Rarity: r.rarity, Quantity: r.qty, 'ManaBox ID': '', 'Scryfall ID': r.scryfall_id,
      'Purchase price': r.purchase_price ?? '', Misprint: 'false', Altered: 'false', Condition: COND_LONG[r.condition], Language: r.lang,
      'Purchase price currency': 'USD',
    })));
  }
  return toCsv(rows.map(r => ({
    Count: r.qty, 'Tradelist Count': 0, Name: r.name, Edition: r.set_code, Condition: COND_MOX[r.condition], Language: 'English',
    Foil: r.finish === 'nonfoil' ? '' : r.finish, Tags: r.tag_names ?? '', 'Last Modified': '', 'Collector Number': r.collector_number,
    Alter: 'False', Proxy: 'False', 'Purchase Price': r.purchase_price ?? '',
  })));
}

/** Decklist text in Moxfield/Arena style (round-trips through the importer). */
export function exportDeckTxt(deckId: number): string {
  const d = getDeck(deckId, { light: true });
  const line = (c: (typeof d.cards)[number]) =>
    `${c.qty} ${c.card.name} (${c.card.set.toUpperCase()}) ${c.card.number}${c.finish === 'foil' ? ' *F*' : c.finish === 'etched' ? ' *E*' : ''}`;
  const section = (title: string, pick: (c: (typeof d.cards)[number]) => boolean) => {
    const cs = d.cards.filter(pick);
    return cs.length ? [title, ...cs.map(line), ''] : [];
  };
  // Optional commanders are part of the 99; giving them their own section means a re-import keeps
  // the short-list, while other apps simply read them as deck cards.
  return [
    ...section('Commander', c => c.board === 'commander'),
    ...section('Companion', c => c.board === 'companion'),
    ...section('// OPTIONAL COMMANDERS', c => c.board === 'main' && c.altCommander),
    ...section('Deck', c => c.board === 'main' && !c.altCommander),
    ...section('Maybeboard', c => c.board === 'maybe'),
  ].join('\r\n');
}
