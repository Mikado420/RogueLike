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
  npc_smith: () => gfx((g) => {
    shadow(g, 18);
    g.roundRect(-12, -34, 24, 28, 7).fill(0x6a4a3a).stroke({ width: 2, color: 0x2a1a10 });
    g.rect(-12, -22, 24, 14).fill(0x3a3a40);
    g.circle(0, -41, 9).fill(0xe0b088).stroke({ width: 2, color: 0x7a5236 });
    g.rect(-9, -38, 18, 4).fill(0x5a3a22);
    g.rect(13, -30, 4, 18).fill(0x8a6a4a);
    g.roundRect(9, -36, 12, 7, 2).fill(0x9aa0b0);
  }),
  npc_keeper: () => gfx((g) => {
    shadow(g, 16);
    g.roundRect(-10, -33, 20, 27, 7).fill(0x4a6a5a).stroke({ width: 2, color: 0x1a2a20 });
    g.circle(0, -40, 9).fill(0xf2c9a0).stroke({ width: 2, color: 0x7a5236 });
    g.moveTo(-9, -44).arc(0, -41, 9.5, Math.PI, 0).fill(0xb0b0b0);
    g.roundRect(-22, -20, 14, 14, 2).fill(0xa07a4a).stroke({ width: 1.5, color: 0x4a3a1a });
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
  bush: () => gfx((g) => { shadow(g, 14); g.circle(-6, -8, 8).fill(0x3a8a3a); g.circle(6, -9, 9).fill(0x45983f); g.circle(0, -14, 8).fill(0x52a84c); }),
  mangrove: () => gfx((g) => {
    shadow(g, 18);
    for (const x of [-10, -3, 4, 11]) g.moveTo(x, 0).quadraticCurveTo(x * 0.5, -10, 0, -18).stroke({ width: 3, color: 0x5a4a32 });
    g.rect(-3, -34, 6, 18).fill(0x5a4a32);
    g.circle(0, -42, 15).fill(0x3a6a3a); g.circle(-9, -36, 10).fill(0x335f34); g.circle(9, -38, 10).fill(0x2f5a30);
  }),
  reed: () => gfx((g) => { for (const x of [-8, -4, 0, 4, 8]) { g.moveTo(x, 0).lineTo(x + 2, -22 - Math.abs(x)).stroke({ width: 2, color: 0x7a9a4a }); g.ellipse(x + 2, -24 - Math.abs(x), 2, 5).fill(0x6a4a2a); } }),
  crag: () => gfx((g) => { shadow(g, 22); g.poly([-22, 0, -16, -26, -4, -38, 10, -30, 20, -14, 18, 2]).fill(0x3a3434).stroke({ width: 2, color: 0x1a1414 }); g.poly([-4, -38, 10, -30, 2, -20]).fill(0x5a4a4a); }),
  dead_tree: () => gfx((g) => {
    shadow(g, 14);
    g.moveTo(0, 0).lineTo(0, -40).stroke({ width: 6, color: 0x3a2a24 });
    g.moveTo(0, -26).lineTo(-14, -40).stroke({ width: 3, color: 0x3a2a24 }); g.moveTo(0, -32).lineTo(12, -46).stroke({ width: 3, color: 0x3a2a24 });
  }),
  vent: () => gfx((g) => { shadow(g, 14); g.poly([-14, 0, -8, -14, 8, -14, 14, 0]).fill(0x4a3a3a).stroke({ width: 2, color: 0x2a1a1a }); g.ellipse(0, -14, 8, 3).fill(0xff7a2a); g.circle(0, -24, 7).fill({ color: 0xff9a4a, alpha: 0.35 }); }),
  old_tree: () => gfx((g) => {
    shadow(g, 24);
    g.rect(-6, -34, 12, 34).fill(0x4a3a22);
    g.circle(0, -54, 24).fill(0x24502c); g.circle(-14, -44, 15).fill(0x2a5a32); g.circle(14, -46, 16).fill(0x1f4826); g.circle(0, -70, 14).fill(0x2f6036);
  }),
  big_shroom: () => gfx((g) => { shadow(g, 16); g.rect(-4, -26, 8, 26).fill(0xe0d8c0); g.ellipse(0, -28, 20, 10).fill(0x8a4ac8).stroke({ width: 2, color: 0x4a2a6a }); g.circle(-7, -30, 3).fill({ color: 0xffe0ff, alpha: 0.8 }); g.circle(7, -31, 2.5).fill({ color: 0xffe0ff, alpha: 0.8 }); }),
  pine: () => gfx((g) => {
    shadow(g, 18);
    g.rect(-3, -14, 6, 14).fill(0x5a3a22);
    g.poly([-18, -14, 0, -40, 18, -14]).fill(0x2a5a46); g.poly([-14, -30, 0, -56, 14, -30]).fill(0x2f6650); g.poly([-10, -46, 0, -68, 10, -46]).fill(0x357058);
    g.poly([-10, -46, 0, -68, 10, -46, 0, -58]).fill({ color: 0xffffff, alpha: 0.7 });
  }),
  ice_rock: () => gfx((g) => { shadow(g, 20); g.poly([-20, 0, -14, -20, 0, -28, 14, -22, 20, -6, 12, 2]).fill(0xa8c8e0).stroke({ width: 2, color: 0x5a7a9a }); g.poly([0, -28, 14, -22, 4, -14]).fill(0xe0f0ff); }),
  crystal_rock: () => gfx((g) => { shadow(g, 16); for (const [x, h, c] of [[-8, 26, 0x9fe8ff], [2, 36, 0xc8f4ff], [10, 22, 0x7fd8ff]] as [number, number, number][]) g.poly([x - 5, 0, x, -h, x + 5, 0]).fill({ color: c, alpha: 0.9 }).stroke({ width: 1, color: 0xffffff }); }),
  town_wall: () => gfx((g) => {
    const hw = TILE_W / 2, hh = TILE_H / 2, h = 30;
    g.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(0x8a8070);
    g.poly([hw, 0, 0, hh, 0, hh - h, hw, -h]).fill(0x7a7060);
    g.poly([0, -hh - h, hw, -h, 0, hh - h, -hw, -h]).fill(0xa49a86).stroke({ width: 1, color: 0x5a5448 });
  }),
  house: () => houseDrawer(0x4a6a9a),
  house_red: () => houseDrawer(0xa84a3a),
  tower_wall: () => gfx((g) => {
    const hw = TILE_W / 2, hh = TILE_H / 2, h = 80;
    g.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(0x5a5a72);
    g.poly([hw, 0, 0, hh, 0, hh - h, hw, -h]).fill(0x4a4a62);
    g.poly([0, -hh - h, hw, -h, 0, hh - h, -hw, -h]).fill(0x7a7a96).stroke({ width: 1, color: 0x3a3a4a });
    g.rect(-2, -h + 10, 4, h - 20).fill({ color: 0x9fa8ff, alpha: 0.35 });
  }),
  fountain: () => gfx((g) => {
    shadow(g, 30);
    g.ellipse(0, -6, 30, 15).fill(0x9a958a).stroke({ width: 2, color: 0x5a564c });
    g.ellipse(0, -8, 24, 11).fill(0x4ab3ff);
    g.rect(-4, -36, 8, 28).fill(0xb0aca0);
    g.circle(0, -40, 9).fill({ color: 0x9fe8ff, alpha: 0.85 });
    g.circle(0, -40, 15).fill({ color: 0x9fe8ff, alpha: 0.2 });
  }),
  crystal_big: () => gfx((g) => {
    shadow(g, 26);
    g.poly([-14, 0, -6, -50, 0, -70, 6, -50, 14, 0]).fill({ color: 0x9fe8ff, alpha: 0.85 }).stroke({ width: 2, color: 0xffffff });
    g.poly([0, -70, 6, -50, 0, -10]).fill({ color: 0xffffff, alpha: 0.5 });
    g.circle(0, -40, 26).fill({ color: 0x9fe8ff, alpha: 0.12 });
  }),
  lamp: () => gfx((g) => { shadow(g, 6); g.rect(-2, -40, 4, 40).fill(0x3a3a40); g.roundRect(-6, -50, 12, 12, 3).fill(0xffe08a).stroke({ width: 1.5, color: 0x3a3a40 }); g.circle(0, -44, 16).fill({ color: 0xffe08a, alpha: 0.15 }); }),
  pillar: () => gfx((g) => { shadow(g, 14); g.rect(-9, -52, 18, 52).fill(0x5a5a68).stroke({ width: 2, color: 0x2a2a34 }); g.rect(-12, -56, 24, 6).fill(0x6a6a78); }),
  npc_gate: () => gfx((g) => {
    shadow(g, 24);
    g.rect(-20, -54, 7, 54).fill(0x6a6a86); g.rect(13, -54, 7, 54).fill(0x6a6a86);
    g.rect(-24, -60, 48, 8).fill(0x8a8aa6).stroke({ width: 1.5, color: 0x3a3a4a });
    g.ellipse(0, -28, 12, 24).fill({ color: 0x9fa8ff, alpha: 0.35 });
  }),
  npc_cave: () => gfx((g) => {
    shadow(g, 28);
    g.poly([-28, 0, -22, -26, -8, -38, 10, -36, 24, -22, 28, 0]).fill(0x5a5048).stroke({ width: 2, color: 0x2a2420 });
    g.ellipse(0, -10, 14, 16).fill(0x0a0808);
    g.ellipse(0, -10, 10, 12).fill({ color: 0xffd76a, alpha: 0.12 });
  }),
  npc_stairs: () => gfx((g) => {
    for (let i = 0; i < 4; i++) g.rect(-16 + i * 3, -6 - i * 8, 32 - i * 6, 8).fill(0xb0a890 - i * 0x080808).stroke({ width: 1, color: 0x4a4438 });
    g.ellipse(0, -34, 10, 4).fill({ color: 0xffe28a, alpha: 0.6 });
  }),
  node_ore: () => gfx((g) => {
    shadow(g, 16);
    g.poly([-16, 0, -12, -16, 0, -22, 12, -16, 16, 0]).fill(0x6a6a72).stroke({ width: 2, color: 0x2a2a30 });
    for (const [x, y] of [[-6, -10], [4, -14], [8, -6]]) g.circle(x, y, 2.5).fill(0xffd76a);
  }),
  node_herb: () => gfx((g) => {
    for (const a of [-0.9, -0.4, 0, 0.4, 0.9]) g.moveTo(0, 0).quadraticCurveTo(Math.sin(a) * 10, -10, Math.sin(a) * 14, -18).stroke({ width: 3, color: 0x5ad06a });
    g.circle(0, -20, 4).fill(0xffe0f0);
  }),
  node_wood: () => gfx((g) => {
    shadow(g, 14);
    g.ellipse(0, -8, 12, 6).fill(0x8a6a44).stroke({ width: 2, color: 0x4a3a22 });
    g.rect(-12, -8, 24, 8).fill(0x7a5a34);
    g.ellipse(0, 0, 12, 6).fill(0xc8a070).stroke({ width: 1.5, color: 0x4a3a22 });
  }),
  node_fish: () => gfx((g) => {
    g.ellipse(0, 0, 16, 8).stroke({ width: 2, color: 0xdff4ff, alpha: 0.8 });
    g.ellipse(0, 0, 9, 4).stroke({ width: 2, color: 0xdff4ff, alpha: 0.6 });
    g.poly([10, -14, 16, -10, 10, -6]).fill(0x9fd8ff);
  }),
  npc_cook: () => gfx((g) => {
    shadow(g, 14);
    g.roundRect(-10, -33, 20, 27, 7).fill(0xf0f0f0).stroke({ width: 2, color: 0x8a8a8a });
    g.circle(0, -40, 8).fill(0xf2c9a0).stroke({ width: 2, color: 0x7a5236 });
    g.roundRect(-8, -56, 16, 10, 4).fill(0xffffff).stroke({ width: 1.5, color: 0xaaaaaa });
    g.ellipse(14, -18, 8, 4).fill(0x6a6a72);
  }),
  npc_board: () => gfx((g) => {
    shadow(g, 16);
    g.rect(-12, -10, 3, 10).fill(0x5a3a22); g.rect(9, -10, 3, 10).fill(0x5a3a22);
    g.roundRect(-16, -40, 32, 30, 3).fill(0x8a6a44).stroke({ width: 2, color: 0x4a3a22 });
    for (const [x, y, c] of [[-10, -34, 0xf0e8d0], [2, -36, 0xffe0a0], [-6, -22, 0xe0f0ff], [6, -24, 0xf0e8d0]] as [number, number, number][]) g.rect(x, y, 8, 9).fill(c);
  }),
  npc_portal: () => gfx((g) => {
    g.ellipse(0, 0, 26, 13).fill({ color: 0x6a7aff, alpha: 0.35 }).stroke({ width: 2, color: 0x9fa8ff });
    g.ellipse(0, 0, 16, 8).stroke({ width: 2, color: 0xd0d8ff });
    for (const x of [-14, 0, 14]) g.rect(x - 1, -30, 2, 26).fill({ color: 0x9fa8ff, alpha: 0.5 });
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
  item_shield: () => gfx((g) => {
    g.poly([-8, -9, 8, -9, 8, 2, 0, 10, -8, 2]).fill(0x8a94a6).stroke({ width: 1.5, color: 0x3a3e48 });
    g.rect(-1, -8, 2, 16).fill(0xd8c070);
  }),
  item_book: () => gfx((g) => {
    g.roundRect(-8, -9, 16, 18, 2).fill(0x5a3a8a).stroke({ width: 1.5, color: 0x2a1a4a });
    g.rect(-6, -7, 12, 2).fill(0xe0c070);
  }),
  item_hat: () => gfx((g) => {
    g.ellipse(0, 4, 11, 4).fill(0x8a6a4a);
    g.roundRect(-6, -8, 12, 12, 4).fill(0x8a6a4a).stroke({ width: 1.5, color: 0x4a3a2a });
  }),
  item_ring: () => gfx((g) => {
    g.circle(0, 0, 6).stroke({ width: 3, color: 0xf3d36a });
    g.circle(0, -6, 3).fill(0x7cf0ff);
  }),
};

/**
 * 見た目つきのプレイヤー。body/hair は作成時の色、armor/head は装備（アバター）の見た目。
 * armor = { kind: light|heavy|cloth, color }、head = { kind: helm|hat|hood, color }
 */
export function makePlayerSprite(body: number, hair: number, armor?: { kind: string; color: number } | null, head?: { kind: string; color: number } | null): Container {
  return gfx((g) => {
    shadow(g, 13);
    g.roundRect(-9, -34, 18, 26, 7).fill(body).stroke({ width: 2, color: 0x1a1d26 });
    if (armor) {
      if (armor.kind === 'heavy') {
        g.roundRect(-11, -33, 22, 18, 5).fill(armor.color).stroke({ width: 2, color: 0x2a2e38 });
        g.circle(-11, -31, 5).fill(armor.color).stroke({ width: 1.5, color: 0x2a2e38 });
        g.circle(11, -31, 5).fill(armor.color).stroke({ width: 1.5, color: 0x2a2e38 });
      } else if (armor.kind === 'cloth') {
        g.poly([-11, -32, 11, -32, 13, -6, -13, -6]).fill(armor.color).stroke({ width: 1.5, color: 0x2a2e38 });
        g.rect(-2, -32, 4, 26).fill({ color: 0xffffff, alpha: 0.35 });
      } else {
        g.roundRect(-9, -31, 18, 14, 4).fill(armor.color).stroke({ width: 1.5, color: 0x2a2e38 });
      }
    }
    g.rect(-9, -16, 18, 4).fill(0x6b4a2b);
    g.circle(0, -40, 9).fill(0xf2c9a0).stroke({ width: 2, color: 0x7a5236 });
    g.moveTo(-9, -44).arc(0, -41, 9.5, Math.PI, 0).fill(hair);
    if (head) {
      if (head.kind === 'helm') {
        g.moveTo(-10, -40).arc(0, -41, 10.5, Math.PI, 0).fill(head.color);
        g.rect(-10, -42, 20, 3).fill(head.color).stroke({ width: 1, color: 0x2a2e38 });
        g.rect(-1.5, -52, 3, 8).fill(0xd84a3a);
      } else if (head.kind === 'hood') {
        g.moveTo(-11, -36).arc(0, -41, 11.5, Math.PI * 0.95, Math.PI * 0.05).fill(head.color);
      } else {
        g.ellipse(0, -47, 14, 4).fill(head.color).stroke({ width: 1, color: 0x2a2e38 });
        g.roundRect(-7, -56, 14, 10, 4).fill(head.color).stroke({ width: 1, color: 0x2a2e38 });
      }
    }
  });
}

/** 素材・消耗品の小さな印 */
export function makeBagIcon(color: number): Container {
  return gfx((g) => {
    g.circle(0, 0, 7).fill(color).stroke({ width: 2, color: 0x10141c });
    g.circle(-2, -2, 2).fill({ color: 0xffffff, alpha: 0.6 });
  });
}

function houseDrawer(roof: number): Container {
  return gfx((g) => {
    const hw = TILE_W / 2, hh = TILE_H / 2, h = 28;
    g.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(0xd8ccb0);
    g.poly([hw, 0, 0, hh, 0, hh - h, hw, -h]).fill(0xc0b498);
    g.rect(-hw / 2 - 4, -h + 10, 8, 10).fill(0x6a8aaa);
    g.poly([-hw - 4, -h, 0, -h - 26, hw + 4, -h, 0, hh - h + 4]).fill(roof).stroke({ width: 1.5, color: 0x2a2018 });
  });
}

export function makeSprite(name: string): Container {
  const d = DRAWERS[name];
  if (d) return d();
  // 未定義の名前は目立つ色の箱にする
  return gfx((g) => g.rect(-10, -20, 20, 20).fill(0xff00ff));
}

/** 武器の見た目（キャラの手元に出す） */
export function makeWeaponGlyph(weaponType: string | undefined, tint?: number): Graphics {
  const g = makeWeaponGlyphRaw(weaponType);
  if (tint !== undefined) g.tint = tint;
  return g;
}

function makeWeaponGlyphRaw(weaponType: string | undefined): Graphics {
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
