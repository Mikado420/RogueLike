import { CONTENT, inheritCost, petExpToNext, monsterStats, txt, type PetData } from '../../../shared/src';
import { btn, h, kv } from './dom';
import { modText, type Ctx } from './ctx';
import type { Menu } from './menu';

/** ペットの画面（一覧・連れていく・役割・継承・逃がす） */
export function registerPetTab(menu: Menu, ctx: Ctx) {
  const st = { sel: -1, mat: -1, skill: '', slot: 0, confirm: -1 };
  menu.extraTabs.push({
    id: 'pets', label: txt('menu.pets'), render: (body) => {
      const ch = ctx.me().char;
      if (ch.pets.length === 0) { body.append(h('div', 'muted', txt('pet.none'))); return; }
      const wrap = h('div', 'inv');
      const left = h('div', 'inv-left');
      const list = h('div', 'shop-list');
      for (const pet of ch.pets) {
        const row = h('button', `shop-row pet-row${st.sel === pet.uid ? ' sel' : ''}`);
        row.append(h('span', 'name', `${pet.name}${pet.elite ? ' ★' : ''}`), h('span', 'have', `Lv ${pet.level}`), h('span', 'tag', txt(`pet.${pet.role}`)));
        if (ch.activePet === pet.uid) row.append(h('span', 'tag on', txt('pet.active')));
        row.addEventListener('click', () => { st.sel = pet.uid; st.mat = -1; st.skill = ''; menu.refresh(); });
        list.append(row);
      }
      left.append(list);
      wrap.append(left);
      const det = h('div', 'detail');
      const pet = ch.pets.find((x) => x.uid === st.sel);
      if (!pet) { det.classList.add('empty'); wrap.append(det); body.append(wrap); return; }
      det.append(petInfo(ctx, pet));
      const act = h('div', 'd-actions');
      if (ch.activePet === pet.uid) act.append(btn(txt('pet.dismiss'), () => ctx.send({ type: 'setActivePet', uid: null }), 'btn'));
      else act.append(btn(txt('pet.call'), () => ctx.send({ type: 'setActivePet', uid: pet.uid }), 'btn primary'));
      det.append(act);
      const roles = h('div', 'seg');
      for (const r of ['battle', 'gather'] as const) roles.append(btn(txt(`pet.${r}`), () => ctx.send({ type: 'setPetRole', uid: pet.uid, role: r }), `seg-btn${pet.role === r ? ' on' : ''}`));
      det.append(kv(txt('pet.role'), ''), roles);
      // 継承
      const inh = h('div', 'npc-sec');
      inh.append(h('div', 'sub-title', `${txt('pet.inherit')}  ${inheritCost(ctx.world, pet).toLocaleString()} G`));
      const mats = h('div', 'look-row');
      for (const m of ch.pets) {
        if (m.uid === pet.uid) continue;
        mats.append(btn(`${m.name} Lv${m.level}`, () => { st.mat = m.uid; st.skill = ''; menu.refresh(); }, `look-btn${st.mat === m.uid ? ' on' : ''}`));
      }
      inh.append(h('span', 'muted', txt('pet.material')), mats);
      const mat = ch.pets.find((x) => x.uid === st.mat);
      if (mat) {
        const sk = h('div', 'look-row');
        for (const s of mat.skills) sk.append(btn(CONTENT.pets.skills[s]?.name ?? s, () => { st.skill = s; menu.refresh(); }, `look-btn${st.skill === s ? ' on' : ''}`));
        inh.append(sk);
        const slots = h('div', 'slot-pick');
        slots.append(h('span', 'k', txt('pet.slot')));
        for (let i = 0; i < CONTENT.pets.skillSlots; i++) slots.append(btn(pet.skills[i] ? CONTENT.pets.skills[pet.skills[i]]?.name ?? `${i + 1}` : `${i + 1}`, () => { st.slot = i; menu.refresh(); }, `mini${st.slot === i ? ' on' : ''}`));
        inh.append(slots);
        const go = btn(txt('pet.inherit'), () => { ctx.send({ type: 'inheritPet', base: pet.uid, material: mat.uid, skill: st.skill, slot: st.slot }); st.mat = -1; st.skill = ''; }, 'btn primary');
        go.disabled = !st.skill || ch.gold < inheritCost(ctx.world, pet);
        inh.append(go);
      }
      det.append(inh);
      const rel = btn(st.confirm === pet.uid ? txt('pet.confirm') : txt('pet.release'), () => {
        if (st.confirm !== pet.uid) { st.confirm = pet.uid; menu.refresh(); return; }
        ctx.send({ type: 'releasePet', uid: pet.uid }); st.sel = -1; st.confirm = -1;
      }, `mini danger${st.confirm === pet.uid ? ' on' : ''}`);
      det.append(rel);
      wrap.append(det);
      body.append(wrap);
    },
  });
}

function petInfo(ctx: Ctx, pet: PetData): HTMLElement {
  const box = h('div', 'item-info');
  const def = CONTENT.monsters[pet.species];
  box.append(h('div', 'd-name', `${pet.name}${pet.elite ? ' ★' : ''}`));
  box.append(kv(txt('stat.level'), `${pet.level}  (${pet.exp}/${petExpToNext(ctx.world, pet.level)})`));
  const st = monsterStats(def, pet.level, CONTENT, { hp: 1, atk: CONTENT.pets.atkMul * (pet.elite ? 1.3 : 1), def: 1, exp: 0, gold: 0 });
  box.append(kv(txt('d.atk'), String(st.atk)), kv(txt('d.matk'), String(st.matk)), kv(txt('d.element'), txt(`el.${def.element}`)));
  const sk = h('div', 'd-unique');
  sk.append(h('div', 'u-name', txt('pet.skills')));
  for (const id of pet.skills) {
    const s = CONTENT.pets.skills[id];
    if (!s) continue;
    const mods = Object.entries(s.mods ?? {}).map(([k, v]) => modText(k as never, v as number)).join(' ');
    sk.append(h('div', 'u-line', `${s.name}${mods ? `  ${mods}` : ''}`));
  }
  box.append(sk);
  return box;
}
