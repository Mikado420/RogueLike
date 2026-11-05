import { Container, Graphics } from 'pixi.js';

/**
 * モンスターの見た目。スプライト名（形）＋2色で描く。
 * 画像に差し替えるときは、この関数がスプライト名に対応する画像を返すようにすればよい。
 */
type Draw = (g: Graphics, a: number, b: number) => void;
const shadow = (g: Graphics, rx: number) => g.ellipse(0, 0, rx, rx / 2).fill({ color: 0x000000, alpha: 0.28 });
const dark = (c: number, k = 0.55) => {
  const r = ((c >> 16) & 255) * k, g = ((c >> 8) & 255) * k, b = (c & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
};

const SHAPES: Record<string, Draw> = {
  blob: (g, a, b) => {
    shadow(g, 16);
    g.ellipse(0, -11, 16, 13).fill({ color: a, alpha: 0.92 }).stroke({ width: 2, color: b });
    g.ellipse(-5, -16, 5, 3).fill({ color: 0xffffff, alpha: 0.5 });
    g.circle(-5, -10, 2.2).fill(0x10243a); g.circle(5, -10, 2.2).fill(0x10243a);
  },
  insect: (g, a, b) => {
    shadow(g, 9);
    g.ellipse(-9, -30, 9, 5).fill({ color: 0xe8f4ff, alpha: 0.6 }); g.ellipse(9, -30, 9, 5).fill({ color: 0xe8f4ff, alpha: 0.6 });
    g.ellipse(0, -24, 7, 10).fill(a).stroke({ width: 1.5, color: b });
    g.rect(-7, -25, 14, 3).fill(b); g.rect(-6, -19, 12, 3).fill(b);
    g.circle(0, -35, 5).fill(b); g.poly([-2, -15, 2, -15, 0, -9]).fill(b);
  },
  golem: (g, a, b) => {
    shadow(g, 22);
    const s = dark(a, 0.45);
    g.roundRect(-18, -42, 36, 30, 6).fill(a).stroke({ width: 2, color: s });
    g.roundRect(-12, -56, 24, 16, 4).fill(a).stroke({ width: 2, color: s });
    g.roundRect(-26, -40, 9, 24, 4).fill(dark(a, 0.85)).stroke({ width: 2, color: s });
    g.roundRect(17, -40, 9, 24, 4).fill(dark(a, 0.85)).stroke({ width: 2, color: s });
    g.rect(-12, -14, 9, 12).fill(dark(a, 0.75)); g.rect(3, -14, 9, 12).fill(dark(a, 0.75));
    g.circle(-5, -49, 2.5).fill(b); g.circle(5, -49, 2.5).fill(b);
    g.circle(0, -30, 4).fill({ color: b, alpha: 0.7 });
  },
  orb: (g, a, b) => {
    shadow(g, 10);
    g.circle(0, -30, 18).fill({ color: a, alpha: 0.18 });
    g.circle(0, -30, 12).fill({ color: a, alpha: 0.5 });
    g.circle(0, -30, 8).fill(dark(a, 0.5)).stroke({ width: 2, color: b });
    g.circle(-3, -31, 1.8).fill(b); g.circle(3, -31, 1.8).fill(b);
  },
  beast: (g, a, b) => {
    shadow(g, 20);
    const s = dark(a, 0.45);
    for (const x of [-12, -5, 6, 13]) g.rect(x - 2, -12, 5, 12).fill(dark(a, 0.7));
    g.ellipse(0, -18, 18, 10).fill(a).stroke({ width: 2, color: s });
    g.ellipse(16, -24, 9, 8).fill(a).stroke({ width: 2, color: s });
    g.poly([14, -31, 18, -38, 20, -30]).fill(dark(a, 0.7));
    g.circle(19, -25, 1.8).fill(b);
    g.poly([22, -20, 28, -21, 22, -17]).fill(b);
    g.poly([-18, -20, -26, -26, -18, -16]).fill(dark(a, 0.8));
  },
  shroom: (g, a, b) => {
    shadow(g, 14);
    g.roundRect(-6, -18, 12, 18, 4).fill(b).stroke({ width: 1.5, color: dark(b, 0.5) });
    g.ellipse(0, -22, 17, 11).fill(a).stroke({ width: 2, color: dark(a, 0.5) });
    for (const [x, y] of [[-8, -25], [5, -28], [9, -20], [-2, -18]]) g.circle(x, y, 2.5).fill({ color: 0xffffff, alpha: 0.85 });
    g.circle(-3, -9, 1.5).fill(0x2a1a10); g.circle(3, -9, 1.5).fill(0x2a1a10);
  },
  serpent: (g, a, b) => {
    shadow(g, 18);
    g.moveTo(-18, -4).quadraticCurveTo(-8, -14, 0, -6).quadraticCurveTo(8, 2, 14, -10).stroke({ width: 8, color: a, cap: 'round' });
    g.circle(15, -14, 6).fill(a).stroke({ width: 1.5, color: dark(a, 0.5) });
    g.circle(17, -15, 1.5).fill(b);
    g.moveTo(20, -12).lineTo(25, -11).stroke({ width: 1.5, color: 0xff4a4a });
  },
  frog: (g, a, b) => {
    shadow(g, 16);
    g.ellipse(0, -12, 16, 11).fill(a).stroke({ width: 2, color: dark(a, 0.5) });
    g.ellipse(0, -9, 10, 6).fill(b);
    g.circle(-7, -22, 4.5).fill(a).stroke({ width: 1.5, color: dark(a, 0.5) }); g.circle(7, -22, 4.5).fill(a).stroke({ width: 1.5, color: dark(a, 0.5) });
    g.circle(-7, -22, 2).fill(0x10141c); g.circle(7, -22, 2).fill(0x10141c);
  },
  crab: (g, a, b) => {
    shadow(g, 18);
    for (const s of [-1, 1]) {
      for (const k of [0, 1, 2]) g.moveTo(s * 10, -8).lineTo(s * (18 + k * 2), -2 + k * 2).stroke({ width: 2, color: dark(a, 0.7) });
      g.circle(s * 17, -18, 6).fill(a).stroke({ width: 1.5, color: dark(a, 0.5) });
    }
    g.ellipse(0, -12, 14, 9).fill(a).stroke({ width: 2, color: dark(a, 0.5) });
    g.ellipse(0, -14, 8, 4).fill({ color: b, alpha: 0.6 });
    g.circle(-4, -20, 1.8).fill(0x10141c); g.circle(4, -20, 1.8).fill(0x10141c);
  },
  humanoid: (g, a, b) => {
    shadow(g, 13);
    const s = dark(a, 0.45);
    g.rect(-7, -14, 5, 14).fill(dark(a, 0.7)); g.rect(2, -14, 5, 14).fill(dark(a, 0.7));
    g.roundRect(-10, -36, 20, 24, 6).fill(a).stroke({ width: 2, color: s });
    g.circle(0, -42, 8).fill(a).stroke({ width: 2, color: s });
    g.circle(-3, -43, 1.6).fill(b); g.circle(3, -43, 1.6).fill(b);
    g.rect(-10, -22, 20, 3).fill(b);
  },
  ghost: (g, a, b) => {
    g.ellipse(0, -4, 10, 4).fill({ color: 0x000000, alpha: 0.15 });
    g.moveTo(-12, -14).arc(0, -30, 12, Math.PI, 0).lineTo(12, -10).lineTo(6, -14).lineTo(0, -8).lineTo(-6, -14).lineTo(-12, -10).closePath()
      .fill({ color: a, alpha: 0.75 }).stroke({ width: 1.5, color: b, alpha: 0.7 });
    g.circle(-4, -30, 2.4).fill(b); g.circle(4, -30, 2.4).fill(b);
  },
  bat: (g, a, b) => {
    shadow(g, 9);
    g.poly([-24, -30, -8, -36, -4, -26, -12, -22]).fill(dark(a, 0.8));
    g.poly([24, -30, 8, -36, 4, -26, 12, -22]).fill(dark(a, 0.8));
    g.ellipse(0, -28, 7, 8).fill(a).stroke({ width: 1.5, color: dark(a, 0.5) });
    g.circle(-2.5, -30, 1.5).fill(b); g.circle(2.5, -30, 1.5).fill(b);
  },
  treant: (g, a, b) => {
    shadow(g, 22);
    g.roundRect(-11, -40, 22, 40, 6).fill(a).stroke({ width: 2, color: dark(a, 0.5) });
    g.moveTo(-10, -26).lineTo(-24, -40).stroke({ width: 5, color: a });
    g.moveTo(10, -30).lineTo(24, -44).stroke({ width: 5, color: a });
    g.circle(0, -52, 18).fill(b); g.circle(-12, -46, 11).fill(dark(b, 0.85)); g.circle(12, -48, 12).fill(dark(b, 0.9));
    g.circle(-4, -28, 2.2).fill(0xffe14a); g.circle(4, -28, 2.2).fill(0xffe14a);
  },
  spider: (g, a, b) => {
    shadow(g, 18);
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
      g.moveTo(s * 6, -12).lineTo(s * (14 + k * 2), -20 + k * 4).lineTo(s * (18 + k * 2), -2 + k).stroke({ width: 2, color: dark(a, 0.8) });
    }
    g.ellipse(-4, -14, 11, 9).fill(a).stroke({ width: 1.5, color: dark(a, 0.5) });
    g.circle(8, -14, 6).fill(a);
    for (const [x, y] of [[9, -16], [12, -15], [10, -12]]) g.circle(x, y, 1.4).fill(b);
  },
  drake: (g, a, b) => {
    shadow(g, 24);
    const s = dark(a, 0.45);
    g.poly([-6, -32, -32, -54, -14, -30]).fill({ color: dark(a, 0.85), alpha: 0.9 }).stroke({ width: 1.5, color: s });
    g.poly([6, -32, 32, -54, 14, -30]).fill({ color: dark(a, 0.85), alpha: 0.9 }).stroke({ width: 1.5, color: s });
    g.moveTo(-14, -16).quadraticCurveTo(-30, -14, -34, -4).stroke({ width: 6, color: a, cap: 'round' });
    for (const x of [-8, 6]) g.rect(x - 2, -12, 6, 12).fill(dark(a, 0.7));
    g.ellipse(0, -22, 16, 12).fill(a).stroke({ width: 2, color: s });
    g.ellipse(0, -18, 9, 6).fill(b);
    g.ellipse(14, -36, 9, 7).fill(a).stroke({ width: 2, color: s });
    g.moveTo(8, -26).lineTo(12, -32).stroke({ width: 6, color: a });
    g.circle(17, -38, 1.8).fill(0xffe14a);
    g.poly([10, -42, 12, -50, 15, -42]).fill(b);
  },
  hydra: (g, a, b) => {
    shadow(g, 40);
    const s = dark(a, 0.45);
    g.ellipse(0, -24, 32, 20).fill(a).stroke({ width: 3, color: s });
    for (const [x, h] of [[-20, 70], [0, 82], [20, 70]]) {
      g.moveTo(x * 0.5, -36).quadraticCurveTo(x * 1.2, -h * 0.6, x, -h).stroke({ width: 10, color: a, cap: 'round' });
      g.ellipse(x, -h - 4, 9, 7).fill(a).stroke({ width: 2, color: s });
      g.circle(x + 3, -h - 6, 2).fill(0xffe14a);
      g.poly([x + 6, -h - 2, x + 12, -h, x + 6, -h + 2]).fill(b);
    }
    g.ellipse(0, -18, 18, 8).fill({ color: b, alpha: 0.5 });
  },
  ignaros: () => { /* 下で専用に描く */ },
};

export function makeMonsterSprite(shape: string, colors: [string, string] | undefined, fallback: () => Container): Container {
  const d = SHAPES[shape];
  if (!d || shape === 'ignaros') return fallback();
  const a = colors ? parseInt(colors[0].slice(1), 16) : 0x9a9aa8;
  const b = colors ? parseInt(colors[1].slice(1), 16) : 0xffffff;
  const c = new Container();
  const g = new Graphics();
  d(g, a, b);
  c.addChild(g);
  return c;
}
