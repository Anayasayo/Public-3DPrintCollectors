import type { Finish } from '../scryfall/cards.js';
import type { Board } from '../decks/validateCommander.js';

export type RawCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

/** Map the many condition spellings used by other apps to TCGplayer's grades. */
export function normalizeCondition(v: unknown): RawCondition | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (['m', 'mint', 'nm', 'near mint', 'nearmint', 'nm m', 'nm/m', 'mint/near mint', 'near mint foil', 'new'].includes(s) || s.startsWith('near mint')) return 'NM';
  if (['lp', 'lightly played', 'light play', 'light played', 'slightly played', 'sp', 'ex', 'excellent', 'lightplayed', 'nm lp'].includes(s) || s.startsWith('lightly played')) return 'LP';
  if (['mp', 'moderately played', 'moderate play', 'moderate played', 'played', 'pl', 'good', 'gd', 'vg', 'very good', 'moderatelyplayed'].includes(s) || s.startsWith('moderately played')) return 'MP';
  if (['hp', 'heavily played', 'heavy play', 'heavy played', 'poor', 'po', 'heavilyplayed'].includes(s) || s.startsWith('heavily played')) return 'HP';
  if (['dmg', 'damaged', 'd', 'dm'].includes(s) || s.startsWith('damaged')) return 'DMG';
  return null;
}

/** "foil", "Foil", "true", "yes", "etched", "Normal", "" ... -> finish (null when unspecified). */
export function normalizeFinish(v: unknown): Finish | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  if (!s) return null;
  if (s.includes('etched')) return 'etched';
  if (['false', 'no', 'n', '0', 'normal', 'nonfoil', 'non-foil', 'non foil', 'regular'].includes(s)) return 'nonfoil';
  if (s.includes('foil') || ['true', 'yes', 'y', '1', 'f', 'x'].includes(s)) return 'foil';
  return null;
}

export function normalizeBoard(v: unknown): Board | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  if (!s) return null;
  if (s.includes('optional commander') || s.includes('alt commander') || s.includes('alternative commander')) return 'main';
  if (s.includes('commander') || s === 'cmdr' || s === 'command zone') return 'commander';
  if (s.includes('companion')) return 'companion';
  if (s.includes('maybe') || s.includes('side') || s.includes('considering')) return 'maybe';
  if (s.includes('main') || s === 'deck' || s.includes('mainboard')) return 'main';
  return null;
}

const LANGS: Record<string, string> = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja', korean: 'ko',
  russian: 'ru', 'chinese simplified': 'zhs', 'simplified chinese': 'zhs', 'chinese traditional': 'zht', 'traditional chinese': 'zht',
  phyrexian: 'ph',
};
export function normalizeLang(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  if (!s) return null;
  return LANGS[s] ?? (s.length <= 3 ? s : null);
}

export function parseQty(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/x$/i, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseMoney(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
