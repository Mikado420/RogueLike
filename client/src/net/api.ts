import type { CharSummary } from '../../../shared/src';

/** 接続先（ビルド時の VITE_SERVER_URL。なければ手元の wrangler dev） */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8787';
export const WS_URL = SERVER_URL.replace(/^http/, 'ws');

const TOKEN_KEY = 'endless-garden.token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function req<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error');
  return data;
}

export interface Me { accountId: string; handle: string | null; name: string | null; characters: CharSummary[]; migrated: boolean; online: boolean }

export const api = {
  async guest() {
    const r = await req<{ token: string; accountId: string }>('POST', '/api/guest', undefined, false);
    setToken(r.token);
    return r;
  },
  me: () => req<Me>('GET', '/api/me'),
  createCharacter: (name: string, look: { body: number; hair: number }) => req<{ id: string }>('POST', '/api/characters', { name, look }),
  deleteCharacter: (id: string) => req<{ ok: true }>('DELETE', `/api/characters/${encodeURIComponent(id)}`),
  play: (charId: string) => req<{ ticket: string; key: string }>('POST', '/api/play', { charId }),
  profile: (handle: string, name: string) => req<{ ok: true }>('POST', '/api/profile', { handle, name }),
  issueTransfer: () => req<{ code: string; expiresAt: number }>('POST', '/api/transfer/issue'),
  async redeemTransfer(code: string) {
    const r = await req<{ token: string }>('POST', '/api/transfer/redeem', { code }, false);
    setToken(r.token);
    return r;
  },
  migrate: (account: unknown) => req<{ ok: true; removed: string[]; characters: number }>('POST', '/api/migrate', { account }),
  get: <T>(path: string) => req<T>('GET', path),
  post: <T>(path: string, body?: unknown) => req<T>('POST', path, body),
};
