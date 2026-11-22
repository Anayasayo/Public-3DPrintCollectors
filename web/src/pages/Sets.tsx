import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Empty, PageHeader, Spinner } from '../components/ui';

export function Sets() {
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['sets', all], queryFn: () => api.get<any[]>(`/sets${all ? '?all=1' : ''}`) });
  if (isLoading) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;
  const rows = (data ?? []).filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.code.includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader title="Set completion" sub={`${rows.length} sets`}
        actions={<>
          <input className="input w-full sm:w-56" placeholder="Filter sets…" value={q} onChange={e => setQ(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show every set</label>
        </>} />

      {!rows.length ? <Empty title="No sets to show">Add cards to your collection, or tick "Show every set".</Empty> : (
        <div className="card-panel overflow-hidden">
          <div className="table-wrap"><table className="data">
            <thead><tr><th className="w-8"></th><th>Set</th><th className="col-md">Code</th><th className="col-lg">Released</th><th className="w-40 sm:w-64">Completion</th><th className="text-right">Owned</th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.code}>
                  <td>{s.icon_svg_uri && <img src={s.icon_svg_uri} alt="" className="h-4 w-4 opacity-70 invert" />}</td>
                  <td><Link className="hover:text-gold" to={`/sets/${s.code}`}>{s.name}</Link></td>
                  <td className="col-md text-muted uppercase">{s.code}</td>
                  <td className="col-lg text-muted">{s.released_at ?? '—'}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                        <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, s.pct)}%` }} />
                      </div>
                      <span className="w-12 text-right text-xs text-muted tabular-nums">{s.pct}%</span>
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{s.owned} / {s.total}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
