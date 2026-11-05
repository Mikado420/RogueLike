import {
  CONTENT, EQUIP_SLOTS, OfflineServices, RARITIES, txt, type Item, type MailItem, type BuildRow, type OnlineResult, type OnlineServices, type RecruitEntry, type RescueEntry, type Visibility,
} from '../../../shared/src';
import type { SocialClient } from '../net/social';
import { api } from '../net/api';

interface MarketRow { id: string; seller: string; sellerName: string; price: number; item: Item }
import { btn, h, kv } from './dom';
import type { Menu } from './menu';
import type { Ctx } from './ctx';

type Sub = 'party' | 'recruit' | 'rescue' | 'builds' | 'guild' | 'market' | 'mail' | 'stall';
const SUBS: Sub[] = ['party', 'recruit', 'rescue', 'market', 'mail', 'stall', 'builds', 'guild'];

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
    market: MarketRow[]; mine: MarketRow[]; mail: MailItem[]; mq: Record<string, string>; sell: { uid: number; price: string }; stallSel: Record<number, string>; stallTitle: string;
  } = { sub: 'party', recruits: [], rescues: [], builds: [], card: null, q: '', msg: '', loaded: {}, market: [], mine: [], mail: [], mq: {}, sell: { uid: 0, price: '' }, stallSel: {}, stallTitle: '' };
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
    if (sub === 'market') {
      void run(services.market.search(st.mq), (v) => { st.market = v as MarketRow[]; });
      void run(services.market.search({ mine: 1 }), (v) => { st.mine = v as MarketRow[]; });
    }
    if (sub === 'mail') void api.get<{ mail: MailItem[] }>('/api/mail').then((r) => { st.mail = r.mail; refresh(); }).catch(() => {});
  };
  const itemLine = (it: Item, extra: string) => {
    const row = h('div', 'online-line');
    const n = h('span', 'name', `${it.name}${it.refine ? ` +${it.refine}` : ''}`);
    n.style.color = CONTENT.rarities.defs[it.rarity].color;
    row.append(n, h('span', 'muted', `Lv${it.ilvl}  ${extra}`));
    return row;
  };
  const tradable = () => ctx.me().char.inventory.filter((i) => !i.locked && i.trade !== 'none');
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

      // ───── 取引所 ─────
      if (st.sub === 'market') {
        const f = h('div', 'online-form');
        const sel = (key: string, opts: [string, string][]) => {
          const e = h('select');
          for (const [v, name] of [['', txt('market.any')] as [string, string], ...opts]) { const o = h('option'); o.value = v; o.textContent = name; if ((st.mq[key] ?? '') === v) o.selected = true; e.append(o); }
          e.addEventListener('change', () => { st.mq[key] = e.value; });
          return e;
        };
        f.append(sel('slot', EQUIP_SLOTS.map((x) => [x, txt(`slot.${x}`)])));
        f.append(sel('rarity', RARITIES.map((x) => [x, CONTENT.rarities.defs[x].name])));
        f.append(sel('opt', CONTENT.options.pool.map((o) => [o.key, o.label])));
        f.append(sel('sort', [['low', txt('market.low')], ['high', txt('market.high')], ['new', txt('market.new')]]));
        const mx = input(txt('market.max'), 10);
        mx.value = st.mq.max ?? '';
        mx.addEventListener('input', () => { st.mq.max = mx.value; });
        f.append(mx, btn(txt('online.search'), () => load('market', true), 'btn'));
        box.append(f);
        for (const r of st.market) {
          const row = itemLine(r.item, `${r.price.toLocaleString()} G  ${r.sellerName}`);
          row.append(btn(txt('market.buy'), () => { ctx.send({ type: 'marketBuy', id: r.id, price: r.price }); st.market = st.market.filter((x) => x !== r); refresh(); }, 'mini primary'));
          box.append(row);
        }
        box.append(h('div', 'sub-title', txt('market.sell')));
        const g = h('div', 'online-form');
        const pick = h('select');
        for (const it of tradable()) { const o = h('option'); o.value = String(it.uid); o.textContent = `${it.name}${it.refine ? ` +${it.refine}` : ''}`; if (st.sell.uid === it.uid) o.selected = true; pick.append(o); }
        const price = input(txt('market.price'), 10);
        price.value = st.sell.price;
        price.inputMode = 'numeric';
        g.append(pick, price, btn(txt('market.list'), () => {
          const uid = Number(pick.value), pr = Math.floor(Number(price.value));
          if (!uid || !(pr > 0)) return;
          ctx.send({ type: 'marketList', uid, price: pr });
          st.sell = { uid: 0, price: '' };
          setTimeout(() => load('market', true), 1500);
        }, 'btn primary'));
        box.append(g);
        if (st.mine.length) box.append(h('div', 'sub-title', txt('market.mine')));
        for (const r of st.mine) {
          const row = itemLine(r.item, `${r.price.toLocaleString()} G`);
          row.append(btn(txt('market.cancel'), () => { ctx.send({ type: 'marketCancel', id: r.id }); st.mine = st.mine.filter((x) => x !== r); refresh(); }, 'mini'));
          box.append(row);
        }
      }

      // ───── 郵便受け ─────
      if (st.sub === 'mail') {
        const acts = h('div', 'online-form');
        acts.append(btn(txt('mail.take'), () => { ctx.send({ type: 'claimMail' }); setTimeout(() => load('mail', true), 1500); }, 'btn primary'), btn(txt('online.reload'), () => load('mail', true), 'mini'));
        box.append(acts);
        for (const m of st.mail) {
          const row = m.item ? itemLine(m.item, txt(`mail.from.${m.from}`)) : h('div', 'online-line');
          if (!m.item) row.append(h('span', 'name', m.gold ? `${m.gold.toLocaleString()} G` : m.bag ? `${CONTENT.materials[m.bag.id]?.name ?? m.bag.id} ×${m.bag.n}` : ''), h('span', 'muted', txt(`mail.from.${m.from}`)));
          box.append(row);
        }
      }

      // ───── 露店 ─────
      if (st.sub === 'stall') {
        const meP = ctx.me();
        if (meP.stall) {
          box.append(h('div', 'char-name', meP.stall.title || txt('online.stall')));
          for (const x of meP.stall.items) box.append(itemLine(x.item, `${x.price.toLocaleString()} G`));
          box.append(btn(txt('stall.close'), () => ctx.send({ type: 'stallClose' }), 'btn danger'));
        } else if (ctx.world.area.type === 'town') {
          const t = input(txt('stall.title'), 16);
          t.value = st.stallTitle;
          t.addEventListener('input', () => { st.stallTitle = t.value; });
          box.append(t);
          for (const it of tradable()) {
            const row = itemLine(it, '');
            const pr = input(txt('market.price'), 10);
            pr.inputMode = 'numeric';
            pr.value = st.stallSel[it.uid] ?? '';
            pr.addEventListener('input', () => { st.stallSel[it.uid] = pr.value; });
            row.append(pr);
            box.append(row);
          }
          box.append(btn(txt('stall.open'), () => {
            const items = Object.entries(st.stallSel).map(([uid, v]) => ({ uid: Number(uid), price: Math.floor(Number(v)) })).filter((x) => x.price > 0);
            if (items.length) ctx.send({ type: 'stallOpen', title: st.stallTitle, items });
            st.stallSel = {};
          }, 'btn primary'));
        }
        const others = ctx.world.players.filter((p) => p.id !== meP.id && p.stall);
        if (others.length) box.append(h('div', 'sub-title', txt('stall.near')));
        for (const p of others) {
          box.append(h('div', 'name', `${p.char.name}  ${p.stall!.title}`));
          for (const x of p.stall!.items) {
            const row = itemLine(x.item, `${x.price.toLocaleString()} G`);
            row.append(btn(txt('market.buy'), () => ctx.send({ type: 'stallBuy', seller: p.id, uid: x.uid, price: x.price }), 'mini primary'));
            box.append(row);
          }
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
