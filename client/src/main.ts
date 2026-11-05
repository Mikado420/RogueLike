import { Application } from 'pixi.js';
import { newAccount, type AccountData } from '../../shared/src';
import { Sfx } from './audio';
import { loadSettings } from './settings';
import { BrowserSaveStore } from './store';
import { showTitle } from './ui/title';
import { Game } from './game';

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

  const store = new BrowserSaveStore();
  let account: AccountData | null = null;
  try { account = await store.load(); } catch (e) { console.error(e); }
  if (!account) account = newAccount(Date.now(), (Math.random() * 0x7fffffff) >>> 0);

  const charId = await showTitle(account, store);
  new Game(app, account, charId, store, settings, sfx);
}

void boot();
