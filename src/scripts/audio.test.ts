import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EFFECTS, EFFECTS_LEVEL, MUSIC_LEVEL, createAudio, type Sound } from './audio';

type Spy = ReturnType<typeof vi.fn>;
interface FakeNode { kind: string; connect: Spy; [key: string]: unknown }
interface FakeOptions { noFilter?: boolean; noBuffer?: boolean; noCompressor?: boolean }

function fakeContext(opts: FakeOptions = {}) {
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 });
  const node = (kind: string, extra: Record<string, unknown> = {}): FakeNode => {
    const n: FakeNode = { kind, connect: vi.fn(), ...extra };
    ctx.nodes.push(n);
    return n;
  };
  const ctx = {
    made: 0,
    currentTime: 0,
    sampleRate: 8000,
    destination: { kind: 'destination' },
    nodes: [] as FakeNode[],
    buffersMade: 0,
    /** Oscillators plus one-shot noise sources: every effect voice. */
    get voices(): number {
      return ctx.made + ctx.sources.filter((s) => !s.loop).length;
    },
    createOscillator() {
      ctx.made++;
      return node('osc', { type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn() });
    },
    createGain: () => node('gain', { gain: param() }),
    resume: vi.fn(async () => {}),
    sources: [] as Array<{ buffer: unknown; loop: boolean; connect: Spy; start: Spy; stop: Spy }>,
    decode: vi.fn(async (_data: ArrayBuffer): Promise<unknown> => ({ fake: 'buffer' })),
    createBufferSource() {
      const src = { buffer: null as unknown, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      ctx.nodes.push({ kind: 'source', ...src });
      ctx.sources.push(src);
      return src;
    },
    createBuffer: (_channels: number, length: number, _rate: number) => {
      ctx.buffersMade++;
      return { getChannelData: () => new Float32Array(length) };
    },
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(), Q: param() }),
    createDynamicsCompressor: () => node('compressor', { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    decodeAudioData(data: ArrayBuffer) {
      return ctx.decode(data);
    },
  };
  const loose = ctx as unknown as Record<string, unknown>;
  if (opts.noFilter) loose.createBiquadFilter = undefined;
  if (opts.noBuffer) loose.createBuffer = undefined;
  if (opts.noCompressor) loose.createDynamicsCompressor = undefined;
  return ctx;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('effects', () => {
  it('has a sound for every game event', () => {
    for (const e of ['step', 'climb', 'dig', 'refill', 'gold', 'allGold', 'land', 'guardTrapped', 'guardKilled', 'guardRespawn', 'death', 'levelClear', 'click', 'gameOver']) {
      expect(EFFECTS[e as keyof typeof EFFECTS].length, e).toBeGreaterThan(0);
    }
  });
  it('makes no sound and no context before unlock', () => {
    const make = vi.fn(() => fakeContext() as unknown as AudioContext);
    createAudio(make).play(['gold']);
    expect(make).not.toHaveBeenCalled();
  });
  it('plays one voice per blip after unlock', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.play(['gold', 'dig']);
    expect(ctx.voices).toBe(EFFECTS.gold.length + EFFECTS.dig.length);
  });
  it('creates the context only once', () => {
    const make = vi.fn(() => fakeContext() as unknown as AudioContext);
    const audio = createAudio(make);
    audio.unlock();
    audio.unlock();
    expect(make).toHaveBeenCalledTimes(1);
  });
  it('is silent when effects are off or the game is paused', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.setEffects(false);
    audio.play(['gold']);
    audio.setEffects(true);
    audio.pause();
    audio.play(['gold']);
    expect(ctx.voices).toBe(0);
    audio.resume();
    audio.play(['gold']);
    expect(ctx.voices).toBe(EFFECTS.gold.length);
  });
  it('does nothing when the browser has no audio', () => {
    const audio = createAudio(() => null);
    audio.unlock();
    expect(() => {
      audio.play(['gold']);
      audio.music('play');
      vi.advanceTimersByTime(500);
    }).not.toThrow();
  });
});

const SOUNDS = Object.keys(EFFECTS) as Sound[];
const OLD_DIG_GAIN = 0.07;
const end = (b: { delay?: number; dur: number }): number => (b.delay ?? 0) + b.dur;

