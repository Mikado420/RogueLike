import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  CONTENT, type Drop, type GameEvent, type Item, type Monster, type Player, type Projectile, type World,
} from '../../shared/src';
import { depth, isoRadii, setTerrain, terrainHeight, TILE_H, TILE_W, toScreen, toScreenH } from './iso';
import { makeBagIcon, makePlayerSprite, makeSprite, makeWeaponGlyph } from './sprites';
import { makeMonsterSprite } from './monsters';
import { drawIsoShape, Effects } from './fx';
import { buildingTile, shade } from './buildings';
import { TownLife } from './townlife';
import { chargeLevel, rarityRank, shownLook, type GameMap } from '../../shared/src';
import { BODY_COLORS, ELEMENT_COLOR, hex, HAIR_COLORS, lookInfo, rarityColorNum, statusColor } from './colors';
import type { Settings } from './settings';
import type { Sfx } from './audio';

interface ActorView {
  root: Container;
  body: Container;
  lookKey?: string;
  weapon?: Graphics;
  weaponType?: string;
  bar?: Graphics;
  aura?: Graphics;
  prev: { x: number; y: number };
  cur: { x: number; y: number };
  hurt: number;
  float: number;
  stall?: Text;
  stallKey?: string;
}

interface DropView { root: Container; glow: Graphics; pillar?: Graphics; icon: Container; t: number }
interface ProjView { root: Container; prev: { x: number; y: number }; cur: { x: number; y: number } }

const FONT = '"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif';

/** 落ちている装備の見た目 */
export function itemIconName(it: Item): string {
  if (it.slot === 'weapon') {
    const map: Record<string, string> = {
      bow: 'item_bow', staff: 'item_staff', instrument: 'item_lute', spear: 'item_spear', knuckles: 'item_fist',
      gun: 'item_gun', scythe: 'item_scythe',
    };
    return map[it.kind] ?? 'item_sword';
  }
  if (it.slot === 'accessory') return 'item_ring';
  if (it.slot === 'head') return 'item_hat';
  if (it.slot === 'sub') return it.kind === 'shield' ? 'item_shield' : it.kind === 'grimoire' ? 'item_book' : 'item_ring';
  return 'item_armor';
}

export class WorldView {
  readonly camera = new Container();
  private ground = new Graphics();
  private telegraphs = new Graphics();
  private entities = new Container();
  readonly fx = new Effects();
  private actors = new Map<number, ActorView>();
  private projectiles = new Map<number, ProjView>();
  private drops = new Map<number, DropView>();
  private npcs = new Map<number, Container>();
  private nodes = new Map<number, Container>();
  private camPos = { x: 0, y: 0 };
  private time = 0;
  private areaRef: unknown = null;
  /** 煙突のてっぺん（画面座標）。煙を出す */
  private chimneys: { x: number; y: number }[] = [];
  /** 街のにぎわい（NPC の動き・煙・通行人） */
  private life: TownLife | null = null;
  private npcPos = new Map<number, { x: number; y: number; sprite: string }>();

  constructor(private app: Application, private world: World, public myId: number, private settings: Settings, private sfx: Sfx) {
    app.stage.addChild(this.camera);
    this.entities.sortableChildren = true;
    this.camera.addChild(this.ground, this.fx.groundLayer, this.telegraphs, this.entities, this.fx.layer);
    this.setArea();
  }

  private me(): Player {
    return this.world.players.find((p) => p.id === this.myId)!;
  }

