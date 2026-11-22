import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Board, type Condition, type Finish } from '../lib/api';
import { CONDITIONS, CONDITION_LABEL, FINISH_LABEL, money } from '../lib/format';
import { Empty, PageHeader, Spinner, StyleBadges, useToast } from '../components/ui';
import { PrintingPicker } from '../components/PrintingPicker';

type Status = 'resolved' | 'ambiguous' | 'unresolved' | 'flagged';
type Action = 'import' | 'skip' | 'misc';

interface Row {
  line: number; raw: string; qty: number; status: Status; scryfallId?: string; card?: any; candidates?: any[];
  finish: Finish; condition: Condition; board?: Board | null; issues: string[]; binder?: string; deck?: string;
  purchasePrice?: number | null; action: Action;
}

const FIELDS = ['name', 'qty', 'setCode', 'setName', 'set', 'number', 'finish', 'condition', 'lang', 'board', 'scryfallId', 'tcgplayerId', 'purchasePrice', 'binder', 'deck', 'notes'] as const;

const STATUS_STYLE: Record<Status, string> = {
  resolved: 'bg-good/15 text-good', ambiguous: 'bg-accent/15 text-accent',
  unresolved: 'bg-bad/15 text-bad', flagged: 'bg-amber-500/15 text-amber-300',
};