describe('effect table', () => {
  it('gives every sound blips with positive gain and duration', () => {
    for (const s of SOUNDS) {
      expect(EFFECTS[s].length, s).toBeGreaterThan(0);
      for (const b of EFFECTS[s]) {
        expect(b.gain, s).toBeGreaterThan(0);
        expect(b.dur, s).toBeGreaterThan(0);
      }
    }
  });
  it('keeps every effect short', () => {
    for (const s of SOUNDS) {
      const cap = s === 'levelClear' || s === 'gameOver' ? 1 : 0.6;
      expect(Math.max(...EFFECTS[s].map(end)), s).toBeLessThanOrEqual(cap + 1e-9);
    }
  });
  it('dig is three pickaxe ticks inside 0.2 s plus noise, with a crumble after the first strike', () => {
    const ticks = EFFECTS.dig.filter((b) => b.wave !== 'noise');
    expect(ticks.length).toBe(3);
    const delays = ticks.map((b) => b.delay ?? 0);
    expect([...delays].sort((x, y) => x - y)).toEqual(delays);
    expect(new Set(delays).size).toBe(3);
    expect(delays.every((d) => d >= 0 && d < 0.2)).toBe(true);
    const noise = EFFECTS.dig.filter((b) => b.wave === 'noise');
    expect(noise.length).toBeGreaterThan(0);
    const crumble = noise.reduce((a, b) => (b.dur > a.dur ? b : a));
    expect(crumble.delay ?? 0).toBeGreaterThan(delays[0]);
    expect(crumble.to).toBeLessThan(crumble.from);
  });
  it('dig is much louder than the old blip and effects sit above music', () => {
    expect(Math.max(...EFFECTS.dig.map((b) => b.gain))).toBeGreaterThanOrEqual(3 * OLD_DIG_GAIN);
    expect(EFFECTS_LEVEL).toBeGreaterThan(MUSIC_LEVEL);
  });
  it('keeps steps quieter than digging', () => {
    expect(Math.max(...EFFECTS.step.map((b) => b.gain))).toBeLessThan(Math.max(...EFFECTS.dig.map((b) => b.gain)));
  });
});

describe('noise voice', () => {
  it('uses a buffer source and a band-pass filter for each noise blip', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.play(['dig']);
    const noiseBlips = EFFECTS.dig.filter((b) => b.wave === 'noise').length;
    const filters = ctx.nodes.filter((n) => n.kind === 'filter');
    expect(filters.length).toBe(noiseBlips);
    expect(filters.every((f) => f.type === 'bandpass')).toBe(true);
    expect(ctx.sources.filter((s) => !s.loop).length).toBe(noiseBlips);
    expect(ctx.sources.every((s) => s.start.mock.calls.length === 1 && s.buffer !== null)).toBe(true);
  });
  it('creates the noise buffer once and reuses it', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    expect(ctx.buffersMade).toBe(0);
    audio.play(['dig']);
    audio.play(['land']);
    expect(ctx.buffersMade).toBe(1);
    expect(new Set(ctx.sources.map((s) => s.buffer)).size).toBe(1);
  });
  it('fills the buffer with the same samples every time', () => {
    const fills: number[][] = [];
    for (let i = 0; i < 2; i++) {
      const ctx = fakeContext();
      const data = new Float32Array(8000);
      ctx.createBuffer = () => ({ getChannelData: () => data });
      const audio = createAudio(() => ctx as unknown as AudioContext);
      audio.unlock();
      audio.play(['step']);
      fills.push(Array.from(data.slice(0, 16)));
    }
    expect(fills[0]).toEqual(fills[1]);
    expect(fills[0].some((v) => v !== 0)).toBe(true);
  });
  it('still plays oscillator blips when the context cannot make filters or buffers', () => {
    for (const opts of [{ noFilter: true }, { noBuffer: true }]) {
      const ctx = fakeContext(opts);
      const audio = createAudio(() => ctx as unknown as AudioContext);
      audio.unlock();
      expect(() => audio.play(['dig'])).not.toThrow();
      expect(ctx.made).toBe(EFFECTS.dig.filter((b) => b.wave !== 'noise').length);
      expect(ctx.sources.length).toBe(0);
    }
  });
  it('works without a compressor', () => {
    const ctx = fakeContext({ noCompressor: true });
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    expect(() => audio.play(['gold'])).not.toThrow();
    expect(ctx.voices).toBe(EFFECTS.gold.length);
  });
});

