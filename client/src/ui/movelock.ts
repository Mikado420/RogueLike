import { btn } from './dom';

/**
 * 移動を伴うボタン（ダンジョン・塔・レイド・マッチング・転送）の二重押しを防ぐ。
 * 1 回押したら、エリアが変わる（移動が終わった）か、エラーの知らせが来る（失敗した）か、8 秒たつまで押せない。
 */
const HOLD_MS = 8000;
let until = 0;
let lockedIn = '';

export function moveLocked(area: string): boolean {
  if (area !== lockedIn) until = 0;
  return performance.now() < until;
}

/** 失敗の知らせが来たら呼ぶ（もう一度押せるように） */
export function unlockMove() {
  until = 0;
  document.querySelectorAll<HTMLButtonElement>('.move-btn').forEach((b) => { b.disabled = false; });
}

/** 移動を伴うボタン。押したら、同じ種類のボタンを全部押せなくする */
export function moveBtn(label: string, area: () => string, send: () => void, cls = 'btn'): HTMLButtonElement {
  const b = btn(label, () => {
    if (moveLocked(area())) return;
    until = performance.now() + HOLD_MS;
    lockedIn = area();
    document.querySelectorAll<HTMLButtonElement>('.move-btn').forEach((x) => { x.disabled = true; });
    send();
  }, `${cls} move-btn`);
  b.disabled = moveLocked(area());
  return b;
}
