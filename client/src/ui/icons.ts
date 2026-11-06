import { CONTENT, type Item } from '../../../shared/src';

/**
 * アイテムのイラスト（塗りの小さな絵）。
 * 1枚ずつ閉じた SVG を data: の画像にする（SVG の id が画面上でぶつからず、ブラウザが絵を使い回せる）。
 * 装備は「ベースの形 × ティアの金属色 × 属性・レアリティの宝石色」、袋のアイテムは「種類の形 × 素材の色」で描く。
 */

const OL = '#141720';
const O = `stroke="${OL}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
const O15 = `stroke="${OL}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;

const ELEMENT: Record<string, string> = {
  fire: '#ff6a3d', water: '#4ab3ff', wind: '#6fe39a', earth: '#d8a24a', light: '#fff27a', dark: '#b57dff',
};
const WOOD = '#8a5a32';
const LEATHER = '#7a4a2a';
const GOLD = '#e8b84a';
const CLOTH = '#3c56a8';

// ───────── 色 ─────────

function rgb(c: string): [number, number, number] {
  const s = c.replace('#', '');
  const f = s.length === 3 ? s.split('').map((x) => x + x).join('') : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const light = (c: string, t = 0.5) => mix(c, '#ffffff', t);
const dark = (c: string, t = 0.45) => mix(c, '#000000', t);

/** 斜めの立体グラデーション（左上が明るい） */
function lg(id: string, c: string, hi = 0.55, lo = 0.45): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light(c, hi)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${dark(c, lo)}"/></linearGradient>`;
}
/** 横向きのグラデーション（筒や刃の丸み） */
function hg(id: string, c: string): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dark(c, 0.35)}"/><stop offset=".35" stop-color="${light(c, 0.55)}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${dark(c, 0.5)}"/></linearGradient>`;
}
/** 光る玉 */
function rg(id: string, c: string): string {
  return `<radialGradient id="${id}" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".25" stop-color="${light(c, 0.5)}"/><stop offset=".7" stop-color="${c}"/><stop offset="1" stop-color="${dark(c, 0.45)}"/></radialGradient>`;
}

const HL = (d: string, w = 1.6, o = 0.6) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`;
const shadow = (rx = 18) => `<ellipse cx="32" cy="58" rx="${rx}" ry="3.2" fill="#000" opacity=".28"/>`;

interface Paint { defs: string; body: string; shadow?: number | false }

function wrap(p: Paint, glow?: string, sparkle = 0): string {
  let defs = p.defs;
  let pre = '';
  if (glow) {
    defs += `<radialGradient id="glw"><stop offset="0" stop-color="${glow}" stop-opacity=".55"/><stop offset=".6" stop-color="${glow}" stop-opacity=".18"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>`;
    pre = `<circle cx="32" cy="32" r="31" fill="url(#glw)"/>`;
  }
  const sh = p.shadow === false ? '' : shadow(p.shadow ?? 18);
  let post = '';
  if (sparkle > 0) {
    const star = (x: number, y: number, r: number) => `<path d="M${x} ${y - r}L${x + r * 0.28} ${y - r * 0.28}L${x + r} ${y}L${x + r * 0.28} ${y + r * 0.28}L${x} ${y + r}L${x - r * 0.28} ${y + r * 0.28}L${x - r} ${y}L${x - r * 0.28} ${y - r * 0.28}Z" fill="#fff"/>`;
    post += star(53, 11, 4.5);
    if (sparkle > 1) post += star(10, 50, 3.2) + star(56, 44, 2.4);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${pre}${sh}${p.body}${post}</svg>`;
}

const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// ───────── 装備 ─────────

interface Look { metal: string; gem: string; cloth: string }

/** 立てた剣（tip が上）。w は刃の幅、len は刃の長さ */
function blade(m: string, w: number, len: number, guardW: number, gripLen: number): string {
  const top = 30 - (len + gripLen + 8) / 2 + 2;
  const bottom = top + len;
  const x0 = 32 - w / 2, x1 = 32 + w / 2;
  const g = bottom + 2;
  return `<path d="M32 ${top} L${x1} ${top + w * 0.9} L${x1} ${bottom} L${x0} ${bottom} L${x0} ${top + w * 0.9} Z" fill="url(#m)" ${O}/>`
    + `<path d="M32 ${top + w} L32 ${bottom - 2}" stroke="${dark(m, 0.35)}" stroke-width="1.4" stroke-linecap="round"/>`
    + HL(`M${x0 + 1.8} ${top + w * 1.1} L${x0 + 1.8} ${bottom - 2}`, 1.4, 0.7)
    + `<rect x="${32 - guardW / 2}" y="${g - 2}" width="${guardW}" height="5" rx="2.2" fill="url(#gd)" ${O}/>`
    + `<rect x="29.2" y="${g + 3}" width="5.6" height="${gripLen}" rx="1.6" fill="${LEATHER}" ${O15}/>`
    + `<path d="M29.4 ${g + 6} L34.6 ${g + 4.6} M29.4 ${g + 9} L34.6 ${g + 7.6}" stroke="${dark(LEATHER, 0.4)}" stroke-width="1.1"/>`
    + `<circle cx="32" cy="${g + gripLen + 5}" r="3.2" fill="url(#gd)" ${O15}/>`;
}

