// 入力：キーボード・マウス・タッチ
// タッチは「画面の左半分のどこを触ってもスティックが出る」方式。右側に場面ごとのボタン。
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'atk', KeyZ: 'atk', KeyK: 's1', KeyX: 's1', KeyL: 's2', KeyC: 's2', Space: 'dodge', ShiftLeft: 'dodge', ShiftRight: 'dodge',
  KeyE: 'act', KeyF: 'act', Enter: 'act', KeyQ: 'potion', KeyR: 'potion',
};
const STICK_R = 52;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.held = { atk: false, s1: false, s2: false, dodge: false, act: false, potion: false };
    this.pressed = new Set();
    this.mouse = null;
    this.mouseAt = 0;
    this.mouseDown = false;
    this.stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this.blocked = () => false;

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = KEYMAP[e.code];
      if (!k) return;
      if (this.blocked() && k !== 'act') return;
      e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) this.keys.delete(k); });
    addEventListener('blur', () => this.reset());

    canvas.addEventListener('mousemove', (e) => { this.mouse = this.toGame(e); this.mouseAt = performance.now(); this.touchMode = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (this.touchMode) return;
      this.mouse = this.toGame(e);
      this.mouseAt = performance.now();
      if (e.button === 0) { this.mouseDown = true; this.pressed.add('atk'); }
      if (e.button === 2) this.pressed.add('s1');
    });
    addEventListener('mouseup', () => { this.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.setupTouch();
  }

  reset() {
    this.keys.clear();
    this.mouseDown = false;
    for (const k of Object.keys(this.held)) this.held[k] = false;
    this.endStick();
  }

  toGame(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.canvas.width, y: ((e.clientY - r.top) / r.height) * this.canvas.height };
  }

  setupTouch() {
    const zone = document.getElementById('stick-zone');
    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stick-knob');
    const start = (t) => {
      this.touchMode = true;
      this.stick.id = t.identifier;
      this.stick.ox = t.clientX;
      this.stick.oy = t.clientY;
      this.stickEl.style.left = `${t.clientX}px`;
      this.stickEl.style.top = `${t.clientY}px`;
      this.stickEl.classList.add('on');
      this.moveStick(t);
    };
    zone.addEventListener('touchstart', (e) => {
      if (this.blocked()) return;
      e.preventDefault();
      if (this.stick.id === null) start(e.changedTouches[0]);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.stick.id) this.moveStick(t);
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === this.stick.id) this.endStick(); };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    for (const b of document.querySelectorAll('#buttons [data-btn]')) {
      const k = b.dataset.btn;
      const on = (e) => {
        e.preventDefault();
        this.touchMode = true;
        this.held[k] = true;
        this.pressed.add(k);
        b.classList.add('on');
        navigator.vibrate?.(8);
      };
      const off = (e) => { e.preventDefault(); this.held[k] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    }
  }

  moveStick(t) {
    let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
    const d = Math.hypot(dx, dy);
    // 指が大きく離れたら、スティックの中心ごとついてくる
    if (d > STICK_R) {
      const k = (d - STICK_R) / d;
      this.stick.ox += dx * k;
      this.stick.oy += dy * k;
      this.stickEl.style.left = `${this.stick.ox}px`;
      this.stickEl.style.top = `${this.stick.oy}px`;
      dx = t.clientX - this.stick.ox;
      dy = t.clientY - this.stick.oy;
    }
    const len = Math.hypot(dx, dy);
    const dead = 6;
    const mag = len < dead ? 0 : Math.min(1, (len - dead) / (STICK_R - dead));
    this.stick.x = len ? (dx / len) * mag : 0;
    this.stick.y = len ? (dy / len) * mag : 0;
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  endStick() {
    this.stick.id = null;
    this.stick.x = 0;
    this.stick.y = 0;
    this.stickEl?.classList.remove('on');
    if (this.knobEl) this.knobEl.style.transform = '';
  }

  move() {
    let x = 0, y = 0;
    if (this.keys.has('left')) x -= 1;
    if (this.keys.has('right')) x += 1;
    if (this.keys.has('up')) y -= 1;
    if (this.keys.has('down')) y += 1;
    if (x || y) { const d = Math.hypot(x, y); return { x: x / d, y: y / d }; }
    return { x: this.stick.x, y: this.stick.y };
  }

  isHeld(k) { return this.keys.has(k) || this.held[k] || (k === 'atk' && this.mouseDown); }
  wasPressed(k) { return this.pressed.has(k); }
  endFrame() { this.pressed.clear(); }
  useMouseAim() { return !this.touchMode && this.mouse && performance.now() - this.mouseAt < 5000; }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
