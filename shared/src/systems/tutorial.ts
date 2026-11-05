import type { Player, World } from '../state';
import { spentStatPoints } from './progression';
import { addToBag } from './items';
import { createItem } from './loot';
import { newUid } from './util';

/**
 * はじめてのチュートリアル。最初のフィールドで、移動・攻撃・回避・スキル・ステ振り・装備を順に教える。
 * 各段の条件はこのtickのイベントやキャラの状態で判定する。
 */
export function updateTutorial(w: World, p: Player) {
  const t = p.char.tutorial;
  if (!t || t.done) return;
  const steps = w.content.tutorial.steps;
  const step = steps[t.step];
  if (!step) { t.done = true; return; }
  let add = 0;
  switch (step.type) {
    case 'move': {
      const d = Math.hypot(p.x - p.tutPos.x, p.y - p.tutPos.y);
      if (d < 2) add = d;
      p.tutPos = { x: p.x, y: p.y };
      break;
    }
    case 'hit': add = w.events.filter((e) => e.type === 'damage' && e.src === p.id).length; break;
    case 'dodge': add = w.events.filter((e) => e.type === 'dodge' && e.id === p.id).length; break;
    case 'learn': add = Object.keys(p.char.skills).length > 0 ? 1 : 0; break;
    case 'skill':
      // この段では MP を切らさない（通常攻撃で溜める前に試せるように）
      p.mp = p.stats.maxMp;
      add = w.events.filter((e) => e.type === 'attack' && e.src === p.id && e.skill).length;
      break;
    case 'stats': add = spentStatPoints(p.char) > 0 ? 1 : 0; break;
    case 'equip': add = w.events.filter((e) => e.type === 'equip' && e.playerId === p.id).length; break;
    case 'town': add = w.area.type === 'town' ? 1 : 0; break;
  }
  if (add <= 0) return;
  t.count += add;
  if (t.count < step.n) return;
  t.step++;
  t.count = 0;
  const next = steps[t.step];
  if (next?.gift) {
    const it = createItem(newUid(w), next.gift.base, 0, 1, next.gift.rarity, w.rng, w.content);
    p.char.inventory.push(it);
    w.events.push({ type: 'pickup', playerId: p.id, item: it });
  }
  if (t.step >= steps.length) {
    t.done = true;
    const r = w.content.tutorial.reward;
    p.char.gold += r.gold;
    for (const [id, n] of Object.entries(r.items)) addToBag(p.char, id, n);
    w.events.push({ type: 'gold', playerId: p.id, amount: r.gold });
  }
  w.events.push({ type: 'tutorial', playerId: p.id, step: t.step, done: t.done });
}