  /** エリアが変わったら地面と置物を作り直す */
  setArea() {
    this.areaRef = this.world.area.map;
    for (const c of [...this.entities.children]) c.destroy({ children: true });
    this.actors.clear(); this.projectiles.clear(); this.drops.clear(); this.npcs.clear(); this.nodes.clear();
    this.ground.clear();
    const m = this.world.area.map;
    setTerrain(m.heights, m.width, m.height);
    const g = this.ground;
    const hw = TILE_W / 2, hh = TILE_H / 2;
    for (let j = 0; j < m.height; j++) {
      for (let i = 0; i < m.width; i++) {
        const k = j * m.width + i;
        const tile = m.tiles[k];
        const td = CONTENT.tiles[tile];
        const p = toScreen(i, j);
        drawGroundTile(g, m, i, j);
        if (td?.detail) tileDetail(g, td.detail, p.x, p.y, groundColor(m, i, j), i, j, (u, v) => terrainHeight(i + u, j + v));
        const sp = m.sprites[k];
        if (sp) {
          const s = makeSprite(sp);
          const c2 = toScreenH(i + 0.5, j + 0.5);
          s.x = c2.x; s.y = c2.y;
          s.zIndex = depth(i + 0.5, j + 0.5);
          this.entities.addChild(s);
        }
      }
    }
    // 建物（1 マスずつの部品。屋根は建物全体でつながる）
    this.chimneys = [];
    for (const b of m.buildings ?? []) {
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) {
        const piece = buildingTile(b, i, j);
        const c2 = toScreen(i + 0.5, j + 0.5);
        piece.root.x = c2.x; piece.root.y = c2.y;
        piece.root.zIndex = depth(i + 0.5, j + 0.5);
        this.entities.addChild(piece.root);
        if (piece.smoke) this.chimneys.push(piece.smoke);
      }
    }
    // 外枠の線は引かない（外周がせり上がるので、平らな線は地形を横切ってしまう）
    // 出口の光
    for (const e of this.world.area.exits) {
      for (let j = e.rect[1]; j < e.rect[3]; j++) for (let i = e.rect[0]; i < e.rect[2]; i++) {
        const p = toScreen(i, j);
        g.poly([p.x, p.y, p.x + hw, p.y + hh, p.x, p.y + 2 * hh, p.x - hw, p.y + hh]).fill({ color: 0x9fe8ff, alpha: 0.35 });
      }
      const cx = (e.rect[0] + e.rect[2]) / 2, cy = (e.rect[1] + e.rect[3]) / 2;
      const label = new Text({ text: CONTENT.areas[e.to]?.name ?? '', style: { fontFamily: FONT, fontSize: 12, fontWeight: '800', fill: 0x9fe8ff, stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5, 1);
      const lp = toScreenH(cx, cy);
      label.x = lp.x; label.y = lp.y - 6;
      label.zIndex = 1e6;
      this.entities.addChild(label);
    }
    // NPC
    this.npcPos.clear();
    for (const n of this.world.area.npcs) this.addNpc(n);
    this.life = new TownLife(this.entities, m, this.chimneys, this.world.area.type === 'town');
    for (const n of this.world.area.nodes) this.addNode(n);
    const me = this.me();
    if (me) { const s = toScreenH(me.x, me.y); this.camPos = { x: s.x, y: s.y }; }
  }

  private addNode(n: { id: number; type: string; x: number; y: number }) {
    const def = CONTENT.gathering.nodeTypes[n.type];
    if (!def) return;
    const root = makeSprite(def.sprite);
    const s = toScreenH(n.x, n.y);
    root.x = s.x; root.y = s.y;
    root.zIndex = depth(n.x, n.y);
    this.entities.addChild(root);
    this.nodes.set(n.id, root);
  }

  private addNpc(n: { id: number; npc: string; x: number; y: number }) {
    const def = CONTENT.npcs[n.npc];
    if (!def) return;
    const root = new Container();
    root.addChild(makeSprite(def.sprite));
    const label = new Text({ text: def.name, style: { fontFamily: FONT, fontSize: 12, fontWeight: '800', fill: hex(def.color), stroke: { color: 0x000000, width: 3 } } });
    label.anchor.set(0.5, 1);
    label.y = -62;
    root.addChild(label);
    const s = toScreenH(n.x, n.y);
    root.x = s.x; root.y = s.y;
    root.zIndex = depth(n.x, n.y);
    this.entities.addChild(root);
    this.npcs.set(n.id, root);
    this.npcPos.set(n.id, { x: n.x, y: n.y, sprite: def.sprite });
  }

  /** step の前に呼ぶ。補間用に今の位置を覚える */
  capturePrev() {
    for (const p of this.world.players) { const v = this.actors.get(p.id); if (v) v.prev = { x: p.x, y: p.y }; }
    for (const m of this.world.area.monsters) { const v = this.actors.get(m.id); if (v) v.prev = { x: m.x, y: m.y }; }
    for (const pr of this.world.area.projectiles) { const v = this.projectiles.get(pr.id); if (v) v.prev = { x: pr.x, y: pr.y }; }
  }

  handleEvents(events: GameEvent[]) {
    const mode = this.settings.damageDisplay;
    for (const e of events) {
      switch (e.type) {
        case 'areaChanged':
          if (e.playerId === this.myId && this.world.area.map !== this.areaRef) this.setArea();
          break;
        case 'damage': {
          if (e.dot) {
            if (mode !== 'mine' || e.src === this.myId || e.tgt === this.myId) this.fx.dot(e.x, e.y, e.amount, e.toPlayer, ELEMENT_COLOR[e.element]);
            break;
          }
          if (mode !== 'mine' || e.src === this.myId) this.fx.damage(e, mode);
          if (e.src === this.myId && e.sweet) this.fx.text(e.x, e.y, CONTENT.text['hud.just'] ?? 'JUST', 0xffe14a);
          if (e.src === this.myId && e.back) this.fx.text(e.x, e.y, CONTENT.text['hud.back'] ?? 'BACK', 0xff9a5a);
          const col = e.toPlayer ? 0xff5050 : e.weak ? ELEMENT_COLOR[e.element] : e.crit ? 0xffd23a : 0xffffff;
          this.fx.spark(e.x, e.y, col);
          const v = this.actors.get(e.tgt);
          if (v) v.hurt = 0.15;
          if (e.crit && e.src === this.myId && this.settings.shake) this.fx.shake = Math.max(this.fx.shake, 6);
          if (e.tgt === this.myId) { this.sfx.play('hurt'); if (this.settings.shake) this.fx.shake = Math.max(this.fx.shake, 4); }
          else this.sfx.play(e.crit ? 'crit' : 'hit', e.src === this.myId ? 1 : 0.4);
          break;
        }
        case 'heal':
          if (e.tgt === this.myId) this.fx.text(e.x, e.y, `+${e.amount}`, 0x6fe39a);
          break;
        case 'evade':
          if (e.tgt === this.myId) { this.fx.text(e.x, e.y, e.block ? 'BLOCK' : 'MISS', 0x9fe8ff); this.sfx.play('evade'); }
          else if (e.block) this.fx.text(e.x, e.y, 'GUARD', 0xb0b8c8);
          else this.fx.text(e.x, e.y, 'MISS', 0xb0b8c8);
          break;
        case 'break': {
          const m = this.world.area.monsters.find((x) => x.id === e.id);
          if (m) { this.fx.bigText(m.x, m.y, CONTENT.text['hud.break'] ?? 'BREAK', 0xffd23a); this.fx.burst(m.x, m.y, 0xffd23a, m.r + 0.6, 0.35); }
          this.sfx.play('crit');
          if (this.settings.shake) this.fx.shake = Math.max(this.fx.shake, 7);
          break;
        }
        case 'attack': {
          if (e.src !== this.myId) {
            const m = this.world.area.monsters.find((x) => x.id === e.src);
            if (m && CONTENT.monsters[m.defId].boss) this.sfx.play('warn', 0.8);
            break;
          }
          if (e.skill) this.sfx.play('skill');
          else this.sfx.play(e.weapon === 'bow' || e.weapon === 'gun' ? 'shoot' : e.weapon === 'staff' || e.weapon === 'instrument' ? 'magic' : 'swing');
          break;
        }
        case 'impact': {
          const color = e.team === 0 ? (e.element === 'neutral' ? 0xdfefff : ELEMENT_COLOR[e.element]) : 0xff3a2a;
          this.fx.flashShape(e.x, e.y, e.shape, e.dir, color, e.team === 0 ? 0.28 : 0.5);
          if (e.team === 1 && e.shape.type === 'circle' && e.shape.radius >= 3) {
            this.sfx.play('quake');
            if (this.settings.shake) this.fx.shake = Math.max(this.fx.shake, 12);
          }
          break;
        }
        case 'explode':
          this.fx.burst(e.x, e.y, ELEMENT_COLOR[e.element], e.radius * 0.6, 0.35);
          this.sfx.play('explode', 0.7);
          break;
        case 'death':
          this.fx.burst(e.x, e.y, e.player ? 0xff4040 : 0xffffff, e.boss ? 2.5 : 0.8, e.boss ? 0.8 : 0.4);
          this.sfx.play('death', e.boss ? 1 : 0.6);
          if (e.boss && this.settings.shake) this.fx.shake = 16;
          break;
        case 'drop': {
          if (!e.rarity) break;
          const rd = CONTENT.rarities.defs[e.rarity];
          if (rd.sfx) this.sfx.play('legend');
          else if (rd.glow) this.sfx.play('dropRare');
          else this.sfx.play('drop', 0.6);
          break;
        }
        case 'pickup':
          if (e.playerId === this.myId) this.sfx.play('pickup');
          break;
        case 'dodge':
          if (e.id === this.myId) this.sfx.play('dodge');
          break;
        case 'say':
        case 'emote': {
          const a = this.world.players.find((p) => p.id === e.id);
          if (!a) break;
          const t = e.type === 'say' ? (e.text.length > 16 ? `${e.text.slice(0, 16)}…` : e.text) : CONTENT.social.chat.emotes.find((x) => x.id === e.emote)?.text ?? '';
          this.fx.text(a.x, a.y - 0.6, t, 0xffffff);
          break;
        }
        case 'respawn':
          if (e.id === this.myId) this.sfx.play('respawn');
          break;
        case 'enrage':
          this.sfx.play('enrage');
          if (this.settings.shake) this.fx.shake = 10;
          break;
        case 'equip':
          if (e.playerId === this.myId) this.sfx.play('equip');
          break;
        case 'reload':
          if (e.playerId === this.myId) this.sfx.play(e.done ? 'reloadDone' : 'reload', 0.6);
          break;
        case 'rhythm':
          if (e.playerId === this.myId) {
            const p = this.me();
            if (e.onBeat) { this.fx.burst(p.x, p.y, 0xff9ad8, 0.9, 0.25); this.sfx.play('note'); }
          }
          break;
        case 'proc':
          if (e.playerId === this.myId) { this.fx.text(e.x, e.y, e.name, 0xffb02e); this.sfx.play('skill', 0.5); }
          break;
        case 'refine':
          if (e.playerId === this.myId) this.sfx.play(e.success ? 'legend' : 'death', 0.7);
          break;
        case 'capture':
          if (e.playerId === this.myId) {
            this.fx.burst(e.x, e.y, e.success ? 0x9be04a : 0xc0a0ff, 1.0, 0.5);
            this.sfx.play(e.success ? 'legend' : 'evade');
          }
          break;
        case 'levelUp':
          if (e.playerId === this.myId) {
            const p = this.me();
            this.fx.burst(p.x, p.y, 0xffe14a, 1.6, 0.8);
            this.fx.bigText(p.x, p.y, CONTENT.text['hud.levelUp'] ?? 'LEVEL UP', 0xffe14a);
            this.sfx.play('legend');
          }
          break;
      }
    }
  }

  private actorView(a: Player | Monster): ActorView {
    let v = this.actors.get(a.id);
    if (!v) {
      const root = new Container();
      root.sortableChildren = true;
      let body: Container;
      if (a.kind === 'player') body = this.playerBody(a);
      else {
        const md = CONTENT.monsters[a.defId];
        body = makeMonsterSprite(md.sprite, md.colors, () => makeSprite(md.sprite));
      }
      if (a.kind === 'monster') {
        const sc = (CONTENT.monsters[a.defId].scale ?? 1) * (a.elite ? 1.15 : 1);
        body.scale.set(sc);
      }
      root.addChild(body);
      v = { root, body, prev: { x: a.x, y: a.y }, cur: { x: a.x, y: a.y }, hurt: 0, float: Math.random() * 10, lookKey: a.kind === 'player' ? this.lookKey(a) : undefined };
      // ほかのプレイヤーの名前
      if (a.kind === 'player' && a.id !== this.myId) {
        const name = new Text({ text: `${a.char.name}  Lv${a.char.level}`, style: { fontSize: 11, fontWeight: '800', fill: 0xdff3ff, stroke: { color: 0x000000, width: 3 }, fontFamily: 'system-ui, sans-serif' } });
        name.anchor.set(0.5, 1);
        name.y = -44;
        name.zIndex = 6;
        root.addChild(name);
      }
      if (a.kind === 'monster') {
        if (!CONTENT.monsters[a.defId].boss) { v.bar = new Graphics(); v.bar.zIndex = 5; root.addChild(v.bar); }
        if (a.elite) {
          v.aura = new Graphics();
          const { rx, ry } = isoRadii(a.r + 0.25);
          v.aura.ellipse(0, 0, rx, ry).stroke({ width: 3, color: 0xffb02e, alpha: 0.8 });
          v.aura.zIndex = -1;
          root.addChild(v.aura);
        }
      }
      this.entities.addChild(root);
      this.actors.set(a.id, v);
    }
    return v;
  }

  private lookKey(p: Player): string {
    return `${p.char.look.body}/${p.char.look.hair}/${shownLook(p.char, 'body')}/${shownLook(p.char, 'head')}/${shownLook(p.char, 'weapon')}`;
  }

  private playerBody(p: Player): Container {
    const armor = lookInfo(shownLook(p.char, 'body'));
    const head = lookInfo(shownLook(p.char, 'head'));
    return makePlayerSprite(BODY_COLORS[p.char.look.body % BODY_COLORS.length], HAIR_COLORS[p.char.look.hair % HAIR_COLORS.length], armor, head);
  }

  render(alpha: number, dtMs: number) {
    const dt = dtMs / 1000;
    this.time += dt;
    const w = this.world;
    if (w.area.map !== this.areaRef) this.setArea();
    const seen = new Set<number>();
    const lerp = (v: { prev: { x: number; y: number } }, x: number, y: number) => ({
      x: v.prev.x + (x - v.prev.x) * alpha,
      y: v.prev.y + (y - v.prev.y) * alpha,
    });

    for (const a of [...w.players, ...w.area.monsters, ...w.pets] as (Player | Monster)[]) {
      seen.add(a.id);
      const v = this.actorView(a);
      const pos = lerp(v, a.x, a.y);
      v.cur = pos;
      const s = toScreenH(pos.x, pos.y);
      v.root.x = s.x; v.root.y = s.y;
      v.root.zIndex = depth(pos.x, pos.y) + 0.01;
      v.hurt = Math.max(0, v.hurt - dt);
      v.float += dt;
      const flying = a.kind === 'monster' && (CONTENT.monsters[a.defId].tags ?? []).includes('flying');
      v.body.y = flying ? Math.sin(v.float * 4) * 3 : 0;
      const frozen = a.statuses.some((st) => st.id === 'freeze');
      const stunned = a.stagger > 0 || a.statuses.some((st) => st.id === 'stun');
      v.body.tint = v.hurt > 0 ? 0xff8080 : frozen ? 0x9fe0ff : stunned ? 0xfff0a0 : 0xffffff;
      const facingLeft = Math.cos(a.facing) - Math.sin(a.facing) < 0;

      if (a.kind === 'player') {
        const lk = this.lookKey(a);
        if (lk !== v.lookKey) {
          v.lookKey = lk;
          const nb = this.playerBody(a);
          v.root.addChildAt(nb, v.root.getChildIndex(v.body));
          v.body.destroy({ children: true });
          v.body = nb;
          v.weaponType = undefined;
        }
        v.root.visible = !a.dead;
        // 露店の看板
        const sk = a.stall ? `${a.stall.title}/${a.stall.items.length}` : '';
        if (sk !== (v.stallKey ?? '')) {
          v.stallKey = sk;
          v.stall?.destroy();
          v.stall = undefined;
          if (a.stall) {
            const t = new Text({ text: `🏷 ${a.stall.title || CONTENT.text['online.stall']}  ${a.stall.items.length}`, style: { fontSize: 12, fontWeight: '800', fill: 0xffe28a, stroke: { color: 0x000000, width: 3 }, fontFamily: 'system-ui, sans-serif' } });
            t.anchor.set(0.5, 1);
            t.y = -58;
            t.zIndex = 7;
            v.root.addChild(t);
            v.stall = t;
          }
        }
        v.root.alpha = a.dodgeTicks > 0 ? 0.55 : a.iframes > 0 ? 0.75 + Math.sin(this.time * 30) * 0.2 : 1;
        const look = shownLook(a.char, 'weapon');
        const lookKind = look ? Object.values(CONTENT.equipment.bases).find((b) => b.look === look.split(':')[0])?.kind : undefined;
        const wt = lookKind ?? a.char.equipment.weapon?.kind;
        const wkey = `${wt}:${look}`;
        if (v.weaponType !== wkey) {
          v.weapon?.destroy();
          const wl = lookInfo(look);
          v.weapon = makeWeaponGlyph(wt, wl && wl.color !== 0xffffff ? wl.color : undefined);
          v.weaponType = wkey;
          v.root.addChild(v.weapon);
        }
        if (v.weapon) {
          const f = toScreen(Math.cos(a.facing), Math.sin(a.facing));
          const fl = Math.hypot(f.x, f.y) || 1;
          v.weapon.x = (f.x / fl) * 16;
          v.weapon.y = -22 + (f.y / fl) * 8;
          const pointing = ['oneHandSword', 'twoHandSword', 'dualSwords', 'spear', 'gun'].includes(wt ?? 'oneHandSword');
          v.weapon.rotation = pointing ? Math.atan2(f.y, f.x) : 0;
          v.weapon.scale.x = !pointing && f.x < 0 ? -1 : 1;
          v.weapon.zIndex = f.y < 0 ? -1 : 1;
        }
        v.body.scale.x = facingLeft ? -1 : 1;
        // 溜め
        if (!v.aura) { v.aura = new Graphics(); v.aura.zIndex = -1; v.root.addChild(v.aura); }
        v.aura.clear();
        const lvl = chargeLevel(this.world, a);
        if (a.charge > 2) {
          const col = [0xffffff, 0xffe14a, 0xff9a3a, 0xff4a4a][lvl];
          const { rx, ry } = isoRadii(0.6 + lvl * 0.15 + Math.sin(this.time * 20) * 0.03);
          v.aura.ellipse(0, 0, rx, ry).stroke({ width: 2 + lvl, color: col, alpha: 0.8 });
        }
      } else {
        const def = CONTENT.monsters[a.defId];
        const sc = (def.scale ?? 1) * (a.elite ? 1.15 : 1);
        v.body.scale.set(facingLeft ? -sc : sc, a.moving && !flying ? sc * (1 + Math.sin(v.float * 14) * 0.05) : sc);
        if (v.bar) {
          v.bar.clear();
          const top = -(def.radius > 0.5 ? 66 : 46) * sc;
          if (a.hp < a.stats.maxHp) {
            const wbar = 34;
            v.bar.rect(-wbar / 2 - 1, top - 1, wbar + 2, 6).fill(0x000000);
            v.bar.rect(-wbar / 2, top, wbar * Math.max(0, a.hp / a.stats.maxHp), 4).fill(a.elite ? 0xffb02e : 0xe8453c);
          }
          let x = -14;
          for (const st of a.statuses) {
            v.bar.circle(x, top - 7, 3).fill(statusColor(st.id));
            x += 7;
          }
        }
        if (v.aura) v.aura.alpha = 0.6 + Math.sin(this.time * 5) * 0.3;
        if (a.team === 0) {
          v.body.scale.set(facingLeft ? -0.7 : 0.7, 0.7);
          if (!v.aura) {
            v.aura = new Graphics();
            const { rx, ry } = isoRadii(a.r + 0.15);
            v.aura.ellipse(0, 0, rx, ry).stroke({ width: 2, color: 0x9be04a, alpha: 0.8 });
            v.aura.zIndex = -1;
            v.root.addChild(v.aura);
          }
        }
        v.root.alpha = a.hidden ? 0.12 + Math.abs(Math.sin(this.time * 2)) * 0.08 : 1;
      }
    }
    for (const [id, v] of this.actors) {
      if (!seen.has(id)) { v.root.destroy({ children: true }); this.actors.delete(id); }
    }

    // 飛び道具
    const seenP = new Set<number>();
    for (const pr of w.area.projectiles) {
      seenP.add(pr.id);
      let v = this.projectiles.get(pr.id);
      if (!v) {
        const root = makeSprite(pr.sprite);
        if (pr.team === 1) root.tint = 0xffb0b0;
        this.entities.addChild(root);
        v = { root, prev: { x: pr.x - pr.vx, y: pr.y - pr.vy }, cur: { x: pr.x, y: pr.y } };
        this.projectiles.set(pr.id, v);
      }
      this.placeProjectile(v, pr, alpha);
    }
    for (const [id, v] of this.projectiles) {
      if (!seenP.has(id)) { v.root.destroy({ children: true }); this.projectiles.delete(id); }
    }

    // ドロップ
    const seenD = new Set<number>();
    const hide = this.me().char.lootFilter.hideBelow;
    for (const d of w.area.drops) {
      if (d.item && hide && d.ownerId === this.myId && rarityRank(d.item.rarity) < rarityRank(hide)) continue;
      seenD.add(d.id);
      let v = this.drops.get(d.id);
      if (!v) { v = this.makeDrop(d); this.drops.set(d.id, v); }
      v.t += dt;
      v.icon.y = -14 + Math.sin(v.t * 3) * 3;
      v.glow.alpha = 0.55 + Math.sin(v.t * 4) * 0.25;
      if (v.pillar) v.pillar.alpha = 0.65 + Math.sin(v.t * 2.5) * 0.2;
      v.root.alpha = d.ticksLeft < 100 ? 0.4 + 0.6 * Math.abs(Math.sin(v.t * 6)) : 1;
    }
    for (const [id, v] of this.drops) {
      if (!seenD.has(id)) { v.root.destroy({ children: true }); this.drops.delete(id); }
    }

    // 予兆
    this.telegraphs.clear();
    for (const s of w.area.strikes) {
      if (!s.telegraph || w.tick >= s.nextTick) continue;
      const total = Math.max(1, s.nextTick - s.startTick);
      const k = Math.min(1, (w.tick - s.startTick + alpha) / total);
      drawIsoShape(this.telegraphs, s.x, s.y, s.shape, s.dir);
      this.telegraphs.fill({ color: 0xff2a1a, alpha: 0.14 + 0.1 * Math.sin(this.time * 18) }).stroke({ width: 2, color: 0xff3a2a, alpha: 0.9 });
      const inner = s.shape.type === 'circle' ? { ...s.shape, radius: s.shape.radius * k }
        : s.shape.type === 'arc' || s.shape.type === 'line' ? { ...s.shape, range: s.shape.range * k } : s.shape;
      drawIsoShape(this.telegraphs, s.x, s.y, inner, s.dir);
      this.telegraphs.fill({ color: 0xff2a1a, alpha: 0.32 });
    }

    // 採集ポイント
    for (const n of w.area.nodes) {
      const v = this.nodes.get(n.id);
      if (v) v.alpha = n.charges > 0 ? 0.85 + Math.sin(this.time * 3 + n.id) * 0.15 : 0.2;
    }
    // 街のにぎわい
    const meP = w.players.find((p) => p.id === this.myId);
    this.life?.update(dt, this.npcs, this.npcPos, meP ? { x: meP.x, y: meP.y } : null);
    // 途中で増えた NPC（出口・階段）
    for (const n of w.area.npcs) if (!this.npcs.has(n.id)) this.addNpc(n);
    for (const n of w.area.nodes) if (!this.nodes.has(n.id)) this.addNode(n);

    // レイドの安全地帯
    for (const z of w.area.safeZones) {
      const s = toScreen(z.x, z.y);
      const { rx, ry } = isoRadii(z.r);
      this.telegraphs.ellipse(s.x, s.y, rx, ry).fill({ color: 0x7fd8ff, alpha: 0.18 + 0.1 * Math.sin(this.time * 6) }).stroke({ width: 3, color: 0xbff0ff, alpha: 0.9 });
    }
    // ボスのシールド
    for (const m of w.area.monsters) {
      if (!m.shielded) continue;
      const v = this.actors.get(m.id);
      if (!v) continue;
      const s = toScreenH(v.cur.x, v.cur.y);
      const { rx } = isoRadii(m.r + 0.6);
      this.telegraphs.circle(s.x, s.y - rx * 0.6, rx).stroke({ width: 3, color: 0x9fe8ff, alpha: 0.7 + 0.2 * Math.sin(this.time * 8) });
    }

    // 自分の足元
    const me = this.me();
    const mv = this.actors.get(me.id);
    if (mv && !me.dead) {
      const tip = toScreenH(mv.cur.x + Math.cos(me.facing) * 0.75, mv.cur.y + Math.sin(me.facing) * 0.75);
      const l = toScreenH(mv.cur.x + Math.cos(me.facing + 0.5) * 0.5, mv.cur.y + Math.sin(me.facing + 0.5) * 0.5);
      const r = toScreenH(mv.cur.x + Math.cos(me.facing - 0.5) * 0.5, mv.cur.y + Math.sin(me.facing - 0.5) * 0.5);
      const { rx, ry } = isoRadii(0.55);
      const c = toScreenH(mv.cur.x, mv.cur.y);
      this.telegraphs.ellipse(c.x, c.y, rx, ry).stroke({ width: 2, color: 0x8fd0ff, alpha: 0.45 });
      this.telegraphs.poly([tip.x, tip.y, l.x, l.y, r.x, r.y]).fill({ color: 0x8fd0ff, alpha: 0.6 });
    }

    // カメラ
    const target = mv ? toScreenH(mv.cur.x, mv.cur.y) : toScreenH(me.x, me.y);
    const follow = 1 - Math.exp(-dt * 10);
    this.camPos.x += (target.x - this.camPos.x) * follow;
    this.camPos.y += (target.y - 30 - this.camPos.y) * follow;
    const sh = this.fx.shake;
    const ox = sh > 0 ? (Math.random() - 0.5) * sh : 0;
    const oy = sh > 0 ? (Math.random() - 0.5) * sh : 0;
    const zoom = Math.min(1.25, Math.max(0.8, Math.min(this.app.screen.width, this.app.screen.height) / 640));
    this.camera.scale.set(zoom);
    this.camera.x = Math.round(this.app.screen.width / 2 - this.camPos.x * zoom + ox);
    this.camera.y = Math.round(this.app.screen.height / 2 - this.camPos.y * zoom + oy);

    this.fx.update(dt, 0.6);
  }

  /** 自分のキャラの画面上の位置（マウスで狙うときの基準） */
  playerScreenPos(): { x: number; y: number } {
    const v = this.actors.get(this.myId);
    const p = v ? v.cur : this.me();
    const s = toScreenH(p.x, p.y);
    const z = this.camera.scale.x;
    return { x: this.camera.x + s.x * z, y: this.camera.y + (s.y - 22) * z };
  }

  private placeProjectile(v: ProjView, pr: Projectile, alpha: number) {
    const x = v.prev.x + (pr.x - v.prev.x) * alpha;
    const y = v.prev.y + (pr.y - v.prev.y) * alpha;
    v.cur = { x, y };
    const s = toScreenH(x, y);
    v.root.x = s.x; v.root.y = s.y - 20;
    v.root.zIndex = depth(x, y) + 0.02;
    const d = toScreen(pr.vx, pr.vy);
    v.root.rotation = Math.atan2(d.y, d.x);
  }

  private makeDrop(d: Drop): DropView {
    const root = new Container();
    const s = toScreenH(d.x, d.y);
    root.x = s.x; root.y = s.y;
    root.zIndex = depth(d.x, d.y);
    const glow = new Graphics();
    glow.blendMode = 'add';
    let pillar: Graphics | undefined;
    let icon: Container;
    if (d.item) {
      const rd = CONTENT.rarities.defs[d.item.rarity];
      const color = rarityColorNum(d.item.rarity);
      const { rx, ry } = isoRadii(rd.glow ? 0.6 : 0.3);
      if (rd.glow) for (let i = 4; i >= 1; i--) glow.ellipse(0, 0, rx * i / 4, ry * i / 4).fill({ color, alpha: 0.12 });
      else glow.ellipse(0, 0, rx, ry).fill({ color: 0x000000, alpha: 0.25 });
      if (rd.pillar) {
        pillar = new Graphics();
        const h = d.item.rarity === 'epic' ? 140 : 220;
        const wdt = d.item.rarity === 'epic' ? 26 : 34;
        for (let i = 0; i < 12; i++) {
          const k = i / 12;
          const ww = wdt * (0.55 + k * 0.45);
          pillar.rect(-ww / 2, -h + h * k, ww, h / 12 + 1).fill({ color, alpha: 0.04 + k * 0.22 });
        }
        pillar.rect(-3, -h, 6, h).fill({ color: 0xffffff, alpha: 0.45 });
        pillar.blendMode = 'add';
      }
      icon = makeSprite(itemIconName(d.item));
      const ring = new Graphics();
      ring.circle(0, 0, 13).fill({ color: 0x0b0e14, alpha: 0.6 }).stroke({ width: 2, color });
      icon.addChildAt(ring, 0);
    } else {
      const md = d.bag ? CONTENT.materials[d.bag.id] : null;
      const color = md ? hex(md.color) : 0xffd23a;
      const { rx, ry } = isoRadii(0.25);
      glow.ellipse(0, 0, rx, ry).fill({ color: 0x000000, alpha: 0.25 });
      icon = makeBagIcon(color);
    }
    root.addChild(glow);
    if (pillar) root.addChild(pillar);
    root.addChild(icon);
    this.entities.addChild(root);
    return { root, glow, pillar, icon, t: Math.random() * 3 };
  }
}

/** マスごとの決まったゆらぎ（0〜1） */
function tileNoise(i: number, j: number): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 地面の模様（石畳の目地・草・土のつぶ） */
function tileDetail(g: Graphics, kind: string, x: number, y: number, base: number, i: number, j: number, z: (u: number, v: number) => number = () => 0) {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const n = (k: number) => tileNoise(i * 7 + k, j * 13 + k * 3);
  // マスの中の点（u, v は 0〜1）
  const at = (u: number, v: number) => [x + (u - v) * hw, y + (u + v) * hh - z(u, v)];
  if (kind === 'paving') {
    // 大きな敷石：内側に目地
    const d = 0.06;
    g.poly([...at(d, d), ...at(1 - d, d), ...at(1 - d, 1 - d), ...at(d, 1 - d)]).stroke({ width: 1, color: shade(base, 0.8), alpha: 0.55 });
    if (n(1) > 0.7) g.poly([...at(0.2, 0.25), ...at(0.45, 0.2), ...at(0.4, 0.45)]).fill({ color: shade(base, 1.06), alpha: 0.5 });
  } else if (kind === 'cobble') {
    // 丸い石を並べる
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const u = 0.27 + a * 0.46 + (n(a * 2 + b) - 0.5) * 0.08, v = 0.27 + b * 0.46 + (n(a + b * 5) - 0.5) * 0.08;
      const [cx, cy] = at(u, v);
      g.ellipse(cx, cy, 11, 5.5).fill({ color: shade(base, 0.96 + n(a * 3 + b) * 0.08) }).stroke({ width: 1, color: shade(base, 0.82), alpha: 0.45 });
    }
  } else if (kind === 'grass') {
    for (let k = 0; k < 3; k++) {
      if (n(k) < 0.45) continue;
      const [cx, cy] = at(0.15 + n(k + 5) * 0.7, 0.15 + n(k + 9) * 0.7);
      g.moveTo(cx - 2, cy).lineTo(cx - 3, cy - 4).moveTo(cx, cy).lineTo(cx, cy - 5).moveTo(cx + 2, cy).lineTo(cx + 3, cy - 4)
        .stroke({ width: 1, color: shade(base, n(k + 2) > 0.5 ? 1.25 : 0.78) });
    }
    if (n(11) > 0.93) { const [cx, cy] = at(0.5, 0.5); g.circle(cx, cy - 1, 2).fill(n(12) > 0.5 ? 0xfff0a0 : 0xffffff); }
  } else if (kind === 'dirt') {
    for (let k = 0; k < 4; k++) {
      const [cx, cy] = at(0.1 + n(k) * 0.8, 0.1 + n(k + 4) * 0.8);
      g.circle(cx, cy, 1 + n(k + 8) * 1.2).fill({ color: shade(base, n(k + 1) > 0.5 ? 0.8 : 1.15), alpha: 0.7 });
    }
  }
}

