export type Finish = 'nonfoil' | 'foil' | 'etched';
export type Condition = 'NM' | 'LP' | 'MP';
export type Board = 'commander' | 'main' | 'companion' | 'maybe';

export interface Card {
  id: string;
  oracleId: string | null;
  name: string;
  lang: string;
  set: string;
  setName: string;
  number: string;
  rarity: string;
  releasedAt: string;
  finishes: Finish[];
  styles: string[];
  typeLine: string;
  manaCost: string;
  cmc: number;
  power: string | null;
  toughness: string | null;
  colors: string[];
  colorIdentity: string[];
  oracleText: string;
  keywords: string[];
  commanderLegality: string | null;
  gameChanger: boolean;
  tcgplayerId: number | null;
  tcgplayerEtchedId: number | null;
  image: string | null;
  imageSmall: string | null;
  imageBack: string | null;
}

export type PriceMap = Record<string, { price: number; source: string; fetchedAt: string }>;

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${url}`, init);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new ApiError(json?.error ?? `Request failed (${res.status})`, res.status);
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
