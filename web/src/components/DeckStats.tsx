import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '../lib/format';
import {
  COLOR_FILL, COLOR_KEYS, COLOR_NAME, CURVE_BUCKETS, TYPE_FILL, TYPE_PLURAL, TYPES, sumQty,
  type DeckStatsData, type Entry,
} from '../lib/deckStats';

type Mode = 'color' | 'type';
const PANEL_TOOLTIP = { background: '#141821', border: '1px solid #262d3d', borderRadius: 10 };
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%');
const bucketLabel = (b: string) => `Mana value ${b}`;

/** The series a curve bar is split into: by card color or by card type. */
function seriesFor(mode: Mode) {
  return mode === 'color'
    ? COLOR_KEYS.map(k => ({ key: k as string, name: COLOR_NAME[k], fill: COLOR_FILL[k] }))
    : TYPES.filter(t => t !== 'Land').map(t => ({ key: t as string, name: TYPE_PLURAL[t], fill: TYPE_FILL[t] }));
}

function Dot({ fill }: { fill: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: fill }} />;
}

function CardList({ entries, max = 40 }: { entries: Entry[]; max?: number }) {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.slice(0, max).map(e => (
        <Link key={`${e.id}-${e.name}`} to={`/card/${e.cardId}`}
          className="rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[11px] text-slate-200 hover:border-gold/50 hover:text-gold">
          {e.qty > 1 && <span className="text-muted">{e.qty}× </span>}{e.name}
        </Link>
      ))}
      {sorted.length > max && <span className="px-1 text-[11px] text-muted">+{sorted.length - max} more</span>}
    </div>
  );
}