/** マスの地面の色（ゆらぎ込み） */
function groundColor(m: GameMap, i: number, j: number): number {
  const i2 = Math.max(0, Math.min(m.width - 1, i)), j2 = Math.max(0, Math.min(m.height - 1, j));
  const td = CONTENT.tiles[m.tiles[j2 * m.width + i2]];
  if (!td) return 0xff00ff;
  return td.detail ? shade(hex(td.colors[0]), 0.98 + tileNoise(i2, j2) * 0.04) : hex(td.colors[(i2 + j2) % 2]);
}

/** 2 色を混ぜる */
function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * 地面の 1 マス。中心と 4 辺で 4 つの三角形に分け、角の高さにそって描く。
 * 辺のところは隣のマスの色と混ぜて、マスの境目がカクカクに見えないようにする。斜面は向きで明暗をつける。
 */
const isLiquid = (t: string | undefined) => !!t && (!!CONTENT.tiles[t]?.shine || t === 'lava');
const tileName = (m: GameMap, i: number, j: number) => m.tiles[Math.max(0, Math.min(m.height - 1, j)) * m.width + Math.max(0, Math.min(m.width - 1, i))];
/** 角のまわり 4 マスのうち 2 マス以上が水（溶岩）なら、その角は水 */
function liquidCorner(m: GameMap, x: number, y: number): string | null {
  let n = 0, name: string | null = null;
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const t = tileName(m, x + dx, y + dy);
    if (isLiquid(t)) { n++; name = t; }
  }
  return n >= 2 ? name : null;
}

