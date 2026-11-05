import { deserializeAccount, txt, type AccountData, type Removed } from '../../../shared/src';
import { api, ApiError, type Me } from '../net/api';
import { BrowserSaveStore } from '../store';
import { btn, h } from './dom';
import type { TitleHooks } from './title';

const label = (k: string, v: string) => { const t = txt(`${k}.${v}`); return t && t !== `${k}.${v}` ? t : v; };

/** オフライン版のセーブの引き継ぎ画面（このブラウザの保存・書き出したファイル） */
export function registerMigration(): TitleHooks['migrate'] {
  return (box: HTMLElement, back: () => void, _me: Me) => {
    void _me;
    let picked: AccountData | null = null;
    const draw = (msg = '') => {
      box.replaceChildren();
      box.append(h('div', 'title-logo', txt('game.title')), h('div', 'title-sub', txt('account.migrate')));
      const list = h('div', 'char-list');
      for (const ch of picked?.characters ?? []) {
        const row = h('div', 'char-row');
        row.append(h('div', 'char-pick', `${ch.name}  ${txt('stat.level')} ${ch.level}`));
        list.append(row);
      }
      const err = h('div', 'title-err', msg);
      const acts = h('div', 'title-buttons');
      if (picked) {
        acts.append(btn(txt('migrate.go'), async () => {
          box.classList.add('busy');
          try {
            const r = await api.migrate(picked);
            result(r.characters, r.removed);
          } catch (e) {
            draw(txt(`net.${e instanceof ApiError ? e.code : 'error'}`));
          } finally { box.classList.remove('busy'); }
        }, 'btn primary big'));
      }
      const file = h('input');
      file.type = 'file'; file.accept = 'application/json,.json'; file.style.display = 'none';
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        try { picked = deserializeAccount(await f.text()); draw(); } catch { draw(txt('err.importFailed')); }
      });
      acts.append(btn(txt('migrate.file'), () => file.click(), 'btn'), file, btn(txt('title.back'), back, 'btn'));
      box.append(list, acts, err);
    };
    const result = (n: number, removed: Removed[]) => {
      box.replaceChildren();
      box.append(h('div', 'title-logo', txt('game.title')), h('div', 'title-sub', `${txt('migrate.done')}  ${n}`));
      if (removed.length) {
        box.append(h('div', 'title-sub', txt('migrate.removed')));
        const list = h('div', 'removed-list');
        for (const r of removed) {
          const row = h('div', 'removed-row');
          row.append(h('span', '', r.char ?? txt('migrate.storage')), h('b', '', label('migrate.what', r.what)), h('span', 'muted', label('migrate.reason', r.reason)));
          list.append(row);
        }
        box.append(list);
      }
      box.append(btn(txt('title.back'), back, 'btn primary'));
    };
    // このブラウザに残っている保存を探す
    void new BrowserSaveStore().load().then((acc) => { if (acc && acc.characters.length) picked = acc; draw(); }).catch(() => draw());
    draw();
  };
}
