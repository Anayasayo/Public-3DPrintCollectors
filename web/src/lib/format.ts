import type { Condition, Finish } from './api';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n: number | null | undefined) => (n == null ? '—' : usd.format(n));
export const moneyShort = (n: number | null | undefined) =>
  n == null ? '—' : n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : usd.format(n);

export const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Normal', foil: 'Foil', etched: 'Etched' };
export const CONDITION_LABEL: Record<Condition, string> = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played' };
export const CONDITIONS: Condition[] = ['NM', 'LP', 'MP'];

export const SOURCE_LABEL: Record<string, string> = {
  justtcg: 'TCGplayer (JustTCG)',
  tcg_last5: 'TCGplayer last 5 sales',
  scryfall_market: 'TCGplayer market (fallback)',
};

export const RARITY_COLOR: Record<string, string> = {
  common: '#9aa3b5', uncommon: '#b8c7d9', rare: '#e2c171', mythic: '#f07a3a', special: '#b388ff', bonus: '#b388ff',
};

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'never';
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const priceKey = (id: string, finish: Finish, condition: Condition) => `${id}|${finish}|${condition}`;
