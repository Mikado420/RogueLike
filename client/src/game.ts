import type { Application, Ticker } from 'pixi.js';
import { CONTENT, type Command, type GameEvent, type World } from '../../shared/src';
import type { NetSession } from './net/session';
import { InputManager } from './input';
import { WorldView } from './view';
import { Hud } from './hud';
import { Music, type Sfx } from './audio';
import { Ambience } from './ambience';
import { pickTrack } from './music';
import { saveSettings, type Settings } from './settings';
import { Modal } from './ui/modal';
import { Menu } from './ui/menu';
import { NpcPanels } from './ui/npc';
import { registerContentPanels } from './ui/content';
import { registerCraftPanels } from './ui/crafting';
import { registerPetTab } from './ui/pets';
import { registerOnlineTab } from './ui/online';
import type { Ctx } from './ui/ctx';


/** 1人ぶんのゲーム（ワールド・描画・UI・保存）をまとめる */
export class Game {
  world: World;
  view: WorldView;
  hud: Hud;
  input: InputManager;
  modal: Modal;
  menu: Menu;
  npc: NpcPanels;
  ctx: Ctx;
  private acc = 0;
  private tickFn: (t: Ticker) => void;
  onExit: ((reason: string | null) => void) | null = null;
  ambience = new Ambience();
  music = new Music(CONTENT.music.tracks);
  private musicTimer = 0;
  myId = 0;

  constructor(private app: Application, public session: NetSession, public settings: Settings, public sfx: Sfx) {
    this.world = session.world;
    const myId = session.myId;
    this.myId = myId;
    const host = document.getElementById('game')!;
    this.input = new InputManager(host);
    this.input.setBindings(settings.keys ?? {});
    this.view = new WorldView(app, this.world, myId, settings, sfx);
    app.stage.addChild(this.ambience.layer);
    this.hud = new Hud(this.world, myId, this.input, sfx);
    this.applySettings();
    this.modal = new Modal(document.getElementById('ui')!);
    const self = this;
    this.ctx = {
      get world() { return self.world; },
      get myId() { return self.myId; },
      me: () => this.world.players.find((p) => p.id === self.myId)!,
      send: (cmd: Command) => this.input.pushCommand(cmd),
      settings,
      saveSettings: () => saveSettings(settings),
      sfx,
      modal: this.modal,
      hud: this.hud,
      input: this.input,
      applySettings: () => this.applySettings(),
      session,
      logout: () => this.logout(),
    };
    this.menu = new Menu(this.ctx);
    this.npc = new NpcPanels(this.ctx);
    registerContentPanels(this.npc, this.menu, this.ctx);
    registerCraftPanels(this.npc);
    registerPetTab(this.menu, this.ctx);
    registerOnlineTab(this.menu);
    this.modal.onChange = () => { this.input.enabled = !this.modal.isOpen; };
    this.hud.onMenu = () => this.menu.toggle();
    this.hud.onPotion = () => this.usePotion();
    this.hud.onCapture = () => this.useCapture();
    this.input.onAction = (a) => {
      if (a === 'menu') {
        if (this.modal.isOpen) this.modal.close(); else this.menu.open();
      }
      if (a === 'potion') this.usePotion();
      if (a === 'capture') this.useCapture();
    };
    this.tickFn = (t) => this.frame(t);
    app.ticker.add(this.tickFn);
    session.onKick = (r) => this.onExit?.(r);
    session.onState = (st) => this.hud.setConnection(st);
    (window as unknown as { eg: unknown }).eg = { game: this, get world() { return self.world; }, get me() { return self.ctx.me(); } };
  }

  applySettings() {
    const s = this.settings;
    this.sfx.enabled = s.sound;
    this.sfx.volume = s.volume.sfx * s.volume.master;
    this.music.enabled = s.sound;
    this.music.setVolume(s.volume.bgm * s.volume.master);
    this.ambience.quality = s.quality;
    this.input.setBindings(s.keys ?? {});
    this.hud.refreshKeys();
    const res = s.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    if (this.app.renderer.resolution !== res) {
      this.app.renderer.resolution = res;
      this.app.renderer.resize(this.app.screen.width, this.app.screen.height);
    }
  }

  /** タイトルに戻る（サーバーがすぐ保存する） */
  logout() {
    this.session.close();
    this.onExit?.(null);
  }

  private usePotion() {
    const p = this.ctx.me();
    const bag = p.char.bag;
    const missing = 1 - p.hp / p.stats.maxHp;
    const id = missing > 0.55 && bag.potion_m ? 'potion_m' : bag.potion_s ? 'potion_s' : bag.potion_m ? 'potion_m' : null;
    if (id) this.input.pushCommand({ type: 'useItem', id });
  }

  private useCapture() {
    const bag = this.ctx.me().char.bag;
    const item = bag.seal_stone ? 'seal_stone' : bag.seal_stone_hi ? 'seal_stone_hi' : null;
    if (item) this.input.pushCommand({ type: 'capture', item });
  }

  private frame(t: Ticker) {
    const TICK_MS = 1000 / CONTENT.balance.tickRate;
    this.acc += Math.min(t.deltaMS, 250);
    while (this.acc >= TICK_MS) {
      if (this.ctx.me()) this.input.playerScreen = this.view.playerScreenPos();
      this.session.clientTick(this.input.sample());
      // エリアを移るとプレイヤーの番号が変わる
      const id = this.session.myId;
      if (id !== this.myId) { this.myId = id; this.view.myId = id; this.hud.myId = id; }
      this.handleEvents(this.session.takeEvents());
      this.acc -= TICK_MS;
    }
    if (!this.ctx.me()) return;
    this.session.updateDisplay();
    this.view.render(1, t.deltaMS);
    const ps = this.view.playerScreenPos();
    this.ambience.update(this.world, ps.x, ps.y + 22 * this.view.camera.scale.x, this.view.camera.scale.x, this.app.screen.width, this.app.screen.height, t.deltaMS / 1000);
    this.hud.update();
    this.musicTimer -= t.deltaMS;
    if (this.musicTimer <= 0) {
      this.musicTimer = 1000;
      this.music.attach(this.sfx.ctx);
      this.music.play(pickTrack(this.world, this.ctx.me()));
    }
  }

  private handleEvents(events: GameEvent[]) {
    if (events.length === 0) return;
    this.view.handleEvents(events);
    this.hud.handleEvents(events);
    let refresh = false;
    for (const e of events) {
      if (e.type === 'npc' && e.playerId === this.ctx.myId) this.npc.open(e.npc, e.npcId);
      if ((e.type === 'charChanged' || e.type === 'equip' || e.type === 'gold') && e.playerId === this.ctx.myId) refresh = true;
      if (e.type === 'pickup' && e.playerId === this.ctx.myId) refresh = true;
      if (e.type === 'levelUp' && e.playerId === this.ctx.myId) refresh = true;
      if (e.type === 'areaChanged' && e.playerId === this.ctx.myId) this.modal.close();
    }
    if (refresh) { this.menu.refresh(); this.npc.refresh(); }
  }

  destroy() {
    this.input.dispose();
    this.app.ticker.remove(this.tickFn);
    this.music.dispose();
    this.ambience.layer.destroy({ children: true });
    this.view.camera.destroy({ children: true });
    this.modal.close();
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
