import type { Player, World } from '../state';

/** 記録（実績・ミッション・図鑑の元になる数）が増えたときに呼ばれる処理 */
type CounterHook = (w: World, p: Player, key: string, total: number, added: number) => void;
const hooks: CounterHook[] = [];
export function onCounter(fn: CounterHook) { hooks.push(fn); }

export function addCounter(w: World, p: Player, key: string, n: number) {
  const c = p.char.counters;
  c[key] = (c[key] ?? 0) + n;
  for (const h of hooks) h(w, p, key, c[key], n);
}

/** 最大値の記録（塔の最高階・精錬の最高値など） */
export function setCounterMax(w: World, p: Player, key: string, value: number) {
  const c = p.char.counters;
  if ((c[key] ?? 0) >= value) return;
  const add = value - (c[key] ?? 0);
  c[key] = value;
  for (const h of hooks) h(w, p, key, value, add);
}
