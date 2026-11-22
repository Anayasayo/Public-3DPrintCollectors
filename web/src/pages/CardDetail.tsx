import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs, type Card, type Condition, type Finish, type PriceMap } from '../lib/api';
import { CONDITIONS, CONDITION_LABEL, FINISH_LABEL, SOURCE_LABEL, money, priceKey, timeAgo } from '../lib/format';
import { ConditionBadge, FinishBadge, ManaCost, PageHeader, PriceTag, Spinner, StyleBadges, useToast } from '../components/ui';

export function CardDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [finish, setFinish] = useState<Finish | null>(null);
  const [last5, setLast5] = useState<any[] | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['card', id], queryFn: () => api.get<any>(`/cards/${id}`) });
  const card: Card | undefined = data?.card;
  const activeFinish: Finish = finish ?? card?.finishes[0] ?? 'nonfoil';
  const history = useQuery({ queryKey: ['card-history', id], queryFn: () => api.get<any[]>(`/cards/${id}/history?days=180`) });
  const printings = useQuery({
    queryKey: ['printings', card?.name],
    queryFn: () => api.get<{ printings: Card[]; prices: PriceMap }>(`/cards/printings${qs({ name: card!.name })}`),
    enabled: !!card,
  });

  const refreshNow = useMutation({
    mutationFn: () => api.post<any>('/prices/refresh-now', { ids: [id] }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['card', id] }); toast(r.state?.lastError ?? 'Prices refreshed', r.state?.lastError ? 'err' : 'ok'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const fetchLast5 = useMutation({
    mutationFn: () => api.post<any>(`/cards/${id}/last5`, { finish: activeFinish }),
    onSuccess: r => { setLast5(r.results); qc.invalidateQueries({ queryKey: ['card', id] }); toast('Latest TCGplayer sales loaded'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const addToWishlist = useMutation({
    mutationFn: () => api.post('/wishlist', { scryfallId: id, finish: activeFinish, condition: 'NM' }),
    onSuccess: () => toast('Added to wishlist'),
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const addToCollection = useMutation({
    mutationFn: (condition: Condition) => api.post('/collection', { scryfallId: id, finish: activeFinish, condition, qty: 1 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['card', id] }); qc.invalidateQueries({ queryKey: ['summary'] }); toast('Added to collection'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading || !card) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const prices: PriceMap = data.prices;
  const chart = (history.data ?? []).filter(h => h.finish === activeFinish);
  const dates = [...new Set(chart.map(h => h.date))].sort();
  const series = dates.map(d => ({
    date: d.slice(5),
    ...Object.fromEntries(CONDITIONS.map(c => [c, chart.find(h => h.date === d && h.condition === c)?.price])),
  }));

  return (
    <div>
      <PageHeader
        title={card.name}
        sub={<span className="flex flex-wrap items-center gap-2">
          <ManaCost cost={card.manaCost} /> <span>{card.typeLine}</span>
          <span className="text-muted">· {card.setName} #{card.number} · {card.rarity}</span>
          {card.gameChanger && <span className="chip bg-rose-500/20 text-rose-300">Game Changer</span>}
          {card.commanderLegality !== 'legal' && <span className="chip bg-bad/20 text-bad">Commander: {card.commanderLegality}</span>}
        </span>}
        actions={<>
          <button className="btn-ghost" onClick={() => addToWishlist.mutate()}>☆ Wishlist</button>
          <button className="btn-ghost" disabled={refreshNow.isPending} onClick={() => refreshNow.mutate()}>{refreshNow.isPending ? <Spinner /> : '↻'} Refresh price</button>
          <button className="btn-primary" onClick={() => addToCollection.mutate('NM')}>+ Add to collection</button>
        </>}
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(17rem,25rem)_minmax(0,1fr)]">
        <div>
          <img src={card.image ?? ''} alt={card.name} className="mx-auto w-full max-w-sm rounded-xl shadow-2xl lg:max-w-none" />
          {card.imageBack && <img src={card.imageBack} alt="" className="mt-3 w-full rounded-xl shadow-2xl" />}
          <StyleBadges styles={card.styles} className="mt-3" />
          <div className="mt-3 whitespace-pre-line rounded-xl border border-line bg-panel p-3 text-sm text-slate-300">{card.oracleText}</div>
        </div>

        <div className="grid gap-4">
          <div className="card-panel p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="label">Prices</span>
              <div className="flex gap-1">
                {card.finishes.map(f => (
                  <button key={f} className={`chip cursor-pointer px-2.5 py-1 ${activeFinish === f ? 'bg-gold text-ink' : 'bg-panel2 text-muted'}`} onClick={() => { setFinish(f); setLast5(null); }}>{FINISH_LABEL[f]}</button>
                ))}
              </div>
              <button className="btn-ghost btn-sm ml-auto" disabled={fetchLast5.isPending} onClick={() => fetchLast5.mutate()}>
                {fetchLast5.isPending ? <Spinner /> : '◷'} Last 5 sales (TCGplayer)
              </button>
            </div>
            <div className="grid gap-2.5 min-[420px]:grid-cols-3 sm:gap-3">
              {CONDITIONS.map(c => {
                const p = prices[priceKey(card.id, activeFinish, c)];
                return (
                  <div key={c} className="rounded-xl border border-line bg-panel2 p-3">
                    <div className="flex items-center justify-between"><ConditionBadge condition={c} /><span className="text-[11px] text-muted">{CONDITION_LABEL[c]}</span></div>
                    <div className="mt-1 font-display text-2xl font-bold text-gold tabular-nums">{money(p?.price)}</div>
                    <div className="text-[11px] text-muted">{p ? `${SOURCE_LABEL[p.source] ?? p.source} · ${timeAgo(p.fetchedAt)}` : 'no price yet'}</div>
                    <button className="btn-ghost btn-sm mt-2 w-full" onClick={() => addToCollection.mutate(c)}>+ Add {c}</button>
                  </div>
                );
              })}
            </div>
            {last5 && (
              <div className="mt-3 rounded-xl border border-line bg-panel2 p-3">
                <div className="label mb-2">Most recent TCGplayer sales ({FINISH_LABEL[activeFinish]})</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {last5.map(r => (
                    <div key={r.condition} className="rounded-lg border border-line p-2">
                      <div className="flex items-center justify-between text-sm"><ConditionBadge condition={r.condition} /><span className="text-gold tabular-nums">{money(r.average)}</span></div>
                      <div className="mt-1 text-[11px] text-muted">
                        {r.sales.length ? `avg of ${r.sales.length} sale${r.sales.length === 1 ? '' : 's'}: ${r.sales.map((s: any) => `$${s.price}`).join(', ')}` : 'no recent sales in this condition'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-muted">Averages of the 5 most recent sold listings. Stored for 7 days and used ahead of the JustTCG price.</div>
              </div>
            )}
          </div>

          <div className="card-panel p-4">
            <div className="label mb-2">Price history ({FINISH_LABEL[activeFinish]})</div>
            {series.length < 2 ? <div className="flex h-40 items-center justify-center text-sm text-muted">Not enough history yet — a snapshot is stored each time prices refresh.</div> : (
              <ResponsiveContainer width="100%" height={200} minWidth={0}>
                <LineChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid stroke="#262d3d" vertical={false} />
                  <XAxis dataKey="date" stroke="#8b93a7" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b93a7" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={{ background: '#141821', border: '1px solid #262d3d', borderRadius: 10 }} formatter={(v: any) => money(Number(v))} />
                  <Line type="monotone" dataKey="NM" stroke="#3ecf8e" dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="LP" stroke="#7c9cff" dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="MP" stroke="#f5b841" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
            <div className="card-panel p-4">
              <div className="label mb-2">You own</div>
              {!data.owned.length ? <div className="text-sm text-muted">None of this printing yet.</div> : (
                <div className="flex flex-col gap-1 text-sm">
                  {data.owned.map((o: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><FinishBadge finish={o.finish} /><ConditionBadge condition={o.condition} /><span className="text-muted">{o.binder}</span></span>
                      <span className="tabular-nums">×{o.qty}</span>
                    </div>
                  ))}
                </div>
              )}
              {!!data.decks.length && (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="label mb-1">In decks</div>
                  {data.decks.map((d: any) => <Link key={d.id} to={`/decks/${d.id}`} className="block text-sm hover:text-gold">⚔ {d.name} ×{d.qty}</Link>)}
                </div>
              )}
            </div>

            <div className="card-panel p-4">
              <div className="label mb-2">Other printings ({data.printingCount})</div>
              <div className="flex max-h-80 flex-wrap gap-2 overflow-y-auto">
                {printings.data?.printings.filter(p => p.id !== card.id).map(p => (
                  <Link key={p.id} to={`/card/${p.id}`} className="w-24 sm:w-28" title={`${p.setName} #${p.number}${p.styles.length ? ` — ${p.styles.join(', ')}` : ''}`}>
                    <img src={p.imageSmall ?? ''} alt="" loading="lazy" className="w-full rounded" />
                    <div className="mt-0.5 truncate text-[10px] text-muted">{p.set.toUpperCase()} #{p.number}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {data.market && (
            <div className="text-xs text-muted">
              Scryfall-reported TCGplayer market price (fallback only): normal {money(data.market.nonfoil)} · foil {money(data.market.foil)}
              {data.market.etched != null && <> · etched {money(data.market.etched)}</>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
