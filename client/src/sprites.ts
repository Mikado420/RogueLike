import { Container, Graphics } from 'pixi.js';
import { TILE_H, TILE_W } from './iso';

/**
 * 見た目はすべて「スプライト名」で参照する。
 * いまは図形で描いているが、ここを画像（Texture）に差し替えれば全体の見た目が変わる。
 * 原点は足元（地面に接する点）。
 */
type Drawer = () => Container;

const shadow = (g: Graphics, rx: number, ry = rx / 2) => g.ellipse(0, 0, rx, ry).fill({ color: 0x000000, alpha: 0.28 });

function gfx(draw: (g: Graphics) => void): Container {
  const c = new Container();
  const g = new Graphics();
  draw(g);
  c.addChild(g);
  return c;
}

const DRAWERS: Record<string, Drawer> = {
  player: () => makePlayerSprite(0x3b6fd8, 0x5a3a22),
  npc_fountain: () => gfx((g) => {
    shadow(g, 26);
    g.ellipse(0, -6, 26, 13).fill(0x6a7080).stroke({ width: 2, color: 0x3a3e48 });
    g.ellipse(0, -8, 20, 9).fill(0x4ab3ff);
    g.rect(-4, -40, 8, 32).fill(0x9aa0b0);
    g.circle(0, -44, 7).fill({ color: 0x9fe8ff, alpha: 0.9 });
    g.circle(0, -44, 12).fill({ color: 0x9fe8ff, alpha: 0.25 });
  }),
  npc_priest: () => gfx((g) => {
    shadow(g, 13);
    g.poly([-12, -4, 12, -4, 8, -36, -8, -36]).fill(0xf2eedc).stroke({ width: 2, color: 0x8a8670 });
    g.rect(-2, -32, 4, 22).fill(0xe0b84a);
    g.circle(0, -42, 8).fill(0xf2c9a0).stroke({ width: 2, color: 0x7a5236 });
    g.poly([-9, -46, 0, -60, 9, -46]).fill(0xe0b84a);
  }),
  npc_merchant: () => gfx((g) => {
    shadow(g, 16);
    g.roundRect(-11, -34, 22, 28, 8).fill(0x8a5a2a).stroke({ width: 2, color: 0x4a2a10 });
    g.rect(-11, -18, 22, 4).fill(0xe0b84a);
    g.circle(0, -40, 9).fill(0xf2c9a0).stroke({ width: 2, color: 0x7a5236 });
    g.ellipse(0, -47, 12, 4).fill(0x3a6a3a);
    g.roundRect(12, -26, 12, 14, 3).fill(0xc89a5a).stroke({ width: 1.5, color: 0x5a3a1a });
  }),
  slime: () => gfx((g) => {
    shadow(g, 16);
    g.ellipse(0, -11, 16, 13).fill({ color: 0x46a8ff, alpha: 0.92 }).stroke({ width: 2, color: 0x1f5b99 });
    g.ellipse(-5, -16, 5, 3).fill({ color: 0xffffff, alpha: 0.5 });
    g.circle(-5, -10, 2.2).fill(0x10243a);
    g.circle(5, -10, 2.2).fill(0x10243a);
  }),
  hornet: () => gfx((g) => {
    shadow(g, 9);
    g.ellipse(-9, -30, 9, 5).fill({ color: 0xe8f4ff, alpha: 0.6 });
    g.ellipse(9, -30, 9, 5).fill({ color: 0xe8f4ff, alpha: 0.6 });
    g.ellipse(0, -24, 7, 10).fill(0xf2c230).stroke({ width: 1.5, color: 0x4a3505 });
    g.rect(-7, -25, 14, 3).fill(0x2a2006);
    g.rect(-6, -19, 12, 3).fill(0x2a2006);
    g.circle(0, -35, 5).fill(0x2a2006);
    g.poly([-2, -15, 2, -15, 0, -9]).fill(0x2a2006);
  }),
  golem: () => gfx((g) => {
    shadow(g, 22);
    g.roundRect(-18, -42, 36, 30, 6).fill(0x8a8378).stroke({ width: 2, color: 0x3e3a34 });
    g.roundRect(-12, -56, 24, 16, 4).fill(0x9a9388).stroke({ width: 2, color: 0x3e3a34 });
    g.roundRect(-26, -40, 9, 24, 4).fill(0x7a7368).stroke({ width: 2, color: 0x3e3a34 });
    g.roundRect(17, -40, 9, 24, 4).fill(0x7a7368).stroke({ width: 2, color: 0x3e3a34 });
    g.rect(-12, -14, 9, 12).fill(0x6d665c);
    g.rect(3, -14, 9, 12).fill(0x6d665c);
    g.circle(-5, -49, 2.5).fill(0x7cf0ff);
    g.circle(5, -49, 2.5).fill(0x7cf0ff);
  }),
  wisp: () => gfx((g) => {
    shadow(g, 10);
    g.circle(0, -30, 18).fill({ color: 0x7a3cff, alpha: 0.18 });
    g.circle(0, -30, 12).fill({ color: 0x5b2ab8, alpha: 0.5 });
    g.circle(0, -30, 8).fill(0x2a0f55).stroke({ width: 2, color: 0xb98cff });
    g.circle(-3, -31, 1.8).fill(0xff6bd5);
    g.circle(3, -31, 1.8).fill(0xff6bd5);
  }),
  ignaros: () => gfx((g) => {
    shadow(g, 46);
    g.ellipse(0, -40, 42, 30).fill(0x8a2a18).stroke({ width: 3, color: 0x3a0c05 });
    g.ellipse(0, -46, 30, 18).fill({ color: 0xc8461f, alpha: 0.85 });
    for (const sx of [-1, 1]) {
      g.roundRect(sx * 30 - 7, -24, 14, 24, 5).fill(0x6a1e10).stroke({ width: 2, color: 0x3a0c05 });
      g.poly([sx * 14, -78, sx * 30, -104, sx * 24, -74]).fill(0x2a1a14).stroke({ width: 2, color: 0x110805 });
    }
    g.ellipse(0, -70, 20, 15).fill(0x9a3018).stroke({ width: 3, color: 0x3a0c05 });
    g.circle(-8, -72, 3.5).fill(0xffe14a);
    g.circle(8, -72, 3.5).fill(0xffe14a);
    g.poly([-10, -62, 10, -62, 0, -56]).fill(0xffb02e);
    for (let i = 0; i < 5; i++) g.poly([-20 + i * 10, -66, -15 + i * 10, -82 - (i % 2) * 6, -10 + i * 10, -66]).fill({ color: 0xff7a2a, alpha: 0.8 });
  }),
  tree: () => gfx((g) => {
    shadow(g, 20);
    g.rect(-4, -26, 8, 26).fill(0x6b4423);
    g.circle(0, -42, 20).fill(0x2f7d3a);
    g.circle(-9, -52, 14).fill(0x3a9147);
    g.circle(9, -54, 13).fill(0x45a052);
    g.circle(0, -64, 12).fill(0x52b05e);
  }),
  rock: () => gfx((g) => {
    shadow(g, 22);
    g.poly([-22, -4, -18, -20, -4, -30, 14, -26, 22, -10, 16, 0, -10, 2]).fill(0x7d8189).stroke({ width: 2, color: 0x3d4047 });
    g.poly([-4, -30, 14, -26, 6, -16, -10, -18]).fill(0x9aa0a8);
  }),
  wall: () => gfx((g) => {
    const hw = TILE_W / 2, hh = TILE_H / 2, h = 34;
    g.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(0x4b4f5c);
    g.poly([hw, 0, 0, hh, 0, hh - h, hw, -h]).fill(0x3a3d48);
    g.poly([0, -hh - h, hw, -h, 0, hh - h, -hw, -h]).fill(0x6a6f80).stroke({ width: 1, color: 0x2a2c34 });
  }),
  // 飛び道具（向きは描画側で回す。+x 方向が前）
  arrow: () => gfx((g) => {
    g.moveTo(-12, 0).lineTo(10, 0).stroke({ width: 2, color: 0xe8d8b0 });
    g.poly([14, 0, 8, -4, 8, 4]).fill(0xdfe6ee);
  }),
  arrow_big: () => gfx((g) => {
    g.moveTo(-18, 0).lineTo(14, 0).stroke({ width: 4, color: 0xfff1b8 });
    g.poly([22, 0, 12, -7, 12, 7]).fill(0xffffff);
    g.circle(0, 0, 10).fill({ color: 0xfff1b8, alpha: 0.25 });
  }),
  wave: () => gfx((g) => {
    g.moveTo(-6, -16).quadraticCurveTo(14, 0, -6, 16).stroke({ width: 5, color: 0xdff4ff, alpha: 0.9 });
    g.moveTo(-12, -12).quadraticCurveTo(6, 0, -12, 12).stroke({ width: 3, color: 0x9fd8ff, alpha: 0.6 });
  }),
  bullet: () => gfx((g) => {
    g.moveTo(-8, 0).lineTo(4, 0).stroke({ width: 2, color: 0xffe9a0, alpha: 0.7 });
    g.circle(5, 0, 2.5).fill(0xfff6d0);
  }),
  bullet_big: () => gfx((g) => {
    g.moveTo(-16, 0).lineTo(6, 0).stroke({ width: 3, color: 0xffd25a, alpha: 0.8 });
    g.circle(7, 0, 4).fill(0xffffff);
    g.circle(7, 0, 8).fill({ color: 0xffd25a, alpha: 0.3 });
  }),
  note: () => gfx((g) => {
    g.circle(0, 0, 11).fill({ color: 0xff9ad8, alpha: 0.25 });
    g.ellipse(-2, 3, 4, 3).fill(0xffe0f4);
    g.moveTo(1.5, 3).lineTo(1.5, -8).lineTo(6, -6).stroke({ width: 2, color: 0xffe0f4 });
  }),
  dagger: () => gfx((g) => {
    g.poly([10, 0, 0, -3, -6, 0, 0, 3]).fill(0xdfe6ee).stroke({ width: 1, color: 0x4a5060 });
  }),
  spear_tip: () => gfx((g) => {
    g.moveTo(-14, 0).lineTo(6, 0).stroke({ width: 3, color: 0x9a7040 });
    g.poly([14, 0, 4, -4, 4, 4]).fill(0xe6edf5);
  }),
  fist_wave: () => gfx((g) => {
    g.circle(0, 0, 18).fill({ color: 0xffb06a, alpha: 0.25 });
    g.moveTo(-6, -18).quadraticCurveTo(18, 0, -6, 18).stroke({ width: 6, color: 0xffd0a0, alpha: 0.9 });
  }),
  spark: () => gfx((g) => {
    g.circle(0, 0, 8).fill({ color: 0xffe14a, alpha: 0.35 });
    g.poly([6, 0, 0, -6, 2, -1, -6, 0, 0, 6, -2, 1]).fill(0xfff6a0);
  }),
  crystal: () => gfx((g) => {
    g.poly([12, 0, 0, -6, -10, 0, 0, 6]).fill({ color: 0x9fe8ff, alpha: 0.9 }).stroke({ width: 1.5, color: 0xffffff });
  }),
  bolt: () => gfx((g) => {
    g.circle(0, 0, 9).fill({ color: 0x9fd8ff, alpha: 0.3 });
    g.circle(0, 0, 5).fill(0xdff4ff);
  }),
  fireball: () => gfx((g) => {
    g.circle(-6, 0, 10).fill({ color: 0xff5a1f, alpha: 0.35 });
    g.circle(0, 0, 11).fill({ color: 0xff7a2a, alpha: 0.5 });
    g.circle(0, 0, 7).fill(0xffd25a);
  }),
  aqua: () => gfx((g) => {
    g.poly([18, 0, -14, -6, -20, 0, -14, 6]).fill({ color: 0x3fa8ff, alpha: 0.85 });
    g.poly([18, 0, -8, -3, -8, 3]).fill(0xd8f1ff);
  }),
  shadow: () => gfx((g) => {
    g.circle(0, 0, 10).fill({ color: 0x7a3cff, alpha: 0.35 });
    g.circle(0, 0, 6).fill(0x2a0f55).stroke({ width: 2, color: 0xd59cff });
  }),
  // 落ちているアイテム
  item_sword: () => gfx((g) => {
    g.moveTo(-8, 8).lineTo(8, -8).stroke({ width: 3, color: 0xdfe6ee });
    g.moveTo(-9, 3).lineTo(-3, 9).stroke({ width: 3, color: 0x8a6a3a });
  }),
  item_bow: () => gfx((g) => {
    g.moveTo(-6, -10).quadraticCurveTo(8, 0, -6, 10).stroke({ width: 3, color: 0xa0703a });
    g.moveTo(-6, -10).lineTo(-6, 10).stroke({ width: 1, color: 0xeeeeee });
  }),
  item_staff: () => gfx((g) => {
    g.moveTo(-6, 10).lineTo(5, -6).stroke({ width: 3, color: 0x8a5a2a });
    g.circle(6, -8, 4).fill(0x8fe0ff);
  }),
  item_armor: () => gfx((g) => {
    g.poly([-9, -8, -4, -10, 0, -7, 4, -10, 9, -8, 7, 9, -7, 9]).fill(0x9a8a6a).stroke({ width: 1.5, color: 0x3a3020 });
  }),
  item_spear: () => gfx((g) => {
    g.moveTo(-9, 9).lineTo(7, -7).stroke({ width: 2.5, color: 0x9a7040 });
    g.poly([10, -10, 4, -8, 8, -4]).fill(0xdfe6ee);
  }),
  item_fist: () => gfx((g) => {
    g.roundRect(-7, -6, 14, 12, 4).fill(0xb0a090).stroke({ width: 1.5, color: 0x4a4030 });
    g.rect(-6, -6, 12, 3).fill(0x8a7a6a);
  }),
  item_gun: () => gfx((g) => {
    g.rect(-9, -3, 16, 5).fill(0x5a6070);
    g.rect(-6, 1, 5, 7).fill(0x6a4a2a);
  }),
  item_scythe: () => gfx((g) => {
    g.moveTo(-6, 10).lineTo(4, -8).stroke({ width: 2.5, color: 0x6a4a2a });
    g.moveTo(4, -8).quadraticCurveTo(-8, -12, -10, -2).stroke({ width: 3, color: 0xc8d0e0 });
  }),
  item_lute: () => gfx((g) => {
    g.ellipse(-2, 3, 7, 6).fill(0xc8843a).stroke({ width: 1.5, color: 0x5a3a1a });
    g.moveTo(3, -1).lineTo(10, -10).stroke({ width: 2.5, color: 0x6a4a2a });
  }),
  item_ring: () => gfx((g) => {
    g.circle(0, 0, 6).stroke({ width: 3, color: 0xf3d36a });
    g.circle(0, -6, 3).fill(0x7cf0ff);
  }),
};

