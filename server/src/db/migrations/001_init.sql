CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  oracle_id TEXT,
  name TEXT NOT NULL,
  front_name TEXT NOT NULL,
  lang TEXT,
  set_code TEXT NOT NULL,
  set_name TEXT,
  collector_number TEXT NOT NULL,
  rarity TEXT,
  released_at TEXT,
  layout TEXT,
  finishes TEXT NOT NULL DEFAULT '[]',
  border_color TEXT,
  frame TEXT,
  frame_effects TEXT NOT NULL DEFAULT '[]',
  full_art INTEGER NOT NULL DEFAULT 0,
  promo INTEGER NOT NULL DEFAULT 0,
  promo_types TEXT NOT NULL DEFAULT '[]',
  variation INTEGER NOT NULL DEFAULT 0,
  type_line TEXT,
  mana_cost TEXT,
  cmc REAL,
  power TEXT,
  toughness TEXT,
  colors TEXT NOT NULL DEFAULT '[]',
  color_identity TEXT NOT NULL DEFAULT '[]',
  oracle_text TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',
  commander_legality TEXT,
  game_changer INTEGER NOT NULL DEFAULT 0,
  tcgplayer_id INTEGER,
  tcgplayer_etched_id INTEGER,
  image_small TEXT,
  image_normal TEXT,
  image_back TEXT,
  scryfall_usd REAL,
  scryfall_usd_foil REAL,
  scryfall_usd_etched REAL
);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cards_front ON cards(front_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cards_set_num ON cards(set_code, collector_number);
CREATE INDEX IF NOT EXISTS idx_cards_tcg ON cards(tcgplayer_id);
CREATE INDEX IF NOT EXISTS idx_cards_tcg_etched ON cards(tcgplayer_etched_id);
CREATE INDEX IF NOT EXISTS idx_cards_oracle ON cards(oracle_id);

CREATE TABLE IF NOT EXISTS sets (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  set_type TEXT,
  released_at TEXT,
  card_count INTEGER,
  icon_svg_uri TEXT,
  parent_set_code TEXT
);

CREATE TABLE IF NOT EXISTS binders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'binder', -- binder | box | deck
  deck_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO binders (id, name, kind) VALUES (1, 'Main Collection', 'binder');

CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id TEXT NOT NULL REFERENCES cards(id),
  finish TEXT NOT NULL CHECK (finish IN ('nonfoil','foil','etched')),
  condition TEXT NOT NULL CHECK (condition IN ('NM','LP','MP')),
  lang TEXT NOT NULL DEFAULT 'en',
  qty INTEGER NOT NULL CHECK (qty > 0),
  binder_id INTEGER NOT NULL DEFAULT 1 REFERENCES binders(id),
  source_deck_id INTEGER,
  purchase_price REAL,
  notes TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ci_card ON collection_items(scryfall_id);
CREATE INDEX IF NOT EXISTS idx_ci_binder ON collection_items(binder_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#c0392b'
);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id TEXT NOT NULL REFERENCES cards(id),
  finish TEXT NOT NULL CHECK (finish IN ('nonfoil','foil','etched')),
  condition TEXT NOT NULL CHECK (condition IN ('NM','LP','MP')),
  qty INTEGER NOT NULL DEFAULT 1,
  target_price REAL,
  notes TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_collection')),
  target_bracket INTEGER,
  notes TEXT,
  binder_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deck_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  scryfall_id TEXT NOT NULL REFERENCES cards(id),
  finish TEXT NOT NULL CHECK (finish IN ('nonfoil','foil','etched')),
  condition TEXT NOT NULL CHECK (condition IN ('NM','LP','MP')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  board TEXT NOT NULL DEFAULT 'main' CHECK (board IN ('commander','main','companion','maybe'))
);
CREATE INDEX IF NOT EXISTS idx_dc_deck ON deck_cards(deck_id);

-- Change log. For decks that are in the collection, tracked rows with synced_at NULL are pending.
CREATE TABLE IF NOT EXISTS deck_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('add','remove','change')),
  board TEXT NOT NULL DEFAULT 'main',
  qty INTEGER NOT NULL,
  before_scryfall_id TEXT, before_finish TEXT, before_condition TEXT,
  after_scryfall_id TEXT, after_finish TEXT, after_condition TEXT,
  tracked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_deck ON deck_changes(deck_id);

CREATE TABLE IF NOT EXISTS misc_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id TEXT NOT NULL REFERENCES cards(id),
  finish TEXT NOT NULL,
  condition TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  from_deck_id INTEGER,
  from_deck_name TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prices (
  scryfall_id TEXT NOT NULL,
  finish TEXT NOT NULL,
  condition TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('justtcg','tcg_last5')),
  price REAL NOT NULL,
  sample_size INTEGER,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scryfall_id, finish, condition, source)
);

-- When each card was last looked up at JustTCG (even if nothing came back)
CREATE TABLE IF NOT EXISTS price_lookups (
  scryfall_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'main' | 'etched'
  last_attempt TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scryfall_id, kind)
);

CREATE TABLE IF NOT EXISTS price_history (
  date TEXT NOT NULL,
  scryfall_id TEXT NOT NULL,
  finish TEXT NOT NULL,
  condition TEXT NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (date, scryfall_id, finish, condition)
);
CREATE INDEX IF NOT EXISTS idx_ph_card ON price_history(scryfall_id, finish, condition);

CREATE TABLE IF NOT EXISTS value_history (
  date TEXT PRIMARY KEY,
  total REAL NOT NULL,
  card_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT,
  format TEXT,
  destination TEXT,
  rows_total INTEGER,
  rows_imported INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Current price per printing/finish/condition: a fresh (<= 7 day) last-5-sales average wins,
-- otherwise the JustTCG price.
CREATE VIEW IF NOT EXISTS current_prices AS
SELECT k.scryfall_id, k.finish, k.condition,
  CASE WHEN l.price IS NOT NULL AND l.fetched_at >= datetime('now','-7 days') THEN l.price ELSE j.price END AS price,
  CASE WHEN l.price IS NOT NULL AND l.fetched_at >= datetime('now','-7 days') THEN 'tcg_last5' ELSE 'justtcg' END AS source,
  CASE WHEN l.price IS NOT NULL AND l.fetched_at >= datetime('now','-7 days') THEN l.fetched_at ELSE j.fetched_at END AS fetched_at
FROM (SELECT DISTINCT scryfall_id, finish, condition FROM prices) k
LEFT JOIN prices j ON j.scryfall_id=k.scryfall_id AND j.finish=k.finish AND j.condition=k.condition AND j.source='justtcg'
LEFT JOIN prices l ON l.scryfall_id=k.scryfall_id AND l.finish=k.finish AND l.condition=k.condition AND l.source='tcg_last5';
