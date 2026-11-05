import type { PhaseDef } from '../content/types';
import type { Monster, World } from '../state';
import { applyHit } from './combat';
import { spawnMonster } from './world';
import { sec } from './util';

/**
 * ボス・レイドの仕掛け：HP でフェーズが進み、手下の召喚・シールド・安全地帯・速度上昇・時間切れの激昂。
 */

function applyPhase(w: World, m: Monster, ph: PhaseDef) {
  const area = w.area;
  if (ph.summon) {
    for (let i = 0; i < ph.summon.count; i++) {
      const a = (Math.PI * 2 * i) / ph.summon.count;
      const x = m.x + Math.cos(a) * (m.r + 1.8), y = m.y + Math.sin(a) * (m.r + 1.8);
      const lv = ph.summon.level ?? Math.max(1, m.level - 3);
      const add = spawnMonster(w, { key: 'summon', monster: ph.summon.monster, x, y, level: [lv, lv], monsterId: -1, respawnAt: 0 }, { level: lv, difficulty: m.difficulty });
      add.summonedBy = m.id;
      add.ai = 'chase';
      add.targetId = m.targetId;
    }
    if (ph.shield) m.shielded = true;
    w.events.push({ type: 'worldNotice', key: 'notice.summon', args: [w.content.monsters[m.defId].name] });
  }
  if (ph.safeZones) {
    const sz = ph.safeZones;
    area.safeZones = [];
    for (let i = 0; i < sz.count; i++) {
      for (let t = 0; t < 20; t++) {
        const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(3, 7);
        const x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r;
        const k = Math.floor(y) * area.map.width + Math.floor(x);
        if (area.map.solid[k] === false) { area.safeZones.push({ x, y, r: sz.radius }); break; }
      }
    }
    area.safeZoneAt = w.tick + sec(w, sz.delay);
    area.safeZonePower = sz.power;
    area.safeZoneOwner = m.id;
    w.events.push({ type: 'worldNotice', key: 'notice.safeZone', args: [] });
  }
}

export const bossHooks = {
  update(w: World, m: Monster): void {
    const def = w.content.monsters[m.defId];
    const area = w.area;
    if (def.phases) {
      def.phases.forEach((ph, i) => {
        if (m.phase <= i && m.hp / m.stats.maxHp <= ph.hp) { m.phase = i + 1; applyPhase(w, m, ph); }
      });
    }
    if (m.shielded && !area.monsters.some((x) => x.summonedBy === m.id && !x.dead)) {
      m.shielded = false;
      w.events.push({ type: 'break', id: m.id });
    }
    if (def.enrageTime && area.instance && !m.enraged && w.tick - area.instance.startTick > sec(w, def.enrageTime)) {
      m.enraged = true;
      m.scale.atk *= 2;
      m.statsDirty = true;
      w.events.push({ type: 'enrage', id: m.id });
    }
    // 安全地帯の外にいる人に大ダメージ
    if (area.safeZoneOwner === m.id && area.safeZones.length && w.tick >= area.safeZoneAt) {
      for (const p of w.players) {
        if (p.dead) continue;
        if (area.safeZones.some((z) => Math.hypot(p.x - z.x, p.y - z.y) <= z.r)) continue;
        applyHit(w, m, p, { power: area.safeZonePower, element: def.element, damageType: 'magic', kind: 'monster', breakPower: 0, canCrit: false }, -1, 1);
      }
      w.events.push({ type: 'impact', src: m.id, x: m.x, y: m.y, dir: 0, shape: { type: 'circle', radius: 12 }, element: def.element, team: 1 });
      area.safeZones = [];
      area.safeZoneOwner = -1;
    }
  },
  speedMul(w: World, m: Monster): number {
    const def = w.content.monsters[m.defId];
    let k = 1;
    (def.phases ?? []).forEach((ph, i) => { if (m.phase > i && ph.speedMul) k *= ph.speedMul; });
    return k;
  },
};
