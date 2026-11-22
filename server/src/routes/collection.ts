import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { getCards, type Card } from '../scryfall/cards.js';
import { priceSql, round, collectionSummary } from '../pricing/valuation.js';
import { HttpError } from '../decks/service.js';

export const collection = Router();

const finish = z.enum(['nonfoil', 'foil', 'etched']);
const condition = z.enum(['NM', 'LP', 'MP']);

/** SQL filter for a style key (used by collection + search filters). */
export const STYLE_SQL: Record<string, string> = {
  borderless: "c.border_color = 'borderless'",
  showcase: "c.frame_effects LIKE '%\"showcase\"%'",
  extendedart: "c.frame_effects LIKE '%\"extendedart\"%'",
  fullart: 'c.full_art = 1',
  retro: "c.frame IN ('1997','1993')",
  serialized: "c.promo_types LIKE '%\"serialized\"%'",
  surgefoil: "c.promo_types LIKE '%\"surgefoil\"%'",
  galaxyfoil: "c.promo_types LIKE '%\"galaxyfoil\"%'",
  textured: "c.promo_types LIKE '%\"textured\"%'",
  promo: 'c.promo = 1',
  variant: 'c.variation = 1',
  gamechanger: 'c.game_changer = 1',
};

function assertFinish(scryfallId: string, f: string): Card {
  const card = getCards([scryfallId]).get(scryfallId);
  if (!card) throw new HttpError(400, 'Unknown card');
  if (!card.finishes.includes(f as any)) throw new HttpError(400, `${card.name} (${card.set.toUpperCase()} #${card.number}) doesn't come in ${f}.`);
  return card;
}

export function buildCollectionFilter(q: Record<string, any>) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (q.q) { where.push('(c.name LIKE ? OR c.type_line LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  if (q.binder) { where.push('ci.binder_id = ?'); params.push(Number(q.binder)); }
  if (q.set) { where.push('c.set_code = ?'); params.push(String(q.set).toLowerCase()); }
  if (q.rarity) { where.push('c.rarity = ?'); params.push(q.rarity); }
  if (q.finish) { where.push('ci.finish = ?'); params.push(q.finish); }
  if (q.condition) { where.push('ci.condition = ?'); params.push(q.condition); }
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = ci.id AND it.tag_id = ?)'); params.push(Number(q.tag)); }
  if (q.style && STYLE_SQL[q.style]) where.push(STYLE_SQL[q.style]);
  if (q.color) {
    const col = String(q.color);
    if (col === 'C') where.push("c.color_identity = '[]'");
    else if (col === 'M') where.push("json_array_length(c.color_identity) > 1");
    else { where.push('c.color_identity LIKE ?'); params.push(`%"${col}"%`); }
  }
  if (q.type) { where.push('c.type_line LIKE ?'); params.push(`%${q.type}%`); }
  return { where: where.join(' AND '), params };
}

const SORTS: Record<string, string> = {
  name: 'c.name COLLATE NOCASE ASC',
  value: 'total DESC NULLS LAST',
  price: 'price DESC NULLS LAST',
  added: 'ci.added_at DESC, ci.id DESC',
  set: 'c.released_at DESC, c.set_code, CAST(c.collector_number AS INTEGER)',
  qty: 'ci.qty DESC',
};

collection.get('/collection', (req, res) => {
  const q = req.query as Record<string, string>;
  const { where, params } = buildCollectionFilter(q);
  const p = priceSql('ci');
  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Number(q.pageSize ?? 60)));
  const sort = SORTS[q.sort ?? 'name'] ?? SORTS.name;
  const rows = db.prepare(`SELECT ci.*, b.name AS binder_name, b.kind AS binder_kind, ${p.price} AS price, ${p.source} AS price_source,
      ${p.fetchedAt} AS price_at, ci.qty * ${p.price} AS total
    FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id JOIN binders b ON b.id = ci.binder_id ${p.join}
    WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as any[];
  const cards = getCards(rows.map(r => r.scryfall_id));
  const tagRows = rows.length ? db.prepare(`SELECT it.item_id, t.id, t.name, t.color FROM item_tags it JOIN tags t ON t.id = it.tag_id
    WHERE it.item_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map(r => r.id)) as any[] : [];
  const summary = collectionSummary(where, params);
  res.json({
    page, pageSize, summary,
    items: rows.map(r => ({
      id: r.id, qty: r.qty, finish: r.finish, condition: r.condition, lang: r.lang, binderId: r.binder_id, binderName: r.binder_name,
      binderKind: r.binder_kind, sourceDeckId: r.source_deck_id, purchasePrice: r.purchase_price, notes: r.notes, addedAt: r.added_at,
      price: r.price, priceSource: r.price_source, priceAt: r.price_at, total: r.total != null ? round(r.total) : null,
      tags: tagRows.filter(t => t.item_id === r.id).map(t => ({ id: t.id, name: t.name, color: t.color })),
      card: cards.get(r.scryfall_id),
    })),
  });
});

