// Web Audio effects and a small tune sequencer. Nothing is created before unlock().
import type { GameEvent } from '../lib/state';
import { rngFor } from '../lib/rng';
import { TUNES, midiToHz, type TuneName } from '../lib/tunes';
import { decayGain, glide, sweep } from './blip';

export type Sound = GameEvent | 'click' | 'gameOver';
/** `noise` blips are band-pass filtered noise: `from`/`to` sweep the centre frequency in Hz, `q` is the filter Q. */
export interface Blip { wave: OscillatorType | 'noise'; from: number; to: number; dur: number; gain: number; delay?: number; q?: number }

/** Effects sit well above the music so digging and steps read over the tune. */
export const EFFECTS_LEVEL = 1;
export const MUSIC_LEVEL = 0.5;

// Effects are synthesized: noise for thuds and crunches, oscillators for ticks and chimes.
export const EFFECTS: Record<Sound, Blip[]> = {
  step: [{ wave: 'noise', from: 220, to: 160, q: 1, dur: 0.035, gain: 0.12 }],
  climb: [{ wave: 'triangle', from: 500, to: 700, dur: 0.025, gain: 0.15 }],
  dig: [
    { wave: 'square', from: 2200, to: 1800, dur: 0.02, gain: 0.15 },
    { wave: 'noise', from: 300, to: 200, q: 1, dur: 0.04, gain: 0.35 },
    { wave: 'square', from: 2400, to: 2000, dur: 0.02, gain: 0.15, delay: 0.066 },
    { wave: 'noise', from: 300, to: 200, q: 1, dur: 0.04, gain: 0.35, delay: 0.066 },
    { wave: 'square', from: 2600, to: 2100, dur: 0.02, gain: 0.15, delay: 0.133 },
    { wave: 'noise', from: 300, to: 200, q: 1, dur: 0.04, gain: 0.35, delay: 0.133 },
    { wave: 'noise', from: 1200, to: 300, q: 0.8, dur: 0.12, gain: 0.25, delay: 0.15 },
  ],
  refill: [
    { wave: 'noise', from: 300, to: 1200, q: 0.8, dur: 0.25, gain: 0.2 },
    { wave: 'sine', from: 90, to: 50, dur: 0.12, gain: 0.3, delay: 0.2 },
  ],
  gold: [
    { wave: 'square', from: 880, to: 880, dur: 0.07, gain: 0.18 },
    { wave: 'square', from: 1320, to: 1320, dur: 0.15, gain: 0.18, delay: 0.07 },
  ],
  allGold: [
    { wave: 'square', from: 660, to: 660, dur: 0.09, gain: 0.18 },
    { wave: 'square', from: 880, to: 880, dur: 0.09, gain: 0.18, delay: 0.09 },
    { wave: 'square', from: 1320, to: 1320, dur: 0.22, gain: 0.18, delay: 0.18 },
    { wave: 'noise', from: 6000, to: 8000, q: 4, dur: 0.3, gain: 0.15, delay: 0.18 },
  ],
  land: [
    { wave: 'triangle', from: 140, to: 50, dur: 0.12, gain: 0.35 },
    { wave: 'noise', from: 600, to: 300, q: 1, dur: 0.06, gain: 0.2 },
  ],
  guardTrapped: [
    { wave: 'sawtooth', from: 700, to: 200, dur: 0.25, gain: 0.2 },
    { wave: 'sine', from: 120, to: 50, dur: 0.1, gain: 0.3, delay: 0.25 },
  ],
  guardKilled: [
    { wave: 'noise', from: 1500, to: 400, q: 0.8, dur: 0.12, gain: 0.35 },
    { wave: 'sawtooth', from: 200, to: 40, dur: 0.3, gain: 0.2 },
  ],
  guardRespawn: [{ wave: 'triangle', from: 200, to: 600, dur: 0.15, gain: 0.18 }],
  death: [
    { wave: 'noise', from: 800, to: 200, q: 0.8, dur: 0.1, gain: 0.35 },
    { wave: 'sawtooth', from: 500, to: 250, dur: 0.18, gain: 0.2 },
    { wave: 'sawtooth', from: 250, to: 60, dur: 0.4, gain: 0.2, delay: 0.18 },
  ],
  levelClear: [
    { wave: 'square', from: 523, to: 523, dur: 0.1, gain: 0.18 },
    { wave: 'square', from: 659, to: 659, dur: 0.1, gain: 0.18, delay: 0.1 },
    { wave: 'square', from: 784, to: 784, dur: 0.1, gain: 0.18, delay: 0.2 },
    { wave: 'square', from: 1047, to: 1047, dur: 0.3, gain: 0.18, delay: 0.3 },
  ],
  click: [{ wave: 'square', from: 600, to: 600, dur: 0.03, gain: 0.12 }],
  gameOver: [
    { wave: 'triangle', from: 392, to: 392, dur: 0.2, gain: 0.22 },
    { wave: 'triangle', from: 330, to: 330, dur: 0.2, gain: 0.22, delay: 0.2 },
    { wave: 'triangle', from: 262, to: 196, dur: 0.5, gain: 0.22, delay: 0.4 },
  ],
};

