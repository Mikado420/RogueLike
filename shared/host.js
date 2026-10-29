// ゲームの進行役。セッション（接続）・町・パーティ・ダンジョン・レイド・生態系の時計をまとめて扱う。
// サーバーでは WebSocket の接続ごとに、オフラインではブラウザ内の1接続として同じものを使う。
// 通信の約束事は docs/PROTOCOL.md を参照。
import { World } from './world.js';
import { DungeonSim, TICK } from './sim.js';
import { areaSnapshot, areaById, AREAS } from './ecosystem.js';
import { playerStats } from './items.js';
import { Rng, uid } from './rng.js';

export const MAX_PARTY = 4;
export const MAX_RAID = 16;

export class GameHost {
  /**
   * @param {World} world
   * @param {object} o
   * @param {number} o.ecoIntervalSec  生態系を1世代進める間隔
   * @param {() => void} [o.onChange]  保存が必要になったとき
   * @param {boolean} [o.offline]
   */
  constructor(world, { ecoIntervalSec = 600, onChange = () => {}, offline = false } = {}) {
    this.world = world;
    this.ecoIntervalSec = ecoIntervalSec;
    this.onChange = onChange;
    this.offline = offline;
    this.sessions = new Map();
    this.parties = new Map();
    this.instances = new Map();
    this.raid = null;
    this.rng = new Rng(`host:${Date.now()}`);
    this.tickCount = 0;
    this.nextEcoAt = Date.now() + ecoIntervalSec * 1000;
  }

  // ---------- 接続 ----------
  connect(sid, send) {
    this.sessions.set(sid, { id: sid, send, playerId: null, scene: 'title', town: { x: 160, y: 150, dir: 0 }, partyId: null, instanceId: null, lastChat: 0 });
  }

  disconnect(sid) {
    const s = this.sessions.get(sid);
    if (!s) return;
    if (s.instanceId) {
      const inst = this.instances.get(s.instanceId) || (this.raid?.id === s.instanceId ? this.raid : null);
      const p = inst?.sim.players.get(s.playerId);
      if (p && !p.escaped) p.lost = true; // 切断はその場で倒れた扱い
      if (inst) this.finalizePlayer(inst, s.playerId, true);
    }
    this.leaveParty(s);
    this.sessions.delete(sid);
  }

  send(s, msg) { try { s.send(msg); } catch { /* 送れなくても進行は止めない */ } }
  sendTo(pid, msg) { for (const s of this.sessions.values()) if (s.playerId === pid) this.send(s, msg); }
  broadcast(msg, filter = () => true) { for (const s of this.sessions.values()) if (s.playerId && filter(s)) this.send(s, msg); }
  error(s, text) { this.send(s, { type: 'error', text }); }
  toast(s, text) { this.send(s, { type: 'toast', text }); }
  player(s) { return s.playerId ? this.world.state.players[s.playerId] : null; }

  sendProfile(s) {
    const p = this.player(s);
    if (p) this.send(s, { type: 'profile', player: this.world.publicPlayer(p) });
  }