/** Mana value curve, each bar split by color or type. Hover for a breakdown and card names; click to pin the list below. */
export function CurveChart({ stats, mode, height = 220, compact = false }: { stats: DeckStatsData; mode: Mode; height?: number; compact?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const series = seriesFor(mode);
  const groupOf = (i: number) => (mode === 'color' ? stats.curve[i].byColor : stats.curve[i].byType) as Record<string, Entry[]>;
  const rows = stats.curve.map((b, i) => {
    const g = groupOf(i);
    return { bucket: b.bucket, total: sumQty(b.cards), ...Object.fromEntries(series.map(s => [s.key, sumQty(g[s.key])])) };
  });
  const sel = selected ? CURVE_BUCKETS.indexOf(selected) : -1;
  const used = series.filter(s => rows.some(r => (r as any)[s.key] > 0));
  const topKey = rows.map(r => [...used].reverse().find(s => (r as any)[s.key] > 0)?.key);
  const pick = (b: unknown) => { if (b != null) setSelected(cur => (cur === String(b) ? null : String(b))); };

  const breakdown = (i: number) => used
    .map(s => ({ ...s, n: sumQty(groupOf(i)[s.key]) }))
    .filter(s => s.n > 0);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <BarChart data={rows} accessibilityLayer={false} margin={{ left: -28, top: compact ? 4 : 18, right: 4 }}>
          <CartesianGrid stroke="#262d3d" vertical={false} />
          <XAxis dataKey="bucket" stroke="#8b93a7" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#8b93a7" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: '#1b2130' }} wrapperStyle={{ zIndex: 20, maxWidth: 280 }}
            content={({ active, label }) => {
              const i = CURVE_BUCKETS.indexOf(String(label));
              if (!active || i < 0) return null;
              const cards = stats.curve[i].cards;
              const n = sumQty(cards);
              return (
                <div style={PANEL_TOOLTIP} className="px-3 py-2 text-xs shadow-xl">
                  <div className="font-semibold text-slate-100">{bucketLabel(String(label))} · {n} card{n === 1 ? '' : 's'}</div>
                  <div className="text-muted">{pct(n, stats.spells)} of your non-land cards</div>
                  {!!n && <div className="mt-1.5 grid gap-0.5">
                    {breakdown(i).map(s => (
                      <div key={s.key} className="flex items-center gap-1.5"><Dot fill={s.fill} /><span className="flex-1">{s.name}</span><span className="tabular-nums">{s.n}</span></div>
                    ))}
                  </div>}
                  {!!n && <div className="mt-1.5 border-t border-line pt-1.5 text-slate-300">
                    {[...cards].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10).map(e => <div key={e.id} className="truncate">{e.qty > 1 ? `${e.qty}× ` : ''}{e.name}</div>)}
                    {cards.length > 10 && <div className="text-muted">+{cards.length - 10} more — click the bar to see all</div>}
                  </div>}
                </div>
              );
            }} />
          {used.map(s => (
            <Bar key={s.key} dataKey={s.key} stackId="curve" fill={s.fill} isAnimationActive={false} className="cursor-pointer"
              onClick={(d: any) => pick(d?.payload?.bucket ?? d?.bucket)}>
              {rows.map(r => <Cell key={r.bucket} fillOpacity={selected && selected !== r.bucket ? 0.3 : 1} />)}
              {/* Each bar's total is drawn by whichever series is the top segment of that bar. */}
              {!compact && (
                <LabelList dataKey="total" content={(p: any) => (topKey[p.index] === s.key
                  ? <text x={p.x + p.width / 2} y={p.y - 6} textAnchor="middle" fill="#e7eaf2" fontSize={12} fontWeight={600}>{p.value}</text>
                  : null)} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {(sel >= 0 ? breakdown(sel) : used.map(s => ({ ...s, n: rows.reduce((t, r) => t + (r as any)[s.key], 0) }))).map(s => (
          <span key={s.key} className="flex items-center gap-1"><Dot fill={s.fill} />{s.name} <span className="tabular-nums text-slate-300">{s.n}</span></span>
        ))}
      </div>

      {sel >= 0 ? (
        <div className="mt-2 rounded-lg border border-line bg-ink/40 p-2">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium">{bucketLabel(CURVE_BUCKETS[sel])} · {sumQty(stats.curve[sel].cards)} cards</span>
            <button className="text-muted hover:text-slate-200" onClick={() => setSelected(null)}>Clear ✕</button>
          </div>
          {stats.curve[sel].cards.length ? <CardList entries={stats.curve[sel].cards} /> : <div className="text-xs text-muted">No cards at this mana value.</div>}
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-muted">Hover a bar for details · click it to list its cards</div>
      )}
    </div>
  );
}

/** A pie with a clickable legend; clicking a slice or legend row lists the cards behind it (when there are cards). */
function PieWithLegend({ slices, total, unit, emptyText }: {
  slices: { key: string; name: string; fill: string; n: number; entries?: Entry[] }[];
  total: number; unit: string; emptyText: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const shown = slices.filter(s => s.n > 0);
  if (!shown.length) return <div className="py-6 text-center text-sm text-muted">{emptyText}</div>;
  const pick = (k: string) => setSelected(s => (s === k ? null : k));
  const sel = shown.find(s => s.key === selected);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-36 w-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart accessibilityLayer={false}>
              <Pie data={shown} dataKey="n" nameKey="name" innerRadius="45%" outerRadius="95%" stroke="#141821" strokeWidth={2}
                isAnimationActive={false} onClick={(d: any) => pick(d.key ?? d.payload?.key)} className="cursor-pointer">
                {shown.map(s => <Cell key={s.key} fill={s.fill} fillOpacity={selected && selected !== s.key ? 0.3 : 1} />)}
              </Pie>
              <Tooltip contentStyle={PANEL_TOOLTIP} itemStyle={{ color: '#e7eaf2' }}
                formatter={(v: any, name: any) => [`${v} ${unit} (${pct(Number(v), total)})`, name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="grid min-w-[10rem] flex-1 gap-0.5 text-sm">
          {shown.map(s => (
            <button key={s.key} onClick={() => pick(s.key)}
              className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-panel2 ${selected === s.key ? 'bg-panel2' : ''}`}>
              <Dot fill={s.fill} />
              <span className="flex-1">{s.name}</span>
              <span className="tabular-nums">{s.n}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(s.n, total)}</span>
            </button>
          ))}
        </div>
      </div>
      {sel?.entries && (
        <div className="mt-3 rounded-lg border border-line bg-ink/40 p-2">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium">{sel.name} · {sel.n} {unit}</span>
            <button className="text-muted hover:text-slate-200" onClick={() => setSelected(null)}>Clear ✕</button>
          </div>
          <CardList entries={sel.entries} />
        </div>
      )}
    </div>
  );
}

function Panel({ title, sub, children, actions, className = '' }: { title: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`card-panel min-w-0 p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-display font-semibold">{title}</div>
          {sub && <div className="text-xs text-muted">{sub}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-panel2 p-0.5">
      {(['color', 'type'] as const).map(m => (
        <button key={m} className={`rounded-md px-2.5 py-1 text-xs ${mode === m ? 'bg-line text-white' : 'text-muted'}`} onClick={() => onChange(m)}>
          {m === 'color' ? 'By color' : 'By type'}
        </button>
      ))}
    </div>
  );
}

/** Compact stats for the deck page sidebar. */
export function DeckStatsSummary({ stats, onOpenFull }: { stats: DeckStatsData; onOpenFull: () => void }) {
  const [mode, setMode] = useState<Mode>('color');
  const colored = (['W', 'U', 'B', 'R', 'G', 'C'] as const).filter(k => stats.pips[k] > 0);
  const pipTotal = colored.reduce((t, k) => t + stats.pips[k], 0);
  return (
    <div className="card-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="label">Mana curve</div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      <CurveChart stats={stats} mode={mode} height={140} compact />
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <div><div className="font-display text-lg font-semibold tabular-nums">{stats.averageCmc.toFixed(2)}</div><div className="text-[10px] uppercase text-muted">Avg value</div></div>
        <div><div className="font-display text-lg font-semibold tabular-nums">{stats.lands}</div><div className="text-[10px] uppercase text-muted">Lands</div></div>
        <div><div className="font-display text-lg font-semibold tabular-nums">{stats.spells}</div><div className="text-[10px] uppercase text-muted">Spells</div></div>
      </div>
      <div className="mt-3 grid gap-1 text-sm">
        {TYPES.filter(t => stats.byType[t]).map(t => ({ t, n: sumQty(stats.byType[t]) })).sort((a, b) => b.n - a.n).map(({ t, n }) => (
          <div key={t} className="flex items-center gap-2">
            <Dot fill={TYPE_FILL[t]} /><span className="flex-1 text-muted">{TYPE_PLURAL[t]}</span>
            <span className="tabular-nums">{n}</span><span className="w-9 text-right text-xs tabular-nums text-muted">{pct(n, stats.count)}</span>
          </div>
        ))}
      </div>
      {!!pipTotal && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="label mb-1.5">Mana symbols vs sources</div>
          <div className="grid gap-1 text-sm">
            {colored.map(k => (
              <div key={k} className="flex items-center gap-2" title={`${stats.pips[k]} ${COLOR_NAME[k]} symbols in costs · ${sumQty(stats.production[k])} cards can make ${COLOR_NAME[k]} mana`}>
                <img src={`https://svgs.scryfall.io/card-symbols/${k}.svg`} width={14} height={14} alt={k} />
                <span className="flex-1 tabular-nums">{stats.pips[k]} <span className="text-xs text-muted">({pct(stats.pips[k], pipTotal)})</span></span>
                <span className="text-xs text-muted">{sumQty(stats.production[k])} sources</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="btn-ghost mt-3 w-full" onClick={onOpenFull}>See all stats →</button>
    </div>
  );
}

/** The full Stats tab, modelled on ManaBox's deck stats. */
export function DeckStatsFull({ stats, deckColors }: { stats: DeckStatsData; deckColors: string[] }) {
  const [mode, setMode] = useState<Mode>('color');
  const [generic, setGeneric] = useState(false);
  const [showAllSubtypes, setShowAllSubtypes] = useState(false);

  const costKeys = [...(['W', 'U', 'B', 'R', 'G', 'C'] as const)];
  const costSlices = [
    ...costKeys.map(k => ({ key: k, name: COLOR_NAME[k], fill: COLOR_FILL[k], n: stats.pips[k] })),
    ...(generic ? [{ key: 'generic', name: 'Generic', fill: '#6b7280', n: stats.pips.generic }] : []),
  ];
  const prodKeys = (['W', 'U', 'B', 'R', 'G', 'C'] as const).filter(k => k === 'C' || deckColors.includes(k) || stats.production[k]);
  const prodSlices = prodKeys.map(k => ({ key: k, name: COLOR_NAME[k], fill: COLOR_FILL[k], n: sumQty(stats.production[k]), entries: stats.production[k] ?? [] }));
  const typeSlices = TYPES.map(t => ({ key: t, name: TYPE_PLURAL[t], fill: TYPE_FILL[t], n: sumQty(stats.byType[t]), entries: stats.byType[t] ?? [] }));
  const subtypes = showAllSubtypes ? stats.subtypes : stats.subtypes.slice(0, 8);
  const maxSub = stats.subtypes[0]?.n ?? 1;

  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
      <Panel title="Mana value" sub={<>Average <b className="text-slate-200">{stats.averageCmc.toFixed(2)}</b> · Total <b className="text-slate-200">{stats.manaTotal}</b> across {stats.spells} non-land cards</>}
        actions={<ModeToggle mode={mode} onChange={setMode} />}>
        <CurveChart stats={stats} mode={mode} />
      </Panel>

      <Panel title="Card types" sub={`${stats.count} cards in the deck`}>
        <PieWithLegend slices={typeSlices} total={stats.count} unit="cards" emptyText="No cards yet." />
      </Panel>

      <Panel title="Mana costs" sub="Colored mana symbols in your spells' costs"
        actions={<label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={generic} onChange={e => setGeneric(e.target.checked)} /> Include generic</label>}>
        <PieWithLegend slices={costSlices} total={costSlices.reduce((t, s) => t + s.n, 0)} unit="symbols" emptyText="No mana symbols yet." />
      </Panel>

      <Panel title="Mana production" sub="Cards that can make each color (lands, rocks, dorks, rituals). Click a color to list them.">
        <PieWithLegend slices={prodSlices} total={prodSlices.reduce((t, s) => t + s.n, 0)} unit="sources" emptyText="No mana sources found." />
        {deckColors.map(k => {
          const need = stats.pips[k] ?? 0, have = sumQty(stats.production[k]);
          const pipTotal = (['W', 'U', 'B', 'R', 'G'] as const).reduce((t, c) => t + stats.pips[c], 0);
          const srcTotal = (['W', 'U', 'B', 'R', 'G'] as const).reduce((t, c) => t + sumQty(stats.production[c]), 0);
          const low = pipTotal && srcTotal && need / pipTotal - have / srcTotal > 0.1;
          return low ? (
            <div key={k} className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
              {COLOR_NAME[k as keyof typeof COLOR_NAME]} is {pct(need, pipTotal)} of your mana symbols but only {pct(have, srcTotal)} of your colored sources — consider more {COLOR_NAME[k as keyof typeof COLOR_NAME].toLowerCase()} sources.
            </div>
          ) : null;
        })}
      </Panel>

      <Panel title="Subtypes" sub="Creature types and other subtypes, as a share of cards that have one">
        {!stats.subtypes.length ? <div className="text-sm text-muted">No subtypes.</div> : (
          <div className="grid gap-2">
            {subtypes.map(s => (
              <div key={s.name}>
                <div className="flex justify-between text-sm"><span>{s.name}</span><span className="tabular-nums text-muted">{s.n} ({Math.round(s.pct * 100)}%)</span></div>
                <div className="mt-0.5 h-1.5 rounded-full bg-panel2"><div className="h-full rounded-full bg-gold" style={{ width: `${(s.n / maxSub) * 100}%` }} /></div>
              </div>
            ))}
            {stats.subtypes.length > 8 && (
              <button className="text-left text-xs text-accent hover:underline" onClick={() => setShowAllSubtypes(v => !v)}>
                {showAllSubtypes ? 'Show fewer' : `Show all ${stats.subtypes.length}`}
              </button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Tokens" sub="Read from the cards' rules text">
        {!stats.tokens.length ? <div className="text-sm text-muted">No cards in this deck make tokens.</div> : (
          <div className="grid gap-2">
            {stats.tokens.map(t => (
              <div key={t.name} className="rounded-lg border border-line bg-panel2/50 px-3 py-2">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="mt-1 text-xs text-muted">Made by: <CardNames entries={t.from} /></div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Value" className="xl:col-span-2" sub={<>{money(stats.value)} total{stats.unpriced ? ` · ${stats.unpriced} unpriced` : ''}</>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label mb-1.5">By card type</div>
            <div className="grid gap-1.5 text-sm">
              {stats.valueByType.map(v => (
                <div key={v.type}>
                  <div className="flex justify-between"><span className="flex items-center gap-1.5"><Dot fill={TYPE_FILL[v.type]} />{TYPE_PLURAL[v.type]}</span><span className="tabular-nums text-gold">{money(v.value)}</span></div>
                  <div className="mt-0.5 h-1 rounded-full bg-panel2"><div className="h-full rounded-full" style={{ width: `${(v.value / (stats.valueByType[0]?.value || 1)) * 100}%`, background: TYPE_FILL[v.type] }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <div className="label mb-1.5">Most valuable</div>
            <div className="grid gap-1">
              {stats.priciest.map(p => (
                <Link key={p.id} to={`/card/${p.cardId}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-panel2">
                  {p.image && <img src={p.image} alt="" className="h-8 w-[1.45rem] shrink-0 rounded-sm object-cover object-top" />}
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="tabular-nums text-gold">{money(p.price)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function CardNames({ entries }: { entries: Entry[] }) {
  return <>{entries.map((e, i) => <span key={e.id}>{i > 0 && ', '}<Link className="text-slate-300 hover:text-gold" to={`/card/${e.cardId}`}>{e.name}</Link></span>)}</>;
}
