// ワールド状態の保存と読み込み（JSONファイル）。数値は小数3桁に丸めて容量を抑える。
import fs from 'node:fs';
import path from 'node:path';

export function loadState(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('データの読み込みに失敗しました。新しい世界を作ります', e.message);
    return null;
  }
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(state, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
