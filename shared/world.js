// ワールドの状態と操作。サーバーとオフラインモードの両方で同じものを使う。
// 状態はすべてJSONで保存できる形にしている。
import { Rng, uid } from './rng.js';
import { createEcosystem, stepEcosystem, recordKill, aliveSpecies, areaById, defeatApex, AREAS } from './ecosystem.js';
import { craft, starterEquipment, materialPrice, materialLabel, SHOP, expToNext } from './items.js';
import { validateName, validatePlayerName } from './names.js';

export const MAX_INVENTORY = 60;
export const MAX_EQUIPMENT = 30;

export class World {
  constructor(state) {
    this.state = state || { version: 1, eco: createEcosystem(), players: {}, market: [], news: [], ticket: 0 };
    this.rng = new Rng(`${this.state.eco.seed}:world:${Date.now()}`);
  }

  get eco() { return this.state.eco; }

  // ---- プレイヤー ----
  createPlayer(name) {
    const err = validatePlayerName(name);
    if (err) return { error: err };
    const id = uid(this.rng, 'p');
    const eq = starterEquipment(this.rng);
    const p = {
      id, name: name.trim(), token: uid(this.rng, 't') + uid(this.rng, ''),
      level: 1, exp: 0, gold: 50, potions: 3, charms: 0,
      materials: [], equipment: eq,
      equipped: { weapon: eq[0].id, armor: eq[1].id, acc1: null, acc2: null },
      stats: { kills: 0, runs: 0, escapes: 0, deepest: 0, discoveries: 0 },
      namingRights: [],
      createdAt: Date.now(),
    };
    this.state.players[id] = p;
    return { player: p };
  }

  playerByToken(token) {
    return Object.values(this.state.players).find((p) => p.token === token) || null;
  }

  /** クライアントに送るプレイヤー情報（トークンは含めない） */
  publicPlayer(p) {
    const { token, ...rest } = p;
    return rest;
  }

  // ---- 装備・工房 ----
  craft(pid, recipe, materialIds, weaponType) {
    const p = this.state.players[pid];
    if (!p) return { error: 'プレイヤーが見つかりません' };
    if (p.equipment.length >= MAX_EQUIPMENT) return { error: '装備がいっぱいです。売るか捨ててください' };
    const mats = materialIds.map((id) => p.materials.find((m) => m.id === id));
    if (mats.some((m) => !m) || new Set(materialIds).size !== materialIds.length) return { error: '素材が見つかりません' };
    const res = craft(this.rng, recipe, mats, weaponType);
    if (res.error) return res;
    p.materials = p.materials.filter((m) => !materialIds.includes(m.id));
    p.equipment.push(res.item);
    return { item: res.item };
  }

  equip(pid, itemId, slot) {
    const p = this.state.players[pid];
    const it = p?.equipment.find((e) => e.id === itemId);
    if (!it) return { error: '装備が見つかりません' };
    let target = it.slot;
    if (it.slot === 'acc') target = slot === 'acc2' ? 'acc2' : 'acc1';
    for (const s of ['acc1', 'acc2']) if (p.equipped[s] === itemId) p.equipped[s] = null;
    p.equipped[target] = itemId;
    return { ok: true };
  }

  unequip(pid, slot) {
    const p = this.state.players[pid];
    if (!p || slot === 'weapon' || slot === 'armor') return { error: '武器と防具は外せません。別の装備に付け替えてください' };
    p.equipped[slot] = null;
    return { ok: true };
  }

  discardEquipment(pid, itemId) {
    const p = this.state.players[pid];
    if (!p) return { error: 'プレイヤーが見つかりません' };
    if (Object.values(p.equipped).includes(itemId)) return { error: '装備中のものは捨てられません' };
    p.equipment = p.equipment.filter((e) => e.id !== itemId);
    return { ok: true };
  }

  sellMaterials(pid, ids) {
    const p = this.state.players[pid];
    if (!p) return { error: 'プレイヤーが見つかりません' };
    let gold = 0;
    p.materials = p.materials.filter((m) => {
      if (!ids.includes(m.id)) return true;
      gold += materialPrice(m);
      return false;
    });
    p.gold += gold;
    return { gold };
  }

  buy(pid, key, count = 1) {
    const p = this.state.players[pid];
    const item = SHOP[key];
    if (!p || !item) return { error: '品物が見つかりません' };
    const cost = item.price * count;
    if (p.gold < cost) return { error: 'お金が足りません' };
    p.gold -= cost;
    if (key === 'potion') p.potions += count;
    if (key === 'charm') p.charms += count;
    return { ok: true };
  }

  // ---- 取引所 ----
  marketList(pid, kind, id, price) {
    const p = this.state.players[pid];
    if (!p) return { error: 'プレイヤーが見つかりません' };
    price = Math.floor(Number(price));
    if (!(price >= 1 && price <= 999999)) return { error: '値段は1〜999999で入力してください' };
    let item;
    if (kind === 'material') {
      item = p.materials.find((m) => m.id === id);
      if (item) p.materials = p.materials.filter((m) => m.id !== id);
    } else {
      if (Object.values(p.equipped).includes(id)) return { error: '装備中のものは出品できません' };
      item = p.equipment.find((e) => e.id === id);
      if (item) p.equipment = p.equipment.filter((e) => e.id !== id);
    }
    if (!item) return { error: '出品するものが見つかりません' };
    const listing = { id: uid(this.rng, 'l'), seller: pid, sellerName: p.name, kind, item, price, at: Date.now() };
    this.state.market.push(listing);
    return { listing };
  }

