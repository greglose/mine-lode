// Test support: a fake AudioContext that records the node graph each Mine Lode sound builds, so a refactor can be checked against a golden log.
import type { GameAudio, Sound as MineLodeSound } from './audio';

/** Log of one node's calls and property writes, in order. */
type NodeLog = string[];

function fakeContext(currentTime: number) {
  const counts = new Map<string, number>();
  const logs = new Map<string, NodeLog>();
  const fmt = (v: unknown): string => (v && typeof v === 'object' && 'id' in v ? String((v as { id: string }).id) : String(v));
  const log = (id: string, entry: string): void => void logs.get(id)!.push(entry);
  const make = (kind: string): string => {
    const n = counts.get(kind) ?? 0;
    counts.set(kind, n + 1);
    const id = `${kind}${n}`;
    logs.set(id, []);
    return id;
  };
  const param = (id: string, name: string) => ({
    setValueAtTime: (...a: unknown[]) => log(id, `${name}.setValueAtTime(${a.map(fmt)})`),
    exponentialRampToValueAtTime: (...a: unknown[]) => log(id, `${name}.exponentialRampToValueAtTime(${a.map(fmt)})`),
    linearRampToValueAtTime: (...a: unknown[]) => log(id, `${name}.linearRampToValueAtTime(${a.map(fmt)})`),
    set value(v: unknown) {
      log(id, `${name}.value=${fmt(v)}`);
    },
  });
  const node = (kind: string, params: string[], setters: string[]) => {
    const id = make(kind);
    const n: Record<string, unknown> = {
      id,
      connect: (to: unknown) => log(id, `connect(${fmt(to)})`),
      start: (...a: unknown[]) => log(id, `start(${a.map(fmt)})`),
      stop: (...a: unknown[]) => log(id, `stop(${a.map(fmt)})`),
    };
    for (const p of params) n[p] = param(id, p);
    for (const s of setters) Object.defineProperty(n, s, { set: (v: unknown) => log(id, `${s}=${fmt(v)}`), enumerable: true });
    return n;
  };
  const context = {
    currentTime,
    sampleRate: 8000,
    destination: { id: 'destination' },
    resume: async () => {},
    createOscillator: () => node('osc', ['frequency'], ['type']),
    createGain: () => node('gain', ['gain'], []),
    createBufferSource: () => node('src', [], ['buffer', 'loop']),
    createBiquadFilter: () => node('filter', ['frequency', 'Q'], ['type']),
    createDynamicsCompressor: () => node('compressor', ['threshold', 'knee', 'ratio', 'attack', 'release'], []),
    createBuffer: (_channels: number, length: number) => ({ id: 'noiseBuffer', getChannelData: () => new Float32Array(length) }),
  };
  /** The graph as one line per node, ordered by node id, so the order nodes were created in does not matter. */
  const dump = (): string[] =>
    [...logs.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([id, entries]) => `${id}: ${entries.join(' ')}`);
  return { context: context as unknown as AudioContext, dump };
}

export function recordMineLode(
  create: (make: () => AudioContext | null) => GameAudio,
  sounds: MineLodeSound[],
  tunes: Array<'menu' | 'play'>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sound of sounds) {
    const { context, dump } = fakeContext(0.25);
    const audio = create(() => context);
    audio.unlock();
    audio.play([sound]);
    out[`sound:${sound}`] = dump();
  }
  for (const tune of tunes) {
    const { context, dump } = fakeContext(0.25);
    const audio = create(() => context);
    audio.unlock();
    audio.music(tune);
    audio.pause();
    out[`tune:${tune}`] = dump();
  }
  return out;
}
