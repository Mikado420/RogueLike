/**
 * 認証の道具：ゲストの秘密トークン、引き継ぎコード、WebSocket に入るためのチケット（HMAC 署名）。
 * トークンは「アカウント id.秘密」。サーバーには秘密のハッシュだけを置く。
 */
const enc = new TextEncoder();

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};

export function randomId(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

/** 読み間違えにくい文字だけの引き継ぎコード */
export function randomCode(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => chars[b % chars.length]).join('');
}

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export function parseToken(token: string | null | undefined): { accountId: string; secret: string } | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const accountId = token.slice(0, i), secret = token.slice(i + 1);
  if (!/^a_[A-Za-z0-9_-]{8,40}$/.test(accountId) || secret.length < 16) return null;
  return { accountId, secret };
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

/** 時間の比較で漏れないように比べる */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** 署名つきチケット（中身は JSON） */
export async function signTicket(payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verifyTicket<T extends { exp: number }>(ticket: string | null, secret: string, now = Date.now()): Promise<T | null> {
  if (!ticket) return null;
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    return p.exp > now ? p : null;
  } catch { return null; }
}