function drawGroundTile(g: Graphics, m: GameMap, i: number, j: number) {
  const own = tileName(m, i, j);
  // 水のマスの下地は、まわりの陸の色（岸を滑らかに描くため）
  let c = groundColor(m, i, j);
  if (isLiquid(own)) for (const [di, dj] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (!isLiquid(tileName(m, i + di, j + dj))) { c = groundColor(m, i + di, j + dj); break; }
  const td = isLiquid(own) ? undefined : CONTENT.tiles[own];
  const P = (x: number, y: number) => { const s = toScreen(x, y); return [s.x, s.y - terrainHeight(x, y)]; };
  const cx = i + 0.5, cy = j + 0.5;
  const tris: [number, number, number, number, number, number][] = [
    [i, j, i + 1, j, i, j - 1],          // 上の辺（隣は j-1）
    [i + 1, j, i + 1, j + 1, i + 1, j],  // 右の辺（隣は i+1）
    [i + 1, j + 1, i, j + 1, i, j + 1],  // 下の辺（隣は j+1）
    [i, j + 1, i, j, i - 1, j],          // 左の辺（隣は i-1）
  ];
  for (const [ax, ay, bx, by, ni, nj] of tris) {
    const col = isLiquid(tileName(m, ni, nj)) ? c : mix(c, groundColor(m, ni, nj), 0.32);
    const za = terrainHeight(ax, ay), zb = terrainHeight(bx, by), zc = terrainHeight(cx, cy);
    // 斜面の向き：左上（-x・-y）へ向いた面は明るく、右下へ向いた面は暗く
    const ux = bx - ax, uy = by - ay, vx = cx - ax, vy = cy - ay, uz = zb - za, vz = zc - za;
    const det = ux * vy - uy * vx;
    const gx = det ? (uz * vy - vz * uy) / det : 0, gy = det ? (ux * vz - vx * uz) / det : 0;
    const k = Math.max(0.66, Math.min(1.25, 1 + (gx + gy) * 0.011));
    // 急な斜面は岩肌に、高いところは少し明るく（現実の山のように）
    const steep = Math.hypot(gx, gy), alt = (za + zb + zc) / 3;
    const snowy = (td?.colors[0] ?? '').startsWith('#d') || (td?.colors[0] ?? '').startsWith('#e');
    let col2 = mix(col, snowy ? 0x8a96a8 : 0x7c7466, Math.min(0.7, Math.max(0, (steep - 16) / 30)));
    if (alt > 50) col2 = shade(col2, 1 + Math.min(0.12, (alt - 50) / 500));
    g.poly([...P(ax, ay), ...P(bx, by), ...P(cx, cy)]).fill(shade(col2, k));
  }
  // 水・溶岩：角が水かどうかで形を決め、角を斜めに切って岸を滑らかに（マーチングスクエア）
  const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
  const wet = corners.map(([x, y]) => liquidCorner(m, x, y));
  const liq = wet.find((x) => x);
  if (liq) {
    const pts: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = corners[k], b = corners[(k + 1) % 4];
      if (wet[k]) pts.push(...P(a[0], a[1]));
      if (!!wet[k] !== !!wet[(k + 1) % 4]) pts.push(...P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
    }
    const ld = CONTENT.tiles[liq];
    if (pts.length >= 6) {
      g.poly(pts).fill(hex(ld.colors[(i + j) % 2]));
      if (ld.shine) g.poly(pts).fill({ color: hex(ld.shine), alpha: 0.14 });
    }
  }
}
