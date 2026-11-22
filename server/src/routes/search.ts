import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';

export const search = Router();

const LIMIT = 8;
// Escape LIKE wildcards so a search for "100%" or "_" matches those characters literally.
const like = (s: string) => `%${s.replace(/[\\%_]/g, m => `\\${m}`)}%`;

/** Search things you already have: collection, decks (by name, commander or card), binders, Miscellaneous and wishlist. */
search.get('/search', (req, res) => {
  const q = z.string().trim().max(100).parse(String(req.query.q ?? ''));
  if (q.length < 2) return void res.json({ q, collection: [], decks: [], deckCards: [], binders: [], misc: [], wishlist: [] });
  const p = like(q);

  // One row per card name, adding up copies across printings and binders.
  const collection = db.prepare(`SELECT c.name, MIN(c.id) AS cardId, MAX(c.image_small) AS image, SUM(ci.qty) AS qty,
      COUNT(DISTINCT c.id) AS printings, json_group_array(DISTINCT b.name) AS binders
    FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id JOIN binders b ON b.id = ci.binder_id
    WHERE c.name LIKE ? ESCAPE '\\'
    GROUP BY c.name ORDER BY (c.name LIKE ? ESCAPE '\\') DESC, c.name LIMIT ?`).all(p, like(q).slice(1), LIMIT) as any[];
  const collectionTotal = (db.prepare(`SELECT COUNT(DISTINCT c.name) AS n FROM collection_items ci JOIN cards c ON c.id = ci.scryfall_id
    WHERE c.name LIKE ? ESCAPE '\\'`).get(p) as any).n;

  const decks = db.prepare(`SELECT d.id, d.name, d.status,
      (SELECT GROUP_CONCAT(c.name, ' + ') FROM deck_cards dc JOIN cards c ON c.id = dc.scryfall_id WHERE dc.deck_id = d.id AND dc.board = 'commander') AS commanders,
      (SELECT c.image_small FROM deck_cards dc JOIN cards c ON c.id = dc.scryfall_id WHERE dc.deck_id = d.id AND dc.board = 'commander' LIMIT 1) AS image
    FROM decks d
    WHERE d.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM deck_cards dc JOIN cards c ON c.id = dc.scryfall_id
      WHERE dc.deck_id = d.id AND dc.board = 'commander' AND c.name LIKE ? ESCAPE '\\')
    ORDER BY d.name LIMIT ?`).all(p, p, LIMIT) as any[];

  // Cards inside decks, so "which deck is my Sol Ring in?" has an answer.
  const deckCards = db.prepare(`SELECT c.name, MIN(c.id) AS cardId, MAX(c.image_small) AS image,
      json_group_array(DISTINCT json_object('id', d.id, 'name', d.name)) AS decks
    FROM deck_cards dc JOIN cards c ON c.id = dc.scryfall_id JOIN decks d ON d.id = dc.deck_id
    WHERE c.name LIKE ? ESCAPE '\\' AND dc.board != 'maybe'
    GROUP BY c.name ORDER BY c.name LIMIT ?`).all(p, LIMIT) as any[];

  const binders = db.prepare(`SELECT b.id, b.name, b.kind, b.deck_id AS deckId, COALESCE(SUM(ci.qty), 0) AS qty
    FROM binders b LEFT JOIN collection_items ci ON ci.binder_id = b.id
    WHERE b.name LIKE ? ESCAPE '\\' GROUP BY b.id ORDER BY b.name LIMIT ?`).all(p, LIMIT) as any[];

  const misc = db.prepare(`SELECT c.name, MIN(c.id) AS cardId, MAX(c.image_small) AS image, SUM(m.qty) AS qty
    FROM misc_items m JOIN cards c ON c.id = m.scryfall_id
    WHERE c.name LIKE ? ESCAPE '\\' GROUP BY c.name ORDER BY c.name LIMIT ?`).all(p, LIMIT) as any[];

  const wishlist = db.prepare(`SELECT c.name, MIN(c.id) AS cardId, MAX(c.image_small) AS image, SUM(w.qty) AS qty
    FROM wishlist_items w JOIN cards c ON c.id = w.scryfall_id
    WHERE c.name LIKE ? ESCAPE '\\' GROUP BY c.name ORDER BY c.name LIMIT ?`).all(p, LIMIT) as any[];

  res.json({
    q,
    collection: collection.map(r => ({ ...r, binders: JSON.parse(r.binders) })),
    collectionTotal,
    decks,
    deckCards: deckCards.map(r => ({ ...r, decks: JSON.parse(r.decks) })),
    binders,
    misc,
    wishlist,
  });
});
