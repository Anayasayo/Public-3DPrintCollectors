import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { ZodError } from 'zod';
import { HOST, PORT, WEB_DIST, getJustTcgKey } from './config.js';
import { getSetting } from './db/index.js';
import { cards } from './routes/cards.js';
import { collection } from './routes/collection.js';
import { decks } from './routes/decks.js';
import { io } from './routes/io.js';
import { search } from './routes/search.js';
import { system, backupNow, onAppOpened } from './routes/system.js';
import { HttpError } from './decks/service.js';
import { checkForCatalogUpdate } from './scryfall/sync.js';
import { runRefresh } from './pricing/refresh.js';
import { snapshotToday } from './pricing/valuation.js';
import { startIdleShutdown } from './idle.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

// Only accept requests addressed to this machine (blocks DNS-rebinding from web pages).
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(host)) return void res.status(403).send('Forbidden');
  // Refuse changes sent by other websites (a form on any site can POST to 127.0.0.1).
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    let from = '';
    try { from = new URL(origin).hostname; } catch { /* malformed - refused below */ }
    if (!['127.0.0.1', 'localhost'].includes(from)) return void res.status(403).send('Forbidden');
  }
  next();
});

app.use('/api', cards, collection, decks, io, search, system);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Web app not built yet. Run "npm run build" in 3DPrintCollectors, or use "npm run dev".'));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return void res.status(400).json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  console.error(err);
  res.status(500).json({ error: (err as Error)?.message ?? 'Server error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`3DPrintCollectors running at http://${HOST}:${PORT}`);
  // Server start counts as opening the app: check Scryfall for new cards and refresh stale prices.
  onAppOpened();
  // While it stays running: re-check prices every 6 hours and the catalog daily.
  cron.schedule('0 */6 * * *', () => {
    const last = getSetting('last_price_refresh');
    if (getJustTcgKey() && (!last || Date.now() - Date.parse(last) > 12 * 3600_000)) void runRefresh();
  });
  cron.schedule('55 23 * * *', () => snapshotToday());
  cron.schedule('0 4 * * *', () => void checkForCatalogUpdate(true));
  void backupNow('startup').catch(e => console.error('[backup]', e));
  snapshotToday();
  // Launched from the shortcut: stop once the browser tabs are closed, so reopening always starts fresh.
  if (process.env.AUTO_SHUTDOWN === '1') startIdleShutdown(server);
});
