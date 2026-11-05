import type { Command, PlayerInput } from '../../shared/src/sim';
import { screenDirToWorld } from './iso';

/**
 * 入力の抽象化。キーボード・マウス・タッチを
 * 「移動ベクトル・狙い・通常攻撃・スキル1〜4・回避」に変換する。
 */
export class InputManager {
  private keys = new Set<string>();
  private mouseHeld = false;
  private uiAttackHeld = false;
  private pendingSkill = -1;
  private pendingDodge = false;
  private commands: Command[] = [];
  private stick = { x: 0, y: 0 };
  private mouse = { x: 0, y: 0, movedAt: -1e9 };
  /** プレイヤーの画面上の位置（狙いの基準） */
  playerScreen = { x: 0, y: 0 };
  enabled = true;

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

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.code;
    if (down) {
      if (!this.keys.has(k)) {
        if (k === 'Digit1' || k === 'KeyU') this.pendingSkill = 0;
        if (k === 'Digit2' || k === 'KeyI') this.pendingSkill = 1;
        if (k === 'Digit3' || k === 'KeyO') this.pendingSkill = 2;
        if (k === 'Digit4' || k === 'KeyP') this.pendingSkill = 3;
        if (k === 'Space' || k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyK') this.pendingDodge = true;
      }
      this.keys.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    } else {
      this.keys.delete(k);
    }
  }

  // ── HUD（タッチ・クリック）から呼ばれる ──
  setStick(x: number, y: number) { this.stick = { x, y }; }
  setAttackHeld(v: boolean) { this.uiAttackHeld = v; }
  triggerSkill(i: number) { this.pendingSkill = i; }
  triggerDodge() { this.pendingDodge = true; }
  pushCommand(c: Command) { this.commands.push(c); }

  /** 画面上の移動方向（右+x, 下+y） */
  private screenMove(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
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
      this.pendingSkill = -1; this.pendingDodge = false;
      return { move: { x: 0, y: 0 }, aim: null, attack: false, skill: -1, dodge: false, commands };
    }
    const sm = this.screenMove();
    const move = screenDirToWorld(sm.x, sm.y);
    let aim: { x: number; y: number } | null = null;
    if (performance.now() - this.mouse.movedAt < 2500) {
      const a = screenDirToWorld(this.mouse.x - this.playerScreen.x, this.mouse.y - this.playerScreen.y);
      if (Math.hypot(a.x, a.y) > 0) aim = a;
    }
    const attack = this.mouseHeld || this.uiAttackHeld || this.keys.has('KeyJ') || this.keys.has('Enter');
    const out: PlayerInput = { move, aim, attack, skill: this.pendingSkill, dodge: this.pendingDodge, commands };
    this.pendingSkill = -1;
    this.pendingDodge = false;
    return out;
  }
}
