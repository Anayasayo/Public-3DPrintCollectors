import { db } from '../db/index.js';

export type Finish = 'nonfoil' | 'foil' | 'etched';
export type Condition = 'NM' | 'LP' | 'MP';
export const CONDITIONS: Condition[] = ['NM', 'LP', 'MP'];
export const FINISHES: Finish[] = ['nonfoil', 'foil', 'etched'];

/** Raw row from the `cards` table. JSON columns are strings. */
export interface CardRow {
  id: string;
  oracle_id: string | null;
  name: string;
  front_name: string;
  lang: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  released_at: string;
  layout: string;
  finishes: string;
  border_color: string;
  frame: string;
  frame_effects: string;
  full_art: number;
  promo: number;
  promo_types: string;
  variation: number;
  type_line: string | null;
  mana_cost: string | null;
  cmc: number | null;
  power: string | null;
  toughness: string | null;
  colors: string;
  color_identity: string;
  oracle_text: string | null;
  keywords: string;
  commander_legality: string | null;
  game_changer: number;
  tcgplayer_id: number | null;
  tcgplayer_etched_id: number | null;
  image_small: string | null;
  image_normal: string | null;
  image_back: string | null;
  scryfall_usd: number | null;
  scryfall_usd_foil: number | null;
  scryfall_usd_etched: number | null;
}

export interface Card {
  id: string;
  oracleId: string | null;
  name: string;
  lang: string;
  set: string;
  setName: string;
  number: string;
  rarity: string;
  releasedAt: string;
  finishes: Finish[];
  styles: string[];
  typeLine: string;
  manaCost: string;
  cmc: number;
  power: string | null;
  toughness: string | null;
  colors: string[];
  colorIdentity: string[];
  oracleText: string;
  keywords: string[];
  commanderLegality: string | null;
  gameChanger: boolean;
  tcgplayerId: number | null;
  tcgplayerEtchedId: number | null;
  image: string | null;
  imageSmall: string | null;
  imageBack: string | null;
}

const PROMO_LABELS: Record<string, string> = {
  surgefoil: 'Surge Foil', galaxyfoil: 'Galaxy Foil', textured: 'Textured Foil', serialized: 'Serialized',
  halofoil: 'Halo Foil', stepandcompleat: 'Step-and-Compleat Foil', oilslick: 'Oil Slick Foil',
  confettifoil: 'Confetti Foil', doublerainbow: 'Double Rainbow', gilded: 'Gilded Foil', neonink: 'Neon Ink',
  rainbowfoil: 'Rainbow Foil', raisedfoil: 'Raised Foil', fracturefoil: 'Fracture Foil', ripplefoil: 'Ripple Foil',
  manafoil: 'Mana Foil', firstplacefoil: 'First Place Foil', silverfoil: 'Silver Foil', invisibleink: 'Invisible Ink',
  prerelease: 'Prerelease', promopack: 'Promo Pack', buyabox: 'Buy-a-Box', bundle: 'Bundle', datestamped: 'Date Stamped',
  stamped: 'Stamped', boosterfun: 'Booster Fun', dragonscalefoil: 'Dragonscale Foil', singularityfoil: 'Singularity Foil',
  cosmicfoil: 'Cosmic Foil', chocobotrackfoil: 'Chocobo Track Foil', headliner: 'Headliner', poster: 'Poster',
};

