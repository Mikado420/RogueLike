import type { Application, Ticker } from 'pixi.js';
import {
  CONTENT, createWorld, step, syncCharacters, type AccountData, type Command, type GameEvent, type SaveStore, type World,
} from '../../shared/src';
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
import type { Ctx } from './ui/ctx';

const AUTOSAVE_MS = 15000;

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
  private lastSave = performance.now();
  private tickFn: (t: Ticker) => void;
  private saving = false;
  ambience = new Ambience();
  music = new Music(CONTENT.music.tracks);
  private musicTimer = 0;

  constructor(private app: Application, public account: AccountData, charId: string, private store: SaveStore, public settings: Settings, public sfx: Sfx) {
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.world = createWorld({ account, characterId: charId, seed, now: Date.now() });
    account.lastCharacterId = charId;
    const myId = this.world.players[0].id;
    const host = document.getElementById('game')!;
    this.input = new InputManager(host);
    this.input.setBindings(settings.keys ?? {});
    this.view = new WorldView(app, this.world, myId, settings, sfx);
    app.stage.addChild(this.ambience.layer);
    this.ambience.quality = settings.quality;
    this.music.setVolume(settings.volume.bgm * settings.volume.master);
    this.music.enabled = settings.sound;
    sfx.volume = settings.volume.sfx * settings.volume.master;
    this.hud = new Hud(this.world, myId, this.input, sfx);
    this.modal = new Modal(document.getElementById('ui')!);
    const self = this;
    this.ctx = {
      get world() { return self.world; },
      myId,
      me: () => this.world.players.find((p) => p.id === myId)!,
      send: (cmd: Command) => this.input.pushCommand(cmd),
      settings,
      saveSettings: () => saveSettings(settings),
      sfx,
      modal: this.modal,
      hud: this.hud,
    };
    this.menu = new Menu(this.ctx);
    this.npc = new NpcPanels(this.ctx);
    registerContentPanels(this.npc, this.menu, this.ctx);
    registerCraftPanels(this.npc);
    registerPetTab(this.menu, this.ctx);
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
    window.addEventListener('pagehide', this.onHide);
    document.addEventListener('visibilitychange', this.onHide);
    (window as unknown as { eg: unknown }).eg = { game: this, get world() { return self.world; }, get me() { return self.ctx.me(); } };
  }

  private onHide = () => { if (document.visibilityState !== 'visible') void this.save(); };

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
      this.input.playerScreen = this.view.playerScreenPos();
      this.view.capturePrev();
      const me = this.ctx.me();
      const events = step(this.world, new Map([[me.id, this.input.sample()]]), Date.now());
      this.handleEvents(events);
      this.acc -= TICK_MS;
    }
    this.view.render(this.acc / TICK_MS, t.deltaMS);
    const ps = this.view.playerScreenPos();
    this.ambience.update(this.world, ps.x, ps.y + 22 * this.view.camera.scale.x, this.view.camera.scale.x, this.app.screen.width, this.app.screen.height, t.deltaMS / 1000);
    this.hud.update();
    this.musicTimer -= t.deltaMS;
    if (this.musicTimer <= 0) {
      this.musicTimer = 1000;
      this.music.attach(this.sfx.ctx);
      this.music.play(pickTrack(this.world, this.ctx.me()));
    }
    if (performance.now() - this.lastSave > AUTOSAVE_MS) void this.save();
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
      if (e.type === 'levelUp' && e.playerId === this.ctx.myId) { refresh = true; void this.save(); }
      if (e.type === 'areaChanged' && e.playerId === this.ctx.myId) { this.modal.close(); void this.save(); }
    }
    if (refresh) { this.menu.refresh(); this.npc.refresh(); }
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    this.lastSave = performance.now();
    try {
      syncCharacters(this.world);
      await this.store.save(this.account);
    } finally {
      this.saving = false;
    }
  }

  destroy() {
    this.app.ticker.remove(this.tickFn);
    this.music.dispose();
    this.ambience.layer.destroy({ children: true });
    window.removeEventListener('pagehide', this.onHide);
    document.removeEventListener('visibilitychange', this.onHide);
    this.view.camera.destroy({ children: true });
    this.modal.close();
  }
}