const itemInput = z.object({
  scryfallId: z.string(),
  finish,
  condition,
  qty: z.number().int().positive().default(1),
  binderId: z.number().int().optional(),
  purchasePrice: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  tagIds: z.array(z.number().int()).optional(),
});

collection.post('/collection', (req, res) => {
  const b = itemInput.parse(req.body);
  assertFinish(b.scryfallId, b.finish);
  const binderId = b.binderId ?? 1;
  const existing = db.prepare(`SELECT id FROM collection_items WHERE scryfall_id = ? AND finish = ? AND condition = ? AND binder_id = ?
    AND source_deck_id IS NULL AND purchase_price IS NULL AND notes IS NULL`).get(b.scryfallId, b.finish, b.condition, binderId) as any;
  let id: number;
  if (existing && b.purchasePrice == null && !b.notes && !b.tagIds?.length) {
    db.prepare('UPDATE collection_items SET qty = qty + ? WHERE id = ?').run(b.qty, existing.id);
    id = existing.id;
  } else {
    id = Number(db.prepare('INSERT INTO collection_items (scryfall_id, finish, condition, qty, binder_id, purchase_price, notes) VALUES (?,?,?,?,?,?,?)')
      .run(b.scryfallId, b.finish, b.condition, b.qty, binderId, b.purchasePrice ?? null, b.notes ?? null).lastInsertRowid);
    for (const t of b.tagIds ?? []) db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(id, t);
  }
  res.json({ id });
});

collection.patch('/collection/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM collection_items WHERE id = ?').get(id) as any;
  if (!cur) throw new HttpError(404, 'Item not found');
  const b = itemInput.partial().parse(req.body);
  const next = { ...cur, ...Object.fromEntries(Object.entries({
    scryfall_id: b.scryfallId, finish: b.finish, condition: b.condition, qty: b.qty, binder_id: b.binderId,
    purchase_price: b.purchasePrice, notes: b.notes,
  }).filter(([, v]) => v !== undefined)) };
  assertFinish(next.scryfall_id, next.finish);
  db.prepare('UPDATE collection_items SET scryfall_id=?, finish=?, condition=?, qty=?, binder_id=?, purchase_price=?, notes=? WHERE id=?')
    .run(next.scryfall_id, next.finish, next.condition, next.qty, next.binder_id, next.purchase_price, next.notes, id);
  if (b.tagIds) {
    db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
    for (const t of b.tagIds) db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(id, t);
  }
  res.json({ ok: true });
});