function equipShape(kind: string, slot: string, L: Look): Paint {
  const m = L.metal;
  const md = lg('m', m) + lg('gd', GOLD, 0.6, 0.4);
  switch (kind) {
    case 'oneHandSword':
      return { defs: md, body: `<g transform="rotate(45 32 32) translate(32 32) scale(1.2) translate(-32 -32)">${blade(m, 9, 30, 22, 9)}</g>` };
    case 'twoHandSword':
      return { defs: md, body: `<g transform="rotate(45 32 32) translate(32 32) scale(1.18) translate(-32 -32)">${blade(m, 13, 32, 30, 11)}</g>` };
    case 'dualSwords':
      return {
        defs: md,
        body: `<g transform="translate(32 32) rotate(-38) scale(.96) translate(-32 -30)">${blade(m, 8, 28, 18, 8)}</g>`
          + `<g transform="translate(32 32) rotate(38) scale(.96) translate(-32 -30)">${blade(m, 8, 28, 18, 8)}</g>`,
      };
    case 'dagger':
      return { defs: md, body: `<g transform="rotate(35 32 32) translate(32 33) scale(1.12) translate(-32 -32)">${blade(m, 10, 22, 20, 8)}</g>` };
    case 'spear':
      return {
        defs: md + hg('wd', WOOD),
        body: `<g transform="rotate(45 32 32)">`
          + `<rect x="30" y="20" width="4.4" height="42" rx="2" fill="url(#wd)" ${O15}/>`
          + `<path d="M32 1 L38 12 L35 22 L29 22 L26 12 Z" fill="url(#m)" ${O}/>`
          + HL('M29 12 L31 4', 1.3, 0.7)
          + `<rect x="28.2" y="21" width="8" height="4" rx="1.5" fill="url(#gd)" ${O15}/>`
          + `<path d="M36 24 C 40 28 40 32 37 35 M35 25 C 38 30 37 33 35 35" stroke="#d6403a" stroke-width="2" fill="none" stroke-linecap="round"/>`
          + `</g>`,
      };
    case 'scythe':
      return {
        defs: md + hg('wd', WOOD),
        body: `<g transform="rotate(22 32 32)">`
          + `<rect x="33" y="8" width="4.4" height="54" rx="2" fill="url(#wd)" ${O15}/>`
          + `<path d="M35 12 C 22 4 8 8 3 24 C 12 16 22 15 35 20 Z" fill="url(#m)" ${O}/>`
          + HL('M8 20 C 14 13 22 11 31 13', 1.3, 0.7)
          + `<rect x="31.6" y="12" width="7.2" height="9" rx="2" fill="url(#gd)" ${O15}/>`
          + `</g>`,
      };
    case 'staff':
      return {
        defs: md + hg('wd', WOOD) + rg('gm', L.gem),
        body: `<g transform="rotate(28 32 32)">`
          + `<rect x="30" y="20" width="4.6" height="42" rx="2.2" fill="url(#wd)" ${O15}/>`
          + `<circle cx="32.3" cy="13" r="8.4" fill="url(#gm)" ${O}/>`
          + `<path d="M24 16 C 22 8 27 3 30 4 M40.6 16 C 42.6 8 37.6 3 34.6 4" stroke="url(#m)" stroke-width="3.4" fill="none" stroke-linecap="round"/>`
          + `<path d="M24 16 C 22 8 27 3 30 4 M40.6 16 C 42.6 8 37.6 3 34.6 4" stroke="${OL}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".55"/>`
          + `<rect x="27.6" y="20" width="9.4" height="4.4" rx="1.6" fill="url(#gd)" ${O15}/>`
          + `</g>`,
      };
    case 'bow':
      return {
        defs: md + lg('wd', WOOD, 0.4, 0.4),
        body: `<g transform="rotate(35 32 32)">`
          + `<path d="M24 5 L24 59" stroke="#e9e2cf" stroke-width="1.2"/>`
          + `<path d="M24 5 C 46 14 46 50 24 59" stroke="${OL}" stroke-width="7" fill="none" stroke-linecap="round"/>`
          + `<path d="M24 5 C 46 14 46 50 24 59" stroke="url(#wd)" stroke-width="4.4" fill="none" stroke-linecap="round"/>`
          + HL('M28 9 C 37 15 40 22 40.5 28', 1.1, 0.6)
          + `<rect x="36.6" y="26" width="5.6" height="12" rx="2" fill="${LEATHER}" ${O15}/>`
          + `<circle cx="24" cy="5" r="2.6" fill="url(#m)" ${O15}/><circle cx="24" cy="59" r="2.6" fill="url(#m)" ${O15}/>`
          + `</g>`,
      };
    case 'gun':
      return {
        defs: md + lg('wd', WOOD, 0.4, 0.45),
        body: `<g transform="rotate(-12 32 32)">`
          + `<rect x="12" y="20" width="42" height="10" rx="2.6" fill="url(#m)" ${O}/>`
          + `<rect x="50" y="22" width="6" height="6" rx="1" fill="${dark(m, 0.5)}" ${O15}/>`
          + HL('M15 22.6 L48 22.6', 1.2, 0.7)
          + `<path d="M16 29 L30 29 L27 52 L13 52 Z" fill="url(#wd)" ${O}/>`
          + `<path d="M30 30 C 30 38 36 38 37 31" fill="none" ${O15}/>`
          + `<path d="M31 30 L32 35" stroke="${OL}" stroke-width="1.8"/>`
          + `<circle cx="20" cy="25" r="1.6" fill="url(#gd)"/>`
          + `</g>`,
        shadow: 20,
      };
    case 'knuckles':
      return {
        defs: md,
        body: `<g transform="rotate(-10 32 34)">`
          + [16, 25.4, 34.8, 44.2].map((x) => `<path d="M${x - 2.4} 18 L${x} 11 L${x + 2.4} 18 Z" fill="url(#gd)" ${O15}/>`).join('')
          + `<path d="M8 26 C 8 19 12 17 16 17 L48 17 C 52 17 56 19 56 26 C 56 31 53 34 49 34 L46 34 C 46 44 40 50 32 50 C 24 50 18 44 18 34 L15 34 C 11 34 8 31 8 26 Z" fill="url(#m)" ${O}/>`
          + [16, 25.4, 34.8, 44.2].map((x) => `<ellipse cx="${x + 0.2}" cy="25.6" rx="3.6" ry="3.9" fill="#141720"/>`).join('')
          + `<path d="M22 38 C 26 44 38 44 42 38" stroke="${dark(m, 0.35)}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
          + HL('M11 24 C 11 21 13 19.6 16 19.6 L46 19.6', 1.4, 0.75)
          + `</g>`,
      };
    case 'instrument':
      return {
        defs: lg('wd', '#c8843c', 0.45, 0.4) + lg('nk', '#6a4024', 0.3, 0.4) + lg('gd', GOLD, 0.6, 0.4),
        body: `<g transform="rotate(-32 32 34)">`
          + `<rect x="28.6" y="3" width="6.8" height="28" rx="2" fill="url(#nk)" ${O15}/>`
          + `<path d="M27.6 3 L36.4 3 L35 -1 L29 -1 Z" fill="url(#nk)" ${O15}/>`
          + `<path d="M32 22 C 46 22 49 36 47 46 C 45 56 38 60 32 60 C 26 60 19 56 17 46 C 15 36 18 22 32 22 Z" fill="url(#wd)" ${O}/>`
          + `<circle cx="32" cy="40" r="4.6" fill="#2a1a10" ${O15}/>`
          + `<path d="M30.4 4 L30.4 53 M32 4 L32 53 M33.6 4 L33.6 53" stroke="#efe6cf" stroke-width=".7"/>`
          + `<rect x="26.6" y="51" width="10.8" height="3" rx="1" fill="url(#gd)" ${O15}/>`
          + HL('M21 34 C 22 28 26 25 30 24.4', 1.4, 0.6)
          + `</g>`,
      };
    case 'shield':
      return {
        defs: md + lg('fc', L.cloth, 0.35, 0.45) + lg('gd', GOLD, 0.6, 0.4),
        body: `<path d="M32 5 L53 11 L51 33 C 49 46 41 54 32 59 C 23 54 15 46 13 33 L11 11 Z" fill="url(#m)" ${O}/>`
          + `<path d="M32 10 L48 14.6 L46.6 32.4 C 45 42 39 49 32 53 C 25 49 19 42 17.4 32.4 L16 14.6 Z" fill="url(#fc)" ${O15}/>`
          + `<path d="M32 15 L32 49 M20 28 L44 28" stroke="url(#gd)" stroke-width="4.4" stroke-linecap="round"/>`
          + `<circle cx="32" cy="28" r="4.2" fill="url(#gd)" ${O15}/>`
          + HL('M15.6 13.6 L30 9.6', 1.4, 0.7),
      };
    case 'quiver':
      return {
        defs: lg('lt', LEATHER, 0.4, 0.4) + hg('sh', '#b89a6a'),
        body: `<g transform="rotate(18 32 34)">`
          + [24, 31, 38].map((x, i) => `<rect x="${x}" y="${4 + i}" width="2.4" height="18" fill="url(#sh)"/><path d="M${x - 2.6} ${6 + i} L${x + 1.2} ${2 + i} L${x + 5} ${6 + i} L${x + 3.4} ${12 + i} L${x - 1} ${12 + i} Z" fill="${['#e9e2cf', '#d6403a', '#e9e2cf'][i]}" ${O15}/>`).join('')
          + `<rect x="19" y="18" width="26" height="40" rx="5" fill="url(#lt)" ${O}/>`
          + `<rect x="19" y="18" width="26" height="6" rx="3" fill="${dark(LEATHER, 0.3)}" ${O15}/>`
          + `<path d="M23 30 L41 30 M23 46 L41 46" stroke="${light(LEATHER, 0.3)}" stroke-width="1.4" stroke-dasharray="2 2.4"/>`
          + HL('M23 27 L23 53', 1.4, 0.45)
          + `</g>`,
      };
    case 'grimoire':
      return {
        defs: lg('cv', '#6a3a8e', 0.35, 0.45) + lg('gd', GOLD, 0.6, 0.4) + rg('gm', L.gem),
        body: `<rect x="44" y="11" width="7" height="45" rx="1.4" fill="#efe4c4" ${O15}/>`
          + `<path d="M45.4 15 L45.4 52 M47.4 15 L47.4 52" stroke="#c8b98e" stroke-width=".9"/>`
          + `<rect x="12" y="8" width="35" height="49" rx="3.4" fill="url(#cv)" ${O}/>`
          + [[12, 8], [41, 8], [12, 51], [41, 51]].map(([x, y]) => `<rect x="${x}" y="${y}" width="6" height="6" rx="1.4" fill="url(#gd)" ${O15}/>`).join('')
          + `<circle cx="29.5" cy="32.5" r="9" fill="url(#gd)" ${O15}/><circle cx="29.5" cy="32.5" r="5.6" fill="url(#gm)" ${O15}/>`
          + HL('M16 14 L16 50', 1.3, 0.45),
      };
    case 'magazine':
      return {
        defs: md + lg('br', '#d9a441', 0.55, 0.4),
        body: `<g transform="rotate(14 32 34)">`
          + `<path d="M27 6 C 27 2 31 2 31 6 L31 14 L27 14 Z M33 8 C 33 4 37 4 37 8 L37 14 L33 14 Z" fill="url(#br)" ${O15}/>`
          + `<path d="M22 13 L42 13 L44 58 L24 58 Z" fill="url(#m)" ${O}/>`
          + `<path d="M26 22 L40 22 M26.4 30 L40.4 30 M26.8 38 L40.8 38 M27.2 46 L41.2 46" stroke="${dark(m, 0.35)}" stroke-width="1.6" stroke-linecap="round"/>`
          + `<rect x="23.6" y="52" width="21" height="6" rx="1.6" fill="${dark(m, 0.25)}" ${O15}/>`
          + HL('M25.6 16 L27.4 50', 1.3, 0.6)
          + `</g>`,
      };
    case 'talisman':
      return {
        defs: lg('pp', '#f3e7c6', 0.3, 0.2) + rg('gm', L.gem),
        body: `<path d="M32 2 C 30 4 30 6 32 8 C 34 6 34 4 32 2" fill="none" stroke="#c23a32" stroke-width="2"/>`
          + `<rect x="21" y="8" width="22" height="48" rx="1.6" fill="url(#pp)" ${O}/>`
          + `<path d="M26 16 L38 16 M32 16 L32 30 M26 23 L38 23 M27 36 L37 46 M37 36 L27 46" stroke="#c23a32" stroke-width="2.2" stroke-linecap="round"/>`
          + `<circle cx="32" cy="50" r="3.2" fill="url(#gm)" ${O15}/>`
          + `<path d="M28 56 L27 62 M32 56 L32 63 M36 56 L37 62" stroke="#c23a32" stroke-width="1.6" stroke-linecap="round"/>`,
        shadow: 12,
      };
    case 'light':
      if (slot === 'head') {
        return {
          defs: lg('lt', '#6a4630', 0.35, 0.45) + lg('fb', L.gem, 0.4, 0.3),
          body: `<ellipse cx="32" cy="44" rx="27" ry="9" fill="url(#lt)" ${O}/>`
            + `<path d="M18 44 C 18 24 24 16 32 16 C 40 16 46 24 46 44 Z" fill="url(#lt)" ${O}/>`
            + `<path d="M18.6 38 C 26 41 38 41 45.4 38 L45.8 43 C 38 46 26 46 18.2 43 Z" fill="${dark(L.cloth, 0.1)}" ${O15}/>`
            + `<path d="M40 38 C 48 26 56 16 58 6 C 52 14 46 22 40 30" fill="url(#fb)" ${O15}/>`
            + HL('M23 36 C 23 27 26 21 31 19', 1.4, 0.5),
        };
      }
      return {
        defs: lg('lt', '#8a5a36', 0.4, 0.45) + lg('m', m),
        body: `<path d="M17 12 L26 7 C 28 13 36 13 38 7 L47 12 L51 27 L46 29 L46 55 L18 55 L18 29 L13 27 Z" fill="url(#lt)" ${O}/>`
          + `<path d="M26 7 C 28 13 36 13 38 7" fill="none" ${O15}/>`
          + `<path d="M32 13 L32 55" stroke="${dark('#8a5a36', 0.45)}" stroke-width="1.6"/>`
          + `<rect x="18" y="42" width="28" height="5" fill="${dark('#8a5a36', 0.35)}" ${O15}/>`
          + `<rect x="29.4" y="41.4" width="5.2" height="6.2" rx="1" fill="url(#m)" ${O15}/>`
          + [[23, 20], [41, 20], [23, 30], [41, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="url(#m)" ${O15}/>`).join('')
          + HL('M21 16 L21 38', 1.4, 0.45),
      };
    case 'heavy':
      if (slot === 'head') {
        return {
          defs: md + lg('pl', L.gem, 0.4, 0.35),
          body: `<path d="M30 8 C 34 2 42 2 44 6 C 40 6 36 9 34 13" fill="url(#pl)" ${O15}/>`
            + `<path d="M15 34 C 15 15 49 15 49 34 L49 52 C 44 57 20 57 15 52 Z" fill="url(#m)" ${O}/>`
            + `<rect x="19" y="32" width="26" height="5" rx="2" fill="#11131a"/>`
            + `<path d="M32 13 L32 31" stroke="${dark(m, 0.3)}" stroke-width="2.4" stroke-linecap="round"/>`
            + `<path d="M24 42 L24 50 M28 43 L28 51 M36 43 L36 51 M40 42 L40 50" stroke="${dark(m, 0.4)}" stroke-width="1.6" stroke-linecap="round"/>`
            + HL('M20 30 C 20 22 24 18 29 16.4', 1.6, 0.7),
        };
      }
      return {
        defs: md,
        body: `<ellipse cx="15" cy="17" rx="9" ry="7" fill="url(#m)" ${O}/><ellipse cx="49" cy="17" rx="9" ry="7" fill="url(#m)" ${O}/>`
          + `<path d="M19 13 C 26 17 38 17 45 13 L47 34 C 46 44 40 50 32 52 C 24 50 18 44 17 34 Z" fill="url(#m)" ${O}/>`
          + `<path d="M32 16.6 L32 51" stroke="${light(m, 0.4)}" stroke-width="1.6"/>`
          + `<path d="M20 50 L44 50 L42 56 L22 56 Z" fill="url(#m)" ${O15}/>`
          + `<path d="M22 22 C 26 24 30 24 31 24 M42 22 C 38 24 34 24 33 24" stroke="${dark(m, 0.35)}" stroke-width="1.4" fill="none"/>`
          + HL('M22 20 L23 36', 1.6, 0.6) + HL('M10 14 A6 5 0 0 1 16 12', 1.3, 0.7),
      };
    case 'cloth':
      if (slot === 'head') {
        return {
          defs: lg('cl', L.cloth, 0.35, 0.45) + lg('gd', GOLD, 0.6, 0.4),
          body: `<path d="M32 5 C 50 7 56 29 52 55 L12 55 C 8 29 14 7 32 5 Z" fill="url(#cl)" ${O}/>`
            + `<path d="M32 22 C 42 22 46 32 45 46 L19 46 C 18 32 22 22 32 22 Z" fill="#141720"/>`
            + `<path d="M12.6 52 L51.4 52" stroke="url(#gd)" stroke-width="3"/>`
            + HL('M18 40 C 17 24 22 12 30 9', 1.6, 0.5),
        };
      }
      return {
        defs: lg('cl', L.cloth, 0.35, 0.45) + lg('gd', GOLD, 0.6, 0.4),
        body: `<path d="M24 7 L40 7 L50 14 L58 34 L50 38 L46 26 L50 58 L14 58 L18 26 L14 38 L6 34 L14 14 Z" fill="url(#cl)" ${O}/>`
          + `<path d="M24 7 L32 18 L40 7" fill="none" ${O15}/>`
          + `<path d="M32 18 L32 58" stroke="url(#gd)" stroke-width="3.4"/>`
          + `<path d="M15 56 L49 56" stroke="url(#gd)" stroke-width="3"/>`
          + HL('M20 24 L18 50', 1.5, 0.45),
      };
    case 'accessory':
    default: {
      const gm = rg('gm', L.gem);
      if (L.cloth === 'ring') {
        return {
          defs: lg('m', m, 0.6, 0.45) + gm,
          body: `<ellipse cx="32" cy="38" rx="17" ry="15" fill="none" stroke="${OL}" stroke-width="9"/>`
            + `<ellipse cx="32" cy="38" rx="17" ry="15" fill="none" stroke="url(#m)" stroke-width="5.4"/>`
            + HL('M18 33 C 20 28 24 25 28 24', 1.3, 0.8)
            + `<path d="M24 22 L32 12 L40 22 L32 28 Z" fill="url(#m)" ${O15}/>`
            + `<path d="M26 18 L32 6 L38 18 L32 24 Z" fill="url(#gm)" ${O15}/>`,
        };
      }
      if (L.cloth === 'earring') {
        return {
          defs: lg('m', m, 0.6, 0.45) + gm,
          body: `<path d="M32 4 C 40 4 40 14 32 16" fill="none" stroke="url(#m)" stroke-width="3" stroke-linecap="round"/>`
            + `<circle cx="32" cy="22" r="6" fill="none" stroke="${OL}" stroke-width="5"/><circle cx="32" cy="22" r="6" fill="none" stroke="url(#m)" stroke-width="2.6"/>`
            + `<path d="M32 28 C 41 38 43 46 32 58 C 21 46 23 38 32 28 Z" fill="url(#gm)" ${O}/>`
            + HL('M29 38 C 28 42 28 46 30 50', 1.4, 0.7),
          shadow: 10,
        };
      }
      return {
        defs: lg('m', m, 0.6, 0.45) + gm,
        body: `<path d="M12 6 C 14 26 22 34 32 36 C 42 34 50 26 52 6" fill="none" stroke="url(#m)" stroke-width="2.6" stroke-dasharray="3.4 2"/>`
          + `<path d="M32 33 C 44 36 47 46 44 52 C 41 58 23 58 20 52 C 17 46 20 36 32 33 Z" fill="url(#m)" ${O}/>`
          + `<path d="M32 38 C 40 40 42 46 40 50 C 38 54 26 54 24 50 C 22 46 24 40 32 38 Z" fill="url(#gm)" ${O15}/>`
          + HL('M27 43 C 27 41 29 40 31 40', 1.2, 0.8),
      };
    }
  }
}