describe('step spam guard', () => {
  it('skips a step or climb started within 0.09 s, then plays again later', () => {
    for (const s of ['step', 'climb'] as const) {
      const ctx = fakeContext();
      const audio = createAudio(() => ctx as unknown as AudioContext);
      audio.unlock();
      audio.play([s]);
      ctx.currentTime = 0.05;
      audio.play([s]);
      expect(ctx.voices, s).toBe(EFFECTS[s].length);
      ctx.currentTime = 0.2;
      audio.play([s]);
      expect(ctx.voices, s).toBe(EFFECTS[s].length * 2);
    }
  });
  it('never skips other sounds', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.play(['dig']);
    audio.play(['dig']);
    expect(ctx.voices).toBe(EFFECTS.dig.length * 2);
  });
});

describe('mix buses', () => {
  it('sends effects through one bus and a compressor, not straight to the destination', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.play(['gold', 'dig']);
    const toDestination = ctx.nodes.filter((n) => n.connect.mock.calls.some(([t]) => t === ctx.destination));
    expect(toDestination.map((n) => n.kind).sort()).toEqual(['compressor', 'gain']);
  });
  it('sends chiptune notes through the music bus', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.music('play');
    vi.advanceTimersByTime(200);
    expect(ctx.made).toBeGreaterThan(0);
    const oscillators = ctx.nodes.filter((n) => n.kind === 'osc');
    expect(oscillators.every((o) => o.connect.mock.calls.every(([t]) => t !== ctx.destination))).toBe(true);
    const direct = ctx.nodes.filter((n) => n.connect.mock.calls.some(([t]) => t === ctx.destination));
    expect(direct.length).toBe(2);
  });
  it('sends the music file through the music bus', async () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext, { tracks: { menu: '/m.mp3' }, load: async () => new ArrayBuffer(8) });
    audio.unlock();
    audio.music('menu');
    await flush();
    const src = ctx.sources[0];
    expect(src.start).toHaveBeenCalled();
    expect(src.connect.mock.calls.every(([t]) => t !== ctx.destination)).toBe(true);
    const direct = ctx.nodes.filter((n) => n.connect.mock.calls.some(([t]) => t === ctx.destination));
    expect(direct.length).toBe(2);
  });
});

describe('music', () => {
  it('schedules notes while a tune is selected', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    audio.music('play');
    vi.advanceTimersByTime(200);
    expect(ctx.made).toBeGreaterThan(0);
  });
  it('stops when music is turned off, the tune is cleared, or the game pauses', () => {
    for (const stop of [
      (a: ReturnType<typeof createAudio>) => a.setMusic(false),
      (a: ReturnType<typeof createAudio>) => a.music(null),
      (a: ReturnType<typeof createAudio>) => a.pause(),
    ]) {
      const ctx = fakeContext();
      const audio = createAudio(() => ctx as unknown as AudioContext);
      audio.unlock();
      audio.music('menu');
      vi.advanceTimersByTime(100);
      stop(audio);
      const made = ctx.made;
      ctx.currentTime = 10;
      vi.advanceTimersByTime(1000);
      expect(ctx.made).toBe(made);
    }
  });
  it('starts when unlock comes after the tune was chosen', () => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext);
    audio.music('menu');
    audio.unlock();
    vi.advanceTimersByTime(200);
    expect(ctx.made).toBeGreaterThan(0);
  });
});

