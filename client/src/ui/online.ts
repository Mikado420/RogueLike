import {
  CONTENT, OfflineServices, txt, type BuildRow, type OnlineResult, type OnlineServices, type RecruitEntry, type RescueEntry, type Visibility,
} from '../../../shared/src';
import type { SocialClient } from '../net/social';
import { btn, h, kv } from './dom';
import type { Menu } from './menu';
import type { Ctx } from './ctx';

type Sub = 'party' | 'recruit' | 'rescue' | 'builds' | 'guild';
const SUBS: Sub[] = ['party', 'recruit', 'rescue', 'builds', 'guild'];

/** 目的（募集の掲示に出す行き先） */
function goalName(g: string | null): string {
  if (!g) return txt('online.free');
  return CONTENT.dungeons.dungeons[g]?.name ?? CONTENT.raids[g]?.name ?? (g === 'tower' ? CONTENT.tower.name : CONTENT.areas[g]?.name ?? g);
}

/**
 * メニューの「オンライン」タブ。パーティ・募集・救援・ビルド閲覧・ギルド。
 * サーバーにつながらないときはどれも「オフライン」。
 */
export function registerOnlineTab(menu: Menu, ctx: Ctx, services: OnlineServices = OfflineServices, social: SocialClient | null = null) {
  const st: {
    sub: Sub; recruits: RecruitEntry[]; rescues: RescueEntry[]; builds: BuildRow[]; card: Record<string, unknown> | null;
    q: string; msg: string; loaded: Partial<Record<Sub, boolean>>;
  } = { sub: 'party', recruits: [], rescues: [], builds: [], card: null, q: '', msg: '', loaded: {} };
  const refresh = () => menu.refresh();
  if (social) social.onChange = () => { if (menu.isOpen && menu.tab === ('online' as never)) refresh(); };
  const run = async <T>(p: Promise<OnlineResult<T>>, ok?: (v: T) => void) => {
    const r = await p;
    if (r.ok) { st.msg = ''; ok?.(r.value); } else st.msg = r.reason === 'offline' ? txt('online.offline') : txt(`net.${r.message ?? 'error'}`) || txt('net.error');
    refresh();
  };
  const load = (sub: Sub, force = false) => {
    if (st.loaded[sub] && !force) return;
    st.loaded[sub] = true;
    if (sub === 'recruit') void run(services.party.recruits(), (v) => { st.recruits = v; });
    if (sub === 'rescue') void run(services.rescue.list(), (v) => { st.rescues = v; });
    if (sub === 'builds') void run(services.builds.search(st.q), (v) => { st.builds = v; });
  };
  const input = (ph: string, max = 16) => { const i = h('input'); i.placeholder = ph; i.maxLength = max; return i; };

  menu.extraTabs.push({
    id: 'online',
    label: txt('menu.online'),
    render: (el) => {
      const online = services.status().online;
      if (!online) {
        const list = h('div', 'online-list');
        for (const k of SUBS) { const row = h('div', 'online-row'); row.append(h('span', 'name', txt(`online.${k}`)), h('span', 'online-state', txt('online.offline'))); list.append(row); }
        el.append(list);
        return;
      }
      const tabs = h('div', 'online-sub');
      for (const s of SUBS) tabs.append(btn(txt(`online.${s}`), () => { st.sub = s; st.card = null; load(s); refresh(); }, `seg-btn${st.sub === s ? ' on' : ''}`));
      el.append(tabs);
      const box = h('div', 'online-box');
      el.append(box);
      if (st.msg) box.append(h('div', [txt('online.invited'), txt('online.saved')].includes(st.msg) ? 'online-ok' : 'title-err', st.msg));
      load(st.sub);
      const me = ctx.me();
      const myA = ctx.me().account?.id;

      // ───── パーティ ─────
      if (st.sub === 'party') {
        const p = social?.party ?? null;
        if (!p) box.append(btn(txt('online.create'), () => void run(services.party.create()), 'btn primary'));
        else {
          for (const m of p.members) {
            const row = h('div', 'online-line');
            row.append(h('span', 'name', `${m.a === p.leader ? '★ ' : ''}${m.name}`), h('span', 'muted', `${txt('stat.level')} ${m.level}`));
            if (p.leader === myA && m.a !== myA) row.append(btn(txt('online.kick'), () => void run(services.party.leave(m.a)), 'mini danger'));
            box.append(row);
          }
          const f = h('div', 'online-form');
          const who = input(txt('account.handle'));
          f.append(who, btn(txt('online.invite'), () => void run(services.party.invite(who.value.trim()), () => { st.msg = txt('online.invited'); }), 'btn'));
          box.append(f);
          if (p.leader === myA) {
            const g = h('div', 'online-form');
            const sel = h('select');
            for (const [v, name] of [['', txt('online.free')], ...Object.keys(CONTENT.dungeons.dungeons).map((d) => [d, goalName(d)]), ['tower', goalName('tower')], ...Object.keys(CONTENT.raids).map((r) => [r, goalName(r)])]) {
              const o = h('option'); o.value = v; o.textContent = name; if ((p.goal ?? '') === v) o.selected = true; sel.append(o);
            }
            g.append(sel, btn(p.open ? txt('online.close') : txt('online.post'), () => void run(services.party.setOpen(!p.open, sel.value || null)), p.open ? 'btn' : 'btn primary'));
            box.append(g);
          }
          box.append(btn(txt('online.leave'), () => void run(services.party.leave()), 'btn danger'));
        }
        for (const inv of social?.invites.filter((i) => i.kind === 'party') ?? []) {
          const row = h('div', 'online-line');
          row.append(h('span', 'name', inv.from.name), btn(txt('online.join'), () => { social!.invites = social!.invites.filter((x) => x !== inv); void run(services.party.join(inv.id)); }, 'mini'));
          box.append(row);
        }
      }

      // ───── 募集 ─────
      if (st.sub === 'recruit') {
        box.append(btn(txt('online.reload'), () => load('recruit', true), 'mini'));
        for (const r of st.recruits) {
          const row = h('div', 'online-line');
          row.append(h('span', 'name', goalName(r.goal)), h('span', 'muted', `${r.name}  ${txt('stat.level')} ${r.level}  ${r.members}/${CONTENT.social.party.max}`));
          row.append(btn(txt('online.join'), () => void run(services.party.join(r.id)), 'mini'));
          box.append(row);
        }
      }

      // ───── 救援 ─────
      if (st.sub === 'rescue') {
        const inInst = !!ctx.world.area.instance && !ctx.world.area.instance.cleared;
        const acts = h('div', 'online-form');
        if (inInst) acts.append(btn(txt('online.callRescue'), () => { ctx.send({ type: 'rescue' }); }, 'btn primary'));
        acts.append(btn(txt('online.reload'), () => load('rescue', true), 'mini'));
        box.append(acts);
        for (const r of st.rescues) {
          const row = h('div', 'online-line');
          const where = r.kind === 'tower' ? `${CONTENT.tower.name} ${r.floor}F` : goalName(r.dungeon);
          row.append(h('span', 'name', where), h('span', 'muted', `${r.name}  ${txt('stat.level')} ${r.level}  ${CONTENT.difficulties[r.difficulty as keyof typeof CONTENT.difficulties]?.name ?? ''}`));
          row.append(btn(txt('online.go'), () => void run(services.rescue.join(r.id), () => menu.toggle()), 'mini primary'));
          box.append(row);
        }
      }

      // ───── ビルド閲覧 ─────
      if (st.sub === 'builds') {
        const vis = h('div', 'set-row');
        vis.append(h('div', 'set-label', me.char.name));
        const g = h('div', 'seg');
        for (const v of ['public', 'guild', 'private'] as Visibility[]) g.append(btn(txt(`online.vis.${v}`), () => void run(services.builds.publish(me.char.id, v), () => { st.msg = txt('online.saved'); }), 'seg-btn'));
        vis.append(g);
        box.append(vis);
        const f = h('div', 'online-form');
        const q = input(txt('online.search'));
        q.value = st.q;
        f.append(q, btn(txt('online.search'), () => { st.q = q.value.trim(); load('builds', true); }, 'btn'));
        box.append(f);
        if (st.card) box.append(cardView(st.card), btn(txt('title.back'), () => { st.card = null; refresh(); }, 'mini'));
        else for (const b of st.builds) {
          const row = h('div', 'online-line');
          row.append(h('span', 'name', `${b.name}${b.handle ? ` @${b.handle}` : ''}`), h('span', 'muted', `${txt('stat.level')} ${b.level}  ${b.weapon ? CONTENT.weapons[b.weapon as keyof typeof CONTENT.weapons]?.name ?? '' : ''}`));
          row.append(btn(txt('online.view'), () => void run(services.builds.view(b.char_id), (v) => { st.card = v; }), 'mini'));
          box.append(row);
        }
      }

      // ───── ギルド ─────
      if (st.sub === 'guild') {
        const gd = social?.guild ?? null;
        if (!gd) {
          const f = h('div', 'online-form');
          const n = input(txt('online.guildName'), CONTENT.social.guild.nameMax);
          f.append(n, btn(txt('online.create'), () => void run(services.guild.create(n.value.trim())), 'btn primary'));
          box.append(f);
          for (const inv of social?.invites.filter((i) => i.kind === 'guild') ?? []) {
            const row = h('div', 'online-line');
            row.append(h('span', 'name', inv.name ?? ''), h('span', 'muted', inv.from.name), btn(txt('online.join'), () => { social!.invites = social!.invites.filter((x) => x !== inv); void run(services.guild.join(inv.id)); }, 'mini'));
            box.append(row);
          }
        } else {
          box.append(h('div', 'char-name', gd.name));
          const myRole = gd.members.find((m) => m.a === myA)?.role;
          for (const m of gd.members) {
            const row = h('div', 'online-line');
            row.append(h('span', 'name', m.name), h('span', 'muted', txt(`online.role.${m.role}`)));
            if (myRole === 'master' && m.a !== myA) {
              const sel = h('select');
              for (const r of ['officer', 'member', 'master'] as const) { const o = h('option'); o.value = r; o.textContent = txt(`online.role.${r}`); if (m.role === r) o.selected = true; sel.append(o); }
              sel.addEventListener('change', () => void run(services.guild.setRole(m.a, sel.value as 'master' | 'officer' | 'member')));
              row.append(sel);
            }
            if ((myRole === 'master' || (myRole === 'officer' && m.role === 'member')) && m.a !== myA) row.append(btn(txt('online.kick'), () => void run(services.guild.leave(m.a)), 'mini danger'));
            box.append(row);
          }
          if (myRole !== 'member') {
            const f = h('div', 'online-form');
            const who = input(txt('account.handle'));
            f.append(who, btn(txt('online.invite'), () => void run(services.guild.invite(who.value.trim()), () => { st.msg = txt('online.invited'); }), 'btn'));
            box.append(f);
          }
          box.append(btn(txt('online.leave'), () => void run(services.guild.leave()), 'btn danger'));
        }
      }
    },
  });
}

