// ダンジョンの戦闘シミュレーション。サーバー（オンライン）でもブラウザ（オフライン）でも同じコードが動く。
// 当たり判定・ダメージ・ドロップはすべてここで決まる（オンライン時はサーバーが権威を持つ）。
import { generateFloor, moveCircle, isWall } from './dungeon.js';
import { computeDamage, affinity, ELEMENT_INFO, STATUS_INFO } from './elements.js';
import { monsterStats, behaviorOf, isFlying, isPoisonous } from './genome.js';
import { WEAPON_TYPES, rollMaterial, materialLabel } from './items.js';
import { Rng } from './rng.js';

export const TICK = 1 / 20;
const PLAYER_R = 6;
const DOWN_TIME = 20;
const REVIVE_TIME = 2.5;
const REVIVE_RANGE = 26;
const AGGRO = 130;

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class DungeonSim {
  /**
   * @param {object} o
   * @param {string} o.seed
   * @param {object} o.area
   * @param {() => Array} o.snapshotFn  その時点のエリアの生態系（階層を作るたびに呼ぶ）
   * @param {object} [o.apex]           ワールドレイドなら頂点捕食者
   */
  constructor({ seed, area, snapshotFn, apex = null }) {
    this.seed = seed;
    this.area = area;
    this.snapshotFn = snapshotFn;
    this.apex = apex;
    this.rng = new Rng(`${seed}:sim`);
    this.floor = 0;
    this.map = null;
    this.players = new Map();
    this.monsters = new Map();
    this.projectiles = [];
    this.events = [];
    this.tick = 0;
    this.nextId = 1;
    this.wipeT = null;
    this.finished = false;
    this.mapVersion = 0;
    this.bossDefeated = false;
  }

  id() { return this.nextId++; }
  emit(ev) { this.events.push(ev); }

  addPlayer({ id, name, stats, potions = 0, charms = 0, color = 0 }) {
    const p = {
      id, name, stats, color, x: 0, y: 0, dir: 0, hp: stats.maxHp, maxHp: stats.maxHp,
      cd: { atk: 0, s1: 0, s2: 0, dodge: 0, potion: 0 }, dodgeT: 0, atkT: 0, castT: 0,
      down: false, downT: 0, reviveProg: 0, lost: false, escaped: false, ready: false,
      status: {}, buff: {}, input: {}, potions, charms, potionsUsed: 0, charmsUsed: 0,
      loot: { materials: [], gold: 0 }, kills: [], deepest: 0, contrib: 0, dot: 0,
    };
    this.players.set(id, p);
    if (this.map) this.placePlayer(p, this.players.size - 1);
    return p;
  }

  removePlayer(id) { this.players.delete(id); }

  setInput(id, input) {
    const p = this.players.get(id);
    if (p) p.input = input || {};
  }

  start() { this.nextFloor(); }

  placePlayer(p, i) {
    const offs = [[0, 0], [14, 0], [0, 14], [14, 14], [-14, 0], [0, -14], [-14, -14], [14, -14]];
    const o = offs[i % offs.length];
    p.x = this.map.start.x + o[0];
    p.y = this.map.start.y + o[1];
    if (isWall(this.map, p.x, p.y)) { p.x = this.map.start.x; p.y = this.map.start.y; }
  }

  nextFloor() {
    this.floor++;
    const actives = this.activePlayers();
    this.map = generateFloor({
      seed: this.seed, area: this.area, floor: this.floor,
      snapshot: this.snapshotFn(), apex: this.apex, partySize: Math.max(1, actives.length),
    });
    this.mapVersion++;
    this.monsters.clear();
    this.projectiles = [];
    for (const s of this.map.spawns) this.spawnMonster(s);
    actives.forEach((p, i) => {
      this.placePlayer(p, i);
      p.ready = false;
      p.deepest = Math.max(p.deepest, this.floor);
      if (p.down) { p.down = false; p.hp = Math.round(p.maxHp * 0.3); }
    });
    this.emit({ t: 'floor', floor: this.floor });
  }

  spawnMonster(s) {
    const g = s.genome;
    const st = monsterStats(g, s.tier);
    const m = {
      id: this.id(), speciesId: s.speciesId, speciesName: s.speciesName, genome: g, endangered: !!s.endangered,
      x: s.x, y: s.y, hp: st.maxHp, maxHp: st.maxHp, power: st.power, speed: st.speed, r: st.radius,
      behavior: behaviorOf(g), flying: isFlying(g), poison: isPoisonous(g),
      boss: !!s.boss, status: {}, cd: { atk: 0.5 + this.rng.float(), shot: 1 + this.rng.float(), ring: 3, charge: 6, summon: 10 },
      target: null, alerted: false, dashT: 0, dashDir: 0, wanderT: 0, wanderDir: this.rng.float() * Math.PI * 2,
      hurtT: 0, atkT: 0, dir: Math.PI, dot: 0, tier: s.tier,
    };
    if (m.boss) {
      m.maxHp = this.apex.maxHp;
      m.hp = this.apex.hp;
      m.r = 18;
      m.power = Math.round(st.power * 1.3);
      m.speed = 40;
    }
    this.monsters.set(m.id, m);
    return m;
  }

  /** 生きているプレイヤーからの歩数の地図（魔物の経路探索用） */
  computeFlow() {
    const { w, h, tiles } = this.map;
    const dist = new Int16Array(w * h).fill(-1);
    const q = [];
    for (const p of this.alivePlayers()) {
      const i = Math.floor(p.y / 16) * w + Math.floor(p.x / 16);
      if (dist[i] !== 0) { dist[i] = 0; q.push(i); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, y = (i - x) / w, nd = dist[i] + 1;
      if (nd > 40) continue;
      if (x > 0 && dist[i - 1] < 0 && tiles[i - 1] === 1) { dist[i - 1] = nd; q.push(i - 1); }
      if (x < w - 1 && dist[i + 1] < 0 && tiles[i + 1] === 1) { dist[i + 1] = nd; q.push(i + 1); }
      if (y > 0 && dist[i - w] < 0 && tiles[i - w] === 1) { dist[i - w] = nd; q.push(i - w); }
      if (y < h - 1 && dist[i + w] < 0 && tiles[i + w] === 1) { dist[i + w] = nd; q.push(i + w); }
    }
    this.flow = dist;
  }

  flowStep(m) {
    if (!this.flow) return null;
    const w = this.map.w;
    const tx = Math.floor(m.x / 16), ty = Math.floor(m.y / 16);
    const here = this.flow[ty * w + tx];
    let best = null, bd = here < 0 ? 9999 : here;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = this.flow[(ty + dy) * w + (tx + dx)];
      if (v >= 0 && v < bd) { bd = v; best = { x: (tx + dx) * 16 + 8, y: (ty + dy) * 16 + 8 }; }
    }
    return best;
  }

  clearLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(d / 6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (isWall(this.map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  activePlayers() { return [...this.players.values()].filter((p) => !p.lost && !p.escaped); }
  alivePlayers() { return this.activePlayers().filter((p) => !p.down); }

  // ---------- 1ステップ ----------
  step(dt = TICK) {
    if (this.finished || !this.map) return;
    this.tick++;
    if (this.tick % 4 === 1) this.computeFlow();
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    for (const m of [...this.monsters.values()]) this.updateMonster(m, dt);
    this.updateProjectiles(dt);
    this.checkParty(dt);
  }

  checkParty(dt) {
    const actives = this.activePlayers();
    if (!actives.length) { this.finished = true; return; }
    const alive = actives.filter((p) => !p.down);
    if (!alive.length) {
      this.wipeT = (this.wipeT ?? 2) - dt;
      if (this.wipeT <= 0) {
        for (const p of actives) p.lost = true;
        this.emit({ t: 'wipe' });
        this.finished = true;
      }
      return;
    }
    this.wipeT = null;
    if (this.map.stairs && alive.every((p) => p.ready)) this.nextFloor();
  }

  // ---------- プレイヤー ----------
  updatePlayer(p, dt) {
    if (p.lost || p.escaped) return;
    for (const k of Object.keys(p.cd)) p.cd[k] = Math.max(0, p.cd[k] - dt);
    for (const k of Object.keys(p.buff)) if ((p.buff[k] -= dt) <= 0) delete p.buff[k];
    p.atkT = Math.max(0, p.atkT - dt);
    p.castT = Math.max(0, p.castT - dt);
    this.tickStatus(p, dt, true);

    if (p.down) {
      p.downT -= dt;
      const helper = this.alivePlayers().find((q) => q !== p && dist2(q, p) < REVIVE_RANGE ** 2);
      p.reviveProg = helper ? p.reviveProg + dt : Math.max(0, p.reviveProg - dt * 0.5);
      if (p.reviveProg >= REVIVE_TIME) {
        p.down = false;
        p.hp = Math.round(p.maxHp * 0.35);
        p.reviveProg = 0;
        this.emit({ t: 'revive', id: p.id, by: helper.id });
      } else if (p.downT <= 0 && this.alivePlayers().length) {
        p.lost = true;
        this.emit({ t: 'lost', id: p.id });
      }
      return;
    }

    const inp = p.input || {};
    const frozen = p.status.freeze;
    let mx = +inp.mx || 0, my = +inp.my || 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (typeof inp.aim === 'number' && isFinite(inp.aim)) p.dir = inp.aim;
    else if (len > 0.2) p.dir = Math.atan2(my, mx);

    if (!frozen) {
      if (inp.dodge && p.cd.dodge <= 0) {
        p.dodgeT = 0.2;
        p.cd.dodge = 0.9;
        p.dodgeDir = len > 0.2 ? Math.atan2(my, mx) : p.dir;
      }
      let speed = p.stats.speed * (p.buff.haste ? 1.6 : 1) * (p.status.slow ? 0.55 : 1);
      if (p.atkT > 0) speed *= 0.6;
      if (p.dodgeT > 0) {
        p.dodgeT -= dt;
        moveCircle(this.map, p, Math.cos(p.dodgeDir) * speed * 3.2 * dt, Math.sin(p.dodgeDir) * speed * 3.2 * dt, PLAYER_R);
      } else {
        moveCircle(this.map, p, mx * speed * dt, my * speed * dt, PLAYER_R);
      }
      if (p.status.knockback && p.kb) moveCircle(this.map, p, p.kb.x * dt, p.kb.y * dt, PLAYER_R);
    }

    const canAct = !frozen && !p.status.paralyze && p.dodgeT <= 0;
    if (canAct && inp.atk && p.cd.atk <= 0) this.playerAttack(p);
    if (canAct && inp.s1 && p.cd.s1 <= 0) this.playerSkill1(p);
    if (canAct && inp.s2 && p.cd.s2 <= 0) this.playerSkill2(p);
    if (inp.potion && p.cd.potion <= 0 && p.potions - p.potionsUsed > 0 && p.hp < p.maxHp) {
      p.potionsUsed++;
      p.cd.potion = 1;
      this.heal(p, p.maxHp * 0.5);
      this.emit({ t: 'fx', k: 'potion', x: p.x, y: p.y });
    }

    // 階段と脱出の魔法陣
    const m = this.map;
    p.ready = !!(m.stairs && dist2(p, m.stairs) < 22 ** 2 && inp.act);
    if (inp.act && dist2(p, m.portal) < 22 ** 2) {
      p.escaped = true;
      this.emit({ t: 'escape', id: p.id });
    }
  }

  heal(p, amount) {
    if (p.status.curse) return;
    p.hp = Math.min(p.maxHp, p.hp + amount);
  }

  playerAttack(p) {
    const wt = WEAPON_TYPES[p.stats.weaponType] || WEAPON_TYPES.sword;
    p.cd.atk = wt.cd;
    p.atkT = 0.18;
    const base = p.stats.atk * wt.mult;
    const el = p.stats.element;
    const rangeMul = 1 + p.stats.effects.range;
    if (wt.shape === 'arc') {
      this.hitArea(p, (m) => this.inArc(p, m, wt.reach, wt.arc), base, el, 0.2);
      this.emit({ t: 'fx', k: 'slash', x: p.x, y: p.y, a: +p.dir.toFixed(2), e: el });
    } else if (wt.shape === 'line') {
      this.hitArea(p, (m) => this.inLine(p, m, wt.reach, wt.width), base, el, 0.2);
      this.emit({ t: 'fx', k: 'thrust', x: p.x, y: p.y, a: +p.dir.toFixed(2), e: el });
    } else {
      this.shoot(p, {
        speed: wt.speed, range: wt.range * rangeMul, r: wt.shape === 'orb' ? 4 : 2, dmg: base, el,
        kind: wt.shape === 'orb' ? 'orb' : 'arrow', blast: wt.blast || 0, status: 0.2,
      });
    }
  }

  playerSkill1(p) {
    const s = p.stats.skill1;
    p.cd.s1 = s.cd;
    p.castT = 0.3;
    const base = p.stats.atk;
    const el = p.stats.element;
    const a = p.dir;
    switch (s.id) {
      case 'tidal': this.shoot(p, { speed: 150, range: 160, r: 10, dmg: base * 1.6, el, kind: 'wave', pierce: true, status: 0.6 }); break;
      case 'fireball': this.shoot(p, { speed: 170, range: 170, r: 5, dmg: base * 2.0, el, kind: 'fireball', blast: 32, status: 0.6 }); break;
      case 'icicle': for (const d of [-0.25, 0, 0.25]) this.shoot(p, { speed: 210, range: 150, r: 3, dmg: base * 1.0, el, kind: 'icicle', status: 0.5, angle: a + d }); break;
      case 'gale':
        this.hitArea(p, (m) => this.inArc(p, m, 54, 1.3), base * 1.2, el, 1.0);
        this.emit({ t: 'fx', k: 'gale', x: p.x, y: p.y, a: +a.toFixed(2), e: el }); break;
      case 'quake':
        this.hitArea(p, (m) => dist2(p, m) < (46 + m.r) ** 2, base * 1.8, el, 0.7);
        this.emit({ t: 'fx', k: 'ring', x: p.x, y: p.y, r: 46, e: el }); break;
      case 'bolt': this.shoot(p, { speed: 380, range: 230, r: 3, dmg: base * 1.9, el, kind: 'bolt', pierce: true, status: 0.6 }); break;
      case 'ray':
        this.hitArea(p, (m) => this.inLine(p, m, 130, 12), base * 1.7, el, 0.6);
        this.emit({ t: 'fx', k: 'ray', x: p.x, y: p.y, a: +a.toFixed(2), e: el }); break;
      case 'drain': this.shoot(p, { speed: 170, range: 160, r: 4, dmg: base * 1.5, el, kind: 'drain', drain: 0.3, status: 0.4 }); break;
      default:
        this.hitArea(p, (m) => dist2(p, m) < (34 + m.r) ** 2, base * 1.6, el, 0.3);
        this.emit({ t: 'fx', k: 'ring', x: p.x, y: p.y, r: 34, e: el });
    }
  }

  playerSkill2(p) {
    const s = p.stats.skill2;
    p.cd.s2 = s.cd;
    p.castT = 0.3;
    const near = this.alivePlayers().filter((q) => dist2(q, p) < 70 ** 2);
    switch (s.id) {
      case 'heal': for (const q of near) this.heal(q, q.maxHp * 0.3); break;
      case 'guard': p.buff.guard = 4; break;
      case 'haste': p.buff.haste = 4; break;
      case 'purify': for (const q of near) { q.status = {}; this.heal(q, q.maxHp * 0.12); } break;
      default: p.buff.ward = 5;
    }
    this.emit({ t: 'fx', k: 'buff', x: p.x, y: p.y, s: s.id });
  }

  inArc(p, m, reach, arc) {
    const d = Math.sqrt(dist2(p, m));
    if (d > reach + m.r) return false;
    return d < m.r + 2 || angDiff(Math.atan2(m.y - p.y, m.x - p.x), p.dir) < arc / 2;
  }

  inLine(p, m, reach, width) {
    const dx = m.x - p.x, dy = m.y - p.y;
    const c = Math.cos(p.dir), s = Math.sin(p.dir);
    const along = dx * c + dy * s;
    const across = Math.abs(-dx * s + dy * c);
    return along > -m.r && along < reach + m.r && across < width / 2 + m.r;
  }

  hitArea(p, test, base, el, statusChance) {
    for (const m of [...this.monsters.values()]) if (test(m)) this.damageMonster(m, base, el, p, statusChance);
  }

  shoot(owner, o) {
    const a = o.angle ?? owner.dir;
    this.projectiles.push({
      id: this.id(), side: owner.stats ? 'p' : 'm', ownerId: owner.id,
      x: owner.x + Math.cos(a) * 8, y: owner.y + Math.sin(a) * 8,
      vx: Math.cos(a) * o.speed, vy: Math.sin(a) * o.speed, left: o.range, r: o.r,
      dmg: o.dmg, el: o.el, kind: o.kind, blast: o.blast || 0, pierce: !!o.pierce,
      status: o.status || 0, drain: o.drain || 0, hit: new Set(),
    });
  }

  // ---------- ダメージ ----------
  damageMonster(m, base, el, attacker, statusChance = 0.2) {
    if (!this.monsters.has(m.id)) return;
    if (attacker.status?.blind && this.rng.chance(0.4)) { this.emit({ t: 'miss', x: m.x, y: m.y }); return; }
    const crit = this.rng.chance(attacker.stats?.effects.crit || 0.05);
    const resist = el && el !== 'none' ? m.genome.resist[el] || 0 : 0;
    let dmg = computeDamage(base * (crit ? 1.8 : 1), el, m.genome.body, resist, { wet: !!m.status.wet });
    if (m.status.grounded) dmg = Math.round(dmg * 1.2);
    m.hp -= dmg;
    m.hurtT = 0.12;
    m.target = attacker.id;
    m.alerted = true;
    attacker.contrib += dmg;
    const aff = affinity(el, m.genome.body);
    this.emit({ t: 'hit', x: Math.round(m.x), y: Math.round(m.y - m.r), v: dmg, c: crit ? 1 : 0, e: el, a: aff > 1 ? 's' : aff < 1 ? 'w' : '' });

    if (el && el !== 'none' && this.rng.chance(statusChance)) this.applyStatus(m, ELEMENT_INFO[el].status, attacker);
    if (el === 'ice' && m.flying && !m.boss) this.applyStatus(m, 'grounded', attacker); // 翼が凍って墜落
    if (attacker.stats?.effects.poison && this.rng.chance(0.25)) this.applyStatus(m, 'poison', attacker);
    if (attacker.stats?.effects.lifesteal) this.heal(attacker, dmg * attacker.stats.effects.lifesteal);
    if (m.behavior === 'caller' && !m.called) {
      m.called = true;
      for (const o of this.monsters.values()) if (o !== m && dist2(o, m) < 150 ** 2) { o.alerted = true; o.target = attacker.id; }
      this.emit({ t: 'fx', k: 'call', x: m.x, y: m.y });
    }
    if (m.boss && this.apex) this.apex.hp = Math.max(0, m.hp);
    if (m.hp <= 0) this.killMonster(m, attacker, el);
  }

  applyStatus(e, st, src) {
    if (!st) return;
    if (st === 'knockback') {
      const a = Math.atan2(e.y - src.y, e.x - src.x);
      e.kb = { x: Math.cos(a) * 220, y: Math.sin(a) * 220 };
    }
    if (e.boss && (st === 'freeze' || st === 'grounded')) return;
    e.status[st] = STATUS_INFO[st].dur;
  }

  tickStatus(e, dt, isPlayer) {
    for (const k of Object.keys(e.status)) if ((e.status[k] -= dt) <= 0) delete e.status[k];
    let dps = 0;
    if (e.status.burn) dps += e.maxHp * 0.035;
    if (e.status.poison) dps += e.maxHp * 0.025;
    if (!dps) return;
    e.dot += dps * dt;
    if (e.dot >= 1) {
      const d = Math.floor(e.dot);
      e.dot -= d;
      e.hp -= d;
      if (isPlayer) { if (e.hp <= 0) this.playerDown(e); }
      else if (e.hp <= 0 && this.monsters.has(e.id)) {
        const killer = this.players.get(e.target) || this.alivePlayers()[0];
        if (killer) this.killMonster(e, killer, e.status.burn ? 'fire' : 'none');
        else this.monsters.delete(e.id);
      }
    }
  }

  killMonster(m, killer, el) {
    this.monsters.delete(m.id);
    this.emit({ t: 'kill', id: m.id, x: Math.round(m.x), y: Math.round(m.y), sp: m.speciesId });
    const exp = Math.round(3 * m.tier + (m.boss ? 80 : 0));
    if (!m.boss) killer.kills.push({ speciesId: m.speciesId, element: el || 'none', exp });
    // 戦利品は全員に個別ドロップ
    for (const p of this.activePlayers()) {
      const n = m.boss ? 3 : 1;
      for (let i = 0; i < n; i++) {
        if (!m.boss && !this.rng.chance(0.75)) continue;
        const mat = rollMaterial(this.rng, m, Math.max(1, Math.round(m.tier * 2) - 1));
        p.loot.materials.push(mat);
        this.emit({ t: 'drop', to: p.id, text: materialLabel(mat), r: mat.rarity });
      }
      p.loot.gold += Math.round((2 + m.tier * 3) * (m.boss ? 30 : 1));
      if (m.boss) p.kills.push({ speciesId: m.speciesId, element: el || 'none', exp: exp });
    }
    if (m.boss) {
      this.bossDefeated = true;
      this.emit({ t: 'bossDown', name: m.speciesName });
    }
  }

  damagePlayer(p, base, el, src) {
    if (p.down || p.lost || p.escaped || p.dodgeT > 0) return;
    let resist = el && el !== 'none' ? p.stats.resist[el] || 0 : 0;
    for (const q of this.alivePlayers()) {
      if (dist2(q, p) > 90 ** 2) continue;
      for (const a of q.stats.effects.aura) if (a.element === el) resist += a.value;
    }
    let dmg = computeDamage(base, el, p.stats.bodyElement, resist, { wet: !!p.status.wet });
    if (p.buff.guard) dmg *= 0.5;
    else if (p.buff.ward) dmg *= 0.7;
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    this.emit({ t: 'hurt', id: p.id, x: Math.round(p.x), y: Math.round(p.y - 8), v: dmg, e: el });
    if (el && el !== 'none' && this.rng.chance(0.15)) this.applyStatus(p, ELEMENT_INFO[el].status, src);
    if (src.poison && this.rng.chance(0.3)) this.applyStatus(p, 'poison', src);
    if (p.hp <= 0) this.playerDown(p);
  }

  playerDown(p) {
    if (p.down) return;
    if (p.charms - p.charmsUsed > 0) {
      p.charmsUsed++;
      p.hp = Math.round(p.maxHp * 0.5);
      p.status = {};
      this.emit({ t: 'charm', id: p.id });
      return;
    }
    p.hp = 0;
    p.down = true;
    p.downT = DOWN_TIME;
    p.reviveProg = 0;
    p.status = {};
    this.emit({ t: 'down', id: p.id });
  }

  // ---------- 魔物 ----------
  updateMonster(m, dt) {
    for (const k of Object.keys(m.cd)) m.cd[k] -= dt;
    m.hurtT = Math.max(0, m.hurtT - dt);
    m.atkT = Math.max(0, m.atkT - dt);
    this.tickStatus(m, dt, false);
    if (!this.monsters.has(m.id)) return;
    if (m.status.knockback && m.kb) { moveCircle(this.map, m, m.kb.x * dt, m.kb.y * dt, m.r * 0.7); return; }
    if (m.status.freeze || m.status.grounded) return;

    const alive = this.alivePlayers();
    let target = alive.find((p) => p.id === m.target);
    if (!target || dist2(target, m) > (AGGRO * 2.2) ** 2) {
      target = null;
      let best = AGGRO ** 2;
      for (const p of alive) { const d = dist2(p, m); if (d < best) { best = d; target = p; } }
      if (m.boss && !target) target = alive[0] || null;
      m.target = target?.id ?? null;
    }
    const speed = m.speed * (m.status.slow ? 0.5 : 1);
    const moveToward = (tx, ty, mul = 1, chase = false) => {
      // 壁の向こうにいる相手には、通路をたどって近づく
      if (chase && !this.clearLine(m, { x: tx, y: ty })) {
        const step = this.flowStep(m);
        if (step) { tx = step.x; ty = step.y; }
      }
      const a = Math.atan2(ty - m.y, tx - m.x);
      m.dir = a;
      moveCircle(this.map, m, Math.cos(a) * speed * mul * dt, Math.sin(a) * speed * mul * dt, m.r * 0.7);
    };

    if (!target) {
      m.wanderT -= dt;
      if (m.wanderT <= 0) { m.wanderT = 1 + this.rng.float() * 2; m.wanderDir = this.rng.float() * Math.PI * 2; }
      moveCircle(this.map, m, Math.cos(m.wanderDir) * speed * 0.25 * dt, Math.sin(m.wanderDir) * speed * 0.25 * dt, m.r * 0.7);
      return;
    }

    const d = Math.sqrt(dist2(target, m));
    const canAttack = !m.status.paralyze;
    if (m.boss) return this.updateBoss(m, target, d, dt, moveToward, canAttack);

    if (m.dashT > 0) {
      m.dashT -= dt;
      moveCircle(this.map, m, Math.cos(m.dashDir) * speed * 3 * dt, Math.sin(m.dashDir) * speed * 3 * dt, m.r * 0.7);
    } else if (m.behavior === 'ranged' || (m.genome.atk !== 'none' && m.behavior === 'flee')) {
      const want = m.behavior === 'flee' ? 100 : 80;
      if (d < want - 12) moveToward(m.x * 2 - target.x, m.y * 2 - target.y, 0.9);
      else if (d > want + 20) moveToward(target.x, target.y, 1, true);
      m.dir = Math.atan2(target.y - m.y, target.x - m.x);
      if (canAttack && m.cd.shot <= 0 && d < 170) {
        m.cd.shot = 1.6 + this.rng.float() * 0.6;
        m.atkT = 0.2;
        this.shoot(m, { speed: 115, range: 180, r: 3, dmg: m.power, el: m.genome.atk, kind: 'mshot' });
      }
    } else if (m.behavior === 'flee' && m.hp < m.maxHp * 0.4) {
      moveToward(m.x * 2 - target.x, m.y * 2 - target.y, 1.1);
    } else {
      let mul = 1;
      if (m.behavior === 'swarm') {
        let n = 0;
        for (const o of this.monsters.values()) if (o !== m && dist2(o, m) < 50 ** 2) n++;
        mul = 1 + Math.min(0.4, n * 0.15);
      }
      if (d > m.r + PLAYER_R + 2) moveToward(target.x, target.y, mul, true);
      if (m.behavior === 'charge' && canAttack && m.cd.charge <= 0 && d < 70 && d > 24) {
        m.cd.charge = 3 + this.rng.float() * 2;
        m.dashT = 0.32;
        m.dashDir = Math.atan2(target.y - m.y, target.x - m.x);
      }
    }
    // 体当たり
    if (canAttack && m.cd.atk <= 0) {
      for (const p of alive) {
        if (dist2(p, m) < (m.r + PLAYER_R + 3) ** 2) {
          m.cd.atk = 1.2;
          m.atkT = 0.2;
          const mul = m.dashT > 0 ? 1.5 : 1;
          this.damagePlayer(p, m.power * mul, m.genome.atk, m);
          break;
        }
      }
    }
  }

  updateBoss(m, target, d, dt, moveToward, canAttack) {
    if (m.dashT > 0) {
      m.dashT -= dt;
      moveCircle(this.map, m, Math.cos(m.dashDir) * 210 * dt, Math.sin(m.dashDir) * 210 * dt, m.r * 0.7);
    } else if (d > 40) moveToward(target.x, target.y, 1, true);
    if (!canAttack) return;
    if (m.cd.ring <= 0) {
      m.cd.ring = 3.5;
      m.atkT = 0.4;
      const off = this.rng.float();
      for (let i = 0; i < 10; i++) this.shoot(m, { speed: 95, range: 260, r: 4, dmg: m.power * 0.8, el: m.genome.atk, kind: 'mshot', angle: off + (i / 10) * Math.PI * 2 });
    }
    if (m.cd.charge <= 0) {
      m.cd.charge = 7;
      m.dashT = 0.6;
      m.dashDir = Math.atan2(target.y - m.y, target.x - m.x);
      this.emit({ t: 'fx', k: 'roar', x: m.x, y: m.y });
    }
    if (m.cd.summon <= 0) {
      m.cd.summon = 12;
      const sp = this.snapshotFn().find((s) => s.id === m.speciesId) || this.snapshotFn()[0];
      if (sp && sp.pool.length && this.monsters.size < 14) {
        for (let i = 0; i < 2; i++) {
          const mm = this.spawnMonster({ x: m.x + (i ? 24 : -24), y: m.y + 20, speciesId: sp.id, speciesName: sp.name, genome: this.rng.pick(sp.pool), tier: 1.6 });
          mm.alerted = true;
          this.emit({ t: 'spawn', m: this.monsterInfo(mm) });
        }
      }
    }
    if (m.cd.atk <= 0) {
      for (const p of this.alivePlayers()) {
        if (dist2(p, m) < (m.r + PLAYER_R + 4) ** 2) {
          m.cd.atk = 0.9;
          this.damagePlayer(p, m.power * (m.dashT > 0 ? 1.6 : 1.1), m.genome.atk, m);
        }
      }
    }
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const pr of this.projectiles) {
      const sx = pr.vx * dt, sy = pr.vy * dt;
      pr.x += sx; pr.y += sy;
      pr.left -= Math.hypot(sx, sy);
      let dead = pr.left <= 0 || isWall(this.map, pr.x, pr.y);
      if (!dead && pr.side === 'p') {
        const owner = this.players.get(pr.ownerId);
        for (const m of [...this.monsters.values()]) {
          if (pr.hit.has(m.id) || dist2(pr, m) > (pr.r + m.r) ** 2) continue;
          pr.hit.add(m.id);
          if (owner) {
            if (pr.blast) this.explode(pr, owner);
            else {
              const before = m.hp;
              this.damageMonster(m, pr.dmg, pr.el, owner, pr.status);
              if (pr.drain) this.heal(owner, Math.max(0, before - Math.max(0, m.hp)) * pr.drain);
            }
          }
          if (!pr.pierce) { dead = true; break; }
        }
        if (dead && pr.blast && pr.hit.size === 0 && owner) this.explode(pr, owner);
      } else if (!dead && pr.side === 'm') {
        const src = this.monsters.get(pr.ownerId) || { x: pr.x, y: pr.y, poison: false };
        for (const p of this.alivePlayers()) {
          if (dist2(pr, p) < (pr.r + PLAYER_R) ** 2 && p.dodgeT <= 0) {
            this.damagePlayer(p, pr.dmg, pr.el, src);
            dead = true;
            break;
          }
        }
      }
      if (!dead) keep.push(pr);
    }
    this.projectiles = keep;
  }

  explode(pr, owner) {
    this.emit({ t: 'fx', k: 'ring', x: Math.round(pr.x), y: Math.round(pr.y), r: pr.blast, e: pr.el });
    for (const m of [...this.monsters.values()]) {
      if (dist2(pr, m) < (pr.blast + m.r) ** 2) this.damageMonster(m, pr.dmg, pr.el, owner, pr.status);
    }
  }

  // ---------- クライアントへ送る形 ----------
  monsterInfo(m) {
    return { id: m.id, sp: m.speciesId, name: m.speciesName, g: m.genome, boss: m.boss, r: m.r, fly: m.flying, mut: !!m.genome.mutant, end: m.endangered };
  }

  floorInfo() {
    const mp = this.map;
    return {
      floor: this.floor, mapVersion: this.mapVersion,
      map: { w: mp.w, h: mp.h, tiles: mp.tiles.join(''), stairs: mp.stairs, portal: mp.portal, env: mp.env, areaName: mp.areaName, raid: mp.raid },
      monsters: [...this.monsters.values()].map((m) => this.monsterInfo(m)),
      roster: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, weapon: p.stats.weaponType, el: p.stats.element })),
    };
  }

  snapshot() {
    const ps = [];
    for (const p of this.players.values()) {
      if (p.escaped || p.lost) continue;
      let f = 0;
      if (p.down) f |= 1;
      if (p.dodgeT > 0) f |= 2;
      if (p.atkT > 0) f |= 4;
      if (p.castT > 0) f |= 8;
      if (p.ready) f |= 16;
      if (p.buff.guard || p.buff.ward) f |= 32;
      if (p.buff.haste) f |= 64;
      ps.push([p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.dir * 100) / 100, Math.ceil(p.hp), p.maxHp, f, p.down ? Math.ceil(p.downT) : 0, Math.round((p.reviveProg / REVIVE_TIME) * 100), statusList(p.status)]);
    }
    const ms = [];
    for (const m of this.monsters.values()) {
      let f = 0;
      if (m.hurtT > 0) f |= 1;
      if (m.status.freeze) f |= 2;
      if (m.status.grounded) f |= 4;
      if (m.atkT > 0 || m.dashT > 0) f |= 8;
      ms.push([m.id, Math.round(m.x), Math.round(m.y), Math.ceil(Math.max(0, m.hp)), m.maxHp, f, Math.round(m.dir * 100) / 100, statusList(m.status)]);
    }
    const pr = this.projectiles.map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.kind, p.el, Math.round(Math.atan2(p.vy, p.vx) * 100) / 100]);
    const ev = this.events;
    this.events = [];
    return { tick: this.tick, floor: this.floor, mapVersion: this.mapVersion, p: ps, m: ms, pr, ev };
  }

  privateState(id) {
    const p = this.players.get(id);
    if (!p) return null;
    return {
      cd: { atk: +p.cd.atk.toFixed(2), s1: +p.cd.s1.toFixed(2), s2: +p.cd.s2.toFixed(2), dodge: +p.cd.dodge.toFixed(2) },
      potions: p.potions - p.potionsUsed, charms: p.charms - p.charmsUsed,
      loot: p.loot.materials.length, gold: p.loot.gold, kills: p.kills.length,
      escaped: p.escaped, lost: p.lost,
    };
  }

  /** ランの結果（ワールドに渡す） */
  resultOf(id) {
    const p = this.players.get(id);
    if (!p) return null;
    return {
      escaped: p.escaped, materials: p.loot.materials, gold: p.loot.gold, deepest: p.deepest,
      potionsUsed: p.potionsUsed, charmsUsed: p.charmsUsed, kills: p.kills,
    };
  }
}

function statusList(st) {
  const k = Object.keys(st);
  return k.length ? k.join(',') : '';
}
