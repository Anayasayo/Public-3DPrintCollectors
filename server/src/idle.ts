/**
 * Stop the server once no browser tab has the app open (enabled by AUTO_SHUTDOWN=1, which the launcher sets).
 *
 * Every open tab sends a heartbeat with its own id, and says goodbye on `pagehide`. The server stops when
 *  - every tab has said goodbye and none has come back for CLOSE_GRACE_MS (a refresh reconnects well inside that), or
 *  - no heartbeat at all has arrived for STALE_MS (browser crashed or was killed). Browsers throttle timers in
 *    background tabs to about once a minute, so this has to be much longer than the heartbeat interval.
 * A running price refresh or catalog import is always allowed to finish first.
 */
import type { Server } from 'node:http';
import { db } from './db/index.js';
import { refreshState } from './pricing/refresh.js';
import { syncState } from './scryfall/sync.js';

export const CLOSE_GRACE_MS = 30_000;
const STALE_MS = 3 * 60_000;
const FIRST_TAB_MS = 2 * 60_000; // time allowed for the browser to open after the server starts

const tabs = new Map<string, number>(); // tab id -> last heartbeat
let emptySince = Date.now() + FIRST_TAB_MS - CLOSE_GRACE_MS;

export function heartbeat(tabId: string) {
  tabs.set(tabId, Date.now());
}

export function tabClosed(tabId: string) {
  tabs.delete(tabId);
  if (!tabs.size) emptySince = Date.now();
}

function shouldStop(now: number): boolean {
  for (const [id, seen] of tabs) if (now - seen > STALE_MS) tabs.delete(id);
  if (tabs.size) return false;
  if (now - emptySince < CLOSE_GRACE_MS) return false;
  return !refreshState.running && !syncState.running;
}

export function startIdleShutdown(server: Server) {
  const timer = setInterval(() => {
    if (!shouldStop(Date.now())) return;
    clearInterval(timer);
    console.log('No app tabs open - stopping 3DPrintCollectors.');
    server.close();
    server.closeAllConnections();
    db.close();
    process.exit(0);
  }, 5_000);
}
