import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import type { Element } from '../../shared/src/types';
import { ELEMENT_COLOR } from './colors';
import { isoRadii, toScreen } from './iso';

interface Floater {
  obj: Container;
  vx: number; vy: number;
  floor: number;
  age: number;
  life: number;
  bounce: boolean;
  pop: number;
}

interface ComboStack {
  key: string;
  total: number;
  count: number;
  cnt: number;
  lastAt: number;
  x: number; y: number;
  crit: boolean;
  weak: boolean;
  element: Element;
  toPlayer: boolean;
  mode: 'all' | 'mine' | 'total';
}

const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif';

/** ダメージ数字・ヒットの火花・画面揺れ */
export class Effects {
  readonly layer = new Container();
  readonly groundLayer = new Container();
  private floaters: Floater[] = [];
  private combos = new Map<string, ComboStack>();
  private bursts: { g: Graphics; age: number; life: number; grow: number }[] = [];
  private time = 0;
  shake = 0;

  private makeText(text: string, style: TextStyleOptions): Text {
    const t = new Text({ text, style: { fontFamily: FONT, fontWeight: '900', stroke: { color: 0x000000, width: 4, join: 'round' }, ...style } });
    t.anchor.set(0.5);
    return t;
  }

  /** 1つの数字を出す。world 座標で渡す */
  number(wx: number, wy: number, amount: number, opt: { crit: boolean; weak: boolean; element: Element; toPlayer: boolean; offsetY?: number; total?: boolean }) {
    const s = toScreen(wx, wy);
    const c = new Container();
    let color = 0xffffff, size = 22;
    if (opt.toPlayer) { color = 0xff4a4a; size = 22; }
    if (opt.weak) color = ELEMENT_COLOR[opt.element];
    if (opt.crit) { color = opt.weak ? color : 0xffd23a; size = 34; }
    if (opt.total) size += 6;
    const t = this.makeText(String(amount), { fontSize: size, fill: color, stroke: { color: opt.total ? 0x5a2a00 : 0x000000, width: opt.total ? 6 : 4, join: 'round' } });
    c.addChild(t);
    if (opt.weak) {
      const wk = this.makeText('WEAK', { fontSize: 13, fill: color, letterSpacing: 1 });
      wk.y = -size * 0.75;
      c.addChild(wk);
    }
    if (opt.total) {
      const sg = this.makeText('TOTAL', { fontSize: 11, fill: 0xffe9a8, letterSpacing: 1 });
      sg.y = -size * 0.75 - (opt.weak ? 12 : 0);
      c.addChild(sg);
    }
    c.x = s.x + (Math.random() - 0.5) * 14;
    c.y = s.y - 50 - (opt.offsetY ?? 0);
    this.layer.addChild(c);
    const stacked = opt.offsetY !== undefined && !opt.total;
    this.floaters.push({
      obj: c,
      vx: stacked ? 0 : (Math.random() - 0.5) * 60,
      vy: stacked ? -20 : -170 - (opt.crit ? 60 : 0),
      floor: c.y + 6,
      age: 0,
      life: opt.total ? 1.3 : opt.crit ? 1.0 : 0.8,
      bounce: !stacked,
      pop: opt.crit || opt.total ? 1.6 : 1.15,
    });
  }

  text(wx: number, wy: number, text: string, color: number) {
    const s = toScreen(wx, wy);
    const t = this.makeText(text, { fontSize: 16, fill: color });
    t.x = s.x; t.y = s.y - 56;
    this.layer.addChild(t);
    this.floaters.push({ obj: t, vx: 0, vy: -40, floor: Infinity, age: 0, life: 0.7, bounce: false, pop: 1 });
  }

  /**
   * ダメージ表示。cnt>1 は多段ヒットとして数字を積み、最後に合計を出す。
   * mode=total のときは合計だけ（単発もその値を合計として扱う）。
   */
  damage(e: { tgt: number; combo: number; cnt: number; amount: number; crit: boolean; weak: boolean; element: Element; x: number; y: number; toPlayer: boolean }, mode: 'all' | 'mine' | 'total') {
    if (e.cnt <= 1) {
      if (mode === 'total') this.number(e.x, e.y, e.amount, { ...e, total: false });
      else this.number(e.x, e.y, e.amount, e);
      return;
    }
    const key = `${e.combo}:${e.tgt}`;
    let st = this.combos.get(key);
    if (!st) {
      st = { key, total: 0, count: 0, cnt: e.cnt, lastAt: this.time, x: e.x, y: e.y, crit: false, weak: false, element: e.element, toPlayer: e.toPlayer, mode };
      this.combos.set(key, st);
    }
    st.total += e.amount; st.count++; st.lastAt = this.time; st.x = e.x; st.y = e.y;
    st.crit ||= e.crit; st.weak ||= e.weak;
    if (mode !== 'total') this.number(e.x, e.y, e.amount, { ...e, offsetY: (st.count - 1) * 18 });
    if (st.count >= st.cnt) this.finishCombo(st);
  }