function equipLook(it: Item): Look {
  const tc = CONTENT.looks.tierColors;
  const metal = tc[Math.max(0, Math.min(tc.length - 1, it.tier))] ?? '#a8b0bc';
  const gem = it.element !== 'neutral' ? ELEMENT[it.element] ?? '#9fd8ff' : it.rarity === 'common' ? '#9fd8ff' : CONTENT.rarities.defs[it.rarity].color;
  let cloth = it.element !== 'neutral' ? dark(ELEMENT[it.element] ?? CLOTH, 0.35) : CLOTH;
  if (it.base === 'x_ring') cloth = 'ring';
  if (it.base === 'x_earring') cloth = 'earring';
  return { metal, gem, cloth };
}

const cache = new Map<string, string>();

/** 装備のイラスト（data: URL） */
export function itemIconUrl(it: Item): string {
  const kind = CONTENT.equipment.bases[it.base]?.kind ?? it.kind;
  const key = `e:${it.base}:${it.tier}:${it.element}:${it.rarity}`;
  let u = cache.get(key);
  if (!u) {
    const L = equipLook(it);
    const p = equipShape(kind, it.slot, L);
    const glow = it.element !== 'neutral' ? ELEMENT[it.element] : undefined;
    const sparkle = it.rarity === 'mythic' ? 2 : it.rarity === 'legend' ? 1 : 0;
    u = url(wrap(p, glow, sparkle));
    cache.set(key, u);
  }
  return u;
}

