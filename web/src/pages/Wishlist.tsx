import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { CardThumb, ConditionBadge, Empty, FinishBadge, PageHeader, PriceTag, Spinner, useToast } from '../components/ui';
import { PrintingPicker } from '../components/PrintingPicker';

export function Wishlist() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['wishlist'], queryFn: () => api.get<any>('/wishlist') });
  const binders = useQuery({ queryKey: ['binders'], queryFn: () => api.get<any[]>('/binders') });
  const done = (msg: string) => () => { qc.invalidateQueries({ queryKey: ['wishlist'] }); qc.invalidateQueries({ queryKey: ['summary'] }); toast(msg); };

  const add = useMutation({ mutationFn: (b: any) => api.post('/wishlist', b), onSuccess: done('Added to wishlist'), onError: (e: Error) => toast(e.message, 'err') });
  const patch = useMutation({ mutationFn: ({ id, ...b }: any) => api.patch(`/wishlist/${id}`, b), onSuccess: done('Saved') });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/wishlist/${id}`), onSuccess: done('Removed') });
  const acquire = useMutation({ mutationFn: (id: number) => api.post(`/wishlist/${id}/acquire`, { binderId: 1 }), onSuccess: done('Moved into your collection') });

  if (isLoading) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const items = data.items as any[];

  return (
    <div>
      <PageHeader title="Wishlist" sub={<>{items.length} cards · {money(data.total)} at current prices (not counted in your collection value)</>}
        actions={<button className="btn-primary" onClick={() => setAdding(true)}>+ Add card</button>} />

      {!items.length ? <Empty title="Wishlist is empty">Add cards you're hunting for and set a target price — the dashboard tells you when one drops to it.</Empty> : (
        <div className="card-panel overflow-hidden">
          <div className="table-wrap"><table className="data">
            <thead><tr><th className="w-12"></th><th>Card</th><th className="col-md">Set</th><th className="col-lg">Finish</th><th className="col-md">Cond.</th><th className="text-right col-lg">Qty</th><th className="text-right">Price</th><th className="w-32 text-right">Target</th><th></th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className={i.atOrBelowTarget ? 'bg-good/5' : ''}>
                  <td><CardThumb card={i.card} className="w-12 sm:w-14" /></td>
                  <td><Link className="hover:text-gold" to={`/card/${i.card.id}`}>{i.card.name}</Link></td>
                  <td className="col-md text-muted">{i.card.set.toUpperCase()} #{i.card.number}</td>
                  <td className="col-lg"><FinishBadge finish={i.finish} /></td>
                  <td className="col-md"><ConditionBadge condition={i.condition} /></td>
                  <td className="col-lg text-right tabular-nums">{i.qty}</td>
                  <td className="text-right"><PriceTag price={i.price} source={i.priceSource} className={i.atOrBelowTarget ? 'text-good' : ''} /></td>
                  <td className="text-right">
                    <input className="input w-24 text-right" defaultValue={i.targetPrice ?? ''} placeholder="—"
                      onBlur={e => patch.mutate({ id: i.id, targetPrice: e.target.value === '' ? null : Number(e.target.value) })} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-good btn-sm" title="I got it — move to collection" onClick={() => acquire.mutate(i.id)}>Got it</button>
                    <button className="btn-ghost btn-sm ml-1" onClick={() => del.mutate(i.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <PrintingPicker open={adding} keepOpen onClose={() => setAdding(false)} title="Add a card to the wishlist" submitLabel="Add to wishlist"
        onPick={r => add.mutate({ scryfallId: r.card.id, finish: r.finish, condition: r.condition, qty: r.qty })} />
      {!!items.length && <div className="mt-3 text-xs text-muted">"Got it" moves a card into Main Collection ({binders.data?.[0]?.cards ?? 0} cards).</div>}
    </div>
  );
}
