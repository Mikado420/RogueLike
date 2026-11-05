import type { Content } from '../content/types';
import type { Difficulty } from '../core';
import type { Player, World } from '../state';
import { addCounter } from './counters';
import { expToNext, gainExp } from './progression';

/**
 * 人と遊ぶための仕組み（エリア内の会話・エモート・パーティの分配・救援の報酬）。
 * チャンネルをまたぐもの（全体・パーティ・ギルド・個人のチャット、招待）はサーバーの ChatDO / PartyDO / GuildDO。
 */

/** 会話の文を整える（長さ・制御文字・NG ワードを伏せる） */
export function filterChat(text: string, c: Content): string {
  let t = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, c.social.chat.maxLen);
  for (const ng of c.social.chat.ngWords) {
    if (!ng) continue;
    const re = new RegExp(ng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    t = t.replace(re, '＊'.repeat(ng.length));
  }
  return t;
}

/** エリアの中で話す（近くの人に見える） */
export function say(w: World, p: Player, text: string): string | null {
  const t = filterChat(text, w.content);
  if (!t) return 'err.invalid';
  w.events.push({ type: 'say', id: p.id, name: p.char.name, text: t });
  return null;
}

export function emote(w: World, p: Player, id: string): string | null {
  if (!w.content.social.chat.emotes.some((e) => e.id === id)) return 'err.invalid';
  w.events.push({ type: 'emote', id: p.id, emote: id });
  return null;
}

/** 同じパーティで、近くにいて生きている人（自分を含む） */
export function partyNear(w: World, p: Player, range = w.content.social.party.shareRange): Player[] {
  if (!p.partyId) return [p];
  return w.players.filter((x) => x === p || (x.partyId === p.partyId && !x.dead && Math.hypot(x.x - p.x, x.y - p.y) <= range));
}

/** パーティの経験値の倍率（人数が多いほど合計は増え、1人ぶんは減る） */
export function partyExpShare(n: number, c: Content): number {
  if (n <= 1) return 1;
  return (1 + c.social.party.expBonusPerMember * (n - 1)) / n;
}

/** 救援を頼む（ボス戦・インスタンスの中だけ）。サーバーが一覧に出す */
export function requestRescue(w: World, p: Player): string | null {
  if (!w.area.instance || w.area.instance.cleared || w.area.instance.failed) return 'err.invalid';
  w.events.push({ type: 'request', playerId: p.id, what: 'rescue' });
  return null;
}

/** 自動マッチングに並ぶ（ダンジョンの入口で） */
export function requestMatch(w: World, p: Player, dungeon: string, difficulty: Difficulty, cancel: boolean): string | null {
  if (!w.content.dungeons.dungeons[dungeon] || !w.content.difficulties[difficulty]) return 'err.invalid';
  const gate = w.area.npcs.find((n) => n.npc === 'dungeon_gate' && n.data === dungeon && Math.hypot(n.x - p.x, n.y - p.y) <= w.content.balance.player.interactRange + 0.6);
  if (!gate && !cancel) return 'err.notNear';
  w.events.push({ type: 'request', playerId: p.id, what: cancel ? 'matchCancel' : 'match', dungeon, difficulty });
  return null;
}

/** 救援で来た人への報酬（クリアしたとき） */
export function rescueReward(w: World, p: Player) {
  if (!p.rescuer) return;
  const r = w.content.social.rescue.reward;
  const gold = Math.round(r.gold + r.goldPerLevel * (w.area.instance?.level ?? p.char.level));
  const exp = Math.round(expToNext(p.char.level, w.content) * r.expPct / 100);
  p.char.gold += gold;
  gainExp(w, p, exp);
  addCounter(w, p, 'rescues', 1);
  w.events.push({ type: 'rescued', playerId: p.id, gold, exp });
  w.events.push({ type: 'gold', playerId: p.id, amount: gold });
}
