import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs, type Board, type Card, type Condition, type Finish, type PriceMap } from '../lib/api';
import { CONDITIONS, CONDITION_LABEL, FINISH_LABEL, money, priceKey } from '../lib/format';
import { Modal, PriceTag, QtyInput, StyleBadges, Spinner } from './ui';

export interface PickResult {
  card: Card;
  finish: Finish;
  condition: Condition;
  qty: number;
  board?: Board;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (r: PickResult) => void;
  title?: string;
  /** Start straight on the printings of this card name. */
  initialName?: string;
  /** Show a commander/main/maybe selector (deck mode). */
  boards?: boolean;
  submitLabel?: string;
  /** Stay open after each pick and go back to a fresh search, for adding many cards in a row. */
  keepOpen?: boolean;
}

export function useCardSearch(term: string) {
  return useQuery({
    queryKey: ['card-search', term],
    queryFn: () => api.get<{ name: string; id: string; image: string | null; count: number }[]>(`/cards/search${qs({ q: term })}`),
    enabled: term.trim().length >= 2,
    staleTime: 60_000,
  });
}

/**
 * Narrow a card's printings by set code, set name and/or collector number ("ltr", "lord of the rings", "272", "ltr 272").
 * Every word must match something; exact collector numbers rank above partial ones, otherwise newest-first order is kept.
 */
