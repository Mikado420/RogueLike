import { CONTENT, newCharacter, txt, type AccountData, type SaveStore } from '../../../shared/src';
import { BODY_COLORS, HAIR_COLORS } from '../colors';
import { btn, h } from './dom';

/** タイトル画面。キャラクターを選ぶか作ると、その id を返す */
export function showTitle(account: AccountData, store: SaveStore): Promise<string> {
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

    const done = (id: string) => {
      root.classList.add('out');
      setTimeout(() => root.remove(), 400);
      resolve(id);
    };

    const main = () => {
      box.replaceChildren();
      box.append(h('div', 'title-logo', txt('game.title')));
      const list = h('div', 'title-buttons');
      if (account.characters.length > 0) list.append(btn(txt('title.continue'), chars, 'btn primary big'));
      list.append(btn(txt('title.new'), create, account.characters.length ? 'btn big' : 'btn primary big'));
      box.append(list);
    };

    const chars = () => {
      box.replaceChildren();
      box.append(h('div', 'title-sub', txt('title.continue')));
      const list = h('div', 'char-list');
      let confirm: string | null = null;
      const draw = () => {
        list.replaceChildren();
        const sorted = [...account.characters].sort((a, b) => (a.id === account.lastCharacterId ? -1 : b.id === account.lastCharacterId ? 1 : 0));
        for (const ch of sorted) {
          const row = h('div', 'char-row');
          const sw = h('i', 'swatch');
          sw.style.background = `#${BODY_COLORS[ch.look.body % BODY_COLORS.length].toString(16).padStart(6, '0')}`;
          const info = h('button', 'char-pick');
          info.append(sw, h('b', '', ch.name), h('span', '', `${txt('stat.level')} ${ch.level}${ch.rebirths ? ` ★${ch.rebirths}` : ''}`), h('span', 'muted', CONTENT.areas[ch.location.area]?.name ?? ''));
          info.addEventListener('click', () => done(ch.id));
          row.append(info);
          const del = btn(confirm === ch.id ? txt('title.confirmDelete') : txt('title.delete'), async () => {
            if (confirm !== ch.id) { confirm = ch.id; draw(); return; }
            account.characters = account.characters.filter((c) => c.id !== ch.id);
            if (account.lastCharacterId === ch.id) account.lastCharacterId = null;
            await store.save(account);
            confirm = null;
            if (account.characters.length === 0) main(); else draw();
          }, `mini danger${confirm === ch.id ? ' on' : ''}`);
          row.append(del);
          list.append(row);
        }
      };
      draw();
      box.append(list);
      box.append(btn(txt('title.back'), main, 'btn'));
    };

    const create = () => {
      box.replaceChildren();
      box.append(h('div', 'title-sub', txt('title.new')));
      const look = { body: 0, hair: 0 };
      const form = h('div', 'create-form');
      const nameRow = h('label', 'form-row');
      nameRow.append(h('span', '', txt('create.name')));
      const input = h('input', 'text-input');
      input.maxLength = 12;
      input.value = '';
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
          s.addEventListener('click', () => {
            look[key] = i;
            g.querySelectorAll('.swatch-btn').forEach((e, j) => e.classList.toggle('on', j === i));
          });
          g.append(s);
        });
        row.append(g);
        form.append(row);
      };
      swatches(txt('create.body'), BODY_COLORS, 'body');
      swatches(txt('create.hair'), HAIR_COLORS, 'hair');
      box.append(form);
      const actions = h('div', 'title-buttons');
      actions.append(btn(txt('title.start'), async () => {
        const ch = newCharacter(account, input.value, { ...look }, Date.now());
        await store.save(account);
        done(ch.id);
      }, 'btn primary big'));
      actions.append(btn(txt('title.back'), main, 'btn'));
      box.append(actions);
      setTimeout(() => input.focus(), 50);
    };

    main();
  });
}
