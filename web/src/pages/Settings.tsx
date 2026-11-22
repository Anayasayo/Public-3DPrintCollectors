import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { Confirm, PageHeader, Spinner, Stat, useToast } from '../components/ui';

export function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<any>('/settings') });
  const catalog = useQuery({
    queryKey: ['catalog-status'],
    queryFn: () => api.get<any>('/catalog/status'),
    refetchInterval: q => ((q.state.data as any)?.running ? 1000 : false),
  });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<any[]>('/backups') });

  const save = useMutation({
    mutationFn: (b: any) => api.put('/settings', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast('Settings saved'); setKey(''); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const syncCatalog = useMutation({ mutationFn: () => api.post('/catalog/sync'), onSuccess: () => toast('Catalog update started', 'info') });
  const refreshPrices = useMutation({ mutationFn: () => api.post('/prices/refresh', { force: true }), onSuccess: () => toast('Price refresh started', 'info') });
  const backup = useMutation({ mutationFn: () => api.post<any>('/backups'), onSuccess: r => { backups.refetch(); toast(`Backup saved: ${r.file}`); } });
  const restore = useMutation({
    mutationFn: (file: string) => api.post('/backups/restore', { file }),
    onSuccess: () => { qc.invalidateQueries(); toast('Backup restored'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const restoreFromFile = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.post('/backups/upload', fd); },
    onSuccess: () => { qc.invalidateQueries(); toast('Backup restored'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading || !data) return <div className="flex justify-center p-20"><Spinner className="h-8 w-8" /></div>;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" sub="Everything is stored locally on this PC." />

      <div className="card-panel mb-4 p-4 sm:p-5">
        <div className="font-display text-lg font-semibold">TCGplayer pricing (JustTCG)</div>
        <p className="mt-1 text-sm text-muted">
          JustTCG supplies TCGplayer prices for Near Mint, Lightly Played and Moderately Played. Get a free key at{' '}
          <a className="text-accent hover:underline" href="https://justtcg.com" target="_blank" rel="noreferrer">justtcg.com</a> and paste it here.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid w-full flex-1 gap-1 sm:w-auto"><span className="label">API key {data.hasApiKey && <span className="text-good">· saved ({data.apiKeyPreview})</span>}</span>
            <input className="input" type="password" placeholder={data.hasApiKey ? 'Enter a new key to replace it' : 'tcg_xxxxxxxx'} value={key} onChange={e => setKey(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={!key.trim()} onClick={() => save.mutate({ justtcgKey: key.trim() })}>Save key</button>
          {data.hasApiKey && <button className="btn-ghost" onClick={() => save.mutate({ justtcgKey: '' })}>Remove</button>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <Stat label="Plan" value={data.plan ?? '—'} />
          <Stat label="Requests today" value={`${data.usageToday} / ${data.limits.daily}`} />
          <Stat label="Remaining (month)" value={data.requestsRemaining ?? '—'} />
          <Stat label="Last refresh" value={timeAgo(data.lastPriceRefresh)} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1"><span className="label">Daily request cap</span>
            <input className="input" defaultValue={data.limits.daily} onBlur={e => save.mutate({ dailyLimit: Number(e.target.value) })} />
          </label>
          <label className="grid gap-1"><span className="label">Requests per minute</span>
            <input className="input" defaultValue={data.limits.perMinute} onBlur={e => save.mutate({ perMinute: Number(e.target.value) })} />
          </label>
          <label className="grid gap-1"><span className="label">Cards per request</span>
            <input className="input" defaultValue={data.limits.batch} onBlur={e => save.mutate({ batchSize: Number(e.target.value) })} />
          </label>
          <label className="grid gap-1"><span className="label">Refresh when older than (h)</span>
            <input className="input" defaultValue={data.limits.staleHours} onBlur={e => save.mutate({ staleHours: Number(e.target.value) })} />
          </label>
        </div>
        <div className="mt-2 text-xs text-muted">
          Free plan: 100 requests/day, 10/minute, 20 cards each (≈2,000 card prices a day). Starter ($19/mo): 1,000/day and 100 cards each.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={() => refreshPrices.mutate()}>Refresh all prices now</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.marketFallback} onChange={e => save.mutate({ marketFallback: e.target.checked })} />
            Fall back to TCGplayer market price (from the card catalog) when a condition has no JustTCG price
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="grid gap-1"><span className="label">Default condition for imports</span>
            <select className="input w-full sm:w-56" value={data.defaultCondition} onChange={e => save.mutate({ defaultCondition: e.target.value })}>
              <option value="NM">Near Mint</option><option value="LP">Lightly Played</option><option value="MP">Moderately Played</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card-panel mb-4 p-4 sm:p-5">
        <div className="font-display text-lg font-semibold">Card catalog (Scryfall)</div>
        <p className="mt-1 text-sm text-muted">Every paper printing, including borderless, showcase, extended art, full art, retro frames, foils, etched foils and serialized cards. Updated weekly automatically.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="text-sm">
            <div className="font-display text-xl font-bold">{(catalog.data?.catalogSize ?? data.catalogSize).toLocaleString()}</div>
            <div className="text-xs text-muted">printings · updated {timeAgo(data.catalogSyncedAt)}</div>
          </div>
          <button className="btn-ghost" disabled={catalog.data?.running} onClick={() => syncCatalog.mutate()}>
            {catalog.data?.running ? <><Spinner /> {catalog.data.phase} {catalog.data.processed.toLocaleString()}</> : 'Update catalog now'}
          </button>
          {catalog.data?.error && <span className="text-sm text-bad">{catalog.data.error}</span>}
        </div>
      </div>

      <div className="card-panel p-4 sm:p-5">
        <div className="font-display text-lg font-semibold">Backups</div>
        <p className="mt-1 text-sm text-muted">A backup is taken every time the app starts. The 20 most recent are kept next to the database.</p>
        <div className="mt-2 text-xs text-muted">Database: <code>{data.dbPath}</code></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => backup.mutate()}>Back up now</button>
          {/* Moving to another computer: download here, then "Restore from a file" there. */}
          <a className="btn-ghost" href="/api/backups/download" download onClick={() => setTimeout(() => backups.refetch(), 1500)}>Download backup file</a>
          <label className={`btn-ghost cursor-pointer ${restoreFromFile.isPending ? 'pointer-events-none opacity-60' : ''}`}>
            {restoreFromFile.isPending ? <><Spinner /> Restoring…</> : 'Restore from a file…'}
            <input type="file" accept=".db" className="hidden" onChange={e => { setUploadFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          Moving to another computer? Press <b>Download backup file</b> here, copy that file over, and press <b>Restore from a file…</b> on the new one.
        </p>
        <div className="mt-3 grid gap-1 text-sm">
          {backups.data?.map(b => (
            <div key={b.file} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm">
              <span className="truncate font-mono text-xs">{b.file}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-muted">{b.size >= 1024 * 1024 ? `${(b.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b.size / 1024))} KB`}</span>
                <button className="btn-ghost btn-sm" onClick={() => setRestoring(b.file)}>Restore</button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <Confirm open={!!restoring} onClose={() => setRestoring(null)} danger confirmLabel="Restore"
        title="Restore this backup?" body="Your current collection, decks and prices will be replaced by the backup. A safety backup of the current data is taken first."
        onConfirm={() => restoring && restore.mutate(restoring)} />
      <Confirm open={!!uploadFile} onClose={() => setUploadFile(null)} danger confirmLabel="Restore"
        title={`Restore ${uploadFile?.name ?? 'this file'}?`}
        body="Your current collection, decks and prices will be replaced by the ones in this file. A safety backup of the current data is taken first."
        onConfirm={() => uploadFile && restoreFromFile.mutate(uploadFile)} />
    </div>
  );
}
