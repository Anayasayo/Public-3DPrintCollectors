import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseTxt } from '../import/parseTxt.js';
import { readSheet, sheetToRows } from '../import/parseSheet.js';
import { resolveRow } from '../import/resolve.js';
import { commitImport } from '../import/commit.js';
import { exportCsv, exportWorkbook } from '../export/export.js';
import { getSetting } from '../db/index.js';
import { HttpError } from '../decks/service.js';
import type { ColumnMapping, ParsedRow } from '../import/types.js';

export const io = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * Parse + match an uploaded file (xlsx/xls/csv/tsv/txt) or pasted text. Nothing is saved:
 * the client reviews the rows and then calls /import/commit.
 */
io.post('/import/preview', upload.single('file'), (req, res) => {
  const text: string | undefined = req.body?.text;
  const file = req.file;
  if (!file && !text) throw new HttpError(400, 'Upload a file or paste a list.');
  const filename = file?.originalname ?? 'pasted.txt';
  const mapping: ColumnMapping | undefined = req.body?.mapping ? JSON.parse(req.body.mapping) : undefined;
  const defaultCondition = (req.body?.defaultCondition ?? getSetting('default_condition') ?? 'NM') as 'NM' | 'LP' | 'MP';

  let parsed: ParsedRow[];
  let format: string;
  let sheetInfo: { sheetNames: string[]; sheet: string; headers: string[]; mapping: ColumnMapping } | undefined;
  const isPlainText = !file || (/\.txt$/i.test(filename) && !looksTabular(file.buffer.toString('utf8')));
  if (isPlainText) {
    parsed = parseTxt(text ?? file!.buffer.toString('utf8'));
    format = 'txt';
  } else {
    const data = readSheet(file!.buffer, filename, req.body?.sheet);
    const r = sheetToRows(data, mapping);
    parsed = r.rows;
    format = /\.xlsx?$/i.test(filename) ? 'excel' : 'csv';
    sheetInfo = { sheetNames: data.sheetNames, sheet: data.sheet, headers: data.headers, mapping: r.mapping };
  }
  if (parsed.length > 20000) throw new HttpError(400, 'File has more than 20,000 rows — split it into smaller files.');
  const rows = parsed.map(p => resolveRow(p, { defaultCondition }));
  const counts = { resolved: 0, ambiguous: 0, unresolved: 0, flagged: 0 };
  for (const r of rows) counts[r.status]++;

  // A deck can have at most two commanders. If a file marks more (an unusual section layout),
  // keep the first two and hand the rest back as deck cards rather than importing nonsense.
  const commanderRows = rows.filter(r => r.board === 'commander');
  if (commanderRows.length > 2) {
    for (const r of commanderRows.slice(2)) {
      r.board = 'main';
      r.issues.push('More than two commanders were marked in this file — treated as a deck card.');
    }
  }
  const commanders = rows.filter(r => r.board === 'commander').map(r => ({
    line: r.line, name: r.card?.name ?? r.raw, set: r.card?.set, number: r.card?.number, image: r.card?.image,
  }));

  const hasBoards = rows.some(r => r.board && r.board !== 'main');
  const hasDeckColumn = rows.some(r => r.deck);
  res.json({
    filename, format, ...sheetInfo, rows, counts, commanders,
    looksLikeDeck: hasBoards || hasDeckColumn, hasDeckColumn,
  });
});

/** A .txt that is really a CSV/TSV export. */
function looksTabular(text: string) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return (first.split(',').length >= 3 || first.split('\t').length >= 3) && /name/i.test(first);
}

const commitSchema = z.object({
  filename: z.string().optional(),
  format: z.string().optional(),
  destination: z.enum(['collection', 'deck', 'wishlist']),
  binderId: z.number().int().nullable().optional(),
  useFileBinders: z.boolean().optional(),
  deckId: z.number().int().nullable().optional(),
  deckName: z.string().optional(),
  splitByDeckColumn: z.boolean().optional(),
  commanderScryfallIds: z.array(z.string()).optional(),
  rows: z.array(z.object({
    scryfallId: z.string(),
    qty: z.number().int().positive(),
    finish: z.enum(['nonfoil', 'foil', 'etched']),
    condition: z.enum(['NM', 'LP', 'MP']),
    action: z.enum(['import', 'skip', 'misc']),
    board: z.enum(['commander', 'main', 'companion', 'maybe']).nullable().optional(),
    altCommander: z.boolean().optional(),
    binder: z.string().optional(),
    deck: z.string().optional(),
    purchasePrice: z.number().nullable().optional(),
    notes: z.string().optional(),
  })),
});

io.post('/import/commit', (req, res) => {
  res.json(commitImport(commitSchema.parse(req.body)));
});

const stamp = () => new Date().toISOString().slice(0, 10);

io.get('/export/xlsx', (req, res) => {
  const parts = String(req.query.parts ?? 'collection,decks,misc,wishlist').split(',') as any[];
  const deckIds = req.query.deckIds ? String(req.query.deckIds).split(',').map(Number) : undefined;
  const buf = exportWorkbook(parts, deckIds);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="3DPrintCollectors-${stamp()}.xlsx"`);
  res.send(buf);
});

io.get('/export/csv', (req, res) => {
  const format = z.enum(['native', 'manabox', 'moxfield']).parse(req.query.format ?? 'native');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="3DPrintCollectors-${format}-${stamp()}.csv"`);
  res.send('﻿' + exportCsv(format));
});
