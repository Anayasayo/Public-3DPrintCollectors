import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Card } from '../lib/api';
import { money, moneyShort, timeAgo } from '../lib/format';
import { CardThumb, ConditionBadge, Empty, FinishBadge, PageHeader, PriceTag, Spinner, Stat, useToast } from '../components/ui';

interface Mover { card: Card; finish: any; condition: any; qty: number; price: number; oldPrice: number; change: number; pct: number | null }

export function Dashboard() {
  const [days, setDays] = useState(7);
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', days], queryFn: () => api.get<any>(`/dashboard?days=${days}`) });
  const refreshStatus = useQuery({
    queryKey: ['price-status'],
    queryFn: () => api.get<any>('/prices/status'),
    refetchInterval: q => ((q.state.data as any)?.running ? 1500 : false),
  });
  const refresh = useMutation({
    mutationFn: () => api.post('/prices/refresh', {}),
    onSuccess: () => { toast('Price refresh started — this runs in the background.', 'info'); setTimeout(() => qc.invalidateQueries({ queryKey: ['price-status'] }), 500); },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading || !data) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const s = data.summary;
  const history = data.history.map((h: any) => ({ ...h, label: h.date.slice(5) }));
  const running = refreshStatus.data?.running;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub={<>Prices last refreshed {timeAgo(data.lastPriceRefresh)}{data.catalogSize ? ` · ${data.catalogSize.toLocaleString()} printings in catalog` : ''}</>}
        actions={<>
          <select className="input w-28 sm:w-32" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option>
          </select>
          <button className="btn-primary" disabled={running || refresh.isPending} onClick={() => refresh.mutate()}>
            {running ? <><Spinner /> Refreshing {refreshStatus.data.done}/{refreshStatus.data.queued}</> : 'Refresh prices'}
          </button>
        </>}
      />

      {!data.hasApiKey && (
        <Link to="/settings" className="mb-5 block rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          No JustTCG API key yet — prices fall back to TCGplayer market prices from the card catalog. Add your key in Settings for NM/LP/MP pricing. →
        </Link>
      )}
      {refreshStatus.data?.message && <div className="mb-5 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">{refreshStatus.data.message}</div>}
      {refreshStatus.data?.lastError && <div className="mb-5 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-red-200">{refreshStatus.data.lastError}</div>}

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <Stat label="Collection value" value={money(s.total)} accent sub={`${s.cards} cards · ${s.entries} entries`} />
        <Stat label="Decks" value={data.decks.length} sub={`${data.decks.filter((d: any) => d.status === 'in_collection').length} in collection`} />
        <Stat label="Miscellaneous" value={data.miscCount} sub="cards waiting to be filed" />
        <Stat label="Unpriced entries" value={s.unpriced} sub={s.unpriced ? 'run a price refresh' : 'everything is priced'} />
      </div>

      <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-3">
        <div className="card-panel p-3 sm:p-4 lg:col-span-2">
          <div className="label mb-2">Collection value over time</div>
          {history.length < 2 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted">One snapshot is taken per day — the chart fills in as you use the app.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <AreaChart data={history} margin={{ left: -18, right: 6, top: 6 }}>
                <defs>
                  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f5b841" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#f5b841" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#262d3d" vertical={false} />
                <XAxis dataKey="label" stroke="#8b93a7" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#8b93a7" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => moneyShort(v)} />
                <Tooltip contentStyle={{ background: '#141821', border: '1px solid #262d3d', borderRadius: 10 }} formatter={(v: any) => money(Number(v))} />
                <Area type="monotone" dataKey="total" stroke="#f5b841" fill="url(#v)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-panel p-4">
          <div className="label mb-2">Where your cards are</div>
          <div className="flex flex-col gap-1.5">
            {data.binders.map((b: any) => (
              <Link key={b.id} to={`/collection?binder=${b.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-panel2">
                <span className="truncate">{b.kind === 'deck' ? '⚔ ' : '▦ '}{b.name}</span>
                <span className="ml-3 shrink-0 text-muted tabular-nums">{b.cards} · {money(b.value)}</span>
              </Link>
            ))}
            {!data.binders.length && <div className="p-2 text-sm text-muted">Nothing in the collection yet.</div>}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="label mb-1.5">By condition</div>
            {data.byCondition.map((c: any) => (
              <div key={c.condition} className="flex items-center justify-between py-0.5 text-sm">
                <ConditionBadge condition={c.condition} />
                <span className="text-muted tabular-nums">{c.cards} · {money(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-2">
        {[{ title: `Top gainers (${days}d)`, rows: data.movers.gainers as Mover[], up: true }, { title: `Top losers (${days}d)`, rows: data.movers.losers as Mover[], up: false }].map(section => (
          <div key={section.title} className="card-panel p-4">
            <div className="label mb-2">{section.title}</div>
            {!section.rows.length ? <div className="p-2 text-sm text-muted">No price history yet for this window.</div> : (
              <div className="flex flex-col gap-1">
                {section.rows.map((m, i) => (
                  <Link key={i} to={`/card/${m.card.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-panel2">
                    <CardThumb card={m.card} className="w-11 shrink-0 sm:w-12" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{m.card.name}</div>
                      <div className="text-[11px] text-muted">{m.card.set.toUpperCase()} #{m.card.number} · {m.condition} · ×{m.qty}</div>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <div className={section.up ? 'text-good' : 'text-bad'}>{m.change > 0 ? '+' : ''}{money(m.change)}{m.pct != null && ` (${m.pct > 0 ? '+' : ''}${m.pct}%)`}</div>
                      <div className="text-[11px] text-muted">{money(m.oldPrice)} → {money(m.price)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-3">
        <div className="card-panel p-3 sm:p-4 lg:col-span-2">
          <div className="label mb-2">Most valuable cards</div>
          {!data.topCards.length ? <Empty title="Nothing here yet">Add cards or import a collection to get started.</Empty> : (
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-3">
              {data.topCards.map((t: any, i: number) => (
                <Link key={i} to={`/card/${t.card.id}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel2 p-2 hover:border-slate-500">
                  <CardThumb card={t.card} className="w-14 shrink-0 sm:w-16" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.card.name}</div>
                    <div className="flex items-center gap-1 text-[11px] text-muted"><FinishBadge finish={t.finish} /><ConditionBadge condition={t.condition} /></div>
                    <PriceTag className="text-sm text-gold" price={t.price} source={t.source} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card-panel p-4">
          <div className="label mb-2">Wishlist at target price</div>
          {!data.wishlistAlerts.length ? <div className="p-2 text-sm text-muted">No wishlist cards are at or below their target.</div> : (
            <div className="flex flex-col gap-1">
              {data.wishlistAlerts.map((a: any) => (
                <Link key={a.id} to="/wishlist" className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-panel2">
                  <CardThumb card={a.card} className="w-11 shrink-0" />
                  <span className="flex-1 truncate text-sm">{a.card.name}</span>
                  <span className="text-sm text-good tabular-nums">{money(a.price)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
