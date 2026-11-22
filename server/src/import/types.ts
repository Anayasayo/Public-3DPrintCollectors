import type { Finish } from '../scryfall/cards.js';
import type { Board } from '../decks/validateCommander.js';
import type { RawCondition } from './normalize.js';

/** One card line from an imported file, before it's matched to a Scryfall printing. */
export interface ParsedRow {
  line: number;
  raw: string;
  qty: number;
  name?: string;
  setCode?: string;
  setName?: string;
  number?: string;
  finish?: Finish | null;
  condition?: RawCondition | null;
  conditionRaw?: string;
  lang?: string | null;
  board?: Board | null;
  /** Short-listed as an alternative commander (still one of the 99). */
  altCommander?: boolean;
  scryfallId?: string;
  tcgplayerId?: number;
  purchasePrice?: number | null;
  binder?: string;
  deck?: string;
  tags?: string;
  notes?: string;
}

export type Field =
  | 'name' | 'qty' | 'setCode' | 'setName' | 'set' | 'number' | 'finish' | 'condition' | 'lang' | 'board'
  | 'scryfallId' | 'tcgplayerId' | 'purchasePrice' | 'binder' | 'deck' | 'tags' | 'notes' | 'line';

export type ColumnMapping = Partial<Record<Field, string>>;