  marketBuy(pid, listingId) {
    const p = this.state.players[pid];
    const l = this.state.market.find((x) => x.id === listingId);
    if (!p || !l) return { error: 'その出品はもうありません' };
    if (l.seller === pid) return this.marketCancel(pid, listingId);
    if (p.gold < l.price) return { error: 'お金が足りません' };
    if (l.kind === 'material' && p.materials.length >= MAX_INVENTORY) return { error: '素材がいっぱいです' };
    if (l.kind !== 'material' && p.equipment.length >= MAX_EQUIPMENT) return { error: '装備がいっぱいです' };
    p.gold -= l.price;
    const seller = this.state.players[l.seller];
    if (seller) seller.gold += l.price;
    (l.kind === 'material' ? p.materials : p.equipment).push(l.item);
    this.state.market = this.state.market.filter((x) => x.id !== listingId);
    return { ok: true, sellerId: l.seller };
  }

  marketCancel(pid, listingId) {
    const l = this.state.market.find((x) => x.id === listingId && x.seller === pid);
    const p = this.state.players[pid];
    if (!l || !p) return { error: '取り消せる出品がありません' };
    (l.kind === 'material' ? p.materials : p.equipment).push(l.item);
    this.state.market = this.state.market.filter((x) => x.id !== listingId);
    return { ok: true };
  }

  // ---- ダンジョンの結果 ----
  /** ダンジョン内で倒した記録を生態系に送る。初発見なら命名権を返す */
  reportKills(pid, kills) {
    const p = this.state.players[pid];
    const rights = [];
    for (const k of kills) {
      const sp = this.eco.species[k.speciesId];
      if (!sp) continue;
      recordKill(this.eco, k.speciesId, k.element || 'none', 1);
      if (p) {
        p.stats.kills++;
        p.exp += k.exp || 3;
        if (!sp.discoveredBy) {
          sp.discoveredBy = p.name;
          p.stats.discoveries++;
          if (!sp.named && !p.namingRights.includes(sp.id)) { p.namingRights.push(sp.id); rights.push(sp.id); }
        }
      }
    }
    if (p) while (p.exp >= expToNext(p.level)) { p.exp -= expToNext(p.level); p.level++; }
    return { rights };
  }

  /** ラン終了。脱出なら戦利品を持ち帰り、全滅なら失う */
  finishRun(pid, { escaped, materials = [], gold = 0, deepest = 0, potionsUsed = 0, charmsUsed = 0 }) {
    const p = this.state.players[pid];
    if (!p) return { error: 'プレイヤーが見つかりません' };
    p.stats.runs++;
    p.stats.deepest = Math.max(p.stats.deepest, deepest);
    p.potions = Math.max(0, p.potions - potionsUsed);
    p.charms = Math.max(0, p.charms - charmsUsed);
    if (!escaped) return { kept: 0, lost: materials.length };
    p.stats.escapes++;
    const room = Math.max(0, MAX_INVENTORY - p.materials.length);
    const kept = materials.slice(0, room);
    p.materials.push(...kept);
    p.gold += gold;
    const sold = materials.slice(room);
    for (const m of sold) p.gold += materialPrice(m);
    return { kept: kept.length, autoSold: sold.length };
  }

  nameSpecies(pid, speciesId, name) {
    const p = this.state.players[pid];
    const sp = this.eco.species[speciesId];
    if (!p || !sp) return { error: '種が見つかりません' };
    if (!p.namingRights.includes(speciesId)) return { error: 'この種の命名権がありません' };
    if (sp.named) return { error: 'すでに名前が付いています' };
    const err = validateName(name);
    if (err) return { error: err };
    sp.name = name.trim();
    sp.named = true;
    sp.namedBy = p.name;
    p.namingRights = p.namingRights.filter((x) => x !== speciesId);
    const news = { gen: this.eco.generation, kind: 'named', text: `${p.name}が新種を「${sp.name}」と名付けた`, speciesId, at: Date.now() };
    this.pushNews([news]);
    return { ok: true, news };
  }

  // ---- 生態系とニュース ----
  stepEcosystem() {
    const news = stepEcosystem(this.eco).map((n) => ({ ...n, at: Date.now() }));
    this.pushNews(news);
    return news;
  }

  defeatApex(contributors) {
    const apex = this.eco.apex;
    if (!apex || apex.defeated) return null;
    const n = defeatApex(this.eco);
    const news = { ...n, at: Date.now(), text: `${n.text}（参加 ${contributors.length}人）` };
    this.pushNews([news]);
    return news;
  }

  pushNews(list) {
    this.state.news.push(...list);
    if (this.state.news.length > 120) this.state.news.splice(0, this.state.news.length - 120);
  }

  codex() {
    return Object.values(this.eco.species).map((s) => ({
      id: s.id, name: s.name, named: s.named, namedBy: s.namedBy, discoveredBy: s.discoveredBy,
      area: s.area, areaName: areaById(s.area)?.name, parentId: s.parentId,
      createdGen: s.createdGen, extinctGen: s.extinctGen, pop: Math.round(s.pop),
      proto: s.proto, sample: s.pool[0] || s.proto,
    }));
  }

  worldSummary() {
    return {
      generation: this.eco.generation,
      areas: AREAS.map((a) => ({ ...a, species: aliveSpecies(this.eco, a.id).length, pop: Math.round(aliveSpecies(this.eco, a.id).reduce((s, x) => s + x.pop, 0)) })),
      apex: this.eco.apex && !this.eco.apex.defeated ? { id: this.eco.apex.id, name: this.eco.apex.name, area: this.eco.apex.area, hp: this.eco.apex.hp, maxHp: this.eco.apex.maxHp, endGen: this.eco.apex.endGen } : null,
    };
  }
}

export { materialLabel };