export interface GameAudio {
  unlock(): void;
  play(sounds: readonly Sound[]): void;
  setEffects(on: boolean): void;
  setMusic(on: boolean): void;
  /** `variant` picks which of a tune's files plays; selecting the one already playing does nothing. */
  music(name: TuneName | null, variant?: number): void;
  pause(): void;
  resume(): void;
}

const LOOKAHEAD_S = 0.15;
const TIMER_MS = 50;

export interface AudioOptions {
  tracks?: Partial<Record<TuneName, string | readonly string[]>>;
  load?: (url: string) => Promise<ArrayBuffer>;
}

const MUSIC_GAIN = 0.35;
/** Footsteps and climbing fire every 8 ticks; a repeat inside this window is skipped. */
const REPEAT_GUARD_S = 0.09;
const GUARDED: ReadonlySet<Sound> = new Set<Sound>(['step', 'climb']);
const NOISE_SECONDS = 1;

/** Fixed-seed noise so it is the same everywhere. */
const seededNoise = (data: Float32Array): void => {
  const rng = rngFor('mine-lode-noise');
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
};

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`music ${response.status}`);
  return response.arrayBuffer();
};

export function createAudio(makeContext: () => AudioContext | null, options: AudioOptions = {}): GameAudio {
  const tracks = options.tracks ?? {};
  const load = options.load ?? fetchBytes;
  const decoded = new Map<string, AudioBuffer>();
  const started = new Set<string>();
  const failed = new Set<string>();
  let source: AudioBufferSourceNode | null = null;
  let ctx: AudioContext | null = null;
  let unlocked = false;
  let effectsOn = true;
  let musicOn = true;
  let paused = false;
  let tune: TuneName | null = null;
  let tuneVariant = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stepIndex = 0;
  let nextTime = 0;
  let effectsBus: AudioNode | null = null;
  let musicBus: AudioNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  const lastStarted = new Map<Sound, number>();

  const makeBuses = (context: AudioContext): void => {
    const effects = context.createGain();
    effects.gain.value = EFFECTS_LEVEL;
    const limiter = context.createDynamicsCompressor?.();
    if (limiter) {
      limiter.threshold.value = -12;
      limiter.knee.value = 12;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      effects.connect(limiter);
      limiter.connect(context.destination);
    } else {
      effects.connect(context.destination);
    }
    const music = context.createGain();
    music.gain.value = MUSIC_LEVEL;
    music.connect(context.destination);
    effectsBus = effects;
    musicBus = music;
  };

  /** One shared noise buffer, made on first use. Null when the context cannot do noise. */
  const getNoise = (context: AudioContext): AudioBuffer | null => {
    if (noiseBuffer) return noiseBuffer;
    if (typeof context.createBuffer !== 'function' || typeof context.createBiquadFilter !== 'function' || typeof context.createBufferSource !== 'function') return null;
    try {
      const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * NOISE_SECONDS)), context.sampleRate);
      seededNoise(buffer.getChannelData(0));
      noiseBuffer = buffer;
    } catch {
      return null;
    }
    return noiseBuffer;
  };

  const blip = (b: Blip, at: number, bus: AudioNode | null): void => {
    if (!ctx || !bus) return;
    const gain = decayGain(ctx, b.gain, at, b.dur, bus);
    if (b.wave === 'noise') {
      const buffer = getNoise(ctx);
      if (!buffer) return;
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      src.buffer = buffer;
      filter.type = 'bandpass';
      filter.Q.value = b.q ?? 1;
      glide(filter.frequency, b.from, b.to, at, b.dur);
      src.connect(filter);
      filter.connect(gain);
      src.start(at);
      src.stop(at + b.dur);
      return;
    }
    sweep(ctx, b.wave, b, at, gain);
  };

  const schedule = (): void => {
    if (!ctx || !tune) return;
    const t = TUNES[tune];
    const stepDur = 60 / t.bpm / 4;
    while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
      const i = stepIndex % t.lead.length;
      const lead = t.lead[i];
      const bass = t.bass[i];
      if (lead !== null) blip({ wave: 'square', from: midiToHz(lead), to: midiToHz(lead), dur: stepDur * 0.9, gain: 0.025 }, nextTime, musicBus);
      if (bass !== null) blip({ wave: 'triangle', from: midiToHz(bass), to: midiToHz(bass), dur: stepDur * 1.8, gain: 0.05 }, nextTime, musicBus);
      nextTime += stepDur;
      stepIndex++;
    }
  };

  const stopMusic = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (source) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source = null;
    }
  };

  const playBuffer = (buffer: AudioBuffer): boolean => {
    if (!ctx || !musicBus) return false;
    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buffer;
      src.loop = true;
      gain.gain.setValueAtTime(MUSIC_GAIN, ctx.currentTime);
      src.connect(gain);
      gain.connect(musicBus);
      src.start();
      source = src;
      return true;
    } catch {
      return false;
    }
  };

  const keyOf = (name: TuneName, variant: number): string => `${name}#${variant}`;
  const urlOf = (name: TuneName, variant: number): string | undefined => {
    const t = tracks[name];
    return typeof t === 'string' ? (variant === 0 ? t : undefined) : t?.[variant];
  };

  const fetchTrack = (name: TuneName, variant: number): void => {
    const url = urlOf(name, variant);
    const key = keyOf(name, variant);
    if (!url || started.has(key)) return;
    started.add(key);
    const fail = (): void => void failed.add(key);
    const arrived = (bytes: ArrayBuffer): void => {
      const context = ctx;
      if (!context) return fail();
      try {
        context.decodeAudioData(bytes).then(
          (buffer) => {
            decoded.set(key, buffer);
            if (!swapToBuffer(name, variant)) failed.add(key);
          },
          fail,
        );
      } catch {
        fail();
      }
    };
    try {
      load(url).then(arrived, fail);
    } catch {
      fail();
    }
  };

  /** Replaces the chiptune with the decoded file if it is still the wanted tune. Returns false only when playback failed. */
  const swapToBuffer = (name: TuneName, variant: number): boolean => {
    if (!ctx || tune !== name || tuneVariant !== variant || !musicOn || paused || source) return true;
    const buffer = decoded.get(keyOf(name, variant));
    if (!buffer) return true;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (playBuffer(buffer)) return true;
    startChiptune();
    return false;
  };

  const startChiptune = (): void => {
    if (!ctx || !tune) return;
    stepIndex = 0;
    nextTime = ctx.currentTime + 0.05;
    schedule();
    timer = setInterval(schedule, TIMER_MS);
  };

  const syncMusic = (): void => {
    stopMusic();
    if (!ctx || !tune || !musicOn || paused) return;
    const key = keyOf(tune, tuneVariant);
    const ready = decoded.get(key);
    if (ready && !failed.has(key) && playBuffer(ready)) return;
    fetchTrack(tune, tuneVariant);
    startChiptune();
  };

  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      ctx = makeContext();
      if (ctx) makeBuses(ctx);
      void ctx?.resume?.();
      syncMusic();
    },
    play(sounds) {
      if (!ctx || !effectsOn || paused) return;
      for (const s of sounds) {
        const now = ctx.currentTime;
        if (GUARDED.has(s)) {
          const last = lastStarted.get(s);
          if (last !== undefined && now - last < REPEAT_GUARD_S) continue;
          lastStarted.set(s, now);
        }
        for (const b of EFFECTS[s]) blip(b, now + (b.delay ?? 0), effectsBus);
      }
    },
    setEffects(on) {
      effectsOn = on;
    },
    setMusic(on) {
      musicOn = on;
      syncMusic();
    },
    music(name, variant = 0) {
      if (name === tune && variant === tuneVariant && (timer !== undefined || source)) return;
      tune = name;
      tuneVariant = variant;
      syncMusic();
    },
    pause() {
      paused = true;
      stopMusic();
    },
    resume() {
      if (!paused) return;
      paused = false;
      syncMusic();
    },
  };
}
