import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { ColorPips, Empty, Modal, PageHeader, Spinner, useToast } from '../components/ui';

export function Decks() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [bracket, setBracket] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['decks'], queryFn: () => api.get<any[]>('/decks') });
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/decks', { name: name || 'New Commander Deck', targetBracket: bracket ? Number(bracket) : null }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['decks'] }); setCreating(false); setName(''); nav(`/decks/${r.id}`); },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;

  return (
    <div>
      <PageHeader title="Commander decks" sub={`${data?.length ?? 0} decks`}
        actions={<>
          <Link className="btn-ghost" to="/import">Import a decklist</Link>
          <button className="btn-primary" onClick={() => setCreating(true)}>+ New deck</button>
        </>} />

      {!data?.length ? <Empty title="No decks yet">Create a deck and add 100 cards, or import a decklist (.txt, .csv or Excel) from the Import page.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {data.map(d => (
            <Link key={d.id} to={`/decks/${d.id}`} className="card-panel group relative overflow-hidden transition hover:border-slate-500">
              <div className="flex gap-3 p-3">
                {d.commanders[0]?.image
                  ? <img src={d.commanders[0].image} alt="" className="h-40 w-[7rem] shrink-0 rounded-lg object-cover object-top sm:h-44 sm:w-[7.6rem]" />
                  : <div className="flex h-40 w-[7rem] shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-2xl text-muted sm:h-44 sm:w-[7.6rem]">⚔</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate font-display text-lg font-semibold">{d.name}</div>
                    <ColorPips colors={d.colorIdentity} />
                  </div>
                  <div className="truncate text-sm text-muted">{d.commanders.map((c: any) => c.name).join(' + ') || 'No commander yet'}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`chip ${d.count === 100 ? 'bg-good/15 text-good' : 'bg-amber-500/15 text-amber-300'}`}>{d.count} / 100</span>
                    <span className={`chip ${d.legal ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>{d.legal ? 'Legal' : 'Not legal'}</span>
                    {d.status === 'in_collection'
                      ? <span className="chip bg-accent/15 text-accent">In collection</span>
                      : <span className="chip bg-slate-500/15 text-slate-300">Draft</span>}
                    {!!d.pendingChanges && <span className="chip bg-gold/20 text-gold">{d.pendingChanges} unsynced</span>}
                    {d.targetBracket && <span className="chip bg-panel2 text-muted">Bracket {d.targetBracket}</span>}
                  </div>
                  <div className="mt-2 font-display text-lg text-gold tabular-nums">{money(d.value)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New Commander deck"
        footer={<><button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn-primary" onClick={() => create.mutate()}>Create</button></>}>
        <div className="grid gap-3">
          <label className="grid gap-1"><span className="label">Deck name</span>
            <input autoFocus className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Krenko Goblins" onKeyDown={e => e.key === 'Enter' && create.mutate()} />
          </label>
          <label className="grid gap-1"><span className="label">Target bracket (optional)</span>
            <select className="input" value={bracket} onChange={e => setBracket(e.target.value)}>
              <option value="">No target</option>
              <option value="1">1 — Exhibition (no Game Changers)</option>
              <option value="2">2 — Core (no Game Changers)</option>
              <option value="3">3 — Upgraded (up to 3 Game Changers)</option>
              <option value="4">4 — Optimized (any)</option>
              <option value="5">5 — cEDH (any)</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  );
}