  // ---------- メッセージ ----------
  handle(sid, msg) {
    const s = this.sessions.get(sid);
    if (!s || !msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hello') return this.onHello(s, msg);
    if (!s.playerId) return this.error(s, '先にログインしてください');
    const w = this.world;
    const pid = s.playerId;
    const result = (r, okText) => {
      if (r?.error) return this.error(s, r.error);
      if (okText) this.toast(s, okText);
      this.sendProfile(s);
      this.onChange();
    };
    switch (msg.type) {
      case 'town:move': {
        if (s.scene !== 'town') return;
        const x = +msg.x, y = +msg.y;
        if (isFinite(x) && isFinite(y)) s.town = { x: clampN(x, 0, 2000), y: clampN(y, 0, 2000), dir: +msg.dir || 0 };
        return;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 80).trim();
        if (!text || Date.now() - s.lastChat < 800) return;
        s.lastChat = Date.now();
        const p = this.player(s);
        return this.broadcast({ type: 'chat', from: p.name, pid, text, party: !!msg.party }, (o) => !msg.party || (o.partyId && o.partyId === s.partyId));
      }
      case 'input': {
        const inst = this.instanceOf(s);
        if (inst) inst.sim.setInput(pid, sanitizeInput(msg));
        return;
      }
      case 'party:create': return this.createParty(s);
      case 'party:join': return this.joinParty(s, String(msg.code || '').toUpperCase());
      case 'party:leave': this.leaveParty(s); return this.sendParty(s);
      case 'party:list': return this.send(s, { type: 'parties', list: this.partyList() });
      case 'dungeon:start': return this.startDungeon(s, msg.area);
      case 'raid:join': return this.joinRaid(s);
      case 'craft': return result(w.craft(pid, msg.recipe, Array.isArray(msg.ids) ? msg.ids.map(String) : [], msg.weaponType), '装備を作りました');
      case 'equip': return result(w.equip(pid, String(msg.id), msg.slot));
      case 'unequip': return result(w.unequip(pid, msg.slot));
      case 'discard': return result(w.discardEquipment(pid, String(msg.id)), '捨てました');
      case 'sell': {
        const r = w.sellMaterials(pid, Array.isArray(msg.ids) ? msg.ids.map(String) : []);
        return result(r, r.gold ? `${r.gold}Gで売りました` : null);
      }
      case 'buy': return result(w.buy(pid, msg.key, Math.max(1, Math.min(20, msg.count | 0 || 1))), '買いました');
      case 'market:get': return this.send(s, { type: 'market', list: w.state.market });
      case 'market:list': {
        const r = w.marketList(pid, msg.kind === 'material' ? 'material' : 'equipment', String(msg.id), msg.price);
        result(r, '出品しました');
        return this.broadcast({ type: 'market', list: w.state.market });
      }
      case 'market:buy': {
        const r = w.marketBuy(pid, String(msg.id));
        result(r, '購入しました');
        if (r.sellerId) { this.sendTo(r.sellerId, { type: 'toast', text: '出品したものが売れました' }); for (const o of this.sessions.values()) if (o.playerId === r.sellerId) this.sendProfile(o); }
        return this.broadcast({ type: 'market', list: w.state.market });
      }
      case 'market:cancel': {
        result(w.marketCancel(pid, String(msg.id)), '出品を取り消しました');
        return this.broadcast({ type: 'market', list: w.state.market });
      }
      case 'codex:get': return this.send(s, { type: 'codex', list: w.codex(), generation: w.eco.generation });
      case 'news:get': return this.send(s, { type: 'news', items: w.state.news.slice(-60), world: w.worldSummary(), nextEcoIn: this.nextEcoIn() });
      case 'name:species': {
        const r = w.nameSpecies(pid, String(msg.speciesId), msg.name);
        if (r.error) return this.error(s, r.error);
        this.sendProfile(s);
        this.broadcast({ type: 'news', items: [r.news], world: w.worldSummary(), nextEcoIn: this.nextEcoIn() });
        this.onChange();
        return;
      }
      case 'eco:step': {
        // オフライン用：生態系を手動で進める
        if (!this.offline) return;
        return this.stepEco();
      }
      default: return;
    }
  }

  onHello(s, msg) {
    let p = msg.token ? this.world.playerByToken(String(msg.token)) : null;
    if (!p) {
      if (!msg.name) return this.send(s, { type: 'needName' });
      const r = this.world.createPlayer(String(msg.name));
      if (r.error) return this.error(s, r.error);
      p = r.player;
      this.onChange();
    }
    // 同じプレイヤーの古い接続を切る
    for (const o of this.sessions.values()) if (o !== s && o.playerId === p.id) this.disconnect(o.id);
    s.playerId = p.id;
    s.scene = 'town';
    this.send(s, {
      type: 'welcome', token: p.token, player: this.world.publicPlayer(p),
      world: this.world.worldSummary(), news: this.world.state.news.slice(-30), areas: AREAS, offline: this.offline, nextEcoIn: this.nextEcoIn(),
    });
    for (const sid of p.namingRights) this.sendNameRight(s, sid);
  }

  sendNameRight(s, speciesId) {
    const sp = this.world.eco.species[speciesId];
    if (sp && !sp.named) this.send(s, { type: 'nameRight', speciesId, label: sp.name, area: areaById(sp.area)?.name, sample: sp.pool[0] || sp.proto });
  }

  nextEcoIn() { return Math.max(0, Math.round((this.nextEcoAt - Date.now()) / 1000)); }

  // ---------- パーティ ----------
  partyList() {
    return [...this.parties.values()].filter((p) => !p.inDungeon && p.members.length < MAX_PARTY).map((p) => this.partyView(p));
  }
  partyView(p) {
    return { id: p.id, code: p.code, leader: p.leader, inDungeon: !!p.inDungeon, members: p.members.map((id) => ({ id, name: this.world.state.players[id]?.name || '?' })) };
  }
  sendParty(s) {
    const party = s.partyId ? this.parties.get(s.partyId) : null;
    this.send(s, { type: 'party', party: party ? this.partyView(party) : null });
  }
  notifyParty(party) {
    for (const o of this.sessions.values()) if (o.partyId === party.id) this.sendParty(o);
  }

