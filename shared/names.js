// 種の名前。初期種は自動命名、新種はプレイヤーが命名できる。
import { FAMILIES } from './genome.js';

const PREFIX = {
  water: 'ミズ', fire: 'ホノオ', ice: 'コオリ', wind: 'カゼ',
  earth: 'ツチ', thunder: 'イカズチ', light: 'ヒカリ', dark: 'ヤミ',
};
const FAMILY_JA = { slime: 'スライム', beast: 'ケモノ', bug: 'ムシ', lizard: 'トカゲ', golem: 'ゴーレム' };
const FAMILY_ALT = { slime: 'ゼリー', beast: 'ウルフ', bug: 'ビートル', lizard: 'リザード', golem: 'ガーディアン' };

export function familyName(g) {
  return FAMILY_JA[FAMILIES[g.parts.family]] || 'マモノ';
}

export function defaultSpeciesName(g, variant = 0) {
  const fam = FAMILIES[g.parts.family];
  const base = variant % 2 === 0 ? FAMILY_JA[fam] : FAMILY_ALT[fam];
  return (PREFIX[g.body] || '') + base;
}

export function unnamedLabel(id) {
  return `未命名種 ${id.slice(-4).toUpperCase()}`;
}

const NG = ['死ね', 'ころす', '殺す', 'ちんこ', 'まんこ', 'fuck', 'shit', 'sex'];

/** プレイヤーの命名を検証。問題なければ null、だめなら理由を返す */
export function validateName(name) {
  if (typeof name !== 'string') return '名前を入力してください';
  const n = name.trim();
  if (n.length < 2 || n.length > 12) return '2〜12文字で入力してください';
  if (!/^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9ー・]+$/u.test(n)) return '使えない文字が含まれています';
  const low = n.toLowerCase();
  if (NG.some((w) => low.includes(w))) return 'その名前は使えません';
  return null;
}

export function validatePlayerName(name) {
  if (typeof name !== 'string') return '名前を入力してください';
  const n = name.trim();
  if (n.length < 1 || n.length > 10) return '1〜10文字で入力してください';
  const low = n.toLowerCase();
  if (NG.some((w) => low.includes(w))) return 'その名前は使えません';
  return null;
}
