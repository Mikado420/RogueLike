import type { World } from '../state';

/** ゲーム内の時刻（0〜24）。現実の時刻 clock（ミリ秒）から決まる */
export function gameHour(w: World): number {
  const t = w.content.time;
  const sec = w.clock / 1000;
  return (((sec % t.dayLength) / t.dayLength) * 24 + t.hourOffset) % 24;
}

export function isNight(w: World): boolean {
  const h = gameHour(w);
  const n = w.content.time.night;
  return n.from > n.to ? h >= n.from || h < n.to : h >= n.from && h < n.to;
}

/** 朝・昼・夕・夜 */
export function dayPhase(w: World): string {
  const h = gameHour(w);
  for (const p of w.content.time.phases) {
    if ((h >= p.from && h < p.to) || (h + 24 >= p.from && h + 24 < p.to)) return p.id;
  }
  return 'day';
}
