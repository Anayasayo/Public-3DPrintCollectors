import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseTxt } from '../src/import/parseTxt.js';
import { readSheet, sheetToRows, detectMapping } from '../src/import/parseSheet.js';
import { normalizeCondition, normalizeFinish } from '../src/import/normalize.js';

describe('parseTxt', () => {
  it('parses Moxfield/Arena style with sections, sets, numbers and foil flags', () => {
    const rows = parseTxt(`Commander
1 Atraxa, Praetors' Voice (2X2) 190 *F*

Deck
1 Sol Ring (C21) 263
1x Arcane Signet
10 Forest
1 Fire // Ice (MH2) 290 *E*

Sideboard
1 Swords to Plowshares`);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ qty: 1, name: "Atraxa, Praetors' Voice", setCode: '2x2', number: '190', finish: 'foil', board: 'commander' });
    expect(rows[1]).toMatchObject({ qty: 1, name: 'Sol Ring', setCode: 'c21', number: '263', board: 'main' });
    expect(rows[2]).toMatchObject({ qty: 1, name: 'Arcane Signet' });
    expect(rows[3]).toMatchObject({ qty: 10, name: 'Forest' });
    expect(rows[4]).toMatchObject({ name: 'Fire // Ice', finish: 'etched' });
    expect(rows[5]).toMatchObject({ name: 'Swords to Plowshares', board: 'maybe' });
  });

  it('ends the commander block at the blank line (Moxfield "// COMMANDER" export)', () => {
    const rows = parseTxt([
      '// COMMANDER',
      '1 Cosmic Spider-Man (SPM) 271 *F*',
      '',
      '1 Arachne, Psionic Weaver (SPM) 2',
      '1 Aunt May (SPM) 3',
      '2 Forest (J25) 94',
    ].join('\r\n'));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ name: 'Cosmic Spider-Man', setCode: 'spm', number: '271', finish: 'foil', board: 'commander' });
    expect(rows.slice(1).map(r => r.board)).toEqual([null, null, null]);
    expect(rows[3]).toMatchObject({ qty: 2, name: 'Forest' });
  });

  it('keeps two commanders in a partner block but not the cards after it', () => {
    const rows = parseTxt('// COMMANDER\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n\n1 Sol Ring\n');
    expect(rows.map(r => r.board)).toEqual(['commander', 'commander', null]);
  });

  it('parses Archidekt categories and plain MTGO lists', () => {
    const rows = parseTxt(`1x Krenko, Mob Boss (ddt) 52 [Commander{top}]\n1x Goblin Chieftain (m10) 139 [Creature]\nSB: 1 Pyroblast\n// comment\nLightning Bolt`);
    expect(rows[0]).toMatchObject({ name: 'Krenko, Mob Boss', board: 'commander', setCode: 'ddt' });
    expect(rows[1].board).toBe(null);
    expect(rows[2]).toMatchObject({ name: 'Pyroblast', board: 'maybe' });
    expect(rows[3]).toMatchObject({ qty: 1, name: 'Lightning Bolt' });
  });
});

describe('normalize', () => {
  it('maps conditions', () => {
    expect(normalizeCondition('Mint')).toBe('NM');
    expect(normalizeCondition('near_mint')).toBe('NM');
    expect(normalizeCondition('Near Mint Foil')).toBe('NM');
    expect(normalizeCondition('light_played')).toBe('LP');
    expect(normalizeCondition('Excellent')).toBe('LP');
    expect(normalizeCondition('played')).toBe('MP');
    expect(normalizeCondition('Heavily Played')).toBe('HP');
    expect(normalizeCondition('damaged')).toBe('DMG');
  });
  it('maps finishes', () => {
    expect(normalizeFinish('foil')).toBe('foil');
    expect(normalizeFinish('etched')).toBe('etched');
    expect(normalizeFinish('normal')).toBe('nonfoil');
    expect(normalizeFinish('')).toBe(null);
    expect(normalizeFinish('true')).toBe('foil');
  });
});

describe('spreadsheets', () => {
  it('reads a ManaBox CSV export', () => {
    const csv = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency\n' +
      '"Sol Ring",C21,Commander 2021,263,normal,uncommon,2,1,abc,1.5,false,false,near_mint,en,USD\n' +
      '"Lightning Bolt",2X2,Double Masters 2022,117,foil,uncommon,1,2,,,false,false,heavily_played,en,USD\n';
    const data = readSheet(Buffer.from(csv), 'manabox.csv');
    const { rows, mapping } = sheetToRows(data);
    expect(mapping).toMatchObject({ name: 'Name', setCode: 'Set code', setName: 'Set name', number: 'Collector number', finish: 'Foil', qty: 'Quantity', condition: 'Condition' });
    expect(rows[0]).toMatchObject({ name: 'Sol Ring', setCode: 'c21', number: '263', finish: 'nonfoil', qty: 2, condition: 'NM', purchasePrice: 1.5 });
    expect(rows[1]).toMatchObject({ finish: 'foil', condition: 'HP' });
  });

  it('reads a Moxfield collection CSV (Edition = set code)', () => {
    const csv = 'Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number\n1,0,Sol Ring,c21,Lightly Played,English,foil,,,263\n';
    const { rows } = sheetToRows(readSheet(Buffer.from(csv), 'moxfield.csv'));
    expect(rows[0]).toMatchObject({ qty: 1, name: 'Sol Ring', setCode: 'c21', condition: 'LP', finish: 'foil', number: '263' });
  });

  it('reads an Excel workbook with a header row and a deck board column', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['My deck export'],
      ['Quantity', 'Card Name', 'Set', 'Category'],
      [1, 'Krenko, Mob Boss', 'DDT', 'Commander'],
      [1, 'Sol Ring', 'Commander 2021', 'Artifact'],
    ]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const { rows } = sheetToRows(readSheet(buf, 'deck.xlsx'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ qty: 1, name: 'Krenko, Mob Boss', setCode: 'ddt', board: 'commander' });
    expect(rows[1]).toMatchObject({ name: 'Sol Ring', setName: 'Commander 2021' });
  });

  it('reads a headerless one-column sheet of decklist lines', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['1 Sol Ring (C21) 263'], ['2 Island']]), 'S');
    const { rows } = sheetToRows(readSheet(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'x.xlsx'));
    expect(rows.map(r => [r.qty, r.name])).toEqual([[1, 'Sol Ring'], [2, 'Island']]);
  });

  it('detects TCGplayer app headers', () => {
    const m = detectMapping(['Quantity', 'Name', 'Simple Name', 'Set', 'Card Number', 'Set Code', 'Printing', 'Condition', 'Language', 'Rarity', 'Product ID', 'SKU']);
    expect(m).toMatchObject({ qty: 'Quantity', name: 'Name', setCode: 'Set Code', setName: 'Set', number: 'Card Number', finish: 'Printing', tcgplayerId: 'Product ID' });
  });
});
