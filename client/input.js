// 入力：キーボード・マウス・タッチ（仮想スティック＋ボタン）
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'atk', KeyZ: 'atk', KeyK: 's1', KeyX: 's1', KeyL: 's2', KeyC: 's2', Space: 'dodge', ShiftLeft: 'dodge',
  KeyE: 'act', KeyF: 'act', KeyQ: 'potion', KeyR: 'potion',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.held = { atk: false, s1: false, s2: false, dodge: false, act: false, potion: false };
    this.pressed = new Set();
    this.mouse = null;        // 画面上の位置（ゲーム座標）
    this.mouseAt = 0;
    this.mouseDown = false;
    this.stick = { x: 0, y: 0, id: null };
    this.touchMode = false;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) this.keys.delete(k); });
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    canvas.addEventListener('mousemove', (e) => { this.mouse = this.toGame(e); this.mouseAt = performance.now(); });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouseDown = true; this.mouse = this.toGame(e); this.mouseAt = performance.now(); } if (e.button === 2) this.pressed.add('s1'); });
    addEventListener('mouseup', () => { this.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.setupTouch();
  }

  toGame(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.canvas.width, y: ((e.clientY - r.top) / r.height) * this.canvas.height };
  }

  setupTouch() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const R = 46;
    const update = (t) => {
      const r = stick.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.stick.x = dx / R;
      this.stick.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchMode = true; const t = e.changedTouches[0]; this.stick.id = t.identifier; update(t); }, { passive: false });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === this.stick.id) update(t); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === this.stick.id) { this.stick = { x: 0, y: 0, id: null }; knob.style.transform = ''; } };
    stick.addEventListener('touchend', end);
    stick.addEventListener('touchcancel', end);

    for (const b of document.querySelectorAll('#buttons [data-btn]')) {
      const k = b.dataset.btn;
      const on = (e) => { e.preventDefault(); this.touchMode = true; this.held[k] = true; this.pressed.add(k); b.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.held[k] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    }
    addEventListener('touchstart', () => { this.touchMode = true; }, { passive: true });
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
  useMouseAim() { return !this.touchMode && this.mouse && performance.now() - this.mouseAt < 4000; }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
