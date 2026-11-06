import { txt } from '../../shared/src';

/** ビルドごとの版（vite.config.ts で埋め込む。開発中は 'dev'） */
declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const CHECK_EVERY_MS = 10 * 60 * 1000;
let inGame = false;
let pending: string | null = null;
let banner: HTMLDivElement | null = null;

/** ゲームの最中かどうか（最中は勝手に読み込み直さない） */
export function setInGame(v: boolean) {
  inGame = v;
  if (!v && pending) reloadTo(pending);
}

/**
 * ホーム画面に追加したアプリは、閉じても裏で生き続けて読み込み直されない。
 * そこで、起動時・画面に戻ったとき・10 分ごとに version.json を見て、新しい版なら読み込み直す。
 */
export function watchForUpdates() {
  if (BUILD_ID === 'dev') return;
  void check(false);
  document.addEventListener('visibilitychange', () => {
    // 裏から戻ってきたときは遊んでいる最中ではないので、新しい版ならすぐ更新する
    if (document.visibilityState === 'visible') void check(true);
  });
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) void check(true); });
  setInterval(() => void check(false), CHECK_EVERY_MS);
}

async function check(resumed: boolean) {
  let id: string | undefined;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    id = ((await res.json()) as { id?: string }).id;
  } catch { return; }
  if (!id || id === BUILD_ID) return;
  pending = id;
  if (!inGame || resumed) reloadTo(id);
  else showBanner(id);
}

function reloadTo(id: string) {
  // 同じ版へは 1 回だけ（キャッシュで古いままだったときに読み込みをくり返さない）
  const key = `eg-update-${id}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* 使えなくても続ける */ }
  // URL を変えて、キャッシュされた古い index.html を避ける
  const url = new URL(location.href);
  url.searchParams.set('v', id);
  location.replace(url.toString());
}

function showBanner(id: string) {
  if (banner) return;
  banner = document.createElement('div');
  banner.className = 'update-banner';
  const text = document.createElement('span');
  text.textContent = txt('update.available');
  const b = document.createElement('button');
  b.textContent = txt('update.now');
  b.addEventListener('click', () => reloadTo(id));
  banner.append(text, b);
  document.body.append(banner);
}
