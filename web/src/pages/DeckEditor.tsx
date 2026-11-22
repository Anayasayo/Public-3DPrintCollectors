import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Board, type Card, type Condition, type Finish } from '../lib/api';
import { CONDITION_LABEL, FINISH_LABEL, money, timeAgo } from '../lib/format';
import {
  CardThumb, ColorPips, ConditionBadge, ConditionSelect, Confirm, FinishBadge, ManaCost, Modal, PageHeader,
  PriceTag, QtyInput, Spinner, StyleBadges, useToast,
} from '../components/ui';
import { PrintingPicker } from '../components/PrintingPicker';
import { DeckStatsFull, DeckStatsSummary } from '../components/DeckStats';
import { COLOR_NAME, CURVE_BUCKETS, TYPES, TYPE_PLURAL, colorKey, computeDeckStats, typeKey, type ColorKey } from '../lib/deckStats';

const TYPE_ORDER = ['Commander', 'Optional commanders', 'Companion', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other', 'Maybeboard'];

function groupOf(c: { board: Board; card: Card; altCommander?: boolean }) {
  if (c.board === 'commander') return 'Commander';
  if (c.altCommander) return 'Optional commanders';
  if (c.board === 'companion') return 'Companion';
  if (c.board === 'maybe') return 'Maybeboard';
  const front = c.card.typeLine.split('//')[0];
  if (/\bLand\b/.test(front)) return 'Land';
  return TYPE_ORDER.find(t => t !== 'Commander' && new RegExp(`\\b${t}\\b`).test(front)) ?? 'Other';
}

export function DeckEditor() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [swapping, setSwapping] = useState<any | null>(null);
  const [changing, setChanging] = useState<any | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'keep' | 'misc' | 'remove'>('keep');
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [tab, setTab] = useState<'cards' | 'stats'>('cards');
  const NO_FILTER = { q: '', color: '', type: '', mv: '', own: '' };
  const [filter, setFilter] = useState(NO_FILTER);
  const setF = (k: keyof typeof NO_FILTER, val: string) => setFilter(f => ({ ...f, [k]: val }));

  const { data, isLoading } = useQuery({ queryKey: ['deck', id], queryFn: () => api.get<any>(`/decks/${id}`) });
  const pending = useQuery({ queryKey: ['deck-pending', id], queryFn: () => api.get<any>(`/decks/${id}/pending`), enabled: showSync });

  const done = (msg: string) => () => {
    qc.invalidateQueries({ queryKey: ['deck', id] });
    qc.invalidateQueries({ queryKey: ['deck-pending', id] });
    qc.invalidateQueries({ queryKey: ['decks'] });
    qc.invalidateQueries({ queryKey: ['summary'] });
    qc.invalidateQueries({ queryKey: ['collection'] });
    toast(msg);
  };
  const fail = (e: Error) => toast(e.message, 'err');

  const addCard = useMutation({ mutationFn: (b: any) => api.post(`/decks/${id}/cards`, b), onSuccess: done('Card added'), onError: fail });
  const removeCard = useMutation({ mutationFn: ({ cardId, qty }: any) => api.del(`/decks/${id}/cards/${cardId}${qty ? `?qty=${qty}` : ''}`), onSuccess: done('Card removed'), onError: fail });
  const patchCard = useMutation({ mutationFn: ({ cardId, ...b }: any) => api.patch(`/decks/${id}/cards/${cardId}`, b), onSuccess: done('Card updated'), onError: fail });
  const swap = useMutation({ mutationFn: (b: any) => api.post(`/decks/${id}/swap`, b), onSuccess: done('Cards swapped'), onError: fail });
  const optCommander = useMutation({
    mutationFn: ({ cardId, value }: { cardId: number; value: boolean }) => api.post(`/decks/${id}/cards/${cardId}/opt-commander`, { value }),
    onSuccess: done('Optional commanders updated'), onError: fail,
  });
  const patchDeck = useMutation({ mutationFn: (b: any) => api.patch(`/decks/${id}`, b), onSuccess: done('Deck updated'), onError: fail });
  const toCollection = useMutation({ mutationFn: () => api.post(`/decks/${id}/add-to-collection`), onSuccess: done('Deck added to your collection'), onError: fail });
  const sync = useMutation({
    mutationFn: () => api.post<any>(`/decks/${id}/sync`),
    onSuccess: r => { setShowSync(false); done(`Synced — ${r.added} added, ${r.toMisc} moved to Miscellaneous${r.regraded ? `, ${r.regraded} re-graded` : ''}`)(); },
    onError: fail,
  });
  const removeDeck = useMutation({ mutationFn: () => api.del(`/decks/${id}?mode=${deleteMode}`), onSuccess: () => { toast('Deck deleted'); nav('/decks'); }, onError: fail });

  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const c of data?.cards ?? []) {
      const g = groupOf(c);
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]));
  }, [data]);
  const stats = useMemo(() => data && computeDeckStats(data.cards, data.validation.colorIdentity), [data]);

  if (isLoading || !data || !stats) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const v = data.validation;
  const inCollection = data.deck.status === 'in_collection';
  const ownership: Record<number, any> = Object.fromEntries((data.owned ?? []).map((o: any) => [o.deckCardId, o]));
  const missingCost = (data.owned ?? []).reduce((t: number, o: any) => t + (o.missingCost ?? 0), 0);

  // "Search deck": filter the deck's own cards by text (name, type or rules text), color, type, mana value and ownership.
  const filtering = Object.values(filter).some(Boolean);
  const needle = filter.q.trim().toLowerCase();
  const matches = (c: any) => {
    const card: Card = c.card;
    if (needle && ![card.name, card.typeLine, card.oracleText, card.set].some(t => t?.toLowerCase().includes(needle))) return false;
    if (filter.color && colorKey(card) !== filter.color) return false;
    if (filter.type && typeKey(card) !== filter.type) return false;
    if (filter.mv && (typeKey(card) === 'Land' || (filter.mv === '7+' ? card.cmc < 7 : Math.floor(card.cmc) !== Number(filter.mv)))) return false;
    if (filter.own) {
      const missing = (ownership[c.id]?.missing ?? 0) > 0;
      if (filter.own === 'missing' ? !missing : missing) return false;
    }
    return true;
  };
  const shownGroups = filtering
    ? groups.map(([g, cards]) => [g, cards.filter(matches)] as [string, any[]]).filter(([, cards]) => cards.length)
    : groups;
  const shownCount = shownGroups.reduce((n, [, cards]) => n + cards.reduce((t, c) => t + c.qty, 0), 0);

  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2">
          {data.deck.name}
          <button className="btn-ghost btn-sm" onClick={() => { setDraftName(data.deck.name); setRenaming(true); }}>Rename</button>
        </span>}
        sub={<span className="flex flex-wrap items-center gap-2">
          <span className={`chip ${v.count === 100 ? 'bg-good/15 text-good' : 'bg-amber-500/15 text-amber-300'}`}>{v.count} / 100 cards</span>
          <span className={`chip ${v.legal ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>{v.legal ? 'Legal Commander deck' : 'Not legal yet'}</span>
          <ColorPips colors={v.colorIdentity} />
          <span className="text-gold">{money(data.stats.value)}</span>
          <span className="text-muted">· avg CMC {data.stats.averageCmc}</span>
          {inCollection ? <span className="chip bg-accent/15 text-accent">In collection</span> : <span className="chip bg-slate-500/15 text-slate-300">Draft</span>}
        </span>}
        actions={<>
          <a className="btn-ghost" href={`/api/decks/${id}/export.txt`}>Export .txt</a>
          <button className="btn-ghost" onClick={() => setShowHistory(true)}>History</button>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
          {inCollection
            ? <button className="btn-primary" disabled={!data.pendingCount} onClick={() => setShowSync(true)}>
                {data.pendingCount ? `Sync ${data.pendingCount} change${data.pendingCount === 1 ? '' : 's'}` : 'No changes to sync'}
              </button>
            : <button className="btn-primary" onClick={() => toCollection.mutate()}>Add deck to collection</button>}
          <button className="btn-primary" onClick={() => setAdding(true)}>+ Add card</button>
        </>}
      />

      {!!v.issues.length && (
        <div className="card-panel mb-4 divide-y divide-line">
          {v.issues.map((i: any, n: number) => (
            <div key={n} className="flex items-start gap-2 px-4 py-2 text-sm">
              <span className={`chip mt-0.5 ${i.level === 'error' ? 'bg-bad/15 text-bad' : i.level === 'warning' ? 'bg-amber-500/15 text-amber-300' : 'bg-accent/15 text-accent'}`}>{i.level}</span>
              <span className="flex-1">{i.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex gap-1 border-b border-line">
        {(['cards', 'stats'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-slate-200'}`}>
            {t === 'cards' ? `Cards (${v.count})` : 'Stats'}
          </button>
        ))}
      </div>

      {/* On the Cards tab, search sits at the top of the right column on wide screens, and above the cards on phones. */}
      {tab === 'stats' ? <DeckStatsFull stats={stats} deckColors={v.colorIdentity} /> : (
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_20rem]">
        {!!data.cards.length && (
          <div className="card-panel grid gap-2 p-3 lg:col-start-2 lg:row-start-1">
            <div className="label">Search deck</div>
            <div className="relative min-w-0">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span>
              <input className="input pl-8" placeholder="Name, type or rules text…"
                value={filter.q} onChange={e => setF('q', e.target.value)} onKeyDown={e => e.key === 'Escape' && setF('q', '')}
                aria-label="Search this deck's cards" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              <select className="input" value={filter.type} onChange={e => setF('type', e.target.value)} aria-label="Card type">
                <option value="">All types</option>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_PLURAL[t]}</option>)}
              </select>
              <select className="input" value={filter.color} onChange={e => setF('color', e.target.value)} aria-label="Color">
                <option value="">All colors</option>
                {(Object.keys(COLOR_NAME) as ColorKey[]).map(k => <option key={k} value={k}>{COLOR_NAME[k]}</option>)}
              </select>
              <select className="input" value={filter.mv} onChange={e => setF('mv', e.target.value)} aria-label="Mana value">
                <option value="">Mana value</option>
                {CURVE_BUCKETS.map(b => <option key={b} value={b}>Mana value {b}</option>)}
              </select>
              {!inCollection && (
                <select className="input" value={filter.own} onChange={e => setF('own', e.target.value)} aria-label="Owned or missing">
                  <option value="">All cards</option>
                  <option value="missing">Missing only</option>
                  <option value="owned">Owned only</option>
                </select>
              )}
            </div>
            {filtering && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted">Showing <b className="text-slate-200">{shownCount}</b> of {v.count} cards</span>
                <button className="btn-ghost btn-sm" onClick={() => setFilter(NO_FILTER)}>Clear</button>
              </div>
            )}
          </div>
        )}
        <div className="grid content-start gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {filtering && !shownGroups.length && (
            <div className="card-panel px-6 py-10 text-center text-sm text-muted">
              No cards in this deck match. <button className="text-accent hover:underline" onClick={() => setFilter(NO_FILTER)}>Clear the search</button>
            </div>
          )}
          {shownGroups.map(([group, cards]) => (
            <div key={group} className="card-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-1 border-b border-line px-3 py-2 sm:px-4">
                <span className="font-display font-semibold">
                  {group}
                  {group === 'Optional commanders' && (
                    <span className="ml-2 text-xs font-normal text-muted">
                      part of the 99 — swap one in with Change → Commander
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted">{cards.reduce((n, c) => n + c.qty, 0)} cards · {money(cards.reduce((t, c) => t + (c.price ?? 0) * c.qty, 0))}</span>
              </div>
              <div className="table-wrap"><table className="data">
                <tbody>
                  {cards.map(c => {
                    const own = ownership[c.id];
                    return (
                      <tr key={c.id}>
                        <td className="w-12"><CardThumb card={c.card} className="w-12 sm:w-16" /></td>
                        <td className="w-8 text-right tabular-nums text-muted">{c.qty}</td>
                        <td>
                          <Link to={`/card/${c.card.id}`} className="hover:text-gold">{c.card.name}</Link>
                          {c.card.gameChanger && <span className="chip ml-1.5 bg-rose-500/20 text-rose-300">GC</span>}
                          <div className="text-[11px] text-muted">{c.card.set.toUpperCase()} #{c.card.number}</div>
                        </td>
                        <td className="col-lg w-24"><ManaCost cost={c.card.manaCost} size={14} /></td>
                        <td className="col-xl w-40"><StyleBadges styles={c.card.styles} /></td>
                        <td className="col-lg w-24"><FinishBadge finish={c.finish} /></td>
                        <td className="w-14"><ConditionBadge condition={c.condition} /></td>
                        <td className="w-24 text-right"><PriceTag price={c.price} source={c.priceSource} /></td>
                        {!inCollection && (
                          <td className="col-lg w-28 text-[0.7rem]">
                            {own && (own.missing > 0
                              ? <span className="text-amber-300">need {own.missing} · {money(own.missingCost)}</span>
                              : <span className="text-good">owned</span>)}
                          </td>
                        )}
                        <td className="col-md w-44 whitespace-nowrap text-right">
                          {c.canMakeOptional && (
                            <button className="btn-ghost btn-sm mr-1" title="Move this card into the 99 as an optional commander, keeping the other commander"
                              onClick={() => optCommander.mutate({ cardId: c.id, value: true })}>
                              Make optional
                            </button>
                          )}
                          {c.canBeCommander && (
                            <button className={`btn-sm mr-1 ${c.altCommander ? 'btn-good' : 'btn-ghost'}`}
                              title={c.altCommander
                                ? 'Take this card off the optional commanders list'
                                : `Short-list as an optional commander (same colour identity as ${data.deck.name}'s commander)`}
                              onClick={() => optCommander.mutate({ cardId: c.id, value: !c.altCommander })}>
                              {c.altCommander ? '★ Opt Commander' : 'Opt Commander'}
                            </button>
                          )}
                          <button className="btn-ghost btn-sm" title="Change printing, finish or condition" onClick={() => setChanging(c)}>Change</button>
                          <button className="btn-ghost btn-sm ml-1" title="Replace with a different card" onClick={() => setSwapping(c)}>Swap</button>
                        </td>
                        <td className="w-28 whitespace-nowrap text-right">
                          <button className="btn-ghost btn-sm" title="Remove one copy" onClick={() => removeCard.mutate({ cardId: c.id, qty: 1 })}>−</button>
                          <button className="btn-ghost btn-sm ml-1" title="Add one copy" onClick={() => addCard.mutate({ scryfallId: c.card.id, finish: c.finish, condition: c.condition, qty: 1, board: c.board })}>+</button>
                          {/* The Actions column is hidden on narrow screens, so the short-list toggles live here too. */}
                          {c.canMakeOptional && (
                            <button className="btn-ghost btn-sm ml-1 md:hidden" title="Make this an optional commander"
                              onClick={() => optCommander.mutate({ cardId: c.id, value: true })}>☆</button>
                          )}
                          {c.canBeCommander && (
                            <button className={`btn-sm ml-1 md:hidden ${c.altCommander ? 'btn-good' : 'btn-ghost'}`}
                              title={c.altCommander ? 'Take this card off the optional commanders list' : 'Short-list as an optional commander'}
                              onClick={() => optCommander.mutate({ cardId: c.id, value: !c.altCommander })}>
                              {c.altCommander ? '★' : '☆'}
                            </button>
                          )}
                          <button className="btn-ghost btn-sm ml-1 md:hidden" title="Change printing, finish or condition" onClick={() => setChanging(c)}>⋯</button>
                          <button className="btn-ghost btn-sm ml-1" title="Remove all copies" onClick={() => removeCard.mutate({ cardId: c.id })}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          ))}
          {!data.cards.length && (
            <div className="card-panel px-6 py-16 text-center">
              <div className="font-display text-lg">Empty deck</div>
              <div className="mt-1 text-sm text-muted">Add a commander and 99 other cards, or import a decklist.</div>
              <button className="btn-primary mt-4" onClick={() => setAdding(true)}>+ Add the commander</button>
            </div>
          )}
        </div>

        <div className="grid content-start gap-4 lg:col-start-2 lg:row-start-2">
          <DeckStatsSummary stats={stats} onOpenFull={() => setTab('stats')} />

          <div className="card-panel p-4">
            <div className="label mb-2">Bracket</div>
            <select className="input" value={data.deck.target_bracket ?? ''} onChange={e => patchDeck.mutate({ targetBracket: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No target bracket</option>
              <option value="1">1 — Exhibition</option><option value="2">2 — Core</option><option value="3">3 — Upgraded</option>
              <option value="4">4 — Optimized</option><option value="5">5 — cEDH</option>
            </select>
            <div className="mt-2 text-sm text-muted">
              {v.gameChangers.length} Game Changer{v.gameChangers.length === 1 ? '' : 's'} · fits bracket {v.minimumBracket}+
            </div>
            {!!v.gameChangers.length && <div className="mt-1 text-[11px] text-muted">{v.gameChangers.join(', ')}</div>}
          </div>

          {!inCollection && (
            <div className="card-panel p-4">
              <div className="label mb-1">Owned vs missing</div>
              <div className="text-sm text-muted">Cards you don't own yet would cost about</div>
              <div className="font-display text-2xl font-bold text-gold">{money(missingCost)}</div>
              <button className="btn-primary mt-3 w-full" onClick={() => toCollection.mutate()}>Add whole deck to collection</button>
              <div className="mt-1 text-[11px] text-muted">Creates a "Deck: {data.deck.name}" binder and counts every card in your total.</div>
            </div>
          )}

          {inCollection && (
            <div className="card-panel p-4">
              <div className="label mb-1">Collection sync</div>
              {data.pendingCount
                ? <>
                    <div className="text-sm">{data.pendingCount} change{data.pendingCount === 1 ? '' : 's'} not yet applied to the collection.</div>
                    <button className="btn-primary mt-3 w-full" onClick={() => setShowSync(true)}>Review &amp; sync</button>
                  </>
                : <div className="text-sm text-muted">The collection matches this deck.</div>}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Add / swap / change */}
      <PrintingPicker open={adding} keepOpen onClose={() => setAdding(false)} boards title="Add a card to the deck"
        onPick={r => addCard.mutate({ scryfallId: r.card.id, finish: r.finish, condition: r.condition, qty: r.qty, board: r.board })} />

      <PrintingPicker open={!!swapping} onClose={() => setSwapping(null)} title={swapping ? `Replace ${swapping.card.name} with…` : ''} submitLabel="Swap in"
        onPick={r => swapping && swap.mutate({ deckCardId: swapping.id, qty: swapping.qty, replacement: { scryfallId: r.card.id, finish: r.finish, condition: r.condition, qty: r.qty, board: swapping.board } })} />

      <Modal open={!!changing} onClose={() => setChanging(null)} title={changing ? `Change ${changing.card.name}` : ''}
        footer={changing && <>
          <button className="btn-ghost" onClick={() => setChanging(null)}>Cancel</button>
          <button className="btn-primary" onClick={() => { patchCard.mutate({ cardId: changing.id, finish: changing.finish, condition: changing.condition, board: changing.board, qty: changing.qty }); setChanging(null); }}>Save change</button>
        </>}>
        {changing && (
          <div className="grid gap-3">
            <div className="flex gap-3">
              <CardThumb card={changing.card} className="w-24" />
              <div className="text-sm">
                <div className="font-medium">{changing.card.name}</div>
                <div className="text-muted">{changing.card.setName} #{changing.card.number}</div>
                <StyleBadges styles={changing.card.styles} className="mt-1" />
                <Link className="mt-2 inline-block text-xs text-accent hover:underline" to={`/card/${changing.card.id}`}>Open card page →</Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1"><span className="label">Finish</span>
                <select className="input" value={changing.finish} onChange={e => setChanging({ ...changing, finish: e.target.value as Finish })}>
                  {changing.card.finishes.map((f: Finish) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
                </select>
              </label>
              <label className="grid gap-1"><span className="label">Condition</span>
                <ConditionSelect value={changing.condition} onChange={(c: Condition) => setChanging({ ...changing, condition: c })} />
              </label>
              <label className="grid gap-1"><span className="label">Board</span>
                <select className="input" value={changing.board} onChange={e => setChanging({ ...changing, board: e.target.value as Board })}>
                  <option value="commander">Commander</option><option value="main">Deck</option>
                  <option value="companion">Companion</option><option value="maybe">Maybeboard</option>
                </select>
              </label>
              <label className="grid gap-1"><span className="label">Copies affected</span><QtyInput value={changing.qty} onChange={n => setChanging({ ...changing, qty: Math.min(n, changing.qty) })} /></label>
            </div>
            <div className="text-xs text-muted">
              To use a different printing of this card, use <b>Swap</b> and pick the printing you want.
              {inCollection && ' Printing and finish changes move the old card to Miscellaneous when you sync; a condition change just re-grades the copy you own.'}
            </div>
          </div>
        )}
      </Modal>

      {/* Sync review */}
      <Modal open={showSync} onClose={() => setShowSync(false)} wide title="Sync deck changes to the collection"
        footer={<><button className="btn-ghost" onClick={() => setShowSync(false)}>Cancel</button>
          <button className="btn-primary" disabled={sync.isPending} onClick={() => sync.mutate()}>Apply to collection</button></>}>
        {pending.isLoading || !pending.data ? <div className="flex justify-center p-6"><Spinner /></div> : (
          <div className="grid gap-4">
            <Section title="Added to the collection" rows={pending.data.additions} tone="good" empty="Nothing added." />
            <Section title="Moved to Miscellaneous" rows={pending.data.removals} tone="warn" empty="Nothing removed." />
            {!!pending.data.regrades.length && (
              <div>
                <div className="label mb-1">Condition re-grades (same physical card)</div>
                {pending.data.regrades.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 py-1 text-sm">
                    <span>{r.from.name}</span><span className="text-muted">{r.from.condition} → {r.to.condition}</span><span className="text-muted">×{r.qty}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-muted">Cards sent to Miscellaneous stop counting toward your total until you file them back into the collection (or remove them).</div>
          </div>
        )}
      </Modal>

      {/* History */}
      <Modal open={showHistory} onClose={() => setShowHistory(false)} wide title="Change history">
        {!data.changes.length ? <div className="text-sm text-muted">No changes recorded yet.</div> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>When</th><th>Action</th><th>Card</th><th className="col-md">Tracked</th></tr></thead>
            <tbody>
              {data.changes.map((c: any) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-muted">{timeAgo(c.createdAt)}</td>
                  <td><span className={`chip ${c.action === 'add' ? 'bg-good/15 text-good' : c.action === 'remove' ? 'bg-bad/15 text-bad' : 'bg-accent/15 text-accent'}`}>{c.action}</span></td>
                  <td>
                    {c.action === 'change'
                      ? <>{c.before?.card?.name} <span className="text-muted">({c.before?.condition}/{c.before?.finish}) → ({c.after?.condition}/{c.after?.finish})</span></>
                      : <>{(c.after?.card ?? c.before?.card)?.name} <span className="text-muted">×{c.qty} · {(c.after ?? c.before)?.condition}</span></>}
                  </td>
                  <td className="col-md text-muted">{c.tracked ? (c.syncedAt ? `synced ${timeAgo(c.syncedAt)}` : 'pending') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Modal>

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename deck"
        footer={<><button className="btn-ghost" onClick={() => setRenaming(false)}>Cancel</button>
          <button className="btn-primary" onClick={() => { patchDeck.mutate({ name: draftName }); setRenaming(false); }}>Save</button></>}>
        <input autoFocus className="input" value={draftName} onChange={e => setDraftName(e.target.value)} />
      </Modal>

      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} danger confirmLabel="Delete deck" title={`Delete "${data.deck.name}"?`}
        onConfirm={() => removeDeck.mutate()}
        body={inCollection ? (
          <div className="grid gap-2">
            <div>This deck's cards are in your collection. What should happen to them?</div>
            {[['keep', 'Keep them — move to Main Collection'], ['misc', 'Send them to Miscellaneous'], ['remove', 'Remove them from the collection entirely']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input type="radio" name="delmode" checked={deleteMode === v} onChange={() => setDeleteMode(v as any)} /> {l}
              </label>
            ))}
          </div>
        ) : 'This draft deck will be deleted. Your collection is not affected.'} />
    </div>
  );
}

function Section({ title, rows, tone, empty }: { title: string; rows: any[]; tone: 'good' | 'warn'; empty: string }) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      {!rows.length ? <div className="text-sm text-muted">{empty}</div> : (
        <div className="grid gap-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-2 py-1.5 text-sm">
              {r.image && <img src={r.image} alt="" className="h-12 w-[2.1rem] max-w-none shrink-0 rounded object-cover object-top" />}
              <span className="flex-1">{r.name} <span className="text-muted">{r.set?.toUpperCase()} #{r.number}</span></span>
              <span className="text-muted">{FINISH_LABEL[r.finish as Finish]} · {CONDITION_LABEL[r.condition as Condition]}</span>
              <span className={tone === 'good' ? 'text-good' : 'text-amber-300'}>×{r.qty}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
