import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, timeAgo } from '../lib/format';
import { CardThumb, ConditionBadge, Confirm, Empty, FinishBadge, PageHeader, PriceTag, Spinner, useToast } from '../components/ui';

export function Misc() {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<number[]>([]);
  const [binderId, setBinderId] = useState<number>(1);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['misc'], queryFn: () => api.get<any>('/misc') });
  const binders = useQuery({ queryKey: ['binders'], queryFn: () => api.get<any[]>('/binders') });
  const done = (msg: string) => () => {
    qc.invalidateQueries({ queryKey: ['misc'] });
    qc.invalidateQueries({ queryKey: ['summary'] });
    qc.invalidateQueries({ queryKey: ['collection'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setSelected([]);
    toast(msg);
  };
  const toCollection = useMutation({ mutationFn: (ids: number[]) => api.post('/misc/to-collection', { ids, binderId }), onSuccess: done('Filed into the collection'), onError: (e: Error) => toast(e.message, 'err') });
  const remove = useMutation({ mutationFn: (ids: number[]) => api.post('/misc/remove', { ids }), onSuccess: done('Removed') });

  if (isLoading) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const items = data.items as any[];

  return (
    <div>
      <PageHeader title="Miscellaneous"
        sub={<>Cards taken out of decks or imports land here. They do <b>not</b> count toward your collection value until you file them. {items.length} entries · {money(data.total)} if added.</>}
        actions={items.length > 0 && <>
          <select className="input w-full sm:w-48" value={binderId} onChange={e => setBinderId(Number(e.target.value))}>
            {binders.data?.filter(b => b.kind !== 'deck').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn-good" disabled={!selected.length} onClick={() => toCollection.mutate(selected)}>Add {selected.length || ''} to collection</button>
          <button className="btn-danger" disabled={!selected.length} onClick={() => setConfirmRemove(true)}>Remove {selected.length || ''}</button>
          <button className="btn-ghost" onClick={() => setSelected(selected.length === items.length ? [] : items.map(i => i.id))}>
            {selected.length === items.length ? 'Clear' : 'Select all'}
          </button>
        </>} />

      {!items.length ? <Empty title="Nothing in Miscellaneous">When you remove a card from a deck that's in your collection, it shows up here so you can file it or get rid of it.</Empty> : (
        <div className="card-panel overflow-hidden">
          <div className="table-wrap"><table className="data">
            <thead><tr><th className="col-sm w-8"></th><th className="w-12"></th><th>Card</th><th className="col-md">Set</th><th className="col-lg">Finish</th><th>Cond.</th><th className="text-right">Qty</th><th className="text-right col-md">Value</th><th className="col-lg">From</th><th className="col-xl">When</th><th></th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td className="col-sm"><input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(s => e.target.checked ? [...s, i.id] : s.filter(x => x !== i.id))} /></td>
                  <td><CardThumb card={i.card} className="w-12 sm:w-14" /></td>
                  <td><Link className="hover:text-gold" to={`/card/${i.card.id}`}>{i.card.name}</Link></td>
                  <td className="col-md text-muted">{i.card.set.toUpperCase()} #{i.card.number}</td>
                  <td className="col-lg"><FinishBadge finish={i.finish} /></td>
                  <td><ConditionBadge condition={i.condition} /></td>
                  <td className="text-right tabular-nums">{i.qty}</td>
                  <td className="col-md text-right"><PriceTag price={i.price != null ? i.price * i.qty : null} source={i.priceSource} /></td>
                  <td className="col-lg text-muted">{i.fromDeckName ? <>⚔ {i.fromDeckName}</> : i.reason}</td>
                  <td className="col-xl text-muted">{timeAgo(i.createdAt)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-good btn-sm" onClick={() => toCollection.mutate([i.id])}>Add</button>
                    <button className="btn-ghost btn-sm ml-1" onClick={() => remove.mutate([i.id])}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <Confirm open={confirmRemove} onClose={() => setConfirmRemove(false)} danger confirmLabel="Remove"
        title="Remove these cards?" body={`${selected.length} entries will be deleted from Miscellaneous. They are not added to your collection.`}
        onConfirm={() => remove.mutate(selected)} />
    </div>
  );
}
