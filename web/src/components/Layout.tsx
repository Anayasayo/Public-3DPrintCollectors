import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money } from '../lib/format';
import ShinyText from './ShinyText';
import { SearchPalette } from './SearchPalette';
import { Spinner } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/collection', label: 'Collection', icon: '▦' },
  { to: '/decks', label: 'Commander decks', icon: '⚔' },
  { to: '/misc', label: 'Miscellaneous', icon: '⌁' },
  { to: '/wishlist', label: 'Wishlist', icon: '☆' },
  { to: '/sets', label: 'Sets', icon: '◈' },
  { to: '/import', label: 'Import / Export', icon: '⇅' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Layout() {
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<{ summary: { total: number; cards: number }; miscCount: number; hasApiKey: boolean }>('/dashboard'),
    refetchOnWindowFocus: true,
  });

  // Opening the app: ask the server to check Scryfall for new cards and refresh stale prices.
  const qc = useQueryClient();
  useEffect(() => { void api.post('/app/opened').catch(() => {}); }, []);

  // Tell the server this tab is open, and when it closes, so the server can stop once no tabs are left.
  useEffect(() => {
    const tabId = crypto.randomUUID();
    const beat = () => void api.post('/app/heartbeat', { tabId }).catch(() => {});
    const bye = () => navigator.sendBeacon('/api/app/closing', new Blob([JSON.stringify({ tabId })], { type: 'application/json' }));
    beat();
    const timer = setInterval(beat, 10_000);
    window.addEventListener('pagehide', bye);
    window.addEventListener('pageshow', beat); // back/forward cache restores the page without reloading it
    return () => { clearInterval(timer); window.removeEventListener('pagehide', bye); window.removeEventListener('pageshow', beat); };
  }, []);
  const catalog = useQuery({
    queryKey: ['catalog-status'],
    queryFn: () => api.get<{ running: boolean; phase: string; processed: number }>('/catalog/status'),
    refetchInterval: q => (q.state.data?.running ? 2000 : 15000),
  });
  const wasSyncing = useRef(false);
  useEffect(() => {
    const running = !!catalog.data?.running;
    if (wasSyncing.current && !running) void qc.invalidateQueries(); // new cards are in - refresh everything
    wasSyncing.current = running;
  }, [catalog.data?.running, qc]);

  // Close the drawer on navigation (mobile) and on Escape.
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
      // Cmd+K (Mac) / Ctrl+K opens search from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMenuOpen(false); setSearching(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const total = money(summary.data?.summary.total ?? 0);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-line bg-panel/95 px-3 py-2 backdrop-blur lg:hidden">
        <button className="btn-ghost btn-sm text-lg leading-none" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>☰</button>
        <div className="font-display text-base font-bold leading-tight">
          <ShinyText text="3DPrint" color="#e7eaf2" shineColor="#ffffff" speed={3} spread={110} />
          <ShinyText text="Collectors" color="#f5b841" shineColor="#fff3d6" speed={3} spread={110} delay={1.2} />
        </div>
        <button className="btn-ghost btn-sm ml-auto text-base leading-none" aria-label="Search your collection and decks" onClick={() => setSearching(true)}>⌕</button>
        <div className="text-right">
          <div className="font-display text-base font-bold text-gold tabular-nums">{total}</div>
          <div className="text-[0.65rem] text-muted">{summary.data?.summary.cards ?? 0} cards</div>
        </div>
      </header>

      {menuOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)} />}

      <aside className={`fixed inset-y-0 left-0 z-50 flex h-full w-64 shrink-0 flex-col border-r border-line bg-panel px-3 py-4 transition-transform duration-200
        lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-56 lg:translate-x-0 lg:bg-panel/60 xl:w-60
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="hidden px-2 pb-5 lg:block">
          <div className="font-display text-lg font-bold leading-tight">
            <ShinyText text="3DPrint" color="#e7eaf2" shineColor="#ffffff" speed={3} spread={110} />
            <ShinyText text="Collectors" color="#f5b841" shineColor="#fff3d6" speed={3} spread={110} delay={1.2} />
          </div>
          <div className="text-[0.7rem] text-muted">MTG collection &amp; Commander tracker</div>
        </div>
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <span className="font-display font-semibold">Menu</span>
          <button className="btn-ghost btn-sm" aria-label="Close menu" onClick={() => setMenuOpen(false)}>✕</button>
        </div>

        <button onClick={() => { setMenuOpen(false); setSearching(true); }}
          className="mb-3 flex items-center gap-2.5 rounded-lg border border-line bg-panel2/70 px-3 py-2 text-left text-sm text-muted transition-colors hover:border-slate-500 hover:text-slate-200">
          <span className="w-4 text-center">⌕</span>
          <span className="flex-1">Search…</span>
          <kbd className="hidden rounded border border-line px-1.5 text-[10px] lg:inline">⌘K</kbd>
        </button>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-gold/15 text-gold' : 'text-slate-300 hover:bg-panel2'}`}>
              <span className="w-4 text-center opacity-80">{n.icon}</span>
              <span className="flex-1 truncate">{n.label}</span>
              {n.to === '/misc' && !!summary.data?.miscCount && (
                <span className="chip bg-amber-500/20 text-amber-300">{summary.data.miscCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 rounded-xl border border-line bg-panel2/60 px-3 py-2.5">
          <div className="label">Collection value</div>
          <div className="font-display text-xl font-bold text-gold tabular-nums">{total}</div>
          <div className="text-[0.7rem] text-muted">{summary.data?.summary.cards ?? 0} cards</div>
        </div>
        {summary.data && !summary.data.hasApiKey && (
          <NavLink to="/settings" className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[0.7rem] text-amber-200">
            Add your JustTCG API key to load prices →
          </NavLink>
        )}
      </aside>

      <main key={loc.pathname} className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
        {catalog.data?.running && (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
            <Spinner />
            <span className="flex-1">Updating card catalog from Scryfall… new cards will appear shortly.</span>
            {catalog.data.processed > 0 && <span className="tabular-nums text-gold/70">{catalog.data.processed.toLocaleString()} cards</span>}
          </div>
        )}
        <div className="page">
          <Outlet />
        </div>
      </main>

      <SearchPalette open={searching} onClose={() => setSearching(false)} />
    </div>
  );
}
