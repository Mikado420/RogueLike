import {
  CONTENT, itemMods, sellPrice, setCounts, txt, type CharacterData, type Item, type ModKey, type UniqueDef, type WeaponType,
} from '../../../shared/src';
import { rarityColor } from '../colors';
import { h, kv } from './dom';
import { elName, modLabel, modText } from './ctx';

/** レジェンドの固有効果を短い行にする */
export function uniqueLines(u: UniqueDef): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(u.mods ?? {})) out.push(modText(k as ModKey, v as number));
  if (u.when && u.whenMods) {
    const c = u.when;
    const cond = c.hpBelow !== undefined ? txt('cond.hpBelow', c.hpBelow) : c.afterDodge !== undefined ? txt('cond.afterDodge', c.afterDodge)
      : c.night ? txt('cond.night') : c.fullHp ? txt('cond.fullHp') : '';
    for (const [k, v] of Object.entries(u.whenMods)) out.push(`${cond}  ${modText(k as ModKey, v as number)}`);
  }
  if (u.proc) {
    const on = txt(`proc.on.${u.proc.on}`);
    const eff = u.proc.effect === 'status' && u.proc.status ? CONTENT.statuses[u.proc.status]?.name ?? '' : txt(`proc.eff.${u.proc.effect}`);
    const val = u.proc.effect === 'extraHit' ? ` ${Math.round(u.proc.value * 100)}%` : u.proc.effect === 'heal' ? ` ${u.proc.value}%` : '';
    out.push(`${on} ${u.proc.chance}%  ${eff}${val}`);
  }
  if (u.cheatDeath) out.push(txt('proc.cheatDeath', u.cheatDeath));
  return out;
}

/** 装備の詳細（名前・数値・オプション・固有効果・セット・結晶・取引） */
export function itemInfo(it: Item, ch: CharacterData | null): HTMLElement {
  const box = h('div', 'item-info');
  const rd = CONTENT.rarities.defs[it.rarity];
  const name = h('div', 'd-name', it.name + (it.refine > 0 ? ` +${it.refine}` : ''));
  name.style.color = rd.color;
  box.append(name);
  const tags = h('div', 'd-tags');
  const rt = h('span', 'tag', rd.name);
  rt.style.borderColor = rd.color; rt.style.color = rd.color;
  tags.append(rt, h('span', 'tag', it.slot === 'weapon' ? CONTENT.weapons[it.kind as WeaponType]?.name ?? it.kind : txt(`slot.${it.slot}`)));
  if (it.element !== 'neutral') tags.append(h('span', `tag el-${it.element}`, elName(it.element)));
  tags.append(h('span', 'tag muted', txt(`trade.${it.trade}`)));
  box.append(tags);
  const lines = h('div', 'd-lines');
  const req = kv(txt('item.req'), String(it.reqLevel));
  if (ch && ch.level < it.reqLevel) req.classList.add('bad');
  lines.append(req);
  const base = itemMods({ ...it, options: [], crystals: [], unique: undefined, mythic: undefined }, CONTENT);
  for (const [k, v] of Object.entries(base)) lines.append(kv(modLabel(k as ModKey).label, `${v}${modLabel(k as ModKey).unit}`));
  box.append(lines);
  if (it.options.length) {
    const ol = h('div', 'd-opts');
    for (const o of it.options) ol.append(h('div', 'opt', modText(o.key, o.value)));
    box.append(ol);
  }
  if (it.unique) {
    const u = CONTENT.uniques[it.unique];
    const ub = h('div', 'd-unique');
    ub.append(h('div', 'u-name', u.name));
    for (const l of uniqueLines(u)) ub.append(h('div', 'u-line', l));
    box.append(ub);
  }
  if (it.mythic) {
    const m = CONTENT.mythics[it.mythic];
    const mb = h('div', 'd-mythic');
    mb.append(h('div', 'u-name', m.name), h('div', 'u-line', txt(`mythic.${m.effect}`, m.value)));
    for (const [k, v] of Object.entries(m.mods ?? {})) mb.append(h('div', 'u-line', modText(k as ModKey, v as number)));
    box.append(mb);
  }
  if (it.set) {
    const s = CONTENT.sets[it.set];
    const have = ch ? setCounts(ch)[it.set] ?? 0 : 0;
    const sb = h('div', 'd-set');
    sb.append(h('div', 'u-name', `${s.name}  ${have}/${Object.keys(s.pieces).length}`));
    for (const b of s.bonus) {
      const row = h('div', `u-line${have >= b.count ? ' on' : ''}`, `${b.count}: ${Object.entries(b.mods).map(([k, v]) => modText(k as ModKey, v as number)).join('  ')}`);
      sb.append(row);
    }
    box.append(sb);
  }
  if (it.crystals.length) {
    const cr = h('div', 'd-crystals');
    cr.append(h('span', 'k', txt('item.crystals')));
    for (const c of it.crystals) {
      const g = h('span', c ? 'gem on' : 'gem', c ? CONTENT.crystals[c]?.name ?? '◇' : '◇');
      if (c) g.style.color = CONTENT.crystals[c]?.color ?? '';
      cr.append(g);
    }
    box.append(cr);
  }
  return box;
}

/** 装備の一覧のマス */
export function itemCell(it: Item | null, opts: { label?: string; selected?: boolean; price?: boolean; onClick?: () => void } = {}): HTMLButtonElement {
  const c = h('button', 'cell');
  if (opts.label) c.append(h('span', 'cell-slot', opts.label));
  if (it) {
    c.style.borderColor = rarityColor(it.rarity);
    c.style.color = rarityColor(it.rarity);
    if (CONTENT.rarities.defs[it.rarity].glow) c.classList.add('glow');
    c.style.setProperty('--rc', rarityColor(it.rarity));
    c.append(h('span', 'cell-name', it.name + (it.refine > 0 ? ` +${it.refine}` : '')));
    if (it.set) c.append(h('span', 'cell-set', CONTENT.sets[it.set]?.name ?? ''));
    if (opts.price) c.append(h('span', 'cell-price', `${sellPrice(it, CONTENT)} G`));
    if (it.locked) c.append(h('span', 'cell-lock', '🔒'));
    if (opts.selected) c.classList.add('sel');
    if (opts.onClick) c.addEventListener('click', opts.onClick);
  } else {
    c.classList.add('none');
  }
  return c;
}
