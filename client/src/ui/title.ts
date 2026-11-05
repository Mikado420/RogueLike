import { CONTENT, txt } from '../../../shared/src';
import { BODY_COLORS, HAIR_COLORS } from '../colors';
import { api, ApiError, getToken, setToken, type Me } from '../net/api';
import { btn, h } from './dom';

export interface TitleHooks {
  /** 古いセーブの引き継ぎ画面（O4） */
  migrate?: (box: HTMLElement, back: () => void, me: Me) => void;
  /** 前回切られた理由 */
  reason?: string | null;
}

const errText = (e: unknown) => txt(`net.${e instanceof ApiError ? e.code : 'error'}`) || txt('net.error');

/** タイトル画面（オンライン）。ログインしてキャラを選ぶと、その id を返す */
export function showTitle(hooks: TitleHooks = {}): Promise<string> {
  return new Promise((resolve) => {
    const root = h('div', 'title-screen');
    const sky = h('div', 'title-sky');
    for (let i = 0; i < 40; i++) {
      const c = h('i', 'crystal');
      c.style.left = `${Math.random() * 100}%`;
      c.style.animationDelay = `${-Math.random() * 8}s`;
      c.style.animationDuration = `${5 + Math.random() * 6}s`;
      c.style.opacity = String(0.3 + Math.random() * 0.7);
      sky.append(c);
    }
    root.append(sky);
    const box = h('div', 'title-box');
    root.append(box);
    document.body.append(root);
    let me: Me | null = null;
    let reason = hooks.reason ?? null;

    const done = (id: string) => {
      root.classList.add('out');
      setTimeout(() => root.remove(), 400);
      resolve(id);
    };
    const head = (sub?: string) => {
      box.replaceChildren();
      box.append(h('div', 'title-logo', txt('game.title')));
      if (sub) box.append(h('div', 'title-sub', sub));
    };
    const errLine = () => h('div', 'title-err');
    const busy = async (el: HTMLElement, fn: () => Promise<void>) => {
      box.classList.add('busy');
      try { await fn(); } catch (e) { el.textContent = errText(e); } finally { box.classList.remove('busy'); }
    };

    /** 最初の画面：トークンがあればアカウントを読む */
    const start = async () => {
      head();
      const err = errLine();
      box.append(err);
      if (!getToken()) { welcome(); return; }
      try {
        me = await api.me();
        main();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { setToken(null); welcome(); return; }
        if (e instanceof ApiError && e.code === 'banned') { err.textContent = txt('net.banned'); return; }
        err.textContent = errText(e);
        box.append(btn(txt('net.retry'), () => void start(), 'btn primary big'));
      }
    };

    /** はじめての端末 */
    const welcome = () => {
      head();
      const err = errLine();
      const list = h('div', 'title-buttons');
      list.append(btn(txt('title.begin'), () => void busy(err, async () => { await api.guest(); me = await api.me(); main(); }), 'btn primary big'));
      list.append(btn(txt('title.transfer'), redeem, 'btn'));
      box.append(list, err);
    };

    const redeem = () => {
      head(txt('title.transfer'));
      const form = h('div', 'create-form');
      const row = h('label', 'form-row');
      row.append(h('span', '', txt('account.code')));
      const input = h('input', 'text-input');
      input.maxLength = 12;
      input.autocapitalize = 'characters';
      row.append(input);
      form.append(row);
      const err = errLine();
      const acts = h('div', 'title-buttons');
      acts.append(btn(txt('title.ok'), () => void busy(err, async () => { await api.redeemTransfer(input.value); me = await api.me(); main(); }), 'btn primary big'));
      acts.append(btn(txt('title.back'), () => void start(), 'btn'));
      box.append(form, acts, err);
    };

    const main = () => {
      head();
      if (reason) { box.append(h('div', 'title-err', txt(`net.kick.${reason}`) || reason)); reason = null; }
      const list = h('div', 'title-buttons');
      const chars = me?.characters ?? [];
      if (chars.length > 0) list.append(btn(txt('title.continue'), charList, 'btn primary big'));
      if (chars.length < 4) list.append(btn(txt('title.new'), create, chars.length ? 'btn big' : 'btn primary big'));
      list.append(btn(txt('title.account'), account, 'btn'));
      box.append(list);
      if (me?.handle) box.append(h('div', 'title-who', `${me.name ?? ''} @${me.handle}`));
    };

    const charList = () => {
      head(txt('title.continue'));
      const list = h('div', 'char-list');
      let confirm: string | null = null;
      const err = errLine();
      const draw = () => {
        list.replaceChildren();
        for (const ch of me?.characters ?? []) {
          const row = h('div', 'char-row');
          const sw = h('i', 'swatch');
          sw.style.background = `#${BODY_COLORS[ch.look.body % BODY_COLORS.length].toString(16).padStart(6, '0')}`;
          const info = h('button', 'char-pick');
          info.append(sw, h('b', '', ch.name), h('span', '', `${txt('stat.level')} ${ch.level}${ch.rebirths ? ` ★${ch.rebirths}` : ''}`), h('span', 'muted', CONTENT.areas[ch.area]?.name ?? ''));
          info.addEventListener('click', () => done(ch.id));
          row.append(info);
          row.append(btn(confirm === ch.id ? txt('title.confirmDelete') : txt('title.delete'), () => {
            if (confirm !== ch.id) { confirm = ch.id; draw(); return; }
            void busy(err, async () => { await api.deleteCharacter(ch.id); me = await api.me(); confirm = null; if (!me.characters.length) main(); else draw(); });
          }, `mini danger${confirm === ch.id ? ' on' : ''}`));
          list.append(row);
        }
      };
      draw();
      box.append(list, err, btn(txt('title.back'), main, 'btn'));
    };

    const create = () => {
      head(txt('title.new'));
      const look = { body: 0, hair: 0 };
      const form = h('div', 'create-form');
      const nameRow = h('label', 'form-row');
      nameRow.append(h('span', '', txt('create.name')));
      const input = h('input', 'text-input');
      input.maxLength = 12;
      input.placeholder = txt('create.name');
      nameRow.append(input);
      form.append(nameRow);
      const swatches = (label: string, colors: number[], key: 'body' | 'hair') => {
        const row = h('div', 'form-row');
        row.append(h('span', '', label));
        const g = h('div', 'swatches');
        colors.forEach((c, i) => {
          const s = h('button', `swatch-btn${look[key] === i ? ' on' : ''}`);
          s.style.background = `#${c.toString(16).padStart(6, '0')}`;
          s.addEventListener('click', () => { look[key] = i; g.querySelectorAll('.swatch-btn').forEach((e, j) => e.classList.toggle('on', j === i)); });
          g.append(s);
        });
        row.append(g);
        form.append(row);
      };
      swatches(txt('create.body'), BODY_COLORS, 'body');
      swatches(txt('create.hair'), HAIR_COLORS, 'hair');
      const err = errLine();
      const actions = h('div', 'title-buttons');
      actions.append(btn(txt('title.start'), () => void busy(err, async () => { const r = await api.createCharacter(input.value, { ...look }); done(r.id); }), 'btn primary big'));
      actions.append(btn(txt('title.back'), main, 'btn'));
      box.append(form, actions, err);
      setTimeout(() => input.focus(), 50);
    };

    /** アカウント：ID と名前・引き継ぎコード・古いセーブ */
    const account = () => {
      head(txt('title.account'));
      const form = h('div', 'create-form');
      const mk = (label: string, value: string, max: number) => {
        const row = h('label', 'form-row');
        row.append(h('span', '', label));
        const i = h('input', 'text-input');
        i.maxLength = max; i.value = value;
        row.append(i);
        form.append(row);
        return i;
      };
      const handle = mk(txt('account.handle'), me?.handle ?? '', 16);
      const name = mk(txt('account.name'), me?.name ?? '', 16);
      const err = errLine();
      const acts = h('div', 'title-buttons');
      acts.append(btn(txt('account.save'), () => void busy(err, async () => { await api.profile(handle.value.trim(), name.value.trim()); me = await api.me(); err.textContent = txt('account.saved'); }), 'btn primary'));
      const code = h('div', 'title-code');
      acts.append(btn(txt('account.issue'), () => void busy(err, async () => { const r = await api.issueTransfer(); code.textContent = r.code; }), 'btn'));
      if (hooks.migrate && me && !me.migrated) acts.append(btn(txt('account.migrate'), () => hooks.migrate!(box, () => void api.me().then((m) => { me = m; account(); }).catch(() => account()), me!), 'btn'));
      acts.append(btn(txt('title.back'), main, 'btn'));
      box.append(form, code, acts, err);
    };

    void start();
  });
}