  private finishCombo(st: ComboStack) {
    this.combos.delete(st.key);
    // 1発しか当たらなかったときは、その数字がもう出ているので合計は出さない
    if (st.count <= 1 && st.mode !== 'total') return;
    const offsetY = st.mode === 'total' ? 0 : st.count * 18 + 10;
    this.number(st.x, st.y, st.total, { crit: st.crit, weak: st.weak, element: st.element, toPlayer: st.toPlayer, offsetY, total: st.count > 1 });
  }

  /** 地面に広がる輪 */
  burst(wx: number, wy: number, color: number, radius = 0.5, life = 0.25) {
    const s = toScreen(wx, wy);
    const { rx, ry } = isoRadii(radius);
    const g = new Graphics();
    g.ellipse(0, 0, rx, ry).fill({ color, alpha: 0.5 }).stroke({ width: 2, color, alpha: 0.9 });
    g.x = s.x; g.y = s.y;
    this.groundLayer.addChild(g);
    this.bursts.push({ g, age: 0, life, grow: 0.6 });
  }

  spark(wx: number, wy: number, color: number, height = 24) {
    const s = toScreen(wx, wy);
    for (let i = 0; i < 6; i++) {
      const g = new Graphics();
      g.circle(0, 0, 2 + Math.random() * 2).fill(color);
      g.x = s.x; g.y = s.y - height;
      this.layer.addChild(g);
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 120;
      this.floaters.push({ obj: g, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, floor: Infinity, age: 0, life: 0.3, bounce: false, pop: 1 });
    }
  }

  /** 攻撃範囲の一瞬の光（扇形・円形） */
  flashShape(wx: number, wy: number, shape: { type: 'circle'; radius: number } | { type: 'arc'; range: number; arc: number }, dir: number, color: number, alpha = 0.35) {
    const g = new Graphics();
    drawIsoShape(g, wx, wy, shape, dir);
    g.fill({ color, alpha }).stroke({ width: 2, color, alpha: Math.min(1, alpha * 2.2) });
    this.groundLayer.addChild(g);
    this.bursts.push({ g, age: 0, life: 0.18, grow: 0 });
  }

  update(dt: number, comboTimeout: number) {
    this.time += dt;
    for (const st of [...this.combos.values()]) if (this.time - st.lastAt > comboTimeout) this.finishCombo(st);
    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      if (f.age >= f.life) { f.obj.destroy({ children: true }); return false; }
      f.vy += 520 * dt;
      f.obj.x += f.vx * dt;
      f.obj.y += f.vy * dt;
      if (f.bounce && f.obj.y > f.floor && f.vy > 0) { f.obj.y = f.floor; f.vy *= -0.45; f.vx *= 0.6; }
      if (!f.bounce && f.vy > 0 && f.floor === Infinity) f.vy = Math.min(f.vy, 30);
      const k = f.age / f.life;
      const sc = k < 0.12 ? 1 + (f.pop - 1) * (1 - k / 0.12) : 1;
      f.obj.scale.set(sc);
      f.obj.alpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      return true;
    });
    this.bursts = this.bursts.filter((b) => {
      b.age += dt;
      if (b.age >= b.life) { b.g.destroy(); return false; }
      const k = b.age / b.life;
      b.g.alpha = 1 - k;
      if (b.grow) b.g.scale.set(1 + k * b.grow);
      return true;
    });
    this.shake = Math.max(0, this.shake - dt * 30);
  }
}

/** ワールド座標の円・扇形を、アイソメに投影した図形として描く（fill は呼び出し側） */
export function drawIsoShape(g: Graphics, wx: number, wy: number, shape: { type: 'circle'; radius: number } | { type: 'arc'; range: number; arc: number }, dir: number) {
  const pts: number[] = [];
  if (shape.type === 'circle') {
    const s = toScreen(wx, wy);
    const { rx, ry } = isoRadii(shape.radius);
    g.ellipse(s.x, s.y, rx, ry);
    return;
  }
  const half = (shape.arc * Math.PI) / 360;
  const n = 16;
  const o = toScreen(wx, wy);
  pts.push(o.x, o.y);
  for (let i = 0; i <= n; i++) {
    const a = dir - half + (2 * half * i) / n;
    const p = toScreen(wx + Math.cos(a) * shape.range, wy + Math.sin(a) * shape.range);
    pts.push(p.x, p.y);
  }
  g.poly(pts);
}
