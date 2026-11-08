import { SERVER_URL } from './net/api';

/**
 * 画面の更新中に起きたエラーを受け止める。
 * PixiJS の毎フレームの処理で例外が外に出ると、そのフレームから先が止まり「フリーズ」に見えるので、
 * ここで受け止めて記録し、短い知らせだけ出して遊び続けられるようにする。
 * 同じエラーはサーバーに1回だけ送る（Cloudflare のログで原因を追えるように）
 */
const sent = new Set<string>();
let lastToast = 0;
export let showError: ((msg: string) => void) | null = null;
export function setErrorToast(fn: (msg: string) => void) { showError = fn; }

export function reportError(where: string, e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error(`[${where}]`, err);
  const key = `${where}:${err.message}`;
  const now = performance.now();
  if (now - lastToast > 5000) { lastToast = now; showError?.(err.message); }
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  try {
    void fetch(`${SERVER_URL}/api/client-error`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ where, message: err.message.slice(0, 300), stack: (err.stack ?? '').slice(0, 1500), ua: navigator.userAgent.slice(0, 200) }),
    }).catch(() => {});
  } catch { /* noop */ }
}

/** fn を実行し、例外が出たら記録して外に出さない */
export function guard<T>(where: string, fn: () => T): T | undefined {
  try { return fn(); } catch (e) { reportError(where, e); return undefined; }
}