/** 見た目（服・髪の色）つきのプレイヤー */
export function makePlayerSprite(body: number, hair: number): Container {
  return gfx((g) => {
    shadow(g, 13);
    g.roundRect(-9, -34, 18, 26, 7).fill(body).stroke({ width: 2, color: 0x1a1d26 });
    g.rect(-9, -16, 18, 4).fill(0x6b4a2b);
    g.circle(0, -40, 9).fill(0xf2c9a0).stroke({ width: 2, color: 0x7a5236 });
    g.moveTo(-9, -44).arc(0, -41, 9.5, Math.PI, 0).fill(hair);
  });
}

/** 素材・消耗品の小さな印 */
export function makeBagIcon(color: number): Container {
  return gfx((g) => {
    g.circle(0, 0, 7).fill(color).stroke({ width: 2, color: 0x10141c });
    g.circle(-2, -2, 2).fill({ color: 0xffffff, alpha: 0.6 });
  });
}

export function makeSprite(name: string): Container {
  const d = DRAWERS[name];
  if (d) return d();
  // 未定義の名前は目立つ色の箱にする
  return gfx((g) => g.rect(-10, -20, 20, 20).fill(0xff00ff));
}

/** 武器の見た目（キャラの手元に出す） */
export function makeWeaponGlyph(weaponType: string | undefined): Graphics {
  const g = new Graphics();
  switch (weaponType) {
    case 'bow':
      g.moveTo(0, -12).quadraticCurveTo(12, 0, 0, 12).stroke({ width: 3, color: 0xa0703a });
      g.moveTo(0, -12).lineTo(0, 12).stroke({ width: 1, color: 0xeeeeee });
      break;
    case 'staff':
      g.moveTo(-4, 12).lineTo(4, -14).stroke({ width: 3, color: 0x8a5a2a });
      g.circle(4, -16, 4.5).fill(0x8fe0ff);
      break;
    case 'twoHandSword':
      g.moveTo(0, 2).lineTo(26, 0).stroke({ width: 5, color: 0xd0d8e4 });
      g.moveTo(1, -7).lineTo(1, 10).stroke({ width: 3, color: 0x8a6a3a });
      break;
    case 'dualSwords':
      g.moveTo(0, -2).lineTo(15, -5).stroke({ width: 2.5, color: 0xe6edf5 });
      g.moveTo(0, 4).lineTo(15, 7).stroke({ width: 2.5, color: 0xe6edf5 });
      break;
    case 'spear':
      g.moveTo(-10, 1).lineTo(26, 0).stroke({ width: 2.5, color: 0x9a7040 });
      g.poly([32, 0, 24, -4, 24, 4]).fill(0xe6edf5);
      break;
    case 'knuckles':
      g.roundRect(-2, -5, 10, 10, 3).fill(0xb0a090).stroke({ width: 1.5, color: 0x4a4030 });
      break;
    case 'gun':
      g.rect(0, -3, 18, 5).fill(0x5a6070);
      g.rect(2, 1, 5, 7).fill(0x6a4a2a);
      break;
    case 'scythe':
      g.moveTo(-6, 12).lineTo(6, -16).stroke({ width: 3, color: 0x6a4a2a });
      g.moveTo(6, -16).quadraticCurveTo(-12, -22, -16, -8).stroke({ width: 4, color: 0xc8d0e0 });
      break;
    case 'instrument':
      g.ellipse(2, 4, 9, 7).fill(0xc8843a).stroke({ width: 1.5, color: 0x5a3a1a });
      g.moveTo(8, 0).lineTo(18, -12).stroke({ width: 3, color: 0x6a4a2a });
      break;
    default:
      g.moveTo(0, 2).lineTo(18, 0).stroke({ width: 3, color: 0xe6edf5 });
      g.moveTo(1, -5).lineTo(1, 7).stroke({ width: 3, color: 0x8a6a3a });
  }
  return g;
}