collection.delete('/collection/:id', (req, res) => {
  db.prepare('DELETE FROM collection_items WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

collection.post('/collection/bulk', (req, res) => {
  const b = z.object({
    ids: z.array(z.number().int()).min(1),
    action: z.enum(['move', 'delete', 'tag', 'untag', 'misc']),
    binderId: z.number().int().optional(),
    tagId: z.number().int().optional(),
  }).parse(req.body);
  const inList = b.ids.map(() => '?').join(',');
  db.transaction(() => {
    if (b.action === 'move') db.prepare(`UPDATE collection_items SET binder_id = ? WHERE id IN (${inList})`).run(b.binderId ?? 1, ...b.ids);
    if (b.action === 'delete') db.prepare(`DELETE FROM collection_items WHERE id IN (${inList})`).run(...b.ids);
    if (b.action === 'misc') {
      db.prepare(`INSERT INTO misc_items (scryfall_id, finish, condition, qty, reason) SELECT scryfall_id, finish, condition, qty, 'Moved from collection'
        FROM collection_items WHERE id IN (${inList})`).run(...b.ids);
      db.prepare(`DELETE FROM collection_items WHERE id IN (${inList})`).run(...b.ids);
    }
    if (b.action === 'tag' && b.tagId) for (const id of b.ids) db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(id, b.tagId);
    if (b.action === 'untag' && b.tagId) db.prepare(`DELETE FROM item_tags WHERE tag_id = ? AND item_id IN (${inList})`).run(b.tagId, ...b.ids);
  })();
  res.json({ ok: true });
});

// ---- Binders ----
collection.get('/binders', (_req, res) => {
  const p = priceSql('ci');
  const rows = db.prepare(`SELECT b.*, COALESCE(SUM(ci.qty), 0) AS cards, COALESCE(SUM(ci.qty * ${p.price}), 0) AS value
    FROM binders b LEFT JOIN collection_items ci ON ci.binder_id = b.id LEFT JOIN cards c ON c.id = ci.scryfall_id ${p.join}
    GROUP BY b.id ORDER BY b.kind = 'deck', b.id = 1 DESC, b.name`).all() as any[];
  res.json(rows.map(r => ({ id: r.id, name: r.name, kind: r.kind, deckId: r.deck_id, cards: r.cards, value: round(r.value) })));
});

collection.post('/binders', (req, res) => {
  const b = z.object({ name: z.string().min(1), kind: z.enum(['binder', 'box']).default('binder') }).parse(req.body);
  if (db.prepare('SELECT 1 FROM binders WHERE name = ?').get(b.name)) throw new HttpError(400, 'A binder with that name already exists.');
  res.json({ id: Number(db.prepare('INSERT INTO binders (name, kind) VALUES (?, ?)').run(b.name.trim(), b.kind).lastInsertRowid) });
});

collection.patch('/binders/:id', (req, res) => {
  const b = z.object({ name: z.string().min(1) }).parse(req.body);
  db.prepare("UPDATE binders SET name = ? WHERE id = ? AND kind != 'deck'").run(b.name.trim(), Number(req.params.id));
  res.json({ ok: true });
});

collection.delete('/binders/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === 1) throw new HttpError(400, "The Main Collection binder can't be deleted.");
  const b = db.prepare('SELECT * FROM binders WHERE id = ?').get(id) as any;
  if (b?.kind === 'deck') throw new HttpError(400, 'Deck binders are managed from the deck page.');
  db.transaction(() => {
    db.prepare('UPDATE collection_items SET binder_id = 1 WHERE binder_id = ?').run(id);
    db.prepare('DELETE FROM binders WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

// ---- Tags ----
collection.get('/tags', (_req, res) => {
  res.json(db.prepare('SELECT t.*, (SELECT COUNT(*) FROM item_tags it WHERE it.tag_id = t.id) AS items FROM tags t ORDER BY name').all());
});
collection.post('/tags', (req, res) => {
  const b = z.object({ name: z.string().min(1), color: z.string().default('#c0392b') }).parse(req.body);
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(b.name) as any;
  res.json({ id: existing?.id ?? Number(db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(b.name.trim(), b.color).lastInsertRowid) });
});
collection.delete('/tags/:id', (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Wishlist ----
collection.get('/wishlist', (_req, res) => {
  const p = priceSql('w');
  const rows = db.prepare(`SELECT w.*, ${p.price} AS price, ${p.source} AS price_source FROM wishlist_items w
    JOIN cards c ON c.id = w.scryfall_id ${p.join} ORDER BY w.added_at DESC`).all() as any[];
  const cards = getCards(rows.map(r => r.scryfall_id));
  const items = rows.map(r => ({
    id: r.id, qty: r.qty, finish: r.finish, condition: r.condition, targetPrice: r.target_price, notes: r.notes, addedAt: r.added_at,
    price: r.price, priceSource: r.price_source, atOrBelowTarget: r.target_price != null && r.price != null && r.price <= r.target_price,
    card: cards.get(r.scryfall_id),
  }));
  res.json({ items, total: round(items.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0)) });
});

const wishInput = z.object({ scryfallId: z.string(), finish, condition, qty: z.number().int().positive().default(1), targetPrice: z.number().nullable().optional(), notes: z.string().nullable().optional() });
collection.post('/wishlist', (req, res) => {
  const b = wishInput.parse(req.body);
  assertFinish(b.scryfallId, b.finish);
  res.json({ id: Number(db.prepare('INSERT INTO wishlist_items (scryfall_id, finish, condition, qty, target_price, notes) VALUES (?,?,?,?,?,?)')
    .run(b.scryfallId, b.finish, b.condition, b.qty, b.targetPrice ?? null, b.notes ?? null).lastInsertRowid) });
});
collection.patch('/wishlist/:id', (req, res) => {
  const b = wishInput.partial().parse(req.body);
  const cur = db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(Number(req.params.id)) as any;
  if (!cur) throw new HttpError(404, 'Not found');
  db.prepare('UPDATE wishlist_items SET finish=?, condition=?, qty=?, target_price=?, notes=? WHERE id=?').run(
    b.finish ?? cur.finish, b.condition ?? cur.condition, b.qty ?? cur.qty,
    b.targetPrice === undefined ? cur.target_price : b.targetPrice, b.notes === undefined ? cur.notes : b.notes, cur.id);
  res.json({ ok: true });
});
collection.delete('/wishlist/:id', (req, res) => {
  db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
/** Got it! Move a wishlist item into the collection. */
collection.post('/wishlist/:id/acquire', (req, res) => {
  const b = z.object({ binderId: z.number().int().optional(), purchasePrice: z.number().nullable().optional() }).parse(req.body ?? {});
  const w = db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(Number(req.params.id)) as any;
  if (!w) throw new HttpError(404, 'Not found');
  db.transaction(() => {
    db.prepare('INSERT INTO collection_items (scryfall_id, finish, condition, qty, binder_id, purchase_price) VALUES (?,?,?,?,?,?)')
      .run(w.scryfall_id, w.finish, w.condition, w.qty, b.binderId ?? 1, b.purchasePrice ?? null);
    db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(w.id);
  })();
  res.json({ ok: true });
});

// ---- Miscellaneous ----
collection.get('/misc', (_req, res) => {
  const p = priceSql('m');
  const rows = db.prepare(`SELECT m.*, ${p.price} AS price, ${p.source} AS price_source FROM misc_items m
    JOIN cards c ON c.id = m.scryfall_id ${p.join} ORDER BY m.created_at DESC, m.id DESC`).all() as any[];
  const cards = getCards(rows.map(r => r.scryfall_id));
  const items = rows.map(r => ({
    id: r.id, qty: r.qty, finish: r.finish, condition: r.condition, fromDeckId: r.from_deck_id, fromDeckName: r.from_deck_name,
    reason: r.reason, createdAt: r.created_at, price: r.price, priceSource: r.price_source, card: cards.get(r.scryfall_id),
  }));
  res.json({ items, total: round(items.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0)) });
});

collection.post('/misc/to-collection', (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).min(1), binderId: z.number().int().optional() }).parse(req.body);
  db.transaction(() => {
    for (const id of b.ids) {
      const m = db.prepare('SELECT * FROM misc_items WHERE id = ?').get(id) as any;
      if (!m) continue;
      const cond = ['NM', 'LP', 'MP'].includes(m.condition) ? m.condition : 'MP';
      db.prepare('INSERT INTO collection_items (scryfall_id, finish, condition, qty, binder_id) VALUES (?,?,?,?,?)').run(m.scryfall_id, m.finish, cond, m.qty, b.binderId ?? 1);
      db.prepare('DELETE FROM misc_items WHERE id = ?').run(id);
    }
  })();
  res.json({ ok: true });
});

collection.post('/misc/remove', (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).min(1) }).parse(req.body);
  db.prepare(`DELETE FROM misc_items WHERE id IN (${b.ids.map(() => '?').join(',')})`).run(...b.ids);
  res.json({ ok: true });
});
