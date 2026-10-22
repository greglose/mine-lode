import { describe, expect, it, vi } from 'vitest';
import { decayGain, glide, playTone, sweep } from './blip';

const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });

function fakeContext() {
  const oscillators: Array<{ type: string; frequency: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const gains: Array<{ gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn> }> = [];
  const ctx = {
    oscillators,
    gains,
    createOscillator() {
      const o = { type: 'sine', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      oscillators.push(o);
      return o;
    },
    createGain() {
      const g = { gain: param(), connect: vi.fn() };
      gains.push(g);
      return g;
    },
  };
  return ctx;
}

const asCtx = (c: ReturnType<typeof fakeContext>) => c as unknown as BaseAudioContext;
const out = {} as AudioNode;

describe('glide', () => {
  it('sets the start value and ramps to the end value', () => {
    const p = param();
    glide(p as unknown as AudioParam, 200, 100, 1, 0.5);
    expect(p.setValueAtTime).toHaveBeenCalledWith(200, 1);
    expect(p.exponentialRampToValueAtTime).toHaveBeenCalledWith(100, 1.5);
  });
  it('does not ramp when start and end are equal', () => {
    const p = param();
    glide(p as unknown as AudioParam, 440, 440, 0, 0.1);
    expect(p.setValueAtTime).toHaveBeenCalledWith(440, 0);
    expect(p.exponentialRampToValueAtTime).not.toHaveBeenCalled();
  });
});

describe('decayGain', () => {
  it('starts at the level, decays to near silence over the duration and feeds the output', () => {
    const ctx = fakeContext();
    const g = decayGain(asCtx(ctx), 0.3, 2, 0.25, out) as unknown as (typeof ctx.gains)[number];
    expect(g).toBe(ctx.gains[0]);
    expect(g.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 2);
    expect(g.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 2.25);
    expect(g.connect).toHaveBeenCalledWith(out);
  });
});

describe('sweep', () => {
  it('plays one oscillator of the given wave from start to end into the output', () => {
    const ctx = fakeContext();
    sweep(asCtx(ctx), 'sawtooth', { from: 300, to: 120, dur: 0.08 }, 1, out);
    expect(ctx.oscillators).toHaveLength(1);
    const o = ctx.oscillators[0]!;
    expect(o.type).toBe('sawtooth');
    expect(o.frequency.setValueAtTime).toHaveBeenCalledWith(300, 1);
    expect(o.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(120, 1.08);
    expect(o.connect).toHaveBeenCalledWith(out);
    expect(o.start).toHaveBeenCalledWith(1);
    expect(o.stop).toHaveBeenCalledWith(1.08);
  });
});

describe('playTone', () => {
  it('routes one oscillator through one decaying gain into the output', () => {
    const ctx = fakeContext();
    playTone(asCtx(ctx), { wave: 'square', from: 660, to: 660, dur: 0.07, gain: 0.04 }, 0, out);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.gains).toHaveLength(1);
    const [o, g] = [ctx.oscillators[0]!, ctx.gains[0]!];
    expect(o.type).toBe('square');
    expect(o.connect).toHaveBeenCalledWith(g);
    expect(o.frequency.exponentialRampToValueAtTime).not.toHaveBeenCalled();
    expect(g.gain.setValueAtTime).toHaveBeenCalledWith(0.04, 0);
    expect(g.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 0.07);
    expect(g.connect).toHaveBeenCalledWith(out);
    expect(o.stop).toHaveBeenCalledWith(0.07);
  });
});
