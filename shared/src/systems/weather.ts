import type { Element } from '../core';
import type { Content, WeatherDef } from '../content/types';
import type { World } from '../state';
import { hash32, Rng } from '../rng';
import { isNightAt } from './time';

/**
 * 天候。エリアごとに一定時間（slotMinutes）で抽選する。
 * 時刻とエリアとシードだけで決まるので、予報も出せるし、全員に同じ天気になる。
 */

export const slotMs = (c: Content) => c.weather.slotMinutes * 60000;
export const weatherSlotAt = (c: Content, clock: number) => Math.floor(clock / slotMs(c));

export function weatherAt(c: Content, areaId: string, slot: number): string {
  const table = c.areas[areaId]?.weather;
  if (!table) return 'clear';
  const night = isNightAt(c, slot * slotMs(c) + slotMs(c) / 2);
  const weights: Record<string, number> = {};
  for (const [id, w] of Object.entries(table)) {
    const d = c.weather.types[id];
    if (!d || (d.nightOnly && !night)) continue;
    weights[id] = w;
  }
  const rng = new Rng(hash32(c.weather.seed, areaId, slot));
  return Object.keys(weights).length ? rng.weighted(weights) : 'clear';
}

export function currentWeather(w: World, areaId = w.area.id): string {
  return weatherAt(w.content, areaId, weatherSlotAt(w.content, w.clock));
}

export function weatherDef(w: World): WeatherDef {
  return w.content.weather.types[currentWeather(w)] ?? { name: '' };
}

/** 天候と夜による属性の倍率 */
export function envElementMul(w: World, el: Element): number {
  let pct = weatherDef(w).elements?.[el] ?? 0;
  if (isNightAt(w.content, w.clock) && w.area.type !== 'dungeon' && w.area.type !== 'tower') {
    const n = w.content.time.night;
    if (el === 'dark') pct += n.darkDmgPct;
    if (el === 'light') pct += n.lightDmgPct;
  }
  return 1 + pct / 100;
}

/** 予報：今の区切りから n 個ぶん */
export function forecast(c: Content, areaId: string, clock: number, n: number): { slot: number; start: number; weather: string }[] {
  const s0 = weatherSlotAt(c, clock);
  return Array.from({ length: n }, (_, i) => ({ slot: s0 + i, start: (s0 + i) * slotMs(c), weather: weatherAt(c, areaId, s0 + i) }));
}
