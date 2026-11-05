import type { GameEvent } from '../state';

/**
 * イベントを誰に送るか。playerId を持つものは本人だけ（-1 なら誰にも）、それ以外はエリアの全員。
 */
export function eventAudience(e: GameEvent): number | 'all' {
  return 'playerId' in e ? (e as { playerId: number }).playerId : 'all';
}

/** あるプレイヤーに届けるイベントだけを取り出す */
export function eventsFor(events: GameEvent[], playerId: number): GameEvent[] {
  return events.filter((e) => { const a = eventAudience(e); return a === 'all' || a === playerId; });
}

export const isPublicEvent = (e: GameEvent) => eventAudience(e) === 'all';
