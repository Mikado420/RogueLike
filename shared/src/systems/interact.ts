import type { Player, World } from '../state';
import { leaveInstance, nextTowerFloor } from './instance';

/** 近くの NPC（あとで採集ポイント・入口も）に話しかける */
export function interact(w: World, p: Player) {
  const t = interactTarget(w, p);
  if (!t) return;
  if (t.kind !== 'npc') return;
  const role = w.content.npcs[t.npc]?.role;
  if (role === 'leave') { leaveInstance(w, p); return; }
  if (role === 'stairs') { nextTowerFloor(w, p); return; }
  w.events.push({ type: 'npc', playerId: p.id, npc: t.npc, npcId: t.id });
}

export type InteractTarget = { kind: 'npc'; id: number; npc: string; x: number; y: number };

export function interactTarget(w: World, p: Player): InteractTarget | null {
  const range = w.content.balance.player.interactRange;
  let best: InteractTarget | null = null, bd = range;
  for (const n of w.area.npcs) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= bd) { bd = d; best = { kind: 'npc', id: n.id, npc: n.npc, x: n.x, y: n.y }; }
  }
  return best;
}

/** その役割の NPC の近くにいるか（街の機能はこれで確かめる） */
export function nearRole(w: World, p: Player, role: string): boolean {
  const range = w.content.balance.player.interactRange + 0.6;
  return w.area.npcs.some((n) => w.content.npcs[n.npc]?.role === role && Math.hypot(n.x - p.x, n.y - p.y) <= range);
}