  createParty(s) {
    if (s.scene !== 'town') return this.error(s, '町にいるときだけパーティを作れます');
    this.leaveParty(s);
    let code;
    do code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[this.rng.int(0, 23)]).join(''); while ([...this.parties.values()].some((p) => p.code === code));
    const party = { id: uid(this.rng, 'pt'), code, leader: s.playerId, members: [s.playerId], inDungeon: false };
    this.parties.set(party.id, party);
    s.partyId = party.id;
    this.notifyParty(party);
  }

  joinParty(s, code) {
    if (s.scene !== 'town') return this.error(s, '町にいるときだけ参加できます');
    const party = [...this.parties.values()].find((p) => p.code === code);
    if (!party) return this.error(s, 'そのパーティは見つかりません');
    if (party.inDungeon) return this.error(s, 'そのパーティはダンジョンにいます');
    if (party.members.length >= MAX_PARTY) return this.error(s, 'パーティは満員です（最大4人）');
    this.leaveParty(s);
    party.members.push(s.playerId);
    s.partyId = party.id;
    this.notifyParty(party);
  }

  leaveParty(s) {
    const party = s.partyId ? this.parties.get(s.partyId) : null;
    s.partyId = null;
    if (!party) return;
    party.members = party.members.filter((id) => id !== s.playerId);
    if (!party.members.length) { this.parties.delete(party.id); return; }
    if (party.leader === s.playerId) party.leader = party.members[0];
    this.notifyParty(party);
  }

  // ---------- ダンジョン ----------
  instanceOf(s) {
    if (!s.instanceId) return null;
    if (this.raid && this.raid.id === s.instanceId) return this.raid;
    return this.instances.get(s.instanceId) || null;
  }

  startDungeon(s, areaId) {
    const area = areaById(areaId);
    if (!area) return this.error(s, 'エリアを選んでください');
    if (s.scene !== 'town') return;
    const party = s.partyId ? this.parties.get(s.partyId) : null;
    if (party && party.leader !== s.playerId) return this.error(s, '出発できるのはリーダーだけです');
    const members = party ? party.members : [s.playerId];
    const memberSessions = members.map((id) => [...this.sessions.values()].find((o) => o.playerId === id)).filter((o) => o && o.scene === 'town');
    const world = this.world;
    const id = uid(this.rng, 'd');
    const sim = new DungeonSim({ seed: `${id}:${world.eco.generation}`, area, snapshotFn: () => areaSnapshot(world.eco, area.id) });
    const inst = { id, sim, area, partyId: party?.id || null, members: memberSessions.map((o) => o.playerId), finalized: new Set(), sentVersion: {} };
    memberSessions.forEach((o, i) => {
      const p = this.player(o);
      sim.addPlayer({ id: p.id, name: p.name, stats: playerStats(p), potions: p.potions, charms: p.charms, color: i });
      o.scene = 'dungeon';
      o.instanceId = id;
    });
    sim.start();
    if (party) party.inDungeon = true;
    this.instances.set(id, inst);
    for (const o of memberSessions) this.send(o, { type: 'dungeon:enter', area, raid: false });
  }

  joinRaid(s) {
    if (s.scene !== 'town') return;
    const apex = this.world.eco.apex;
    if (!apex || apex.defeated) return this.error(s, 'いまはワールドレイドが開かれていません');
    if (this.raid && this.raid.apexId !== apex.id) this.raid = null;
    if (!this.raid) {
      const area = areaById(apex.area);
      const world = this.world;
      const id = uid(this.rng, 'raid');
      const sim = new DungeonSim({ seed: `${apex.id}`, area, snapshotFn: () => areaSnapshot(world.eco, area.id), apex });
      sim.start();
      this.raid = { id, sim, area, apexId: apex.id, raid: true, members: [], finalized: new Set(), sentVersion: {} };
    }
    const r = this.raid;
    if (r.sim.activePlayers().length >= MAX_RAID) return this.error(s, 'レイドは満員です');
    const p = this.player(s);
    if (r.sim.players.has(p.id)) r.sim.removePlayer(p.id);
    r.finalized.delete(p.id);
    r.sim.addPlayer({ id: p.id, name: p.name, stats: playerStats(p), potions: p.potions, charms: p.charms, color: r.sim.players.size % 8 });
    r.members.push(p.id);
    s.scene = 'dungeon';
    s.instanceId = r.id;
    this.leaveParty(s);
    delete r.sentVersion[p.id];
    this.send(s, { type: 'dungeon:enter', area: r.area, raid: true, apex: { name: apex.name } });
  }

  finalizePlayer(inst, pid, silent = false) {
    if (inst.finalized.has(pid)) return;
    const res = inst.sim.resultOf(pid);
    if (!res) return;
    inst.finalized.add(pid);
    const w = this.world;
    const { rights } = w.reportKills(pid, res.kills);
    const out = w.finishRun(pid, res);
    this.onChange();
    const s = [...this.sessions.values()].find((o) => o.playerId === pid);
    if (s && !silent) {
      s.scene = 'town';
      s.instanceId = null;
      this.send(s, {
        type: 'dungeon:end', escaped: res.escaped, floor: inst.sim.floor, kills: res.kills.length,
        materials: res.escaped ? res.materials.length : 0, lost: res.escaped ? 0 : res.materials.length, gold: res.escaped ? res.gold : 0,
        autoSold: out.autoSold || 0,
      });
      this.sendProfile(s);
      for (const sid of rights) this.sendNameRight(s, sid);
    }
  }

  // ---------- 時間経過 ----------
  stepEco() {
    const news = this.world.stepEcosystem();
    this.nextEcoAt = Date.now() + this.ecoIntervalSec * 1000;
    this.broadcast({ type: 'news', items: news, world: this.world.worldSummary(), nextEcoIn: this.nextEcoIn(), stepped: true });
    this.onChange();
    return news;
  }

  /** 1/20秒ごとに呼ぶ */
  tick() {
    this.tickCount++;
    const all = [...this.instances.values()];
    if (this.raid) all.push(this.raid);
    for (const inst of all) this.tickInstance(inst);

    if (this.tickCount % 2 === 0) {
      const townies = [...this.sessions.values()].filter((s) => s.scene === 'town' && s.playerId);
      if (townies.length) {
        const list = townies.map((s) => ({ id: s.playerId, name: this.player(s)?.name, x: Math.round(s.town.x), y: Math.round(s.town.y), dir: s.town.dir, party: s.partyId }));
        for (const s of townies) this.send(s, { type: 'town:state', players: list });
      }
    }
    if (Date.now() >= this.nextEcoAt) this.stepEco();
  }

  tickInstance(inst) {
    const sim = inst.sim;
    sim.step(TICK);
    const snap = sim.snapshot();
    for (const pid of sim.players.keys()) {
      if (inst.finalized.has(pid)) continue;
      const s = [...this.sessions.values()].find((o) => o.playerId === pid && o.instanceId === inst.id);
      if (!s) continue;
      if (inst.sentVersion[pid] !== sim.mapVersion) {
        inst.sentVersion[pid] = sim.mapVersion;
        this.send(s, { type: 'dungeon:floor', info: sim.floorInfo() });
      }
      this.send(s, { type: 'dungeon:snap', snap, me: sim.privateState(pid) });
    }
    if (inst.raid && sim.bossDefeated && !inst.bossNewsSent) {
      inst.bossNewsSent = true;
      const contributors = [...sim.players.values()].filter((p) => p.contrib > 0).map((p) => p.name);
      const news = this.world.defeatApex(contributors);
      if (news) this.broadcast({ type: 'news', items: [news], world: this.world.worldSummary(), nextEcoIn: this.nextEcoIn() });
    }
    for (const p of sim.players.values()) if ((p.escaped || p.lost) && !inst.finalized.has(p.id)) this.finalizePlayer(inst, p.id);
    if (sim.finished || sim.activePlayers().length === 0) {
      for (const pid of sim.players.keys()) this.finalizePlayer(inst, pid);
      if (inst.raid) { if (this.raid === inst) this.raid = null; }
      else {
        this.instances.delete(inst.id);
        const party = inst.partyId ? this.parties.get(inst.partyId) : null;
        if (party) { party.inDungeon = false; this.notifyParty(party); }
      }
    }
  }
}

function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sanitizeInput(m) {
  const n = (v) => (isFinite(+v) ? Math.max(-1, Math.min(1, +v)) : 0);
  return {
    mx: n(m.mx), my: n(m.my), aim: isFinite(+m.aim) ? +m.aim : undefined,
    atk: !!m.atk, s1: !!m.s1, s2: !!m.s2, dodge: !!m.dodge, act: !!m.act, potion: !!m.potion,
  };
}
