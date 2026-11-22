import type { ParsedRow } from './types.js';
import type { Board } from '../decks/validateCommander.js';
import { normalizeBoard, normalizeCondition } from './normalize.js';

/**
 * Parses plain-text decklists / collection lists in the common formats:
 *   1 Sol Ring                     (MTGO / plain)
 *   1x Sol Ring                    (Archidekt / TappedOut)
 *   1 Sol Ring (C21) 263           (MTG Arena / Moxfield)
 *   1 Sol Ring (C21) 263 *F*       (Moxfield foil; *E* = etched)
 *   1x Sol Ring (c21) 263 [Commander{top}]   (Archidekt categories)
 *   Sol Ring                       (quantity 1 implied)
 * Section headers: Commander, Deck, Mainboard, Sideboard, Maybeboard, Companion (with or without ':' or '//').
 */
const SECTION_RE = /^(?:\/\/\s*)?(optional commanders?|alt(?:ernative)? commanders?|commanders?|command zone|deck|main\s*board|main|mainboard|side\s*board|sideboard|maybe\s*board|maybeboard|maybe|considering|companion|tokens?)\s*:?\s*(?:\(\d+\))?$/i;
const LINE_RE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†\-\/]+))?)?((?:\s+\*[A-Za-z]+\*)*)(?:\s+\[([^\]]*)\])?(?:\s+\^[^^]*\^)?\s*$/;

export function sectionBoard(header: string): Board | null | 'skip' | 'alt-commander' {
  const s = header.toLowerCase().replace(/[:/]/g, '').trim();
  if (/^tokens?$/.test(s)) return 'skip';
  // Our own exports mark the alternative-commander short-list; they are ordinary cards of the 99.
  if (/^(optional|alt|alternative) commanders?$/.test(s)) return 'alt-commander';
  if (/^(deck|main ?board|main)$/.test(s)) return 'main';
  return normalizeBoard(s);
}

export function parseTxt(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let board: Board | null = null;
  let altCommander = false;
  let skipping = false;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) {
      // A blank line closes the commander/companion block. Moxfield-style exports write
      //   // COMMANDER
      //   1 Cosmic Spider-Man (SPM) 271 *F*
      //   <blank>
      //   1 Aunt May (SPM) 3          <- the deck, with no header of its own
      if (board === 'commander' || board === 'companion') board = null;
      altCommander = false;
      return;
    }
    const header = line.match(SECTION_RE);
    if (header) {
      const b = sectionBoard(header[1]);
      skipping = b === 'skip';
      altCommander = b === 'alt-commander';
      board = b === 'alt-commander' ? 'main' : b === 'skip' ? null : b;
      return;
    }
    if (line.startsWith('//') || line.startsWith('#') || /^(about|name)\s/i.test(line)) return;
    if (skipping) return;
    // "SB: 1 Card" (MTGO sideboard prefix)
    let body = line;
    let lineBoard: Board | null = board;
    if (/^SB:\s*/i.test(body)) { body = body.replace(/^SB:\s*/i, ''); lineBoard = 'maybe'; }

    const m = body.match(LINE_RE);
    if (!m) return;
    const [, qty, name, set, number, flags = '', category] = m;
    const flagList = [...flags.matchAll(/\*([A-Za-z]+)\*/g)].map(f => f[1].toUpperCase());
    let finish: ParsedRow['finish'] = null;
    if (flagList.includes('E')) finish = 'etched';
    else if (flagList.includes('F')) finish = 'foil';
    let conditionRaw: string | undefined;
    for (const f of flagList) if (normalizeCondition(f)) conditionRaw = f;
    if (category) {
      const cat = category.split(/[,{]/)[0];
      const b = normalizeBoard(cat);
      if (b) lineBoard = b;
    }
    rows.push({
      line: i + 1,
      raw: rawLine,
      qty: qty ? parseInt(qty, 10) : 1,
      name: name.trim(),
      setCode: set?.toLowerCase(),
      number,
      finish,
      condition: conditionRaw ? normalizeCondition(conditionRaw) : null,
      conditionRaw,
      board: lineBoard,
      altCommander: altCommander && lineBoard === 'main',
    });
  });
  return rows;
}
