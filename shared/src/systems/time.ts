import type { Content } from '../content/types';
import type { World } from '../state';

/** ゲーム内の時刻（0〜24）。現実の時刻 clock（ミリ秒）から決まる（1日＝現実 dayLength 秒） */
export function gameHourAt(c: Content, clock: number): number {
  const t = c.time;
  const sec = clock / 1000;
  return (((sec % t.dayLength) / t.dayLength) * 24 + t.hourOffset) % 24;
}

export const gameHour = (w: World) => gameHourAt(w.content, w.clock);

export function isNightAt(c: Content, clock: number): boolean {
  const h = gameHourAt(c, clock);
  const n = c.time.night;
  return n.from > n.to ? h >= n.from || h < n.to : h >= n.from && h < n.to;
}

export const isNight = (w: World) => isNightAt(w.content, w.clock);

/** 朝・昼・夕・夜 */
export function dayPhaseAt(c: Content, clock: number): string {
  const h = gameHourAt(c, clock);
  for (const p of c.time.phases) {
    if ((h >= p.from && h < p.to) || (h + 24 >= p.from && h + 24 < p.to)) return p.id;
  }
  return 'day';
}

export const dayPhase = (w: World) => dayPhaseAt(w.content, w.clock);
