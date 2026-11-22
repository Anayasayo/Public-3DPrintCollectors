import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { PageHeader, Spinner, StyleBadges } from '../components/ui';

export function SetDetail() {
  const { code = '' } = useParams();
  const [missingOnly, setMissingOnly] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['set', code], queryFn: () => api.get<any>(`/sets/${code}`) });
  if (isLoading || !data) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const cards = data.cards.filter((c: any) => !missingOnly || !c.owned);

  return (
    <div>
      <PageHeader title={data.set.name}
        sub={<>{data.owned} / {data.total} owned · missing cards would cost about <span className="text-gold">{money(data.missingCost)}</span></>}
        actions={<>
          <Link className="btn-ghost" to="/sets">← All sets</Link>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} /> Missing only</label>
        </>} />
      <div className="grid-cards">
        {cards.map((c: any) => (
          <Link key={c.card.id} to={`/card/${c.card.id}`} className={`card-panel overflow-hidden p-1.5 transition hover:border-slate-500 ${c.owned ? '' : 'opacity-45 grayscale'}`}>
            <img src={c.card.imageSmall} alt={c.card.name} loading="lazy" className="w-full rounded-lg" />
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-muted">#{c.card.number}</span>
              <span className={c.owned ? 'text-good' : 'text-muted'}>{c.owned ? `×${c.owned}` : money(c.price)}</span>
            </div>
            <StyleBadges styles={c.card.styles} className="mt-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
