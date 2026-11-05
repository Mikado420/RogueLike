import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { CONTENT, currentWeather, dayPhase, isNight, type World } from '../../shared/src';
import { hex } from './colors';
import { TILE_H, TILE_W } from './iso';

interface Particle { x: number; y: number; v: number; s: number }

/** 昼夜・天候の色味、夜と霧の視界、雨・雪などの粒（画面に重ねる） */
export class Ambience {
  readonly layer = new Container();
  private tint = new Graphics();
  private vision: Sprite;
  private visionFill = new Graphics();
  private fx = new Graphics();
  private parts: Particle[] = [];
  private kind = '';
  private flash = 0;
  private time = 0;
  quality: 'high' | 'low' = 'high';

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const grd = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    this.vision = new Sprite(Texture.from(c));
    this.vision.anchor.set(0.5);
    this.layer.addChild(this.tint, this.fx, this.vision, this.visionFill);
  }

  update(w: World, cx: number, cy: number, zoom: number, sw: number, sh: number, dt: number) {
    this.time += dt;
    const amb = CONTENT.ambience;
    const phase = dayPhase(w);
    const weather = currentWeather(w);
    const indoor = w.area.type === 'dungeon' || w.area.type === 'tower' || w.area.type === 'raid';
    // 色味
    this.tint.clear();
    const layers: { color: string; alpha: number }[] = [];
    if (!indoor) {
      layers.push(amb.phases[phase] ?? { color: '#ffffff', alpha: 0 });
      if (amb.weather[weather]) layers.push(amb.weather[weather]);
    }
    if (amb.areaTint[w.area.id]) layers.push(amb.areaTint[w.area.id]);
    for (const l of layers) if (l.alpha > 0) this.tint.rect(0, 0, sw, sh).fill({ color: hex(l.color), alpha: l.alpha });

    // 視界（夜・霧）
    const night = isNight(w) && !indoor;
    const fog = weather === 'fog' && !indoor;
    let radius = 0;
    if (night && fog) radius = amb.vision.nightFog; else if (fog) radius = amb.vision.fog; else if (night) radius = amb.vision.night;
    if (indoor && amb.vision.dungeon > 0) radius = amb.vision.dungeon;
    const town = w.area.type === 'town';
    this.visionFill.clear();
    if (radius > 0) {
      const rx = radius * (TILE_W / 2) * Math.SQRT2 * zoom * 1.15;
      const ry = rx * (TILE_H / TILE_W);
      this.vision.visible = true;
      this.vision.width = rx * 2; this.vision.height = ry * 2;
      this.vision.x = cx; this.vision.y = cy;
      const alpha = amb.vision.darkness * (town ? 0.45 : 1);
      this.vision.alpha = alpha;
      this.vision.tint = fog && !night ? hex('#b8c0c8') : 0x000000;
      const col = fog && !night ? hex('#b8c0c8') : 0x000000;
      const l = cx - rx, r = cx + rx, t = cy - ry, b = cy + ry;
      if (t > 0) this.visionFill.rect(0, 0, sw, t);
      if (b < sh) this.visionFill.rect(0, b, sw, sh - b);
      if (l > 0) this.visionFill.rect(0, Math.max(0, t), l, Math.min(sh, b) - Math.max(0, t));
      if (r < sw) this.visionFill.rect(r, Math.max(0, t), sw - r, Math.min(sh, b) - Math.max(0, t));
      this.visionFill.fill({ color: col, alpha });
    } else this.vision.visible = false;

    // 粒
    const wd = indoor ? undefined : amb.weather[weather];
    const kind = wd?.particles ?? '';
    const count = Math.round((wd?.count ?? 0) * (this.quality === 'low' ? 0.35 : 1));
    if (kind !== this.kind || this.parts.length !== count) {
      this.kind = kind;
      this.parts = Array.from({ length: count }, () => ({ x: Math.random() * sw, y: Math.random() * sh, v: 0.6 + Math.random() * 0.8, s: Math.random() }));
    }
    this.fx.clear();
    for (const p of this.parts) {
      if (kind === 'rain') {
        p.x += -120 * dt * p.v; p.y += 900 * dt * p.v;
        this.fx.moveTo(p.x, p.y).lineTo(p.x - 4, p.y + 14);
      } else if (kind === 'snow') {
        p.x += Math.sin(this.time * 1.5 + p.s * 10) * 20 * dt; p.y += 50 * dt * p.v;
        this.fx.circle(p.x, p.y, 1.5 + p.s * 1.5);
      } else if (kind === 'ember') {
        p.x += Math.sin(this.time + p.s * 10) * 15 * dt; p.y -= 40 * dt * p.v;
        this.fx.circle(p.x, p.y, 1 + p.s);
      } else if (kind === 'aurora') {
        p.x += 10 * dt * p.v;
        this.fx.circle(p.x, (p.y * 0.25) + Math.sin(this.time * 0.8 + p.x * 0.01) * 20, 30 + p.s * 30);
      }
      if (p.y > sh + 20) { p.y = -20; p.x = Math.random() * sw; }
      if (p.y < -40) { p.y = sh + 20; p.x = Math.random() * sw; }
      if (p.x < -40) p.x = sw + 20;
      if (p.x > sw + 40) p.x = -20;
    }
    if (kind === 'rain') this.fx.stroke({ width: 1.2, color: 0xaac8ff, alpha: 0.45 });
    else if (kind === 'snow') this.fx.fill({ color: 0xffffff, alpha: 0.85 });
    else if (kind === 'ember') this.fx.fill({ color: 0xffa04a, alpha: 0.8 });
    else if (kind === 'aurora') this.fx.fill({ color: 0x7affc8, alpha: 0.06 });
    // 雷
    if (wd?.flash && Math.random() < dt * 0.15) this.flash = 0.6;
    if (this.flash > 0) {
      this.tint.rect(0, 0, sw, sh).fill({ color: 0xffffff, alpha: this.flash });
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }
  }
}
