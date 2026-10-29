// 属性と相性。企画書「属性と相性」の実装。
// 6属性の循環: 水→火→氷→風→土→雷→水（矢印の先に有利）
// 光と闇は互いに有利。無属性は相性なし。

export const ELEMENTS = ['water', 'fire', 'ice', 'wind', 'earth', 'thunder', 'light', 'dark'];
export const ALL_ELEMENTS = [...ELEMENTS, 'none'];
export const CYCLE = ['water', 'fire', 'ice', 'wind', 'earth', 'thunder'];

export const ELEMENT_INFO = {
  water:   { ja: '水', color: '#3c8cfc', dark: '#0040a8', light: '#a4d4fc', status: 'wet' },
  fire:    { ja: '火', color: '#e45c10', dark: '#a81000', light: '#fca044', status: 'burn' },
  ice:     { ja: '氷', color: '#58d8d8', dark: '#008888', light: '#c4fcfc', status: 'freeze' },
  wind:    { ja: '風', color: '#58d854', dark: '#007800', light: '#b8f8b8', status: 'knockback' },
  earth:   { ja: '土', color: '#ac7c00', dark: '#503000', light: '#f8d878', status: 'slow' },
  thunder: { ja: '雷', color: '#f8b800', dark: '#887000', light: '#fcfc78', status: 'paralyze' },
  light:   { ja: '光', color: '#fcfcfc', dark: '#a4a4a4', light: '#fffff0', status: 'blind' },
  dark:    { ja: '闇', color: '#9878f8', dark: '#3c1c8c', light: '#d8b8f8', status: 'curse' },
  none:    { ja: '無', color: '#bcbcbc', dark: '#686868', light: '#ececec', status: null },
};

export const STATUS_INFO = {
  burn:      { ja: '燃焼', dur: 3.0 },   // 継続ダメージ
  wet:       { ja: '湿潤', dur: 4.0 },   // 雷と氷のダメージ増
  freeze:    { ja: '凍結', dur: 1.2 },   // 動けない
  knockback: { ja: '吹き飛ばし', dur: 0.3 },
  slow:      { ja: '鈍化', dur: 3.0 },   // 移動が遅い
  paralyze:  { ja: '麻痺', dur: 1.5 },   // 攻撃できない
  blind:     { ja: '目くらまし', dur: 3.0 }, // 攻撃が外れやすい
  curse:     { ja: '呪い', dur: 5.0 },   // 回復できない
  poison:    { ja: '毒', dur: 5.0 },     // 継続ダメージ（属性と無関係）
  grounded:  { ja: '墜落', dur: 1.8 },   // 風の種が氷を受けたとき
};

export const AFFINITY = { strong: 1.5, normal: 1.0, weak: 0.75 };

/** 攻撃属性 atk が体属性 body の相手に与える倍率 */
export function affinity(atk, body) {
  if (!atk || atk === 'none' || !body || body === 'none') return AFFINITY.normal;
  if ((atk === 'light' && body === 'dark') || (atk === 'dark' && body === 'light')) return AFFINITY.strong;
  const ia = CYCLE.indexOf(atk);
  const ib = CYCLE.indexOf(body);
  if (ia < 0 || ib < 0) return AFFINITY.normal;
  if ((ia + 1) % CYCLE.length === ib) return AFFINITY.strong;
  if ((ib + 1) % CYCLE.length === ia) return AFFINITY.weak;
  return AFFINITY.normal;
}

/** 有利をとれる相手の体属性（食物連鎖にも使う） */
export function preyOf(el) {
  if (el === 'light') return ['dark'];
  if (el === 'dark') return ['light'];
  const i = CYCLE.indexOf(el);
  return i < 0 ? [] : [CYCLE[(i + 1) % CYCLE.length]];
}

/**
 * 最終ダメージ = 基礎攻撃力 × 相性倍率 × (1 − 耐性)
 * resist は −0.5（弱点）〜 +0.75
 */
export function computeDamage(base, atk, body, resist = 0, opts = {}) {
  let mult = affinity(atk, body);
  if (opts.wet && (atk === 'thunder' || atk === 'ice')) mult *= 1.25;
  const r = Math.max(-0.5, Math.min(0.75, resist));
  return Math.max(1, Math.round(base * mult * (1 - r)));
}
