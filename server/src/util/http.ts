/** JSON の応答・エラー・CORS */
export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code }, e.status);
  console.error('internal error', e);
  return json({ error: 'internal' }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'badJson'); }
}

export function corsHeaders(origin: string | null, allowed: string | undefined): Record<string, string> {
  const list = (allowed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && (list.includes(origin) || list.includes('*') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return ok ? {
    'access-control-allow-origin': origin!,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  } : {};
}

/** Durable Object の中の窓口を呼ぶ（POST /op に JSON） */
export async function call<T = unknown>(stub: { fetch(req: Request): Promise<Response> }, op: string, body: unknown = {}): Promise<T> {
  const res = await stub.fetch(new Request(`https://do/${op}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new HttpError(res.status, data.error ?? 'error');
  return data;
}

/** Durable Object の fetch で op ごとに振り分ける */
export async function dispatch(req: Request, handlers: Record<string, (body: any) => Promise<unknown> | unknown>): Promise<Response> {
  try {
    const op = new URL(req.url).pathname.slice(1);
    const h = handlers[op];
    if (!h) throw new HttpError(404, 'noOp');
    const body = req.method === 'POST' ? await readJson<unknown>(req) : {};
    return json((await h(body)) ?? { ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
