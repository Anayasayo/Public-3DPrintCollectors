import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { getCard, printingsByName, printingsByOracle, searchNames } from '../scryfall/cards.js';
import { pricesForCards, round } from '../pricing/valuation.js';
import { refreshLast5 } from '../pricing/tcgLatestSales.js';
import { runRefresh, refreshState } from '../pricing/refresh.js';
import { HttpError } from '../decks/service.js';

export const cards = Router();

cards.get('/cards/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return void res.json([]);
  res.json(searchNames(q, 25));
});

cards.get('/cards/printings', (req, res) => {
  const list = req.query.oracleId ? printingsByOracle(String(req.query.oracleId)) : printingsByName(String(req.query.name ?? ''));
  res.json({ printings: list, prices: pricesForCards(list.map(c => c.id)) });
});

cards.get('/cards/:id', (req, res) => {
  const card = getCard(req.params.id);
  if (!card) throw new HttpError(404, 'Card not found');
  const owned = db.prepare(`SELECT ci.finish, ci.condition, SUM(ci.qty) AS qty, b.name AS binder FROM collection_items ci
    JOIN binders b ON b.id = ci.binder_id WHERE ci.scryfall_id = ? GROUP BY ci.finish, ci.condition, b.name`).all(card.id);
  const decks = db.prepare(`SELECT d.id, d.name, SUM(dc.qty) AS qty FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
    WHERE dc.scryfall_id = ? GROUP BY d.id`).all(card.id);
  const raw = db.prepare('SELECT * FROM prices WHERE scryfall_id = ?').all(card.id);
  const printingCount = card.oracleId ? (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE oracle_id = ?').get(card.oracleId) as any).n : 1;
  const market = db.prepare('SELECT scryfall_usd AS nonfoil, scryfall_usd_foil AS foil, scryfall_usd_etched AS etched FROM cards WHERE id = ?').get(card.id);
  res.json({ card, prices: pricesForCards([card.id]), rawPrices: raw, market, owned, decks, printingCount });
});

cards.get('/cards/:id/history', (req, res) => {
  const rows = db.prepare(`SELECT date, finish, condition, price FROM price_history WHERE scryfall_id = ?
    AND date >= date('now', ?) ORDER BY date`).all(req.params.id, `-${Number(req.query.days ?? 365)} days`);
  res.json(rows);
});

/** On-demand: average of the 5 most recent TCGplayer sales per condition (unofficial feed). */
cards.post('/cards/:id/last5', async (req, res) => {
  const { finish } = z.object({ finish: z.enum(['nonfoil', 'foil', 'etched']) }).parse(req.body);
  const card = getCard(req.params.id);
  if (!card) throw new HttpError(404, 'Card not found');
  try {
    const results = await refreshLast5(card, finish);
    res.json({ results });
  } catch (e: any) {
    throw new HttpError(502, `Last-5 sales unavailable (${e.message}). Using the JustTCG price instead.`);
  }
});

// ---- Pricing refresh ----
cards.post('/prices/refresh', (req, res) => {
  const b = z.object({ ids: z.array(z.string()).optional(), force: z.boolean().optional() }).parse(req.body ?? {});
  void runRefresh(b);
  res.json({ started: true });
});

/** Refresh prices for specific cards and wait for the result (used by the card detail page). */
cards.post('/prices/refresh-now', async (req, res) => {
  const b = z.object({ ids: z.array(z.string()).min(1).max(20) }).parse(req.body);
  const state = await runRefresh({ ids: b.ids, force: true });
  res.json({ state, prices: pricesForCards(b.ids) });
});

cards.get('/prices/status', (_req, res) => {
  res.json(refreshState);
});

export { round };
