/**
 * jsfxr 風の効果音を自前で合成する。音はすべてパラメータから生成し、外部ファイルは使わない。
 */
type Wave = 'square' | 'saw' | 'sine' | 'noise' | 'tri';

interface Tone {
  wave: Wave;
  freq: number;
  freqEnd?: number;
  attack?: number;
  sustain?: number;
  decay: number;
  volume?: number;
  duty?: number;
  vibrato?: number;
  /** 開始時刻（秒）。複数の音を並べるとき用 */
  at?: number;
}

const SOUNDS: Record<string, Tone[]> = {
  swing:   [{ wave: 'noise', freq: 1800, freqEnd: 600, decay: 0.09, volume: 0.25 }],
  shoot:   [{ wave: 'square', freq: 900, freqEnd: 300, decay: 0.1, volume: 0.18, duty: 0.25 }],
  magic:   [{ wave: 'sine', freq: 500, freqEnd: 1100, decay: 0.16, volume: 0.25, vibrato: 30 }],
  skill:   [{ wave: 'saw', freq: 300, freqEnd: 900, attack: 0.02, decay: 0.2, volume: 0.2 }],
  hit:     [{ wave: 'noise', freq: 900, freqEnd: 200, decay: 0.08, volume: 0.35 }],
  crit:    [{ wave: 'square', freq: 1400, freqEnd: 300, decay: 0.12, volume: 0.25 }, { wave: 'noise', freq: 1200, freqEnd: 100, decay: 0.18, volume: 0.35 }],
  hurt:    [{ wave: 'saw', freq: 260, freqEnd: 90, decay: 0.18, volume: 0.3 }],
  evade:   [{ wave: 'sine', freq: 1200, freqEnd: 1800, decay: 0.08, volume: 0.15 }],
  dodge:   [{ wave: 'noise', freq: 600, freqEnd: 2400, decay: 0.12, volume: 0.18 }],
  explode: [{ wave: 'noise', freq: 400, freqEnd: 40, sustain: 0.05, decay: 0.35, volume: 0.45 }],
  quake:   [{ wave: 'noise', freq: 200, freqEnd: 30, sustain: 0.1, decay: 0.5, volume: 0.55 }],
  death:   [{ wave: 'square', freq: 400, freqEnd: 60, decay: 0.3, volume: 0.22, duty: 0.4 }],
  warn:    [{ wave: 'square', freq: 220, decay: 0.12, volume: 0.12, duty: 0.5 }, { wave: 'square', freq: 220, decay: 0.12, volume: 0.12, at: 0.16, duty: 0.5 }],
  drop:    [{ wave: 'tri', freq: 700, freqEnd: 900, decay: 0.12, volume: 0.25 }],
  dropRare:[{ wave: 'sine', freq: 880, decay: 0.12, volume: 0.25 }, { wave: 'sine', freq: 1320, decay: 0.2, volume: 0.25, at: 0.08 }],
  legend:  [
    { wave: 'square', freq: 523, decay: 0.16, volume: 0.18, duty: 0.3 },
    { wave: 'square', freq: 659, decay: 0.16, volume: 0.18, duty: 0.3, at: 0.1 },
    { wave: 'square', freq: 784, decay: 0.16, volume: 0.18, duty: 0.3, at: 0.2 },
    { wave: 'square', freq: 1047, sustain: 0.15, decay: 0.5, volume: 0.2, duty: 0.3, at: 0.3, vibrato: 8 },
    { wave: 'sine', freq: 2093, decay: 0.6, volume: 0.12, at: 0.3 },
  ],
  pickup:  [{ wave: 'square', freq: 660, decay: 0.06, volume: 0.15 }, { wave: 'square', freq: 990, decay: 0.1, volume: 0.15, at: 0.06 }],
  enrage:  [{ wave: 'saw', freq: 120, freqEnd: 60, sustain: 0.2, decay: 0.6, volume: 0.35, vibrato: 12 }],
  respawn: [{ wave: 'sine', freq: 400, freqEnd: 800, decay: 0.3, volume: 0.25 }],
  equip:   [{ wave: 'tri', freq: 500, freqEnd: 700, decay: 0.08, volume: 0.2 }],
  reload:  [{ wave: 'square', freq: 300, freqEnd: 200, decay: 0.05, volume: 0.15 }, { wave: 'noise', freq: 2000, decay: 0.04, volume: 0.1, at: 0.08 }],
  reloadDone: [{ wave: 'square', freq: 500, freqEnd: 800, decay: 0.06, volume: 0.15 }],
  note:    [{ wave: 'sine', freq: 880, decay: 0.15, volume: 0.2 }, { wave: 'sine', freq: 1320, decay: 0.12, volume: 0.12, at: 0.03 }],
};

export class Sfx {
  ctx: AudioContext | null = null;
  private cache = new Map<string, AudioBuffer>();
  volume = 0.8;
  private last = new Map<string, number>();
  enabled = true;

