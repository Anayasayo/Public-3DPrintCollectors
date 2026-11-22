import { Router } from 'express';
import { z } from 'zod';
import {
  addDeckCard, addDeckToCollection, changeDeckCard, createDeck, deleteDeck, getDeck, listDecks, pendingNet,
  removeDeckCard, setAltCommander, syncDeckChanges, updateDeckMeta, HttpError,
} from '../decks/service.js';
import { getCards } from '../scryfall/cards.js';
import { exportDeckTxt } from '../export/export.js';

export const decks = Router();

const finish = z.enum(['nonfoil', 'foil', 'etched']);
const condition = z.enum(['NM', 'LP', 'MP']);
const board = z.enum(['commander', 'main', 'companion', 'maybe']);
const cardInput = z.object({ scryfallId: z.string(), finish, condition, qty: z.number().int().positive().default(1), board: board.default('main'), altCommander: z.boolean().optional() });
const id = (v: string | string[]) => Number(Array.isArray(v) ? v[0] : v);

decks.get('/decks', (_req, res) => res.json(listDecks()));

decks.post('/decks', (req, res) => {
  const b = z.object({ name: z.string().default('New Commander Deck'), targetBracket: z.number().int().min(1).max(5).nullable().optional(), notes: z.string().optional() }).parse(req.body);
  res.json({ id: createDeck(b.name, b.targetBracket, b.notes) });
});

decks.get('/decks/:id', (req, res) => res.json(getDeck(id(req.params.id))));

decks.patch('/decks/:id', (req, res) => {
  const b = z.object({ name: z.string().min(1).optional(), targetBracket: z.number().int().min(1).max(5).nullable().optional(), notes: z.string().nullable().optional() }).parse(req.body);
  updateDeckMeta(id(req.params.id), b);
  res.json({ ok: true });
});

decks.delete('/decks/:id', (req, res) => {
  const mode = z.enum(['keep', 'misc', 'remove']).default('keep').parse(req.query.mode ?? 'keep');
  deleteDeck(id(req.params.id), mode);
  res.json({ ok: true });
});

decks.post('/decks/:id/cards', (req, res) => {
  addDeckCard(id(req.params.id), cardInput.parse(req.body));
  res.json({ ok: true });
});

decks.delete('/decks/:id/cards/:cardId', (req, res) => {
  const qty = req.query.qty ? Number(req.query.qty) : undefined;
  removeDeckCard(id(req.params.id), id(req.params.cardId), qty);
  res.json({ ok: true });
});

/** Short-list a card in the 99 as an alternative commander (or take it off the list). */
decks.post('/decks/:id/cards/:cardId/opt-commander', (req, res) => {
  const { value } = z.object({ value: z.boolean().default(true) }).parse(req.body ?? {});
  setAltCommander(id(req.params.id), id(req.params.cardId), value);
  res.json({ ok: true });
});

decks.patch('/decks/:id/cards/:cardId', (req, res) => {
  changeDeckCard(id(req.params.id), id(req.params.cardId), cardInput.partial().parse(req.body));
  res.json({ ok: true });
});

/** Swap: remove a card and add a different one in a single step (both logged). */
decks.post('/decks/:id/swap', (req, res) => {
  const b = z.object({ deckCardId: z.number().int(), qty: z.number().int().positive().optional(), replacement: cardInput }).parse(req.body);
  removeDeckCard(id(req.params.id), b.deckCardId, b.qty);
  addDeckCard(id(req.params.id), b.replacement);
  res.json({ ok: true });
});

decks.post('/decks/:id/add-to-collection', (req, res) => {
  addDeckToCollection(id(req.params.id));
  res.json({ ok: true });
});

decks.get('/decks/:id/pending', (req, res) => {
  const { net, regrades } = pendingNet(id(req.params.id));
  const ids = [...net.keys(), ...regrades.flatMap(r => [r.from, r.to])].map(k => k.split('|')[0]);
  const cards = getCards(ids);
  const view = (k: string) => {
    const [cid, f, c] = k.split('|');
    const card = cards.get(cid);
    return { id: cid, name: card?.name, set: card?.set, number: card?.number, image: card?.imageSmall, finish: f, condition: c };
  };
  res.json({
    additions: [...net].filter(([, n]) => n > 0).map(([k, n]) => ({ ...view(k), qty: n })),
    removals: [...net].filter(([, n]) => n < 0).map(([k, n]) => ({ ...view(k), qty: -n })),
    regrades: regrades.map(r => ({ from: view(r.from), to: view(r.to), qty: r.qty })),
  });
});

decks.post('/decks/:id/sync', (req, res) => res.json(syncDeckChanges(id(req.params.id))));

decks.get('/decks/:id/export.txt', (req, res) => {
  const d = getDeck(id(req.params.id), { light: true });
  if (!d) throw new HttpError(404, 'Deck not found');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${d.deck.name.replace(/[^\w\- ]+/g, '')}.txt"`);
  res.send(exportDeckTxt(d.deck.id));
});