/** プロフィールカード */
function cardView(c: Record<string, any>): HTMLElement {
  const box = h('div', 'card-view');
  box.append(h('div', 'char-name', `${c.name}${c.handle ? ` @${c.handle}` : ''}`));
  box.append(kv(txt('stat.level'), `${c.level}${c.rebirths ? ` ★${c.rebirths}` : ''}`));
  if (c.title) box.append(kv(txt('online.title'), CONTENT.titles[c.title]?.name ?? c.title));
  const stats = h('div', 'row');
  for (const [k, v] of Object.entries(c.stats ?? {})) stats.append(h('span', 'chip', `${k.toUpperCase()} ${v}`));
  if (c.personal?.type) stats.append(h('span', 'chip', `${CONTENT.balance.personal[c.personal.type as keyof typeof CONTENT.balance.personal]?.name ?? c.personal.type} ${c.personal.value}`));
  box.append(stats);
  const sk = h('div', 'row');
  for (const [id, lv] of Object.entries(c.skills ?? {})) sk.append(h('span', 'chip', `${CONTENT.skills[id]?.name ?? id} ${lv}`));
  box.append(sk);
  const eq = h('div', 'row');
  for (const it of Object.values(c.equipment ?? {}) as any[]) if (it) eq.append(h('span', 'chip', `${it.name}${it.refine ? ` +${it.refine}` : ''}`));
  box.append(eq);
  return box;
}
