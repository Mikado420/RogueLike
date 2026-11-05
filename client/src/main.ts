import { Application } from 'pixi.js';
import { addPlayer, createWorld, step } from '../../shared/src/sim';
import { CONTENT } from '../../shared/src/content';
import { InputManager } from './input';
import { WorldView } from './view';
import { Hud } from './hud';
import { Sfx } from './audio';
import { loadSettings } from './settings';

async function boot() {
  const host = document.getElementById('game')!;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0c1016',
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const settings = loadSettings();
  const sfx = new Sfx();
  sfx.enabled = settings.sound;

  // いまはブラウザの中でワールドを動かす。オンライン化したらサーバーの結果を受け取る形にする
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  const world = createWorld(seed);
  const me = addPlayer(world, 'あなた');

  const input = new InputManager(host);
  const view = new WorldView(app, world, me.id, settings, sfx);
  const hud = new Hud(world, me.id, input, settings, sfx);

  // 固定タイムステップでロジック、描画は補間
  const TICK_MS = 1000 / CONTENT.balance.tickRate;
  let acc = 0;
  app.ticker.add((t) => {
    acc += Math.min(t.deltaMS, 250);
    while (acc >= TICK_MS) {
      input.playerScreen = view.playerScreenPos();
      view.capturePrev();
      const events = step(world, new Map([[me.id, input.sample()]]));
      view.handleEvents(events);
      hud.handleEvents(events);
      acc -= TICK_MS;
    }
    view.render(acc / TICK_MS, t.deltaMS);
    hud.update();
  });

  // デバッグ用（ブラウザのコンソールから触れる）
  (window as unknown as { eg: unknown }).eg = { world, me };
}

void boot();