describe('music files', () => {
  const tracks = { menu: '/music/menu.mp3', play: '/music/play.mp3' };
  const setup = (load = vi.fn(async (_u: string) => new ArrayBuffer(8))) => {
    const ctx = fakeContext();
    const audio = createAudio(() => ctx as unknown as AudioContext, { tracks, load });
    return { ctx, audio, load };
  };

  it('loads nothing before unlock', () => {
    const { audio, load } = setup();
    audio.music('menu');
    expect(load).not.toHaveBeenCalled();
  });
  it('plays the chiptune at once, then swaps to a looping buffer with no more notes', async () => {
    const { ctx, audio, load } = setup();
    audio.unlock();
    audio.music('menu');
    expect(ctx.made).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledWith(tracks.menu);
    await flush();
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.sources[0].start).toHaveBeenCalled();
    const made = ctx.made;
    ctx.currentTime = 10;
    vi.advanceTimersByTime(1000);
    expect(ctx.made).toBe(made);
  });
  it('keeps the chiptune when the load rejects', async () => {
    const { ctx, audio } = setup(vi.fn(async () => { throw new Error('404'); }));
    audio.unlock();
    audio.music('menu');
    await flush();
    const made = ctx.made;
    ctx.currentTime = 10;
    vi.advanceTimersByTime(200);
    expect(ctx.made).toBeGreaterThan(made);
    expect(ctx.sources.length).toBe(0);
  });
  it('keeps the chiptune when decoding rejects or throws, and does not retry', async () => {
    for (const fail of [async () => { throw new Error('bad'); }, () => { throw new Error('sync'); }]) {
      const { ctx, audio, load } = setup();
      ctx.decode.mockImplementation(fail as () => Promise<unknown>);
      audio.unlock();
      audio.music('menu');
      await flush();
      audio.music(null);
      audio.music('menu');
      await flush();
      expect(load).toHaveBeenCalledTimes(1);
      expect(ctx.sources.every((s) => s.start.mock.calls.length === 0)).toBe(true);
    }
  });
  it('keeps the chiptune when the context cannot make buffer sources', async () => {
    const { ctx, audio } = setup();
    (ctx as unknown as { createBufferSource?: unknown }).createBufferSource = undefined;
    audio.unlock();
    audio.music('menu');
    await flush();
    const made = ctx.made;
    ctx.currentTime = 10;
    vi.advanceTimersByTime(200);
    expect(ctx.made).toBeGreaterThan(made);
  });
  it('does not load for a tune with no configured track', () => {
    const ctx = fakeContext();
    const load = vi.fn(async () => new ArrayBuffer(8));
    const audio = createAudio(() => ctx as unknown as AudioContext, { tracks: { menu: tracks.menu }, load });
    audio.unlock();
    audio.music('play');
    expect(load).not.toHaveBeenCalled();
  });
  it('loads a track once however often it is selected', async () => {
    const { audio, load } = setup();
    audio.unlock();
    audio.music('menu');
    await flush();
    audio.music('play');
    audio.music('menu');
    await flush();
    audio.music('menu');
    expect(load.mock.calls.filter(([u]) => u === tracks.menu).length).toBe(1);
  });
  it('stops the playing source on setMusic(false), music(null) and pause()', async () => {
    for (const stop of [
      (a: ReturnType<typeof createAudio>) => a.setMusic(false),
      (a: ReturnType<typeof createAudio>) => a.music(null),
      (a: ReturnType<typeof createAudio>) => a.pause(),
    ]) {
      const { ctx, audio } = setup();
      audio.unlock();
      audio.music('menu');
      await flush();
      stop(audio);
      expect(ctx.sources[0].stop).toHaveBeenCalled();
    }
  });
  it('does not start a stale buffer when the tune changed during the load', async () => {
    let release: (b: ArrayBuffer) => void = () => {};
    const load = vi.fn((u: string) => (u === tracks.menu ? new Promise<ArrayBuffer>((r) => { release = r; }) : Promise.reject(new Error('x'))));
    const { ctx, audio } = setup(load);
    audio.unlock();
    audio.music('menu');
    audio.music('play');
    release(new ArrayBuffer(8));
    await flush();
    expect(ctx.sources.every((s) => s.start.mock.calls.length === 0)).toBe(true);
  });
  it('restarts the buffer after pause and resume', async () => {
    const { ctx, audio } = setup();
    audio.unlock();
    audio.music('menu');
    await flush();
    audio.pause();
    audio.resume();
    expect(ctx.sources.length).toBe(2);
    expect(ctx.sources[1].start).toHaveBeenCalled();
    audio.setMusic(false);
    audio.setMusic(true);
    expect(ctx.sources.length).toBe(3);
  });
});
