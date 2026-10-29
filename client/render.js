// 描画。すべて低解像度のキャンバスに描き、CSSで拡大する。
import { generateSprite, spriteKey } from '../shared/sprite.js';
import { ELEMENT_INFO } from '../shared/elements.js';
import { TILE } from '../shared/dungeon.js';
import { TOWN, SPOTS } from './town.js';

const HERO = [
  '....KKKK....', '...KHHHHK...', '..KHHHHHHK..', '..KHSSSSHK..', '..KSKSSKSK..', '..KSSSSSSK..', '...KSSSSK...',
  '..KTTTTTTK..', '.KSKTTTTKSK.', '.KSKTttTKSK.', '..KTTTTTTK..',
];
const LEGS_A = ['..KttKKttK..', '..KBBK.KBBK.', '..KKK..KKK..'];
const LEGS_B = ['...KtKKtK...', '...KBKKBK...', '...KKK.KKK..'];
const TUNICS = [['#2c64fc', '#0038b8'], ['#e43c3c', '#a00000'], ['#3cbc3c', '#007800'], ['#9c5cfc', '#5020b0'], ['#fc8c28', '#b84800'], ['#28c8d8', '#007888'], ['#f878c8', '#b82880'], ['#e8d020', '#987800']];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cache = new Map();
    this.mapCanvas = null;
    this.townCanvas = null;
    this.fx = [];
    this.nums = [];
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const W = innerWidth, H = innerHeight;
    const s = Math.max(1, Math.min(Math.max(W, H) / 320, Math.min(W, H) / 150));
    this.canvas.width = Math.round(W / s);
    this.canvas.height = Math.round(H / s);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  get w() { return this.canvas.width; }
  get h() { return this.canvas.height; }

  // ---- スプライト ----
  monsterSprite(g) {
    const key = 'm' + spriteKey(g);
    let c = this.cache.get(key);
    if (c) return c;
    const s = generateSprite(g);
    c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const x = c.getContext('2d');
    for (let i = 0; i < s.px.length; i++) {
      const v = s.px[i];
      if (!v) continue;
      x.fillStyle = s.palette[v];
      x.fillRect(i % s.w, Math.floor(i / s.w), 1, 1);
    }
    // 被弾時の白い版
    const flash = document.createElement('canvas');
    flash.width = s.w; flash.height = s.h;
    const fx = flash.getContext('2d');
    fx.drawImage(c, 0, 0);
    fx.globalCompositeOperation = 'source-atop';
    fx.fillStyle = '#fff';
    fx.fillRect(0, 0, s.w, s.h);
    c.flash = flash;
    this.cache.set(key, c);
    return c;
  }

  heroSprite(color, frame, flash = false) {
    const key = `h${color}${frame}${flash ? 'f' : ''}`;
    let c = this.cache.get(key);
    if (c) return c;
    const rows = HERO.concat(frame ? LEGS_B : LEGS_A);
    const [t, td] = TUNICS[color % TUNICS.length];
    const pal = { K: '#101018', H: '#6c3c14', S: '#fcc8a0', T: t, t: td, B: '#503000', W: '#fcfcfc' };
    c = document.createElement('canvas');
    c.width = 12; c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, i) => { if (ch !== '.') { x.fillStyle = flash ? '#fff' : pal[ch]; x.fillRect(i, y, 1, 1); } }));
    this.cache.set(key, c);
    return c;
  }

  // ---- 地形 ----
  buildMap(map) {
    const env = ELEMENT_INFO[map.env] || ELEMENT_INFO.none;
    const c = document.createElement('canvas');
    c.width = map.w * TILE; c.height = map.h * TILE;
    const x = c.getContext('2d');
    const floorA = mix(env.dark, '#181820', 0.55), floorB = mix(env.dark, '#181820', 0.68);
    const wallTop = mix(env.color, '#303040', 0.45), wallFace = mix(env.dark, '#000', 0.4);
    const at = (tx, ty) => (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? '0' : map.tiles[ty * map.w + tx]);
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const px = tx * TILE, py = ty * TILE;
      if (at(tx, ty) === '1') {
        x.fillStyle = (tx + ty) % 2 ? floorA : floorB;
        x.fillRect(px, py, TILE, TILE);
        x.fillStyle = mix(env.color, floorA, 0.85);
        if ((tx * 7 + ty * 13) % 5 === 0) x.fillRect(px + 4, py + 9, 2, 1);
        if ((tx * 3 + ty * 11) % 7 === 0) x.fillRect(px + 11, py + 4, 1, 2);
      } else {
        x.fillStyle = '#06060a';
        x.fillRect(px, py, TILE, TILE);
        if (at(tx, ty + 1) === '1') {
          x.fillStyle = wallFace; x.fillRect(px, py + 6, TILE, 10);
          x.fillStyle = wallTop; x.fillRect(px, py, TILE, 6);
          x.fillStyle = '#000'; x.fillRect(px + (ty % 2 ? 7 : 3), py + 8, 1, 8);
        } else if ([at(tx - 1, ty), at(tx + 1, ty), at(tx, ty - 1)].includes('1')) {
          x.fillStyle = wallTop; x.fillRect(px, py, TILE, TILE);
          x.fillStyle = mix(wallTop, '#000', 0.3); x.fillRect(px, py + TILE - 2, TILE, 2);
        }
      }
    }
    this.mapCanvas = c;
    this.mapEnv = env;
  }

  buildTown() {
    const c = document.createElement('canvas');
    c.width = TOWN.w * 16; c.height = TOWN.h * 16;
    const x = c.getContext('2d');
    for (let ty = 0; ty < TOWN.h; ty++) for (let tx = 0; tx < TOWN.w; tx++) {
      const ch = TOWN.tiles[ty * TOWN.w + tx];
      const px = tx * 16, py = ty * 16;
      const below = TOWN.tiles[(ty + 1) * TOWN.w + tx];
      x.fillStyle = (tx + ty) % 2 ? '#3c8c28' : '#449830';
      x.fillRect(px, py, 16, 16);
      if (ch === ',') { x.fillStyle = '#a49c88'; x.fillRect(px, py, 16, 16); x.fillStyle = '#8c8470'; x.fillRect(px, py + 7, 16, 1); x.fillRect(px + (ty % 2 ? 4 : 10), py, 1, 7); x.fillRect(px + (ty % 2 ? 10 : 4), py + 8, 1, 8); }
      if (ch === '.') { x.fillStyle = '#58a838'; if ((tx * 5 + ty * 3) % 4 === 0) x.fillRect(px + 5, py + 6, 1, 3); }
      if (ch === '~') { x.fillStyle = '#2c64d8'; x.fillRect(px, py, 16, 16); x.fillStyle = '#7cb8fc'; x.fillRect(px + 3, py + 5, 5, 1); x.fillRect(px + 9, py + 11, 4, 1); }
      if (ch === 'T') { x.fillStyle = '#185c10'; x.fillRect(px + 2, py + 1, 12, 11); x.fillStyle = '#28801c'; x.fillRect(px + 4, py + 2, 6, 5); x.fillStyle = '#6c3c14'; x.fillRect(px + 7, py + 12, 2, 4); }
      if (ch === '#') {
        const edge = tx === 0 || ty === 0 || tx === TOWN.w - 1 || ty === TOWN.h - 1;
        if (edge) { x.fillStyle = '#686868'; x.fillRect(px, py, 16, 16); x.fillStyle = '#888'; x.fillRect(px, py, 16, 3); x.fillStyle = '#505050'; x.fillRect(px + (ty % 2 ? 8 : 0), py + 8, 1, 8); }
        else if (below !== '#') { x.fillStyle = '#a86c38'; x.fillRect(px, py, 16, 16); x.fillStyle = '#704020'; x.fillRect(px, py + 15, 16, 1); x.fillRect(px + 7, py + 4, 2, 12); }
        else { x.fillStyle = '#b82c1c'; x.fillRect(px, py, 16, 16); x.fillStyle = '#d84828'; x.fillRect(px, py + (ty % 2) * 8, 16, 2); }
      }
    }
    this.townCanvas = c;
  }

  // ---- 1フレームの描画 ----
  begin(cam) {
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      const a = this.shakeAmp * Math.min(1, this.shakeT / 0.15);
      sx = Math.round((Math.random() * 2 - 1) * a);
      sy = Math.round((Math.random() * 2 - 1) * a);
    }
    this.cx = Math.round(cam.x - this.w / 2) + sx;
    this.cy = Math.round(cam.y - this.h / 2) + sy;
  }

  /** 画面を揺らす（被弾・会心） */
  shake(amp, dur = 0.15) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.shakeAmp = Math.max(this.shakeT > 0 ? this.shakeAmp : 0, amp);
    this.shakeT = Math.max(this.shakeT || 0, dur);
  }
  tickShake(dt) { this.shakeT = Math.max(0, (this.shakeT || 0) - dt); }

  /** 自動で狙っている敵の目印 */
  drawTarget(x, y, r, time) {
    const { ctx } = this;
    const px = Math.round(x - this.cx), py = Math.round(y - this.cy);
    const s = Math.round(r + 5 + Math.sin(time * 8) * 1.5), L = 3;
    ctx.fillStyle = '#f8b800';
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = px + dx * s, cy = py - 3 + dy * s;
      ctx.fillRect(cx - (dx > 0 ? L - 1 : 0), cy, L, 1);
      ctx.fillRect(cx, cy - (dy > 0 ? L - 1 : 0), 1, L);
    }
  }

  /** 足元の範囲（攻撃の向き） */
  drawAim(x, y, a, len) {
    const { ctx } = this;
    const px = x - this.cx, py = y - this.cy;
    ctx.fillStyle = 'rgba(252,252,252,.55)';
    for (let i = 1; i <= 3; i++) {
      const d = 8 + i * (len / 4);
      ctx.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + 2 + Math.sin(a) * d), 1, 1);
    }
  }

  drawTown(time, raidOpen, near) {
    if (!this.townCanvas) this.buildTown();
    this.ctx.drawImage(this.townCanvas, -this.cx, -this.cy);
    for (const s of SPOTS) {
      if (s.raidOnly && !raidOpen) continue;
      const x = s.x - this.cx, y = s.y - this.cy;
      const glow = s.id === 'raid' || (near && near.id === s.id);
      this.ctx.fillStyle = s.id === 'raid' ? (Math.floor(time * 4) % 2 ? '#f8b800' : '#fc7460') : '#000';
      this.ctx.fillRect(x - 7, y - 20, 14, 12);
      this.ctx.strokeStyle = glow ? '#f8b800' : '#fcfcfc';
      this.ctx.strokeRect(x - 6.5, y - 19.5, 13, 11);
      this.text(s.sign, x, y - 10, glow ? '#f8b800' : '#fcfcfc', 9, 'jp');
    }
  }

  drawMap() { this.ctx.drawImage(this.mapCanvas, -this.cx, -this.cy); }

  drawMarker(pt, kind, time) {
    if (!pt) return;
    const x = Math.round(pt.x - this.cx), y = Math.round(pt.y - this.cy);
    const { ctx } = this;
    if (kind === 'stairs') {
      ctx.fillStyle = '#000'; ctx.fillRect(x - 8, y - 8, 16, 16);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = ['#bcbcbc', '#9c9c9c', '#7c7c7c', '#5c5c5c'][i]; ctx.fillRect(x - 8 + i * 2, y - 8 + i * 4, 16 - i * 4, 3); }
      this.text('下へ', x, y - 12, '#fcfcfc', 8, 'jp');
    } else {
      const r = 7 + Math.sin(time * 4) * 1.5;
      ctx.strokeStyle = '#3cbcfc'; ctx.beginPath(); ctx.ellipse(x, y, r + 2, (r + 2) * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fcfcfc'; ctx.beginPath(); ctx.ellipse(x, y, r - 2, (r - 2) * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      this.text('脱出', x, y - 12, '#3cbcfc', 8, 'jp');
    }
  }

  drawHero(e, time) {
    const x = Math.round(e.x - this.cx), y = Math.round(e.y - this.cy);
    if (x < -20 || y < -24 || x > this.w + 20 || y > this.h + 24) return;
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x - 5, y + 5, 10, 2);
    if (e.down) {
      ctx.save(); ctx.translate(x, y + 2); ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = 0.7; ctx.drawImage(this.heroSprite(e.color, 0), -6, -10); ctx.restore();
      this.text(`${e.downT}`, x, y - 12, '#fc6c6c', 8);
      if (e.revive) { ctx.fillStyle = '#000'; ctx.fillRect(x - 9, y - 20, 18, 3); ctx.fillStyle = '#58d854'; ctx.fillRect(x - 9, y - 20, 18 * e.revive / 100, 3); }
      return;
    }
    if (e.dodge) ctx.globalAlpha = 0.5;
    const moving = e.moving;
    const frame = moving ? Math.floor(time * 8) % 2 : 0;
    const img = this.heroSprite(e.color, frame, e.hurt);
    const flip = Math.cos(e.dir) < 0;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -6, -10 - (moving && frame ? 1 : 0));
    ctx.restore();
    this.drawWeapon(e, x, y);
    ctx.globalAlpha = 1;
    if (e.guard) { ctx.strokeStyle = '#f8d878'; ctx.beginPath(); ctx.arc(x, y - 2, 11, 0, Math.PI * 2); ctx.stroke(); }
    if (e.haste) { ctx.fillStyle = '#b8f8b8'; ctx.fillRect(x - 9, y + 2, 2, 1); ctx.fillRect(x + 7, y - 2, 2, 1); }
    if (e.status) this.drawStatus(e.status, x, y - 18);
    if (e.name) this.text(e.name, x, y - 14, e.me ? '#f8b800' : '#fcfcfc', 8, 'jp');
  }

  drawWeapon(e, x, y) {
    const { ctx } = this;
    const a = e.dir;
    const el = ELEMENT_INFO[e.el] || ELEMENT_INFO.none;
    const swing = e.attack ? 1 : 0;
    const hx = x + Math.cos(a) * 4, hy = y - 1 + Math.sin(a) * 3;
    const len = e.weapon === 'spear' ? 14 : e.weapon === 'staff' ? 10 : e.weapon === 'bow' ? 6 : 9;
    const aa = a + (e.weapon === 'sword' && swing ? 0.9 : 0);
    ctx.strokeStyle = e.weapon === 'staff' || e.weapon === 'bow' ? '#a86c38' : '#dcdcdc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(aa) * len * (e.weapon === 'spear' && swing ? 1.4 : 1), hy + Math.sin(aa) * len);
    ctx.stroke();
    if (e.weapon === 'staff') { ctx.fillStyle = el.color; ctx.fillRect(hx + Math.cos(aa) * len - 1.5, hy + Math.sin(aa) * len - 1.5, 3, 3); }
    if (e.weapon === 'bow') { ctx.strokeStyle = '#a86c38'; ctx.beginPath(); ctx.arc(hx, hy, 5, a - 1, a + 1); ctx.stroke(); }
    ctx.lineWidth = 1;
  }

  drawMonster(m, info, time) {
    const x = Math.round(m.x - this.cx), y = Math.round(m.y - this.cy);
    if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) return;
    const img = this.monsterSprite(info.g);
    const scale = info.boss ? 2.2 : 0.6 + info.g.size * 0.4;
    const w = img.width * scale, h = img.height * scale;
    const fly = info.fly && !m.grounded ? 4 + Math.sin(time * 6 + m.id) * 2 : 0;
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x - w * 0.3, y + h * 0.28, w * 0.6, 2);
    const bob = m.attacking ? -2 : Math.round(Math.sin(time * 5 + m.id) * 0.6);
    ctx.drawImage(m.hurt ? img.flash : img, Math.round(x - w / 2), Math.round(y - h * 0.65 - fly + bob), w, h);
    if (m.frozen) { ctx.fillStyle = 'rgba(160,240,252,.45)'; ctx.fillRect(x - w / 2, y - h * 0.65 - fly, w, h); }
    if (info.mut || info.end) { ctx.fillStyle = info.mut ? '#fc74b4' : '#fc6c6c'; ctx.fillRect(x - 1, y - h * 0.65 - fly - 5, 2, 2); }
    if (m.hp < m.maxHp && !info.boss) {
      const bw = Math.max(12, w * 0.7);
      ctx.fillStyle = '#000'; ctx.fillRect(x - bw / 2 - 1, y - h * 0.65 - fly - 3, bw + 2, 3);
      ctx.fillStyle = '#d82800'; ctx.fillRect(x - bw / 2, y - h * 0.65 - fly - 2, bw * m.hp / m.maxHp, 1);
    }
    if (m.status) this.drawStatus(m.status, x, y - h * 0.65 - fly - 9);
  }

  drawStatus(list, x, y) {
    const map = { burn: '#e45c10', wet: '#3c8cfc', freeze: '#58d8d8', slow: '#ac7c00', paralyze: '#f8b800', blind: '#fcfcfc', curse: '#9878f8', poison: '#a040d0', grounded: '#58d854' };
    const items = list.split(',').filter((s) => map[s]);
    items.forEach((s, i) => { this.ctx.fillStyle = map[s]; this.ctx.fillRect(Math.round(x - items.length * 2 + i * 4), Math.round(y), 3, 3); });
  }

  drawProjectile(p) {
    const [, px, py, kind, el, ang] = p;
    const x = Math.round(px - this.cx), y = Math.round(py - this.cy);
    const c = (ELEMENT_INFO[el] || ELEMENT_INFO.none);
    const { ctx } = this;
    if (kind === 'arrow') {
      ctx.strokeStyle = '#fcfcfc'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 6, y - Math.sin(ang) * 6); ctx.stroke();
      ctx.fillStyle = c.color; ctx.fillRect(x - 1, y - 1, 2, 2);
    } else if (kind === 'wave') {
      ctx.fillStyle = c.light; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(x, y, 9, ang - 1.2, ang + 1.2); ctx.lineTo(x, y); ctx.fill(); ctx.globalAlpha = 1;
    } else if (kind === 'bolt') {
      ctx.strokeStyle = c.light; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 10 + 2, y - Math.sin(ang) * 10 - 2); ctx.stroke();
    } else {
      const r = kind === 'fireball' ? 4 : kind === 'mshot' ? 3 : 3;
      ctx.fillStyle = kind === 'mshot' ? '#000' : c.dark;
      ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
      ctx.fillStyle = c.color; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = c.light; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // ---- 演出 ----
  addFx(ev) { this.fx.push({ ...ev, t: 0 }); }
  addNum(x, y, text, color, big = false) { this.nums.push({ x, y, text: String(text), color, big, t: 0 }); }

  drawFx(dt) {
    const { ctx } = this;
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const x = f.x - this.cx, y = f.y - this.cy;
      const c = (ELEMENT_INFO[f.e] || ELEMENT_INFO.none);
      const k = f.t / 0.25;
      if (f.k === 'slash' || f.k === 'gale') {
        ctx.strokeStyle = f.k === 'gale' ? c.light : '#fcfcfc';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, f.k === 'gale' ? 30 + k * 20 : 16 + k * 6, f.a - 0.9, f.a + 0.9); ctx.stroke();
        ctx.lineWidth = 1;
        return f.t < 0.18;
      }
      if (f.k === 'thrust' || f.k === 'ray') {
        const len = f.k === 'ray' ? 130 : 36;
        ctx.strokeStyle = f.k === 'ray' ? c.light : '#fcfcfc';
        ctx.lineWidth = f.k === 'ray' ? 4 - k * 3 : 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(f.a) * len, y + Math.sin(f.a) * len); ctx.stroke();
        ctx.lineWidth = 1;
        return f.t < 0.2;
      }
      if (f.k === 'ring') {
        ctx.strokeStyle = c.color; ctx.globalAlpha = 1 - f.t / 0.35;
        ctx.beginPath(); ctx.arc(x, y, f.r * Math.min(1, f.t / 0.2), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        return f.t < 0.35;
      }
      if (f.k === 'buff' || f.k === 'potion') {
        ctx.fillStyle = f.k === 'potion' ? '#58d854' : '#f8d878';
        for (let i = 0; i < 6; i++) ctx.fillRect(x + Math.cos(i + f.t * 8) * 10, y - f.t * 30 + Math.sin(i * 2) * 4, 2, 2);
        return f.t < 0.6;
      }
      if (f.k === 'puff') {
        ctx.fillStyle = f.c || '#fcfcfc';
        for (let i = 0; i < 8; i++) { const a = i * 0.785; ctx.fillRect(x + Math.cos(a) * f.t * 50, y + Math.sin(a) * f.t * 50, 2, 2); }
        return f.t < 0.4;
      }
      if (f.k === 'call' || f.k === 'roar') {
        ctx.strokeStyle = '#fc6c6c'; ctx.beginPath(); ctx.arc(x, y, f.t * 120, 0, Math.PI * 2); ctx.stroke();
        this.text('！', x, y - 18, '#fc6c6c', 10, 'jp');
        return f.t < 0.5;
      }
      return false;
    });
    this.nums = this.nums.filter((n) => {
      n.t += dt;
      const x = n.x - this.cx, y = n.y - this.cy - n.t * 22;
      this.text(n.text, x, y, n.color, n.big ? 10 : 8);
      return n.t < 0.8;
    });
  }

  text(str, x, y, color = '#fcfcfc', size = 8, font = 'num') {
    const { ctx } = this;
    ctx.font = font === 'jp' ? `${size + 2}px DotGothic16, monospace` : `${size}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(str, Math.round(x) + 1, Math.round(y) + 1);
    ctx.fillStyle = color;
    ctx.fillText(str, Math.round(x), Math.round(y));
  }

  /** 画面外の目的地を指す矢印 */
  drawPointer(pt, color, label) {
    if (!pt) return;
    const x = pt.x - this.cx, y = pt.y - this.cy;
    if (x > 8 && y > 8 && x < this.w - 8 && y < this.h - 8) return;
    const cx = this.w / 2, cy = this.h / 2;
    const a = Math.atan2(y - cy, x - cx);
    const dx = x - cx, dy = y - cy;
    const t = Math.min((this.w / 2 - 12) / Math.max(1e-6, Math.abs(dx)), (this.h / 2 - 12) / Math.max(1e-6, Math.abs(dy)));
    const px = cx + dx * t, py = cy + dy * t;
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6);
    ctx.lineTo(px + Math.cos(a + 2.5) * 5, py + Math.sin(a + 2.5) * 5);
    ctx.lineTo(px + Math.cos(a - 2.5) * 5, py + Math.sin(a - 2.5) * 5);
    ctx.fill();
    this.text(label, px - Math.cos(a) * 10, py - Math.sin(a) * 10, color, 7, 'jp');
  }
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
