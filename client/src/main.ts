import { Application } from 'pixi.js';
import { newAccount, type AccountData } from '../../shared/src';
import { Sfx } from './audio';
import { loadSettings } from './settings';
import { BrowserSaveStore } from './store';
import { showTitle } from './ui/title';
import { showLocalTitle } from './ui/title-local';
import { registerMigration } from './ui/migrate';
import { Game } from './game';
import { NetSession } from './net/session';

async function boot() {
  const host = document.getElementById('game')!;
  const settings = loadSettings();
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0c1016',
    antialias: settings.quality === 'high',
    resolution: settings.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1,
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const sfx = new Sfx();
  sfx.enabled = settings.sound;
  const unlock = () => sfx.unlock();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  // 開発用：サーバーなしでひとりで（本番のビルドには出さない）
  const local = import.meta.env.DEV && new URLSearchParams(location.search).has('local');
  let reason: string | null = null;
  for (;;) {
    let session: NetSession;
    if (local) {
      const store = new BrowserSaveStore();
      let account: AccountData | null = null;
      try { account = await store.load(); } catch (e) { console.error(e); }
      if (!account) account = newAccount(Date.now(), (Math.random() * 0x7fffffff) >>> 0);
      const charId = await showLocalTitle(account, store);
      session = new NetSession(charId, { account, onSave: (a) => void store.save(a) });
    } else {
      const charId = await showTitle({ reason, migrate: registerMigration() });
      session = new NetSession(charId);
    }
    try {
      await session.start();
      await Promise.race([session.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    } catch (e) {
      console.error(e);
      session.close();
      reason = 'error';
      continue;
    }
    const game = new Game(app, session, settings, sfx);
    reason = await new Promise<string | null>((res) => { game.onExit = res; });
    game.destroy();
    session.close();
  }
}

void boot();
