import type { Command, PlayerInput } from '../../shared/src';
import { screenDirToWorld } from './iso';

export type Action = 'up' | 'down' | 'left' | 'right' | 'attack' | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'dodge' | 'interact' | 'potion' | 'menu';

/** 既定のキー割り当て（設定で変えられる） */
export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ', 'Enter'],
  skill1: ['Digit1', 'KeyU'],
  skill2: ['Digit2', 'KeyI'],
  skill3: ['Digit3', 'KeyO'],
  skill4: ['Digit4', 'KeyP'],
  dodge: ['Space', 'ShiftLeft', 'KeyK'],
  interact: ['KeyE', 'KeyF'],
  potion: ['KeyQ'],
  menu: ['KeyM', 'Tab', 'Escape'],
};

/**
 * 入力の抽象化。キーボード・マウス・タッチを
 * 「移動ベクトル・狙い・通常攻撃・スキル1〜4・回避・調べる」に変換する。
 */
export class InputManager {
  private keys = new Set<string>();
  private mouseHeld = false;
  private uiAttackHeld = false;
  private pendingSkill = -1;
  private pendingDodge = false;
  private pendingInteract = false;
  private commands: Command[] = [];
  private stick = { x: 0, y: 0 };
  private mouse = { x: 0, y: 0, movedAt: -1e9 };
  private bindings: Record<Action, string[]> = { ...DEFAULT_KEYS };
  playerScreen = { x: 0, y: 0 };
  /** メニューを開いている間などは false */
  enabled = true;
  onAction: ((a: Action) => void) | null = null;

  constructor(canvasHost: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseHeld = false; this.uiAttackHeld = false; });
    canvasHost.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse = { x: e.clientX, y: e.clientY, movedAt: performance.now() };
    });
    canvasHost.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse = { x: e.clientX, y: e.clientY, movedAt: performance.now() };
      if (e.button === 0) this.mouseHeld = true;
      if (e.button === 2) this.pendingSkill = 0;
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 0) this.mouseHeld = false; });
    canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setBindings(b: Partial<Record<Action, string[]>>) {
    this.bindings = { ...DEFAULT_KEYS, ...b };
  }

  private is(a: Action, code: string) { return this.bindings[a].includes(code); }
  private held(a: Action) { return this.bindings[a].some((k) => this.keys.has(k)); }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const k = e.code;
    if (down) {
      if (!this.keys.has(k)) {
        if (this.is('menu', k)) { e.preventDefault(); this.onAction?.('menu'); }
        if (this.enabled) {
          if (this.is('skill1', k)) this.pendingSkill = 0;
          if (this.is('skill2', k)) this.pendingSkill = 1;
          if (this.is('skill3', k)) this.pendingSkill = 2;
          if (this.is('skill4', k)) this.pendingSkill = 3;
          if (this.is('dodge', k)) this.pendingDodge = true;
          if (this.is('interact', k)) this.pendingInteract = true;
          if (this.is('potion', k)) this.onAction?.('potion');
        }
      }
      this.keys.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    } else {
      this.keys.delete(k);
    }
  }

  // ── HUD（タッチ・クリック）から呼ばれる ──
  setStick(x: number, y: number) { this.stick = { x, y }; }
  setAttackHeld(v: boolean) { this.uiAttackHeld = v; }
  triggerSkill(i: number) { this.pendingSkill = i; }
  triggerDodge() { this.pendingDodge = true; }
  triggerInteract() { this.pendingInteract = true; }
  pushCommand(c: Command) { this.commands.push(c); }

  private screenMove(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    if (x !== 0 || y !== 0) {
      const l = Math.hypot(x, y);
      return { x: x / l, y: y / l };
    }
    return this.stick;
  }

  /** 1tickぶんの入力を取り出す（押した瞬間の入力はここで消費される） */
  sample(): PlayerInput {
    const commands = this.commands;
    this.commands = [];
    if (!this.enabled) {
      this.pendingSkill = -1; this.pendingDodge = false; this.pendingInteract = false;
      return { move: { x: 0, y: 0 }, aim: null, attack: false, skill: -1, dodge: false, interact: false, commands };
    }
    const sm = this.screenMove();
    const move = screenDirToWorld(sm.x, sm.y);
    let aim: { x: number; y: number } | null = null;
    if (performance.now() - this.mouse.movedAt < 2500) {
      const a = screenDirToWorld(this.mouse.x - this.playerScreen.x, this.mouse.y - this.playerScreen.y);
      if (Math.hypot(a.x, a.y) > 0) aim = a;
    }
    const attack = this.mouseHeld || this.uiAttackHeld || this.held('attack');
    const out: PlayerInput = { move, aim, attack, skill: this.pendingSkill, dodge: this.pendingDodge, interact: this.pendingInteract, commands };
    this.pendingSkill = -1;
    this.pendingDodge = false;
    this.pendingInteract = false;
    return out;
  }
}
