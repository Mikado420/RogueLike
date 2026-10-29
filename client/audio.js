// 効果音（矩形波・ノイズのチップチューン風）。最初の操作のあとから鳴る。
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('ed-mute') === '1'; } catch { /* 無視 */ }

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  } catch { return false; }
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, ensure, { passive: true });

function tone(freq, dur, { type = 'square', vol = 0.08, at = 0, slide = 0 } = {}) {
  if (muted || !ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.06) {
  if (muted || !ctx) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(master);
  s.start();
}

let lastAt = {};
export function sfx(name) {
  if (muted || !ctx) return;
  const now = performance.now();
  if (now - (lastAt[name] || 0) < 45) return; // 同じ音の連打を間引く
  lastAt[name] = now;
  switch (name) {
    case 'swing': noise(0.05, 0.03); break;
    case 'hit': tone(220, 0.06, { slide: 110, vol: 0.06 }); break;
    case 'strong': tone(520, 0.05, { vol: 0.06 }); tone(780, 0.08, { at: 0.04, vol: 0.06 }); break;
    case 'weak': tone(140, 0.07, { type: 'triangle', vol: 0.08 }); break;
    case 'hurt': tone(160, 0.12, { type: 'sawtooth', slide: 70, vol: 0.05 }); break;
    case 'kill': tone(330, 0.05); tone(660, 0.09, { at: 0.04 }); break;
    case 'drop': tone(990, 0.05, { vol: 0.05 }); tone(1320, 0.08, { at: 0.05, vol: 0.05 }); break;
    case 'rare': [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.08, { type: 'triangle', at: i * 0.06, vol: 0.09 })); break;
    case 'skill': tone(300, 0.15, { type: 'triangle', slide: 900, vol: 0.08 }); break;
    case 'dodge': noise(0.08, 0.04); break;
    case 'potion': [523, 659, 784].forEach((f, i) => tone(f, 0.07, { type: 'triangle', at: i * 0.05 })); break;
    case 'down': [392, 330, 262].forEach((f, i) => tone(f, 0.18, { type: 'triangle', at: i * 0.15, vol: 0.09 })); break;
    case 'floor': [262, 330, 392, 523].forEach((f, i) => tone(f, 0.1, { at: i * 0.07 })); break;
    case 'open': tone(660, 0.04, { vol: 0.04 }); break;
    case 'close': tone(440, 0.04, { vol: 0.04 }); break;
    case 'ok': tone(880, 0.05, { vol: 0.05 }); tone(1175, 0.07, { at: 0.05, vol: 0.05 }); break;
    case 'error': tone(180, 0.12, { vol: 0.05 }); break;
    case 'boss': [196, 185, 175, 165].forEach((f, i) => tone(f, 0.2, { at: i * 0.18 })); break;
    default:
  }
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('ed-mute', muted ? '1' : '0'); } catch { /* 無視 */ }
  if (!muted) ensure();
}