  /** ユーザー操作の中で呼ぶ（ブラウザの自動再生制限のため） */
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: string, volume = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < 35) return;
    this.last.set(name, now);
    let buf = this.cache.get(name);
    if (!buf) {
      const tones = SOUNDS[name];
      if (!tones) return;
      buf = render(this.ctx, tones);
      this.cache.set(name, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume * this.volume;
    src.connect(g).connect(this.ctx.destination);
    src.start();
  }
}

function render(ctx: AudioContext, tones: Tone[]): AudioBuffer {
  const sr = ctx.sampleRate;
  const total = Math.max(...tones.map((t) => (t.at ?? 0) + (t.attack ?? 0.005) + (t.sustain ?? 0) + t.decay)) + 0.02;
  const buf = ctx.createBuffer(1, Math.ceil(total * sr), sr);
  const out = buf.getChannelData(0);
  for (const t of tones) {
    const a = t.attack ?? 0.005, s = t.sustain ?? 0, d = t.decay;
    const len = a + s + d;
    const start = Math.floor((t.at ?? 0) * sr);
    const n = Math.floor(len * sr);
    let phase = 0;
    let noiseVal = 0, noiseAcc = 0;
    let seed = 1234567;
    const f1 = t.freqEnd ?? t.freq;
    for (let i = 0; i < n && start + i < out.length; i++) {
      const tt = i / sr;
      const k = tt / len;
      let f = t.freq * Math.pow(f1 / t.freq, k);
      if (t.vibrato) f *= 1 + 0.03 * Math.sin(tt * t.vibrato * Math.PI * 2);
      phase += f / sr;
      const p = phase % 1;
      let v: number;
      switch (t.wave) {
        case 'square': v = p < (t.duty ?? 0.5) ? 1 : -1; break;
        case 'saw': v = 2 * p - 1; break;
        case 'tri': v = 1 - 4 * Math.abs(p - 0.5); break;
        case 'sine': v = Math.sin(phase * Math.PI * 2); break;
        default: {
          noiseAcc += f / sr;
          if (noiseAcc >= 1 || i === 0) {
            noiseAcc %= 1;
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            noiseVal = (seed / 0x7fffffff) * 2 - 1;
          }
          v = noiseVal;
        }
      }
      const env = tt < a ? tt / a : tt < a + s ? 1 : Math.max(0, 1 - (tt - a - s) / d);
      out[start + i] += v * env * env * (t.volume ?? 0.3);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return buf;
}

/**
 * BGM。data/music.json の曲（テンポ・音階・波形）から自動で旋律を作って流す。
 * 曲は後で差し替える前提で、「エリア×時間帯×天候 → 曲」の選び方だけ data にある。
 */
export class Music {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private track = '';
  private nextTime = 0;
  private step = 0;
  private seed = 1;
  private timer: number | null = null;
  volume = 0.5;
  enabled = true;

  constructor(private tracks: Record<string, MusicTrack>) {}

  attach(ctx: AudioContext | null) {
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume * 0.25;
    this.gain.connect(ctx.destination);
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = (this.enabled ? v : 0) * 0.25;
  }

  play(track: string) {
    if (track === this.track) return;
    this.track = track;
    this.step = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.1;
    this.seed = 1;
  }

  get current() { return this.track; }

  private rand() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.gain || ctx.state !== 'running' || !this.enabled) return;
    const t = this.tracks[this.track];
    if (!t) return;
    const beat = 60 / t.bpm / 2;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.4) {
      if (this.step % 32 === 0) this.seed = t.seed * 7919 + Math.floor(this.step / 32) % 4;
      const bar = Math.floor(this.step / 8) % 4;
      const chordRoot = t.scale[[0, 3, 4, 2][bar] % t.scale.length];
      if (this.step % 8 === 0) this.note(t.root - 24 + chordRoot, this.nextTime, beat * 7, t.bass as OscillatorType, 0.5);
      if (this.step % 2 === 0 && this.rand() < t.density) {
        const deg = Math.floor(this.rand() * t.scale.length);
        const oct = this.rand() < 0.3 ? 12 : 0;
        this.note(t.root + t.scale[deg] + oct, this.nextTime, beat * (this.rand() < 0.3 ? 3 : 1.6), t.wave as OscillatorType, 0.22);
      }
      this.nextTime += beat;
      this.step++;
    }
  }

  private note(midi: number, at: number, len: number, wave: OscillatorType, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = (['sine', 'square', 'sawtooth', 'triangle'] as OscillatorType[]).includes(wave) ? wave : wave === ('saw' as OscillatorType) ? 'sawtooth' : wave === ('tri' as OscillatorType) ? 'triangle' : 'sine';
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g).connect(this.gain!);
    o.start(at);
    o.stop(at + len + 0.05);
  }

  dispose() { if (this.timer !== null) clearInterval(this.timer); }
}

export interface MusicTrack { bpm: number; root: number; scale: number[]; wave: string; bass: string; density: number; seed: number }