export function ImportExport() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [destination, setDestination] = useState<'collection' | 'deck' | 'wishlist'>('collection');
  const [binderId, setBinderId] = useState(1);
  const [useFileBinders, setUseFileBinders] = useState(false);
  const [deckTarget, setDeckTarget] = useState<'new' | number>('new');
  const [deckName, setDeckName] = useState('');
  const [splitByDeck, setSplitByDeck] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);

  const binders = useQuery({ queryKey: ['binders'], queryFn: () => api.get<any[]>('/binders') });
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => api.get<any[]>('/decks') });

  const runPreview = useMutation({
    mutationFn: async (opts: { sheet?: string; mapping?: Record<string, string> } = {}) => {
      const fd = new FormData();
      if (file) fd.append('file', file);
      else fd.append('text', text);
      if (opts.sheet) fd.append('sheet', opts.sheet);
      if (opts.mapping) fd.append('mapping', JSON.stringify(opts.mapping));
      const res = await fetch('/api/import/preview', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed');
      return json;
    },
    onSuccess: p => {
      setPreview(p);
      setRows(p.rows.map((r: any) => ({ ...r, action: (r.status === 'unresolved' ? 'skip' : 'import') as Action })));
      if (p.looksLikeDeck) setDestination('deck');
      setDeckName((p.filename ?? 'Imported deck').replace(/\.[^.]+$/, ''));
      setSplitByDeck(!!p.hasDeckColumn);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  const commit = useMutation({
    mutationFn: () => api.post<any>('/import/commit', {
      filename: preview.filename, format: preview.format, destination,
      binderId: destination === 'collection' ? binderId : undefined,
      useFileBinders: destination === 'collection' ? useFileBinders : undefined,
      deckId: destination === 'deck' && deckTarget !== 'new' ? deckTarget : undefined,
      deckName: destination === 'deck' ? deckName : undefined,
      splitByDeckColumn: destination === 'deck' ? splitByDeck : undefined,
      rows: rows.filter(r => r.scryfallId).map(r => ({
        scryfallId: r.scryfallId, qty: r.qty, finish: r.finish, condition: r.condition, action: r.action,
        board: r.board ?? undefined, binder: r.binder, deck: r.deck, purchasePrice: r.purchasePrice ?? undefined,
      })),
    }),
    onSuccess: r => {
      qc.invalidateQueries();
      toast(`Imported ${r.imported} cards${r.toMisc ? `, ${r.toMisc} to Miscellaneous` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      setPreview(null); setRows([]); setFile(null); setText('');
      if (r.deckIds?.length) nav(`/decks/${r.deckIds[0]}`);
      else nav('/collection');
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  const update = (line: number, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.line === line ? { ...r, ...patch } : r)));
  const bulk = (match: (r: Row) => boolean, patch: Partial<Row>) => setRows(rs => rs.map(r => (match(r) ? { ...r, ...patch } : r)));

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {} as Record<Status, number>);
  const importing = rows.filter(r => r.action === 'import');
  const shown = rows.filter(r => filter === 'all' || r.status !== 'resolved');
  const commanderRows = rows.filter(r => r.board === 'commander' && r.action === 'import');

  return (
    <div>
      <PageHeader title="Import / Export" sub="Excel (.xlsx/.xls), CSV and plain text — collections or Commander decklists." />

      {!preview ? (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="card-panel p-4 sm:p-5">
            <div className="font-display text-lg font-semibold">Import a file</div>
            <p className="mt-1 text-sm text-muted">
              Works with exports from ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield, Delver Lens, the TCGplayer app, and this app's own exports.
              Columns are detected automatically and you can fix them before anything is saved.
            </p>
            <div
              className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel2/50 px-4 py-10 text-center"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); setText(''); } }}>
              <div className="text-sm text-muted">Drop a file here</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setText(''); } }} />
              <button className="btn-ghost mt-2" onClick={() => fileRef.current?.click()}>Choose a file…</button>
              {file && <div className="mt-3 text-sm text-slate-200">{file.name} ({Math.round(file.size / 1024)} KB)</div>}
            </div>
            <button className="btn-primary mt-4 w-full" disabled={!file || runPreview.isPending} onClick={() => runPreview.mutate({})}>
              {runPreview.isPending ? <Spinner /> : 'Read file'}
            </button>
          </div>

          <div className="card-panel p-4 sm:p-5">
            <div className="font-display text-lg font-semibold">Paste a decklist</div>
            <p className="mt-1 text-sm text-muted">One card per line, e.g. <code className="text-slate-300">1 Sol Ring (C21) 263 *F*</code>. Section headers like Commander / Deck / Sideboard are understood.</p>
            <textarea className="input mt-3 h-52 font-mono text-xs" placeholder={'Commander\n1 Krenko, Mob Boss (DDT) 52\n\nDeck\n1 Sol Ring (C21) 263\n34 Mountain'}
              value={text} onChange={e => { setText(e.target.value); setFile(null); }} />
            <button className="btn-primary mt-3 w-full" disabled={!text.trim() || runPreview.isPending} onClick={() => runPreview.mutate({})}>
              {runPreview.isPending ? <Spinner /> : 'Read list'}
            </button>
          </div>

          <div className="card-panel p-4 sm:p-5 lg:col-span-2">
            <div className="font-display text-lg font-semibold">Export</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="btn-primary" href="/api/export/xlsx">Excel workbook (everything)</a>
              <a className="btn-ghost" href="/api/export/xlsx?parts=collection">Excel — collection only</a>
              <a className="btn-ghost" href="/api/export/xlsx?parts=decks">Excel — decks only</a>
              <a className="btn-ghost" href="/api/export/csv?format=native">CSV (this app)</a>
              <a className="btn-ghost" href="/api/export/csv?format=manabox">CSV (ManaBox format)</a>
              <a className="btn-ghost" href="/api/export/csv?format=moxfield">CSV (Moxfield format)</a>
            </div>
            <p className="mt-2 text-xs text-muted">Exports include the Scryfall ID of every printing, so re-importing a file restores the exact same cards.</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="card-panel mb-4 flex flex-wrap items-center gap-3 p-3 sm:p-4">
            <div>
              <div className="font-display font-semibold">{preview.filename}</div>
              <div className="text-xs text-muted">{rows.length} rows · {preview.format}{preview.sheet ? ` · sheet "${preview.sheet}"` : ''}</div>
            </div>
            {preview.sheetNames?.length > 1 && (
              <select className="input w-full sm:w-44" value={preview.sheet} onChange={e => runPreview.mutate({ sheet: e.target.value })}>
                {preview.sheetNames.map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <div className="flex gap-1.5">
              {(['resolved', 'ambiguous', 'flagged', 'unresolved'] as Status[]).map(s => counts[s] ? <span key={s} className={`chip ${STATUS_STYLE[s]}`}>{counts[s]} {s}</span> : null)}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
              <button className="btn-ghost btn-sm" onClick={() => bulk(r => r.status === 'flagged', { action: 'misc' })}>Flagged → Miscellaneous</button>
              <button className="btn-ghost btn-sm" onClick={() => bulk(r => r.status === 'flagged', { action: 'import', condition: 'MP' })}>Flagged → import as MP</button>
              <button className="btn-ghost" onClick={() => { setPreview(null); setRows([]); }}>Start over</button>
            </div>
          </div>

          {preview.headers && (
            <div className="card-panel mb-4 p-4">
              <div className="label mb-2">Column mapping</div>
              <div className="flex flex-wrap gap-2">
                {FIELDS.map(f => (
                  <label key={f} className="flex items-center gap-1 text-xs text-muted">
                    {f}
                    <select className="input w-32 py-1 sm:w-36" value={preview.mapping?.[f] ?? ''}
                      onChange={e => runPreview.mutate({ sheet: preview.sheet, mapping: { ...preview.mapping, [f]: e.target.value || undefined } as any })}>
                      <option value="">—</option>
                      {preview.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="card-panel mb-4 flex flex-wrap items-end gap-3 p-3 sm:p-4">
            <label className="grid gap-1"><span className="label">Import into</span>
              <select className="input w-full sm:w-44" value={destination} onChange={e => setDestination(e.target.value as any)}>
                <option value="collection">Collection</option><option value="deck">Commander deck</option><option value="wishlist">Wishlist</option>
              </select>
            </label>
            {destination === 'collection' && <>
              <label className="grid gap-1"><span className="label">Binder</span>
                <select className="input w-full sm:w-52" value={binderId} onChange={e => setBinderId(Number(e.target.value))} disabled={useFileBinders}>
                  {binders.data?.filter(b => b.kind !== 'deck').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              {rows.some(r => r.binder) && (
                <label className="flex items-center gap-2 pb-2 text-sm text-muted">
                  <input type="checkbox" checked={useFileBinders} onChange={e => setUseFileBinders(e.target.checked)} /> Use binder names from the file
                </label>
              )}
            </>}
            {destination === 'deck' && <>
              <label className="grid gap-1"><span className="label">Deck</span>
                <select className="input w-full sm:w-52" value={String(deckTarget)} onChange={e => setDeckTarget(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
                  <option value="new">Create a new deck</option>
                  {decks.data?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              {deckTarget === 'new' && (
                <label className="grid gap-1"><span className="label">Deck name</span><input className="input w-full sm:w-52" value={deckName} onChange={e => setDeckName(e.target.value)} /></label>
              )}
              {preview.hasDeckColumn && (
                <label className="flex items-center gap-2 pb-2 text-sm text-muted">
                  <input type="checkbox" checked={splitByDeck} onChange={e => setSplitByDeck(e.target.checked)} /> One deck per "Deck" column value
                </label>
              )}
              {commanderRows.length ? (
                <div className="flex items-center gap-2 pb-1">
                  <span className="label">Commander</span>
                  {commanderRows.map(r => (
                    <span key={r.line} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2 py-1 text-sm">
                      {r.card?.image && <img src={r.card.image} alt="" className="h-11 w-8 max-w-none shrink-0 rounded object-cover object-top" />}
                      {r.card?.name ?? r.raw}
                      {r.card && <span className="text-xs text-muted">{r.card.set.toUpperCase()} #{r.card.number}</span>}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="pb-2 text-xs text-amber-300">No commander detected — set a row's board to Commander below, or do it in the deck editor.</div>
              )}
            </>}
            <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
              <div className="text-sm text-muted">
                {importing.reduce((n, r) => n + r.qty, 0)} cards will be imported
                {rows.some(r => r.action === 'misc') && `, ${rows.filter(r => r.action === 'misc').reduce((n, r) => n + r.qty, 0)} to Miscellaneous`}
              </div>
              <button className="btn-primary" disabled={commit.isPending || !importing.length} onClick={() => commit.mutate()}>
                {commit.isPending ? <Spinner /> : `Import ${importing.reduce((n, r) => n + r.qty, 0)} cards`}
              </button>
            </div>
          </div>

          <div className="mb-2 flex gap-2">
            {(['all', 'attention'] as const).map(f => (
              <button key={f} className={`chip cursor-pointer px-3 py-1 ${filter === f ? 'bg-gold text-ink' : 'bg-panel2 text-muted'}`} onClick={() => setFilter(f)}>
                {f === 'all' ? `All rows (${rows.length})` : `Needs attention (${rows.length - (counts.resolved ?? 0)})`}
              </button>
            ))}
          </div>

          {!shown.length ? <Empty title="Nothing to review">Every row matched a printing.</Empty> : (
            <div className="card-panel overflow-hidden">
              <div className="table-wrap"><table className="data">
                <thead><tr><th className="col-md">Line</th><th>Status</th><th className="w-10"></th><th>Card</th><th>Printing</th><th className="col-lg">Finish</th><th className="col-lg">Condition</th><th className="text-right">Qty</th><th className="col-xl">Board</th><th>Action</th></tr></thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.line}>
                      <td className="col-md text-muted" title={r.raw}>{r.line}</td>
                      <td><span className={`chip ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                      <td>{r.card?.image && <img src={r.card.image} alt="" className="h-[4.5rem] w-[3.2rem] max-w-none shrink-0 rounded object-cover object-top" loading="lazy" />}</td>
                      <td>
                        <div>{r.card?.name ?? <span className="text-bad">{r.raw}</span>}</div>
                        {!!r.issues.length && <div className="text-[11px] text-muted">{r.issues.join(' ')}</div>}
                      </td>
                      <td>
                        {r.candidates?.length ? (
                          <select className="input w-44 sm:w-64" value={r.scryfallId ?? ''}
                            onChange={e => {
                              const c = r.candidates!.find(x => x.id === e.target.value);
                              update(r.line, { scryfallId: c.id, card: c, finish: c.finishes.includes(r.finish) ? r.finish : c.finishes[0], status: 'resolved', action: 'import' });
                            }}>
                            {!r.scryfallId && <option value="">Pick a printing…</option>}
                            {r.candidates.map(c => (
                              <option key={c.id} value={c.id}>{c.set.toUpperCase()} #{c.number} — {c.setName}{c.styles.length ? ` (${c.styles.join(', ')})` : ''}</option>
                            ))}
                          </select>
                        ) : r.card ? (
                          <span className="text-muted">{r.card.set.toUpperCase()} #{r.card.number}<StyleBadges styles={r.card.styles} className="ml-1" /></span>
                        ) : null}
                        <button className="btn-ghost btn-sm ml-1" onClick={() => setPicking(r.line)}>Search…</button>
                      </td>
                      <td className="col-lg">
                        <select className="input w-24" value={r.finish} onChange={e => update(r.line, { finish: e.target.value as Finish })}>
                          {(r.card?.finishes ?? ['nonfoil']).map((f: Finish) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
                        </select>
                      </td>
                      <td className="col-lg">
                        <select className="input w-40" value={r.condition} onChange={e => update(r.line, { condition: e.target.value as Condition })}>
                          {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                        </select>
                      </td>
                      <td className="text-right"><input className="input w-16 text-right" value={r.qty} onChange={e => update(r.line, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></td>
                      <td className="col-xl">
                        <select className="input w-32" value={r.board ?? 'main'} onChange={e => update(r.line, { board: e.target.value as Board })} disabled={destination !== 'deck'}>
                          <option value="commander">Commander</option><option value="main">Deck</option>
                          <option value="companion">Companion</option><option value="maybe">Maybeboard</option>
                        </select>
                      </td>
                      <td>
                        <select className={`input w-32 ${r.action === 'skip' ? 'text-muted' : r.action === 'misc' ? 'text-amber-300' : ''}`}
                          value={r.action} onChange={e => update(r.line, { action: e.target.value as Action })} disabled={!r.scryfallId}>
                          <option value="import">Import</option><option value="misc">To Miscellaneous</option><option value="skip">Skip</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          <PrintingPicker open={picking != null} onClose={() => setPicking(null)} title="Find the right card"
            initialName={rows.find(r => r.line === picking)?.card?.name ?? rows.find(r => r.line === picking)?.raw?.replace(/^\d+x?\s*/, '')}
            submitLabel="Use this printing"
            onPick={res => picking != null && update(picking, {
              scryfallId: res.card.id, card: res.card, finish: res.finish, condition: res.condition, qty: res.qty, status: 'resolved', action: 'import',
            })} />
        </div>
      )}
    </div>
  );
}