export function filterPrintings(cards: Card[], query: string): Card[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return cards;
  const scoreWord = (c: Card, w: string) => {
    const num = c.number.toLowerCase();
    const set = c.set.toLowerCase();
    // 27a / 27★ still count as an exact hit for "27".
    if (num === w || (/^\d+$/.test(w) && num.replace(/\D/g, '') === w)) return 4;
    if (set === w) return 3;
    if (set.startsWith(w)) return 2;
    if (num.includes(w) || c.setName.toLowerCase().includes(w)) return 1;
    return 0;
  };
  return cards
    .map((c, i) => {
      let score = 0;
      for (const w of words) {
        const s = scoreWord(c, w);
        if (!s) return null;
        score += s;
      }
      return { c, i, score };
    })
    .filter((r): r is { c: Card; i: number; score: number } => r != null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(r => r.c);
}

export function PrintingPicker({ open, onClose, onPick, title = 'Add a card', initialName, boards, submitLabel = 'Add', keepOpen }: Props) {
  const [term, setTerm] = useState(initialName ?? '');
  const [name, setName] = useState<string | null>(initialName ?? null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [condition, setCondition] = useState<Condition>('NM');
  const [qty, setQty] = useState(1);
  const [board, setBoard] = useState<Board>('main');
  const [onlyStyled, setOnlyStyled] = useState(false);
  const [within, setWithin] = useState('');
  const [added, setAdded] = useState<{ key: number; label: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setTerm(initialName ?? '');
    setName(initialName ?? null);
    setSelected(null);
    setWithin('');
    setAdded([]);
    setQty(1);
    setCondition('NM');
    setBoard('main');
  }, [open, initialName]);

  const search = useCardSearch(name ? '' : term);
  const printings = useQuery({
    queryKey: ['printings', name],
    queryFn: () => api.get<{ printings: Card[]; prices: PriceMap }>(`/cards/printings${qs({ name })}`),
    enabled: !!name && open,
  });

  useEffect(() => {
    const list = printings.data?.printings;
    if (list?.length && !selected) {
      const best = list.find(c => !c.styles.length && c.finishes.includes('nonfoil')) ?? list[0];
      setSelected(best);
      setFinish(best.finishes.includes('nonfoil') ? 'nonfoil' : best.finishes[0]);
    }
  }, [printings.data, selected]);

  const list = useMemo(() => {
    const all = printings.data?.printings ?? [];
    return filterPrintings(onlyStyled ? all.filter(c => c.styles.length) : all, within);
  }, [printings.data, onlyStyled, within]);
  const total = printings.data?.printings.length ?? 0;

  const submit = () => {
    if (!selected) return;
    onPick({ card: selected, finish, condition, qty, board });
    if (!keepOpen) return onClose();
    const label = `${qty}× ${selected.name} (${selected.set.toUpperCase()} #${selected.number}${finish === 'nonfoil' ? '' : `, ${FINISH_LABEL[finish]}`}${condition === 'NM' ? '' : `, ${condition}`})`;
    setAdded(a => [...a, { key: Date.now(), label }]);
    // Fresh search for the next card; the deck board is kept since cards usually go to the same one.
    setTerm('');
    setName(null);
    setSelected(null);
    setWithin('');
    setFinish('nonfoil');
    setCondition('NM');
    setQty(1);
  };

  const choose = (c: Card) => { setSelected(c); setFinish(c.finishes.includes('nonfoil') ? 'nonfoil' : c.finishes[0]); };

  const prices = printings.data?.prices ?? {};
  const price = selected ? prices[priceKey(selected.id, finish, condition)] : undefined;

  return (
    <Modal open={open} onClose={onClose} title={title} wide="xl"
      footer={selected ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted">
            {selected.name} · {selected.set.toUpperCase()} #{selected.number} · {FINISH_LABEL[finish]} · {condition}
            {price && <> · <span className="text-slate-200">{money(price.price)} each</span></>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {boards && (
              <select className="input w-full sm:w-40" value={board} onChange={e => setBoard(e.target.value as Board)}>
                <option value="commander">Commander</option>
                <option value="main">Deck</option>
                <option value="companion">Companion</option>
                <option value="maybe">Maybeboard</option>
              </select>
            )}
            {/* Finish is a visible toggle, not a hidden dropdown — only the finishes this printing comes in. */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-panel2 p-0.5" role="group" aria-label="Finish">
              {selected.finishes.map(f => (
                <button key={f} type="button" onClick={() => setFinish(f)}
                  className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    finish === f ? 'bg-gold text-ink' : 'text-muted hover:text-slate-200'}`}>
                  {FINISH_LABEL[f]}
                </button>
              ))}
            </div>
            <select className="input w-[48%] sm:w-44" value={condition} onChange={e => setCondition(e.target.value as Condition)} aria-label="Condition">
              {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
            <QtyInput value={qty} onChange={setQty} />
            <button className="btn-primary" onClick={submit}>{submitLabel}</button>
          </div>
        </div>
      ) : null}>

      {added.length > 0 && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <span className="font-medium text-gold">✓ Added {added.length} card{added.length === 1 ? '' : 's'}:</span>{' '}
            <span className="text-muted">{added.map(a => a.label).join(' · ')}</span>
          </div>
          <button className="btn-ghost btn-sm shrink-0" onClick={onClose}>Done</button>
        </div>
      )}

      {!name ? (
        <div>
          <input autoFocus className="input text-base" placeholder="Search a card by name…" value={term} onChange={e => setTerm(e.target.value)} />
          <div className="mt-3 grid gap-1">
            {search.isFetching && <div className="flex items-center gap-2 p-2 text-sm text-muted"><Spinner /> Searching…</div>}
            {search.data?.map(r => (
              <button key={r.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-panel2" onClick={() => { setName(r.name); setSelected(null); setWithin(''); }}>
                {r.image && <img src={r.image} alt="" className="h-[4.5rem] w-[3.2rem] max-w-none shrink-0 rounded object-cover object-top" loading="lazy" />}
                <span className="flex-1">{r.name}</span>
                <span className="text-xs text-muted">{r.count} printing{r.count === 1 ? '' : 's'}</span>
              </button>
            ))}
            {!search.isFetching && term.length >= 2 && !search.data?.length && <div className="p-2 text-sm text-muted">No cards found.</div>}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button className="btn-ghost btn-sm" onClick={() => { setName(null); setSelected(null); }}>← Search again</button>
            <div className="font-display text-lg">{name}</div>
            <div className="text-sm text-muted">
              {list.length === total ? `${total} printing${total === 1 ? '' : 's'}` : `${list.length} of ${total} printings`}
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={onlyStyled} onChange={e => setOnlyStyled(e.target.checked)} /> Special treatments only
            </label>
          </div>
          <input autoFocus className="input mb-3 text-base" value={within} onChange={e => setWithin(e.target.value)}
            placeholder={`Search within ${name} by set or number — e.g. "ltr", "Lord of the Rings", "272", "ltr 272"`}
            onKeyDown={e => { if (e.key === 'Enter' && list[0]) choose(list[0]); }} />
          {printings.isLoading ? <div className="flex justify-center p-8"><Spinner /></div> : (
            <div className="grid-cards-lg">
              {list.map(c => {
                const nm = prices[priceKey(c.id, c.finishes.includes('nonfoil') ? 'nonfoil' : c.finishes[0], 'NM')];
                return (
                  <button key={c.id} onClick={() => choose(c)}
                    className={`group rounded-xl border p-2 text-left transition ${selected?.id === c.id ? 'border-gold bg-gold/10' : 'border-line bg-panel2 hover:border-slate-500'}`}>
                    <img src={c.imageSmall ?? ''} alt={c.name} loading="lazy" className="mb-2 w-full rounded-lg bg-panel object-cover" />
                    <div className="text-xs font-medium">{c.set.toUpperCase()} #{c.number}</div>
                    <div className="truncate text-[11px] text-muted" title={c.setName}>{c.setName}</div>
                    <StyleBadges styles={c.styles} className="mt-1" />
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span>{c.finishes.map(f => FINISH_LABEL[f]).join(' · ')}</span>
                      <PriceTag price={nm?.price} source={nm?.source} />
                    </div>
                  </button>
                );
              })}
              {!list.length && <div className="col-span-full p-2 text-sm text-muted">No printings match "{within}".</div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
