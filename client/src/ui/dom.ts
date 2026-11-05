/** 小さな DOM 作成の道具 */
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | number): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = String(text);
  return e;
};

export function btn(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = h('button', cls, label);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/** ラベルと値の1行 */
export function kv(k: string, v: string | number, cls = 'stat'): HTMLDivElement {
  const r = h('div', cls);
  r.append(h('span', 'k', k), h('span', 'v', String(v)));
  return r;
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(n: number, digits = 1): string {
  const s = (Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits)).toString();
  return `${n > 0 ? '+' : ''}${s}%`;
}
