import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Card, Condition, Finish } from '../lib/api';
import { CONDITIONS, CONDITION_LABEL, FINISH_LABEL, SOURCE_LABEL, money, timeAgo } from '../lib/format';

// ---------- Toasts ----------
type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, kind, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`rounded-lg border px-4 py-2.5 text-sm shadow-xl backdrop-blur ${
            t.kind === 'err' ? 'border-bad/40 bg-bad/15 text-red-100' : t.kind === 'info' ? 'border-accent/40 bg-panel2 text-slate-100' : 'border-good/40 bg-good/15 text-emerald-100'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, wide, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean | 'xl'; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const width = wide === 'xl' ? 'sm:max-w-6xl' : wide ? 'sm:max-w-4xl' : 'sm:max-w-lg';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-black/70 sm:items-start sm:p-4 sm:pt-[6vh]"
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      {/* Full-screen sheet on phones, centred dialog from sm up. */}
      <div className={`card-panel flex w-full flex-col rounded-none border-x-0 shadow-2xl sm:h-auto sm:rounded-xl sm:border-x ${width}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="min-w-0 truncate font-display text-base font-semibold sm:text-lg">{title}</h2>
          <button className="btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:max-h-[72vh] sm:p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card-panel flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="font-display text-lg">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="card-panel px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold break-words sm:text-2xl ${accent ? 'text-gold' : ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

// ---------- Card bits ----------
const STYLE_COLORS: Record<string, string> = {
  Borderless: 'bg-fuchsia-500/15 text-fuchsia-300', Showcase: 'bg-sky-500/15 text-sky-300', 'Extended Art': 'bg-indigo-500/15 text-indigo-300',
  'Full Art': 'bg-teal-500/15 text-teal-300', 'Retro Frame': 'bg-amber-600/20 text-amber-300', Serialized: 'bg-yellow-400/20 text-yellow-200',
  'Surge Foil': 'bg-rose-500/15 text-rose-300', 'Galaxy Foil': 'bg-violet-500/15 text-violet-300', 'Textured Foil': 'bg-orange-500/15 text-orange-300',
};

export function StyleBadges({ styles, className = '' }: { styles: string[]; className?: string }) {
  if (!styles.length) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {styles.map(s => <span key={s} className={`chip ${STYLE_COLORS[s] ?? 'bg-slate-500/15 text-slate-300'}`}>{s}</span>)}
    </span>
  );
}

export function FinishBadge({ finish }: { finish: Finish }) {
  if (finish === 'nonfoil') return <span className="chip bg-slate-600/25 text-slate-300">Normal</span>;
  return (
    <span className={`chip ${finish === 'foil' ? 'text-ink' : 'text-ink'}`}
      style={{ background: finish === 'foil' ? 'linear-gradient(110deg,#ffd982,#9be7ff,#e7a6ff,#ffd982)' : 'linear-gradient(110deg,#c9ced8,#f5f7fa,#aeb6c4)' }}>
      {FINISH_LABEL[finish]}
    </span>
  );
}

export function ConditionBadge({ condition }: { condition: Condition }) {
  const c = condition === 'NM' ? 'bg-good/15 text-good' : condition === 'LP' ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300';
  return <span className={`chip ${c}`} title={CONDITION_LABEL[condition]}>{condition}</span>;
}

export function PriceTag({ price, source, fetchedAt, className = '' }: { price: number | null | undefined; source?: string | null; fetchedAt?: string | null; className?: string }) {
  const dot = source === 'tcg_last5' ? 'bg-gold' : source === 'justtcg' ? 'bg-good' : source === 'scryfall_market' ? 'bg-slate-400' : 'bg-transparent';
  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${className}`} title={source ? `${SOURCE_LABEL[source] ?? source}${fetchedAt ? ` · updated ${timeAgo(fetchedAt)}` : ''}` : 'No price yet'}>
      {price != null && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {money(price)}
    </span>
  );
}

export function ManaCost({ cost, size = 16 }: { cost: string; size?: number }) {
  if (!cost) return null;
  const syms = [...cost.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
  return (
    <span className="inline-flex items-center gap-0.5">
      {syms.map((s, i) => s === '//' ? <span key={i} className="mx-1 text-muted">//</span> :
        <img key={i} src={`https://svgs.scryfall.io/card-symbols/${s.replace(/\//g, '')}.svg`} alt={`{${s}}`} width={size} height={size} loading="lazy" />)}
    </span>
  );
}

export function ColorPips({ colors, size = 14 }: { colors: string[]; size?: number }) {
  const list = colors.length ? colors : ['C'];
  return (
    <span className="inline-flex gap-0.5">
      {list.map(c => <img key={c} src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={c} width={size} height={size} />)}
    </span>
  );
}

/** Card image with a large hover preview (preview is skipped on touch screens). */
export function CardThumb({ card, className = 'w-14 sm:w-16', onClick }: { card: Pick<Card, 'name' | 'image' | 'imageSmall'>; className?: string; onClick?: () => void }) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
  const previewWidth = Math.min(440, Math.max(260, Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.3)));
  return (
    <>
      <img
        src={card.imageSmall ?? card.image ?? ''}
        alt={card.name}
        loading="lazy"
        className={`${className} aspect-[488/680] max-w-none shrink-0 rounded-[5%] bg-panel2 object-cover ${onClick ? 'cursor-pointer' : ''}`}
        onMouseMove={e => finePointer && setHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      />
      {hover && card.image && createPortal(
        <img src={card.image} alt="" className="pointer-events-none fixed z-[90] rounded-[4.5%] shadow-2xl"
          style={{
            width: previewWidth,
            left: Math.min(hover.x + 24, window.innerWidth - previewWidth - 12),
            top: Math.max(8, Math.min(hover.y - previewWidth * 0.7, window.innerHeight - previewWidth * 1.4 - 8)),
          }} />,
        document.body,
      )}
    </>
  );
}

export function ConditionSelect({ value, onChange, className = 'input' }: { value: Condition; onChange: (c: Condition) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={e => onChange(e.target.value as Condition)}>
      {CONDITIONS.map(c => <option key={c} value={c}>{c} — {CONDITION_LABEL[c]}</option>)}
    </select>
  );
}

export function FinishSelect({ value, finishes, onChange, className = 'input' }: { value: Finish; finishes: Finish[]; onChange: (f: Finish) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={e => onChange(e.target.value as Finish)}>
      {finishes.map(f => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
    </select>
  );
}

export function QtyInput({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-panel2">
      <button type="button" className="px-2.5 py-1 text-muted hover:text-white" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input className="w-12 bg-transparent text-center text-sm outline-none" value={value} onChange={e => onChange(Math.max(min, parseInt(e.target.value, 10) || min))} />
      <button type="button" className="px-2.5 py-1 text-muted hover:text-white" onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></>}>
      <div className="text-sm text-slate-300">{body}</div>
    </Modal>
  );
}
