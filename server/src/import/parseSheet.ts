import * as XLSX from 'xlsx';
import type { ColumnMapping, Field, ParsedRow } from './types.js';
import { normalizeBoard, normalizeCondition, normalizeFinish, normalizeLang, parseMoney, parseQty } from './normalize.js';
import { parseTxt } from './parseTxt.js';

/** Header synonyms (compared after lower-casing and stripping non-alphanumerics). */
const SYNONYMS: Record<Field, string[]> = {
  name: ['name', 'cardname', 'card', 'cardtitle', 'productname', 'title', 'simplename'],
  qty: ['quantity', 'qty', 'count', 'amount', 'copies', 'number of copies', 'havecount', 'quantityx', 'total quantity'],
  setCode: ['setcode', 'editioncode', 'expansioncode', 'setid', 'set code'],
  setName: ['setname', 'expansion', 'expansionname', 'editionname'],
  set: ['set', 'edition'],
  number: ['collectornumber', 'cardnumber', 'number', 'collector', 'cn', 'collectorno', 'no', 'num'],
  finish: ['foil', 'finish', 'printing', 'foiling', 'isfoil', 'variant', 'treatment'],
  condition: ['condition', 'cond', 'grade'],
  lang: ['language', 'lang'],
  board: ['board', 'section', 'category', 'categories', 'zone', 'type board'],
  scryfallId: ['scryfallid', 'scryfall', 'scryfalluuid'],
  tcgplayerId: ['tcgplayerid', 'productid', 'tcgplayerproductid', 'tcgid', 'tcgproductid'],
  purchasePrice: ['purchaseprice', 'pricepaid', 'cost', 'paid', 'acquiredprice', 'buyprice'],
  binder: ['binder', 'binders', 'location', 'binder name', 'folder', 'foldername', 'list', 'box'],
  deck: ['deck', 'deckname'],
  tags: ['tags', 'tag'],
  notes: ['notes', 'note', 'comment', 'comments'],
  line: ['line', 'decklist', 'entry', 'card line'],
};

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  // Exact synonym matches first, in field priority order.
  for (const field of Object.keys(SYNONYMS) as Field[]) {
    const syns = SYNONYMS[field].map(clean);
    const hit = headers.find(h => !used.has(h) && syns.includes(clean(h)));
    if (hit) { mapping[field] = hit; used.add(hit); }
  }
  // ManaBox/others: "Foil" and "Printing" both present -> prefer Foil; "Set code" + "Set name" -> drop generic set.
  if (mapping.setCode && mapping.set) { if (!mapping.setName) mapping.setName = mapping.set; delete mapping.set; }
  return mapping;
}

export interface SheetData {
  sheetNames: string[];
  sheet: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Read xlsx / xls / csv / tsv into header + row objects. */
export function readSheet(buf: Buffer, filename: string, sheetName?: string): SheetData {
  const isText = /\.(csv|tsv|txt)$/i.test(filename);
  const wb = isText
    ? XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true, FS: /\.tsv$/i.test(filename) ? '\t' : undefined })
    : XLSX.read(buf, { type: 'buffer' });
  const preferred = wb.SheetNames.find(n => /collection|cards|inventory/i.test(n));
  const sheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : preferred ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
  // Find the header row: the first row within the top 10 that maps a name-ish column.
  let headerIdx = matrix.findIndex((r, i) => i < 10 && detectMapping(r.map(String)).name !== undefined);
  if (headerIdx === -1) {
    // No header: synthesize column names.
    const width = Math.max(0, ...matrix.map(r => r.length));
    const headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    return { sheetNames: wb.SheetNames, sheet, headers, rows: matrix.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
  }
  const headers = matrix[headerIdx].map((h, i) => String(h).trim() || `Column ${i + 1}`);
  const rows = matrix.slice(headerIdx + 1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { sheetNames: wb.SheetNames, sheet, headers, rows };
}

const looksLikeSetCode = (s: string) => /^[a-z0-9]{2,6}$/i.test(s.trim());

/** Turn sheet rows into ParsedRows using a column mapping (auto-detected if not given). */
export function sheetToRows(data: SheetData, mapping?: ColumnMapping): { rows: ParsedRow[]; mapping: ColumnMapping } {
  let map = mapping && Object.keys(mapping).length ? mapping : detectMapping(data.headers);

  // Headerless sheet: a single text column of decklist lines, or [qty, name] pairs.
  if (!map.name && !map.line) {
    const sample = data.rows.slice(0, 20);
    const cols = data.headers;
    if (cols.length >= 2 && sample.every(r => parseQty(r[cols[0]]) != null || String(r[cols[0]]).trim() === '')) {
      map = { qty: cols[0], name: cols[1] };
    } else if (cols.length) {
      map = { line: cols[0] };
    }
  }

  const out: ParsedRow[] = [];
  data.rows.forEach((r, i) => {
    const get = (f: Field) => (map[f] ? String(r[map[f]!] ?? '').trim() : '');
    const lineNo = i + 2;
    if (map.line && !map.name) {
      const text = get('line');
      if (!text) return;
      for (const p of parseTxt(text)) out.push({ ...p, line: lineNo, raw: text });
      return;
    }
    const name = get('name');
    const scryfallId = get('scryfallId');
    const tcg = parseInt(get('tcgplayerId'), 10);
    if (!name && !scryfallId && !Number.isFinite(tcg)) return;

    let setCode = get('setCode') || undefined;
    let setName = get('setName') || undefined;
    const set = get('set');
    if (set) { if (!setCode && looksLikeSetCode(set)) setCode = set; else if (!setName) setName = set; }

    const condRaw = get('condition');
    // Printing columns sometimes carry condition too, e.g. "Near Mint Foil"
    const finishRaw = get('finish');
    out.push({
      line: lineNo,
      raw: data.headers.map(h => r[h]).filter(v => v !== '').join(' | '),
      qty: parseQty(get('qty')) ?? 1,
      name: name || undefined,
      setCode: setCode?.toLowerCase(),
      setName,
      number: get('number') || undefined,
      finish: normalizeFinish(finishRaw) ?? (/foil/i.test(condRaw) ? 'foil' : null),
      condition: normalizeCondition(condRaw),
      conditionRaw: condRaw || undefined,
      lang: normalizeLang(get('lang')),
      board: normalizeBoard(get('board')),
      altCommander: /optional commander|alt(?:ernative)? commander/i.test(get('board')),
      scryfallId: scryfallId || undefined,
      tcgplayerId: Number.isFinite(tcg) ? tcg : undefined,
      purchasePrice: parseMoney(get('purchasePrice')),
      binder: get('binder') || undefined,
      deck: get('deck') || undefined,
      tags: get('tags') || undefined,
      notes: get('notes') || undefined,
    });
  });
  return { rows: out, mapping: map };
}