/** Human-readable style badges that identify an exact printing. */
export function styleBadges(r: Pick<CardRow, 'border_color' | 'frame' | 'frame_effects' | 'full_art' | 'promo' | 'promo_types' | 'variation' | 'finishes'>): string[] {
  const out: string[] = [];
  const fx: string[] = JSON.parse(r.frame_effects || '[]');
  const promos: string[] = JSON.parse(r.promo_types || '[]');
  if (r.border_color === 'borderless') out.push('Borderless');
  if (fx.includes('showcase')) out.push('Showcase');
  if (fx.includes('extendedart')) out.push('Extended Art');
  if (r.full_art) out.push('Full Art');
  if (r.frame === '1997' || r.frame === '1993') out.push('Retro Frame');
  if (fx.includes('inverted')) out.push('Inverted');
  if (fx.includes('etched')) out.push('Etched Frame');
  if (r.border_color === 'gold') out.push('Gold Border');
  if (r.variation) out.push('Variant');
  for (const p of promos) if (PROMO_LABELS[p] && !out.includes(PROMO_LABELS[p])) out.push(PROMO_LABELS[p]);
  if (r.promo && !promos.some(p => PROMO_LABELS[p])) out.push('Promo');
  return out;
}

export function toCard(r: CardRow): Card {
  return {
    id: r.id,
    oracleId: r.oracle_id,
    name: r.name,
    lang: r.lang,
    set: r.set_code,
    setName: r.set_name,
    number: r.collector_number,
    rarity: r.rarity,
    releasedAt: r.released_at,
    finishes: JSON.parse(r.finishes),
    styles: styleBadges(r),
    typeLine: r.type_line ?? '',
    manaCost: r.mana_cost ?? '',
    cmc: r.cmc ?? 0,
    power: r.power,
    toughness: r.toughness,
    colors: JSON.parse(r.colors),
    colorIdentity: JSON.parse(r.color_identity),
    oracleText: r.oracle_text ?? '',
    keywords: JSON.parse(r.keywords),
    commanderLegality: r.commander_legality,
    gameChanger: !!r.game_changer,
    tcgplayerId: r.tcgplayer_id,
    tcgplayerEtchedId: r.tcgplayer_etched_id,
    image: r.image_normal,
    imageSmall: r.image_small,
    imageBack: r.image_back,
  };
}

export function getCard(id: string): Card | undefined {
  const r = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
  return r ? toCard(r) : undefined;
}

export function getCards(ids: string[]): Map<string, Card> {
  const map = new Map<string, Card>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = db.prepare(`SELECT * FROM cards WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as CardRow[];
    for (const r of rows) map.set(r.id, toCard(r));
  }
  return map;
}

/** Name search returning one row per distinct card name (newest printing first). */
export function searchNames(q: string, limit = 20): { name: string; id: string; image: string | null; count: number }[] {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db.prepare(`
    SELECT name, id, image_small AS image, cnt AS count FROM (
      SELECT name, id, image_small, released_at,
        COUNT(*) OVER (PARTITION BY name) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY name ORDER BY released_at DESC) AS rn,
        CASE WHEN front_name LIKE ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END AS rank
      FROM cards WHERE name LIKE ? OR front_name LIKE ?
    ) WHERE rn = 1 ORDER BY rank, length(name), name LIMIT ?`)
    .all(`${q}%`, `${q}%`, like, like, limit) as any[];
}

/** Every printing of a card name, newest first. */
export function printingsByName(name: string): Card[] {
  const rows = db.prepare(`SELECT * FROM cards WHERE name = ? COLLATE NOCASE OR front_name = ? COLLATE NOCASE
    ORDER BY released_at DESC, set_code, CAST(collector_number AS INTEGER), collector_number`).all(name, name) as CardRow[];
  return rows.map(toCard);
}

export function printingsByOracle(oracleId: string): Card[] {
  const rows = db.prepare(`SELECT * FROM cards WHERE oracle_id = ? ORDER BY released_at DESC, set_code, collector_number`).all(oracleId) as CardRow[];
  return rows.map(toCard);
}

export function catalogSize(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
}

/** Default finish for a printing when a source doesn't specify one. */
export function defaultFinish(card: Pick<Card, 'finishes'>, foil = false): Finish {
  if (foil) return card.finishes.includes('foil') ? 'foil' : card.finishes.includes('etched') ? 'etched' : card.finishes[0] ?? 'nonfoil';
  return card.finishes.includes('nonfoil') ? 'nonfoil' : card.finishes[0] ?? 'nonfoil';
}
