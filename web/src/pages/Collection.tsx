import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Condition, type Finish } from '../lib/api';
import { CONDITION_LABEL, FINISH_LABEL, money } from '../lib/format';
import {
  CardThumb, ConditionBadge, ConditionSelect, Confirm, Empty, FinishBadge, Modal, PageHeader, PriceTag, QtyInput,
  Spinner, StyleBadges, useToast,
} from '../components/ui';
import { PrintingPicker } from '../components/PrintingPicker';

const STYLES = [
  ['', 'Any treatment'], ['borderless', 'Borderless'], ['showcase', 'Showcase'], ['extendedart', 'Extended art'],
  ['fullart', 'Full art'], ['retro', 'Retro frame'], ['serialized', 'Serialized'], ['surgefoil', 'Surge foil'],
  ['textured', 'Textured'], ['promo', 'Promo'], ['gamechanger', 'Game Changer'],
];

export function Collection() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [namingBinder, setNamingBinder] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'grid'>(() => (localStorage.getItem('collection-view') as any) ?? 'table');

  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    v ? next.set(k, v) : next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const query = Object.fromEntries(params.entries());
  const { data, isLoading } = useQuery({ queryKey: ['collection', query], queryFn: () => api.get<any>(`/collection${qs(query)}`) });
  const binders = useQuery({ queryKey: ['binders'], queryFn: () => api.get<any[]>('/binders') });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['collection'] }); qc.invalidateQueries({ queryKey: ['binders'] }); qc.invalidateQueries({ queryKey: ['summary'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const add = useMutation({ mutationFn: (b: any) => api.post('/collection', b), onSuccess: () => { invalidate(); toast('Added to collection'); }, onError: (e: Error) => toast(e.message, 'err') });
  const patch = useMutation({ mutationFn: ({ id, ...b }: any) => api.patch(`/collection/${id}`, b), onSuccess: () => { invalidate(); setEditing(null); toast('Saved'); }, onError: (e: Error) => toast(e.message, 'err') });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/collection/${id}`), onSuccess: () => { invalidate(); toast('Removed'); } });
  const bulk = useMutation({ mutationFn: (b: any) => api.post('/collection/bulk', b), onSuccess: () => { invalidate(); setSelected([]); toast('Done'); } });
  const newBinder = useMutation({
    mutationFn: (name: string) => api.post<{ id: number }>('/binders', { name }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['binders'] }); set('binder', String(r.id)); },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  const items = data?.items ?? [];
  const page = Number(get('page') || 1);
  const pages = data ? Math.max(1, Math.ceil(data.summary.entries / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Collection"
        sub={data && <>{data.summary.cards} cards · {data.summary.entries} entries · <span className="text-gold">{money(data.summary.total)}</span>{data.summary.unpriced ? ` · ${data.summary.unpriced} unpriced` : ''}</>}
        actions={<>
          <div className="flex rounded-lg border border-line bg-panel2 p-0.5">
            {(['table', 'grid'] as const).map(v => (
              <button key={v} className={`rounded-md px-2.5 py-1 text-xs ${view === v ? 'bg-line text-white' : 'text-muted'}`}
                onClick={() => { setView(v); localStorage.setItem('collection-view', v); }}>{v === 'table' ? 'List' : 'Grid'}</button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setAdding(true)}>+ Add card</button>
        </>}
      />

      <div className="card-panel mb-4 grid grid-cols-2 gap-2 p-3 sm:flex sm:flex-wrap sm:items-center">
        <input className="input col-span-2 sm:w-56" placeholder="Search name or type…" value={get('q')} onChange={e => set('q', e.target.value)} />
        <select className="input col-span-2 sm:w-44" value={get('binder')} onChange={e => set('binder', e.target.value)}>
          <option value="">All binders</option>
          {binders.data?.map(b => <option key={b.id} value={b.id}>{b.kind === 'deck' ? '⚔ ' : ''}{b.name} ({b.cards})</option>)}
        </select>
        <select className="input sm:w-32" value={get('condition')} onChange={e => set('condition', e.target.value)}>
          <option value="">Any condition</option>
          {(['NM', 'LP', 'MP'] as Condition[]).map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>
        <select className="input sm:w-28" value={get('finish')} onChange={e => set('finish', e.target.value)}>
          <option value="">Any finish</option>
          {(['nonfoil', 'foil', 'etched'] as Finish[]).map(f => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
        </select>
        <select className="input sm:w-40" value={get('style')} onChange={e => set('style', e.target.value)}>
          {STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input sm:w-32" value={get('color')} onChange={e => set('color', e.target.value)}>
          <option value="">Any color</option>
          {[['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['M', 'Multicolor'], ['C', 'Colorless']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input sm:w-36" value={get('sort')} onChange={e => set('sort', e.target.value)}>
          <option value="name">Sort: name</option><option value="value">Sort: total value</option><option value="price">Sort: price</option>
          <option value="added">Sort: recently added</option><option value="set">Sort: newest set</option><option value="qty">Sort: quantity</option>
        </select>
        <button className="btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear</button>
        <button className="btn-ghost btn-sm sm:ml-auto" onClick={() => setNamingBinder('')}>+ Binder</button>
      </div>

      {selected.length > 0 && (
        <div className="card-panel mb-3 flex flex-wrap items-center gap-2 border-gold/40 bg-gold/5 p-3 text-sm">
          <span>{selected.length} selected</span>
          <select className="input w-full sm:w-48" defaultValue="" onChange={e => e.target.value && bulk.mutate({ ids: selected, action: 'move', binderId: Number(e.target.value) })}>
            <option value="">Move to binder…</option>
            {binders.data?.filter(b => b.kind !== 'deck').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn-ghost btn-sm" onClick={() => bulk.mutate({ ids: selected, action: 'misc' })}>Send to Miscellaneous</button>
          <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          <button className="btn-ghost btn-sm" onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}

      {isLoading ? <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>
        : !items.length ? <Empty title="No cards match">Add a card, or import a spreadsheet or decklist from the Import page.</Empty>
        : view === 'table' ? (
          <div className="card-panel overflow-hidden">
           <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-sm w-8"><input type="checkbox" checked={selected.length === items.length} onChange={e => setSelected(e.target.checked ? items.map((i: any) => i.id) : [])} /></th>
                  <th className="w-12"></th><th>Card</th><th className="col-md">Set</th><th className="col-xl">Treatment</th><th className="col-md">Finish</th><th>Cond.</th>
                  <th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right col-lg">Total</th><th className="col-lg">Binder</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="col-sm"><input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(s => e.target.checked ? [...s, i.id] : s.filter(x => x !== i.id))} /></td>
                    <td><CardThumb card={i.card} className="w-12 sm:w-16" /></td>
                    <td><Link className="hover:text-gold" to={`/card/${i.card.id}`}>{i.card.name}</Link></td>
                    <td className="col-md text-muted">{i.card.set.toUpperCase()} #{i.card.number}</td>
                    <td className="col-xl"><StyleBadges styles={i.card.styles} /></td>
                    <td className="col-md"><FinishBadge finish={i.finish} /></td>
                    <td><ConditionBadge condition={i.condition} /></td>
                    <td className="text-right tabular-nums">{i.qty}</td>
                    <td className="text-right"><PriceTag price={i.price} source={i.priceSource} fetchedAt={i.priceAt} /></td>
                    <td className="col-lg text-right tabular-nums text-gold">{money(i.total)}</td>
                    <td className="col-lg text-muted">{i.binderName}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(i)}>Edit</button>
                      <button className="btn-ghost btn-sm ml-1 hidden sm:inline-flex" onClick={() => del.mutate(i.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
           </div>
          </div>
        ) : (
          <div className="grid-cards">
            {items.map((i: any) => (
              <div key={i.id} className="card-panel overflow-hidden p-2">
                <Link to={`/card/${i.card.id}`}><img src={i.card.imageSmall} alt={i.card.name} loading="lazy" className="w-full rounded-lg" /></Link>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1"><FinishBadge finish={i.finish} /><ConditionBadge condition={i.condition} /></span>
                  <span className="text-muted">×{i.qty}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <PriceTag className="text-sm text-gold" price={i.price} source={i.priceSource} />
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(i)}>Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>← Prev</button>
          <span className="text-sm text-muted">Page {page} of {pages}</span>
          <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => set('page', String(page + 1))}>Next →</button>
        </div>
      )}

      <PrintingPicker open={adding} keepOpen onClose={() => setAdding(false)} title="Add a card to the collection"
        onPick={r => add.mutate({ scryfallId: r.card.id, finish: r.finish, condition: r.condition, qty: r.qty, binderId: Number(get('binder')) || 1 })} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.card.name}` : ''}
        footer={editing && <><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn-primary" onClick={() => patch.mutate({ id: editing.id, qty: editing.qty, finish: editing.finish, condition: editing.condition, binderId: editing.binderId, purchasePrice: editing.purchasePrice ?? null, notes: editing.notes ?? null })}>Save</button></>}>
        {editing && (
          <div className="grid gap-3">
            <div className="flex gap-3">
              <CardThumb card={editing.card} className="w-24" />
              <div className="text-sm">
                <div className="font-medium">{editing.card.name}</div>
                <div className="text-muted">{editing.card.setName} #{editing.card.number}</div>
                <StyleBadges styles={editing.card.styles} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1"><span className="label">Quantity</span><QtyInput value={editing.qty} onChange={n => setEditing({ ...editing, qty: n })} /></label>
              <label className="grid gap-1"><span className="label">Condition</span><ConditionSelect value={editing.condition} onChange={c => setEditing({ ...editing, condition: c })} /></label>
              <label className="grid gap-1"><span className="label">Finish</span>
                <select className="input" value={editing.finish} onChange={e => setEditing({ ...editing, finish: e.target.value })}>
                  {editing.card.finishes.map((f: Finish) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
                </select>
              </label>
              <label className="grid gap-1"><span className="label">Binder</span>
                <select className="input" value={editing.binderId} onChange={e => setEditing({ ...editing, binderId: Number(e.target.value) })}>
                  {binders.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1"><span className="label">Purchase price</span>
                <input className="input" value={editing.purchasePrice ?? ''} onChange={e => setEditing({ ...editing, purchasePrice: e.target.value === '' ? null : Number(e.target.value) })} placeholder="optional" />
              </label>
              <label className="grid gap-1"><span className="label">Notes</span>
                <input className="input" value={editing.notes ?? ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="optional" />
              </label>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={namingBinder !== null} onClose={() => setNamingBinder(null)} title="New binder"
        footer={<><button className="btn-ghost" onClick={() => setNamingBinder(null)}>Cancel</button>
          <button className="btn-primary" disabled={!namingBinder?.trim()} onClick={() => { newBinder.mutate(namingBinder!.trim()); setNamingBinder(null); }}>Create</button></>}>
        <label className="grid gap-1"><span className="label">Name</span>
          <input autoFocus className="input" value={namingBinder ?? ''} placeholder="e.g. Trade binder"
            onChange={e => setNamingBinder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && namingBinder?.trim()) { newBinder.mutate(namingBinder.trim()); setNamingBinder(null); } }} />
        </label>
      </Modal>

      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} danger confirmLabel="Delete"
        title="Delete selected cards?" body={`${selected.length} entries will be removed from the collection. This cannot be undone.`}
        onConfirm={() => bulk.mutate({ ids: selected, action: 'delete' })} />
    </div>
  );
}