// ───────── 袋のアイテム ─────────

type Bag = (c: string) => Paint;

const rock = (c: string, ore?: string): Paint => ({
  defs: lg('r', c, 0.45, 0.5) + (ore ? lg('o', ore, 0.6, 0.3) : ''),
  body: `<path d="M8 44 L14 24 L28 13 L45 16 L55 31 L51 48 L34 56 L16 53 Z" fill="url(#r)" ${O}/>`
    + `<path d="M14 24 L30 30 L45 16 M30 30 L34 56 M30 30 L55 31" stroke="${dark(c, 0.35)}" stroke-width="1.2" fill="none"/>`
    + HL('M16 26 L27 16', 1.5, 0.6)
    + (ore ? `<path d="M34 22 L40 18 L44 26 L38 30 Z" fill="url(#o)" ${O15}/><path d="M20 38 L26 34 L30 42 L24 46 Z" fill="url(#o)" ${O15}/><path d="M42 38 L47 36 L48 43 L43 45 Z" fill="url(#o)" ${O15}/>` : ''),
});
const crystalCluster = (c: string): Paint => ({
  defs: lg('c', c, 0.6, 0.35),
  body: `<path d="M20 56 L14 30 L22 18 L28 30 L26 56 Z" fill="url(#c)" ${O}/>`
    + `<path d="M40 56 L42 28 L50 20 L54 34 L48 56 Z" fill="url(#c)" ${O}/>`
    + `<path d="M24 56 L26 22 L33 6 L40 22 L40 56 Z" fill="url(#c)" ${O}/>`
    + `<path d="M33 6 L32 56" stroke="${light(c, 0.5)}" stroke-width="1.2"/>`
    + HL('M28 24 L32 11', 1.6, 0.8),
});
const gem = (c: string): Paint => ({
  defs: lg('c', c, 0.6, 0.4),
  body: `<path d="M18 22 L26 12 L38 12 L46 22 L32 56 Z" fill="url(#c)" ${O}/>`
    + `<path d="M18 22 L46 22 M26 12 L28 22 L32 56 M38 12 L36 22 L32 56" stroke="${dark(c, 0.3)}" stroke-width="1.1" fill="none"/>`
    + `<path d="M28 22 L32 12 L36 22 Z" fill="${light(c, 0.55)}"/>`
    + HL('M22 22 L28 44', 1.4, 0.6),
});
const orb = (c: string, ring?: string): Paint => ({
  defs: rg('o', c) + (ring ? lg('rg', ring, 0.6, 0.4) : ''),
  body: `<circle cx="32" cy="33" r="20" fill="url(#o)" ${O}/>`
    + (ring ? `<ellipse cx="32" cy="34" rx="22" ry="6" fill="none" stroke="${OL}" stroke-width="5"/><ellipse cx="32" cy="34" rx="22" ry="6" fill="none" stroke="url(#rg)" stroke-width="2.8"/>` : `<path d="M22 40 L30 32 L28 26 M36 44 L40 36 L46 34" stroke="${dark(c, 0.4)}" stroke-width="1.4" fill="none" opacity=".7"/>`),
});
const potion = (c: string, tall = false): Paint => ({
  defs: lg('lq', c, 0.45, 0.45),
  body: tall
    ? `<rect x="25" y="4" width="14" height="7" rx="2" fill="#8a5a32" ${O15}/>`
      + `<path d="M26 11 L38 11 L38 50 C 38 56 26 56 26 50 Z" fill="rgba(220,235,255,.18)" ${O}/>`
      + `<path d="M27 26 L37 26 L37 50 C 37 54 27 54 27 50 Z" fill="url(#lq)"/>`
      + `<path d="M27 32 C 31 30 33 36 37 34 M27 40 C 31 38 33 44 37 42" stroke="${light(c, 0.6)}" stroke-width="1.2" fill="none"/>`
      + HL('M29 14 L29 48', 1.5, 0.7)
    : `<rect x="26" y="5" width="12" height="7" rx="2" fill="#8a5a32" ${O15}/>`
      + `<path d="M27 12 L37 12 L37 20 C 47 24 51 31 51 40 C 51 51 43 58 32 58 C 21 58 13 51 13 40 C 13 31 17 24 27 20 Z" fill="rgba(220,235,255,.18)" ${O}/>`
      + `<path d="M15 37 C 22 33 42 33 49 37 C 50 48 43 55 32 55 C 21 55 14 48 15 37 Z" fill="url(#lq)"/>`
      + `<ellipse cx="32" cy="36.4" rx="16.6" ry="2.6" fill="${light(c, 0.45)}" opacity=".8"/>`
      + HL('M19 33 C 20 27 24 23 28 22', 1.8, 0.75) + HL('M20 44 C 21 48 24 51 27 52', 1.4, 0.4),
});
const blob = (c: string, drip = false): Paint => ({
  defs: lg('b', c, 0.5, 0.4),
  body: `<path d="M11 46 C 9 30 21 13 32 13 C 44 13 55 30 53 46 C 51 55 13 55 11 46 Z" fill="url(#b)" ${O}/>`
    + (drip ? `<path d="M22 52 C 22 58 26 58 26 52 M38 52 C 38 60 43 60 43 52" fill="url(#b)" ${O15}/>` : '')
    + `<ellipse cx="24" cy="26" rx="5" ry="3.4" fill="#fff" opacity=".75" transform="rotate(-30 24 26)"/>`
    + HL('M16 42 C 16 34 19 28 23 24', 1.4, 0.45),
});
const flame = (c: string): Paint => ({
  defs: `<linearGradient id="f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${dark(c, 0.2)}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${light(c, 0.5)}"/></linearGradient>`,
  body: `<path d="M32 4 C 40 16 51 23 49 40 C 47 52 39 58 32 58 C 24 58 15 52 15 40 C 15 29 23 25 25 14 C 29 21 30 25 32 28 C 34 20 35 12 32 4 Z" fill="url(#f)" ${O}/>`
    + `<path d="M32 30 C 38 38 41 42 39 48 C 37 54 27 54 25 48 C 23 42 28 38 32 30 Z" fill="${light(c, 0.75)}"/>`,
});
const scales = (c: string): Paint => ({
  defs: lg('s', c, 0.55, 0.45),
  body: [[14, 28], [30, 16], [26, 36]].map(([x, y]) => `<path d="M${x} ${y} C ${x + 10} ${y - 8} ${x + 24} ${y - 2} ${x + 24} ${y + 10} C ${x + 24} ${y + 20} ${x + 12} ${y + 24} ${x + 4} ${y + 18} C ${x - 2} ${y + 12} ${x - 2} ${y + 4} ${x} ${y} Z" fill="url(#s)" ${O}/>`
    + `<path d="M${x + 6} ${y + 4} C ${x + 12} ${y} ${x + 18} ${y + 2} ${x + 20} ${y + 8}" stroke="#fff" stroke-width="1.3" fill="none" opacity=".6"/>`).join(''),
});
const fang = (c: string): Paint => ({
  defs: lg('f', light(c, 0.35), 0.6, 0.35),
  body: `<path d="M18 8 C 34 6 48 10 46 18 C 42 32 34 46 22 58 C 26 44 24 30 16 20 C 12 14 13 9 18 8 Z" fill="url(#f)" ${O}/>`
    + `<path d="M18 8 C 30 8 40 12 42 16" stroke="${dark(c, 0.2)}" stroke-width="1.4" fill="none"/>`
    + HL('M20 16 C 25 24 27 34 25 46', 1.5, 0.7),
});
const pelt = (c: string, fluffy = false): Paint => ({
  defs: lg('p', c, 0.4, 0.45),
  body: fluffy
    ? `<path d="M14 44 C 6 40 8 28 16 28 C 14 18 26 12 32 18 C 36 10 50 12 50 24 C 58 26 58 40 50 44 C 50 52 38 56 32 50 C 26 56 14 54 14 44 Z" fill="url(#p)" ${O}/>`
      + `<path d="M20 34 C 22 30 26 30 28 32 M34 28 C 36 24 42 24 44 28 M28 42 C 30 38 36 38 38 42" stroke="${dark(c, 0.25)}" stroke-width="1.4" fill="none"/>`
    : `<path d="M12 16 L20 10 L30 14 L44 10 L52 18 L50 30 L56 42 L48 54 L32 50 L18 56 L10 44 L14 32 Z" fill="url(#p)" ${O}/>`
      + `<path d="M20 22 L24 26 M30 20 L33 25 M40 20 L42 24 M22 36 L26 40 M36 34 L39 39 M30 44 L33 48" stroke="${dark(c, 0.35)}" stroke-width="1.6" stroke-linecap="round"/>`
      + HL('M16 20 L26 14', 1.4, 0.45),
});
const sack = (c: string, dots: string): Paint => ({
  defs: lg('s', c, 0.45, 0.45),
  body: `<path d="M24 14 C 20 18 22 22 26 22 C 12 30 10 48 18 54 C 26 60 38 60 46 54 C 54 48 52 30 38 22 C 42 22 44 18 40 14 Z" fill="url(#s)" ${O}/>`
    + `<path d="M24 22 L40 22" stroke="${dark(c, 0.4)}" stroke-width="2.2" stroke-linecap="round"/>`
    + `<circle cx="26" cy="38" r="2.6" fill="${dots}"/><circle cx="37" cy="34" r="2" fill="${dots}"/><circle cx="34" cy="46" r="2.8" fill="${dots}"/><circle cx="22" cy="48" r="1.8" fill="${dots}"/>`
    + HL('M18 40 C 18 34 21 29 25 26', 1.4, 0.5),
});
const shell = (c: string): Paint => ({
  defs: lg('s', c, 0.5, 0.45),
  body: `<path d="M8 44 C 8 22 20 12 32 12 C 44 12 56 22 56 44 C 48 50 16 50 8 44 Z" fill="url(#s)" ${O}/>`
    + `<path d="M32 13 L32 47 M20 16 L16 46 M44 16 L48 46 M12 30 C 24 26 40 26 52 30" stroke="${dark(c, 0.3)}" stroke-width="1.4" fill="none"/>`
    + HL('M14 36 C 14 26 20 18 28 15', 1.6, 0.6),
});
const wing = (c: string): Paint => ({
  defs: lg('w', c, 0.35, 0.45),
  body: `<path d="M8 18 C 20 8 40 8 56 12 C 52 20 52 28 56 34 C 48 32 44 38 44 44 C 38 40 32 42 30 48 C 26 42 18 42 14 46 C 16 36 12 26 8 18 Z" fill="url(#w)" ${O}/>`
    + `<path d="M8 18 L56 12 M18 20 L30 48 M28 16 L44 44 M38 14 L56 34" stroke="${dark(c, 0.45)}" stroke-width="1.4" fill="none"/>`,
});
const spool = (c: string): Paint => ({
  defs: lg('t', c, 0.4, 0.45) + lg('wd', WOOD, 0.4, 0.4),
  body: `<rect x="14" y="10" width="36" height="7" rx="2" fill="url(#wd)" ${O}/><rect x="14" y="47" width="36" height="7" rx="2" fill="url(#wd)" ${O}/>`
    + `<rect x="18" y="17" width="28" height="30" fill="url(#t)" ${O}/>`
    + [21, 25, 29, 33, 37, 41].map((y) => `<path d="M19 ${y} L45 ${y + 2}" stroke="${light(c, 0.3)}" stroke-width="1" opacity=".7"/>`).join('')
    + `<path d="M46 34 C 52 38 54 46 58 52" stroke="url(#t)" stroke-width="2" fill="none"/>`,
});
const sprig = (c: string): Paint => ({
  defs: lg('l', c, 0.45, 0.45),
  body: `<path d="M30 60 C 30 44 32 28 36 8" stroke="${dark(c, 0.45)}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    + [[30, 46, -1], [32, 34, 1], [33, 22, -1], [35, 12, 1]].map(([x, y, s]) => `<path d="M${x} ${y} C ${x + s * 8} ${y - 12} ${x + s * 20} ${y - 10} ${x + s * 22} ${y - 6} C ${x + s * 18} ${y + 4} ${x + s * 8} ${y + 4} ${x} ${y} Z" fill="url(#l)" ${O15}/><path d="M${x} ${y} C ${x + s * 8} ${y - 4} ${x + s * 14} ${y - 6} ${x + s * 18} ${y - 6}" stroke="${light(c, 0.4)}" stroke-width="1" fill="none"/>`).join(''),
});
const lotus = (c: string): Paint => ({
  defs: lg('p', c, 0.3, 0.3) + lg('l', '#5fae6a', 0.4, 0.4),
  body: `<ellipse cx="32" cy="50" rx="24" ry="7" fill="url(#l)" ${O}/>`
    + `<path d="M32 50 C 14 46 10 30 16 22 C 24 30 28 40 32 50 Z M32 50 C 50 46 54 30 48 22 C 40 30 36 40 32 50 Z" fill="url(#p)" ${O15}/>`
    + `<path d="M32 50 C 22 40 24 20 32 10 C 40 20 42 40 32 50 Z" fill="url(#p)" ${O}/>`
    + `<circle cx="32" cy="44" r="3" fill="#ffd23a"/>`,
});
const log = (c: string): Paint => ({
  defs: lg('b', c, 0.35, 0.45),
  body: `<path d="M12 26 L44 14 C 52 12 58 26 50 32 L18 46 C 10 48 6 30 12 26 Z" fill="url(#b)" ${O}/>`
    + `<ellipse cx="15" cy="36" rx="7" ry="10" transform="rotate(-22 15 36)" fill="${light(c, 0.45)}" ${O}/>`
    + `<ellipse cx="15" cy="36" rx="3.6" ry="5.4" transform="rotate(-22 15 36)" fill="none" stroke="${dark(c, 0.2)}" stroke-width="1.2"/>`
    + `<path d="M24 26 L44 18 M28 34 L48 26" stroke="${dark(c, 0.35)}" stroke-width="1.4" stroke-linecap="round"/>`,
});
const fish = (c: string): Paint => ({
  defs: lg('f', c, 0.5, 0.45),
  body: `<path d="M8 32 C 16 18 36 16 46 30 L58 20 L56 32 L58 44 L46 34 C 36 48 16 46 8 32 Z" fill="url(#f)" ${O}/>`
    + `<circle cx="17" cy="29" r="2.4" fill="#141720"/><circle cx="16.4" cy="28.4" r=".8" fill="#fff"/>`
    + `<path d="M24 22 C 28 28 28 36 24 42" stroke="${dark(c, 0.3)}" stroke-width="1.4" fill="none"/>`
    + HL('M14 26 C 20 20 30 20 38 24', 1.4, 0.6),
});
const eel = (c: string): Paint => ({
  defs: lg('e', c, 0.4, 0.45),
  body: `<path d="M6 40 C 14 24 22 24 28 34 C 34 44 42 44 48 30 C 52 22 58 22 60 28 C 56 30 54 34 52 38 C 44 54 32 52 24 42 C 20 36 14 38 10 46 Z" fill="url(#e)" ${O}/>`
    + `<circle cx="56" cy="27" r="1.6" fill="#141720"/>`,
});
const crab = (c: string): Paint => ({
  defs: lg('c', c, 0.5, 0.45),
  body: `<path d="M12 46 L6 52 M18 50 L14 58 M52 46 L58 52 M46 50 L50 58" stroke="${dark(c, 0.2)}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M14 22 C 6 18 6 8 14 8 L14 14 L20 12 C 22 18 20 22 14 22 Z M50 22 C 58 18 58 8 50 8 L50 14 L44 12 C 42 18 44 22 50 22 Z" fill="url(#c)" ${O15}/>`
    + `<path d="M10 40 C 10 26 20 22 32 22 C 44 22 54 26 54 40 C 48 50 16 50 10 40 Z" fill="url(#c)" ${O}/>`
    + `<circle cx="26" cy="26" r="2.2" fill="#141720"/><circle cx="38" cy="26" r="2.2" fill="#141720"/>`
    + HL('M16 36 C 18 30 24 27 30 26', 1.4, 0.6),
});
const bowl = (c: string, rim = '#e9e2cf'): Paint => ({
  defs: lg('s', c, 0.45, 0.4) + lg('b', rim, 0.3, 0.35),
  body: `<ellipse cx="32" cy="30" rx="24" ry="8" fill="url(#s)" ${O}/>`
    + `<path d="M8 30 C 8 46 20 54 32 54 C 44 54 56 46 56 30 C 50 36 14 36 8 30 Z" fill="url(#b)" ${O}/>`
    + `<path d="M22 16 C 20 12 24 10 22 6 M32 14 C 30 10 34 8 32 4 M42 16 C 40 12 44 10 42 6" stroke="#fff" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>`
    + `<circle cx="24" cy="29" r="2.2" fill="${light(c, 0.4)}"/><circle cx="36" cy="31" r="2.6" fill="${dark(c, 0.2)}"/>`,
});
const plateFish = (c: string): Paint => ({
  defs: lg('p', '#e9e2cf', 0.3, 0.3) + lg('f', c, 0.45, 0.45),
  body: `<ellipse cx="32" cy="42" rx="26" ry="10" fill="url(#p)" ${O}/>`
    + `<path d="M10 38 C 18 26 36 24 46 36 L56 28 L54 38 L56 48 L46 40 C 36 50 18 50 10 38 Z" fill="url(#f)" ${O}/>`
    + `<path d="M20 32 L24 44 M28 30 L32 44 M36 32 L40 44" stroke="${dark(c, 0.5)}" stroke-width="1.6" stroke-linecap="round"/>`,
});
const cup = (c: string): Paint => ({
  defs: lg('t', c, 0.45, 0.35) + lg('w', '#f2f2f6', 0.2, 0.35),
  body: `<ellipse cx="32" cy="54" rx="22" ry="5" fill="url(#w)" ${O15}/>`
    + `<path d="M48 30 C 58 30 58 44 46 44" fill="none" stroke="${OL}" stroke-width="5"/><path d="M48 30 C 58 30 58 44 46 44" fill="none" stroke="#f2f2f6" stroke-width="2.4"/>`
    + `<path d="M14 24 L50 24 C 50 40 44 52 32 52 C 20 52 14 40 14 24 Z" fill="url(#w)" ${O}/>`
    + `<ellipse cx="32" cy="24" rx="18" ry="4" fill="url(#t)" ${O15}/>`
    + `<path d="M26 16 C 24 12 28 10 26 6 M36 16 C 34 12 38 10 36 6" stroke="#fff" stroke-width="1.6" fill="none" opacity=".55"/>`,
});
const pot = (c: string): Paint => ({
  defs: lg('p', '#4a4a56', 0.4, 0.45) + lg('s', c, 0.4, 0.4),
  body: `<ellipse cx="32" cy="24" rx="22" ry="6" fill="url(#s)" ${O}/>`
    + `<path d="M10 24 C 10 46 20 54 32 54 C 44 54 54 46 54 24 C 48 30 16 30 10 24 Z" fill="url(#p)" ${O}/>`
    + `<path d="M6 26 L10 28 M58 26 L54 28" stroke="${OL}" stroke-width="4" stroke-linecap="round"/>`
    + `<path d="M24 22 C 26 16 30 16 30 20 M36 20 C 38 14 42 16 40 22" stroke="#ff6a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
});
const boxMeal = (c: string): Paint => ({
  defs: lg('b', '#b8332a', 0.3, 0.45) + lg('e', c, 0.45, 0.4),
  body: `<path d="M8 28 L56 28 L52 52 L12 52 Z" fill="url(#b)" ${O}/>`
    + `<rect x="10" y="22" width="44" height="10" rx="3" fill="#f2efe6" ${O15}/>`
    + `<path d="M12 20 C 20 14 44 14 52 20 L50 26 C 42 22 22 22 14 26 Z" fill="url(#e)" ${O}/>`
    + `<path d="M18 21 L46 21" stroke="${dark(c, 0.4)}" stroke-width="1.4"/>`,
});
const feast = (c: string): Paint => ({
  defs: lg('d', c, 0.55, 0.4) + lg('p', '#e9e2cf', 0.3, 0.3),
  body: `<ellipse cx="32" cy="48" rx="27" ry="8" fill="url(#p)" ${O}/>`
    + `<path d="M10 46 C 10 26 20 16 32 16 C 44 16 54 26 54 46 Z" fill="url(#d)" ${O}/>`
    + `<circle cx="32" cy="13" r="3.4" fill="url(#d)" ${O15}/>`
    + HL('M16 40 C 16 30 22 22 30 20', 1.8, 0.75),
});
const pouch = (c: string): Paint => ({
  defs: lg('s', '#c9b8e8', 0.3, 0.4),
  body: `<path d="M24 16 C 20 18 22 22 26 22 C 14 30 12 48 20 54 C 28 60 36 60 44 54 C 52 48 50 30 38 22 C 42 22 44 18 40 16 Z" fill="url(#s)" ${O}/>`
    + `<path d="M24 22 L40 22" stroke="#7a5aa8" stroke-width="2.2" stroke-linecap="round"/>`
    + [[30, 8, 3], [40, 6, 2.2], [22, 10, 1.8], [33, 40, 4], [24, 46, 2.4], [42, 44, 2.4]].map(([x, y, r]) => `<path d="M${x} ${y - r}L${x + r * 0.3} ${y - r * 0.3}L${x + r} ${y}L${x + r * 0.3} ${y + r * 0.3}L${x} ${y + r}L${x - r * 0.3} ${y + r * 0.3}L${x - r} ${y}L${x - r * 0.3} ${y - r * 0.3}Z" fill="${c}"/>`).join(''),
});
const ghost = (c: string): Paint => ({
  defs: `<radialGradient id="g" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${dark(c, 0.3)}"/></radialGradient>`,
  body: `<path d="M32 6 C 44 18 50 28 50 38 C 50 50 42 56 32 56 C 22 56 14 50 14 38 C 14 28 20 18 32 6 Z" fill="url(#g)" ${O}/>`
    + `<circle cx="26" cy="38" r="2.2" fill="#141720" opacity=".55"/><circle cx="38" cy="38" r="2.2" fill="#141720" opacity=".55"/>`,
});
const bark = (c: string): Paint => ({
  defs: lg('b', c, 0.35, 0.45),
  body: `<path d="M10 18 L46 10 L54 18 L52 44 L18 54 L10 46 Z" fill="url(#b)" ${O}/>`
    + `<path d="M16 22 C 22 30 18 38 22 48 M26 18 C 32 28 28 38 32 50 M38 14 C 44 24 40 34 44 46 M48 16 C 50 24 48 32 50 40" stroke="${dark(c, 0.45)}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    + `<path d="M40 30 C 46 26 50 32 46 36" fill="#5fae6a" ${O15}/>`,
});
const snakeSkin = (c: string): Paint => ({
  defs: lg('s', c, 0.45, 0.45),
  body: `<path d="M8 50 C 14 38 24 44 28 34 C 32 24 40 30 46 20 C 50 14 54 12 58 14 L56 22 C 52 22 50 26 48 30 C 42 40 34 36 30 44 C 26 54 16 50 12 56 Z" fill="url(#s)" ${O}/>`
    + [[16, 48], [26, 40], [36, 34], [46, 24]].map(([x, y]) => `<path d="M${x} ${y - 3} L${x + 3} ${y} L${x} ${y + 3} L${x - 3} ${y} Z" fill="${dark(c, 0.35)}"/>`).join(''),
});
const needle = (c: string): Paint => ({
  defs: lg('n', c, 0.55, 0.4),
  body: `<path d="M38 10 C 50 6 58 14 54 24 C 52 30 46 32 40 28 L12 58 L8 56 L34 24 C 30 18 32 12 38 10 Z" fill="url(#n)" ${O}/>`
    + `<path d="M40 13 C 45 15 49 19 51 23 M36 18 C 41 20 45 24 47 28" stroke="#3a2a10" stroke-width="3" stroke-linecap="round"/>`
    + HL('M32 30 L14 52', 1.4, 0.7),
});
const sealStone = (c: string): Paint => orb(c, '#e8b84a');

const BAG: Record<string, [Bag, ...unknown[]]> = {
  potion_s: [potion], potion_m: [potion], ether: [potion],
  slime_gel: [blob], eel_slime: [(c) => blob(c, true)], toad_oil: [(c) => potion(c, true)], ectoplasm: [ghost],
  hornet_needle: [needle], golem_core: [(c) => rock(c, '#7fe0ff')], wisp_ember: [flame],
  refine_stone: [crystalCluster], storm_crystal: [crystalCluster], catalyst: [(c) => potion(c, true)],
  ember_scale: [scales], lizard_scale: [scales], fire_scale: [scales], wyvern_scale: [scales], dragon_scale: [scales],
  boar_hide: [(c) => pelt(c)], yeti_fur: [(c) => pelt(c, true)], spore: [(c) => sack(c, '#f6e6c8')], snake_skin: [snakeSkin],
  crab_shell: [shell], hydra_fang: [fang], hell_fang: [fang], wolf_fang: [fang],
  magma_core: [(c) => orb(c)], frost_core: [(c) => orb(c)], bat_wing: [wing], ancient_bark: [bark],
  fairy_dust: [pouch], dark_silk: [spool],
  copper_ore: [(c) => rock('#8a8478', c)], iron_ore: [(c) => rock('#7a7a82', c)], mithril_ore: [(c) => rock('#6a7280', c)], star_ore: [(c) => rock('#5a5a6a', c)],
  herb_green: [sprig], moon_herb: [sprig], fire_herb: [sprig], shade_herb: [sprig], snow_lotus: [lotus],
  oak_wood: [log], marsh_wood: [log], ash_wood: [log], elder_wood: [log], frost_wood: [log],
  river_fish: [fish], rain_trout: [fish], ice_fish: [fish], golden_fish: [fish], swamp_eel: [eel], lava_crab: [crab],
  grilled_fish: [plateFish], herb_soup: [(c) => bowl(c)], spicy_stew: [(c) => bowl(c, '#5a3a2a')], moon_tea: [cup],
  eel_kabayaki: [boxMeal], lava_crab_pot: [pot], lotus_salad: [(c) => bowl(c)], golden_feast: [feast],
  seal_stone: [sealStone], seal_stone_hi: [sealStone],
};

/** 袋のアイテム（素材・消耗品・料理・結晶・捕獲石）のイラスト（data: URL） */
export function bagIconUrl(id: string): string {
  const key = `b:${id}`;
  let u = cache.get(key);
  if (u) return u;
  const m = CONTENT.materials[id];
  const cr = CONTENT.crystals[id];
  let p: Paint;
  let glow: string | undefined;
  let sparkle = 0;
  if (cr) { p = gem(cr.color); glow = cr.color; }
  else if (m) {
    const f = BAG[id]?.[0] ?? (m.kind === 'food' ? (c: string) => bowl(c) : m.kind === 'consumable' ? potion : (c: string) => rock('#7a7a82', c));
    p = f(m.color);
    if (id === 'refine_stone' || id === 'storm_crystal' || id === 'golden_fish' || id === 'golden_feast' || id === 'seal_stone_hi') glow = m.color;
    if (id === 'golden_fish' || id === 'golden_feast' || id === 'dragon_scale') sparkle = 1;
  } else {
    p = rock('#7a7a82');
  }
  u = url(wrap(p, glow, sparkle));
  cache.set(key, u);
  return u;
}

/** イラストの <img>（装飾なので代替文字は空） */
export function iconImg(src: string, cls = 'ico'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = cls;
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  return img;
}
