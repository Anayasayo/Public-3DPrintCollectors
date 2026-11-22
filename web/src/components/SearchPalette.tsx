import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { Spinner } from './ui';

interface Hit { key: string; to: string; image?: string | null; title: ReactNode; detail: ReactNode; icon?: string }

/** Searches what you already have (collection, decks, binders, Miscellaneous, wishlist) - not the card catalog. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 150); return () => clearTimeout(t); }, [text]);
  useEffect(() => { if (open) { setText(''); setQ(''); } }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<any>(`/search${qs({ q })}`),
    enabled: open && q.length >= 2,
    placeholderData: keepPreviousData,
  });

  const sections = useMemo(() => {
    if (!data || q.length < 2) return [];
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const out: { title: string; hits: Hit[] }[] = [
      { title: 'Decks', hits: data.decks.map((d: any) => ({
        key: `d${d.id}`, to: `/decks/${d.id}`, image: d.image, icon: '⚔', title: d.name,
        detail: <>{d.commanders || 'No commander yet'} · {d.status === 'in_collection' ? 'In collection' : 'Draft'}</>,
      })) },
      { title: 'In your collection', hits: [
        ...data.collection.map((c: any) => ({
          key: `c${c.name}`, to: `/card/${c.cardId}`, image: c.image, title: c.name,
          detail: <>{c.qty} {c.qty === 1 ? 'copy' : 'copies'}{c.printings > 1 ? ` · ${c.printings} printings` : ''} · {c.binders.join(', ')}</>,
        })),
        ...(data.collectionTotal > data.collection.length ? [{
          key: 'c-all', to: `/collection${qs({ q })}`, icon: '▦', title: `See all ${data.collectionTotal} matches in the collection`, detail: 'Opens the Collection page filtered to this search',
        }] : []),
      ] },
      { title: 'Cards in your decks', hits: data.deckCards.map((c: any) => ({
        key: `dc${c.name}`, to: c.decks.length === 1 ? `/decks/${c.decks[0].id}` : `/card/${c.cardId}`, image: c.image, title: c.name,
        detail: <>In {c.decks.length === 1 ? c.decks[0].name : `${c.decks.length} decks: ${c.decks.map((d: any) => d.name).join(', ')}`}</>,
      })) },
      { title: 'Binders', hits: data.binders.map((b: any) => ({
        key: `b${b.id}`, to: b.deckId ? `/decks/${b.deckId}` : `/collection${qs({ binder: String(b.id) })}`, icon: '▤', title: b.name,
        detail: plural(b.qty, 'card'),
      })) },
      { title: 'Miscellaneous', hits: data.misc.map((c: any) => ({
        key: `m${c.name}`, to: '/misc', image: c.image, title: c.name, detail: `${c.qty} waiting in Miscellaneous`,
      })) },
      { title: 'Wishlist', hits: data.wishlist.map((c: any) => ({
        key: `w${c.name}`, to: '/wishlist', image: c.image, title: c.name, detail: `${c.qty} wanted`,
      })) },
    ];
    return out.filter(s => s.hits.length);
  }, [data, q]);
  const flat = sections.flatMap(s => s.hits);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const go = (h?: Hit) => { if (!h) return; onClose(); nav(h.to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
  };

  let idx = -1;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 sm:items-start sm:p-4 sm:pt-[10vh]"
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card-panel flex w-full flex-col rounded-none border-x-0 shadow-2xl sm:max-h-[75vh] sm:max-w-2xl sm:rounded-xl sm:border-x" onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          <span className="text-muted">⌕</span>
          <input autoFocus className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted"
            placeholder="Search your collection, decks, binders, wishlist…" value={text} onChange={e => setText(e.target.value)}
            aria-label="Search your collection and decks" />
          {isFetching && <Spinner />}
          <button className="btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {q.length < 2 ? (
            <div className="px-3 py-8 text-center text-sm text-muted">
              Type a card, deck, commander or binder name.
              <div className="mt-1 text-xs">Only searches cards you already have — use <b>+ Add card</b> to find new ones.</div>
            </div>
          ) : !sections.length ? (
            !isFetching && <div className="px-3 py-8 text-center text-sm text-muted">Nothing you own matches “{q}”.</div>
          ) : sections.map(s => (
            <div key={s.title} className="mb-2">
              <div className="label px-2 pb-1 pt-2">{s.title}</div>
              {s.hits.map(h => {
                const i = ++idx;
                return (
                  <button key={h.key} data-idx={i} onMouseMove={() => setActive(i)} onClick={() => go(h)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${active === i ? 'bg-gold/15' : ''}`}>
                    {h.image
                      ? <img src={h.image} alt="" className="h-10 w-[1.8rem] shrink-0 rounded object-cover object-top" />
                      : <span className="flex h-10 w-[1.8rem] shrink-0 items-center justify-center rounded border border-line text-muted">{h.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${active === i ? 'text-gold' : ''}`}>{h.title}</span>
                      <span className="block truncate text-xs text-muted">{h.detail}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="hidden border-t border-line px-4 py-2 text-[11px] text-muted sm:block">↑ ↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>,
    document.body,
  );
}
