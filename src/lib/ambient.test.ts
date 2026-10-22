import { describe, expect, it } from 'vitest';
import { MAX_DIG_SPARKS, MAX_DRIPS, MAX_DUST, ambientOf, flicker } from './ambient';
import type { Decor } from './decor';
import type { GameEvent } from './state';

const decor = (kinds: string[] = []): Decor => ({
  props: kinds.map((kind, i) => ({ kind: kind as Decor['props'][number]['kind'], x: 3 + i * 4, y: 2, z: 0, scale: 1, rot: 0, variant: 0 })),
  lights: [],
  layers: [],
});
const hero: { x: number; y: number; facing: -1 | 1 } = { x: 10, y: 5, facing: 1 };
const run = (d: Decor, events: GameEvent[], h = hero, ticks = 300) => {
  const out = [];
  for (let t = 0; t < ticks; t++) out.push(...ambientOf(t, 'seed', d, events, h).map((s) => ({ ...s, t })));
  return out;
};

// Coordinates are grid cells like scene blocks: y grows downward, so a falling drip has vy >= 0.
describe('ambientOf', () => {
  it('is deterministic for equal inputs', () => {
    const d = decor(['stalactite']);
    for (let t = 0; t < 50; t++) {
      expect(ambientOf(t, 's', d, ['dig'], hero)).toEqual(ambientOf(t, 's', d, ['dig'], hero));
    }
  });
  it('spawns dust only a few cells in front of the hero on his facing side', () => {
    for (const facing of [1, -1] as const) {
      const dust = run(decor(), [], { x: 10, y: 5, facing }).filter((s) => s.kind === 'dust');
      expect(dust.length).toBeGreaterThan(0);
      for (const s of dust) {
        expect((s.x - 10) * facing).toBeGreaterThanOrEqual(0);
        expect((s.x - 10) * facing).toBeLessThanOrEqual(4);
        expect(Math.abs(s.y - 5)).toBeLessThanOrEqual(2);
      }
    }
  });
  it('drips only below stalactites', () => {
    expect(run(decor(['lantern', 'crystal']), []).filter((s) => s.kind === 'drip')).toEqual([]);
    const d = decor(['stalactite', 'lantern']);
    const drips = run(d, []).filter((s) => s.kind === 'drip');
    expect(drips.length).toBeGreaterThan(0);
    for (const s of drips) {
      expect(s.x).toBeCloseTo(3, 0);
      expect(s.y).toBeGreaterThanOrEqual(2);
      expect(s.vy).toBeGreaterThanOrEqual(0);
    }
  });
  it('sparks only on ticks with a dig event, on the dug side', () => {
    expect(run(decor(), ['step', 'gold']).filter((s) => s.kind === 'spark')).toEqual([]);
    for (const facing of [1, -1] as const) {
      const sparks = ambientOf(4, 's', decor(), ['dig'], { x: 10, y: 5, facing }).filter((s) => s.kind === 'spark');
      expect(sparks.length).toBeGreaterThan(0);
      for (const s of sparks) {
        expect((s.x - 10) * facing).toBeGreaterThan(0);
        expect((s.x - 10) * facing).toBeLessThanOrEqual(2);
        expect(s.y).toBeGreaterThanOrEqual(5);
      }
    }
  });
  it('keeps per-tick counts small and bounded', () => {
    const d = decor(Array(10).fill('stalactite'));
    for (let t = 0; t < 300; t++) {
      const out = ambientOf(t, 's', d, ['dig', 'dig'], hero);
      expect(out.filter((s) => s.kind === 'dust').length).toBeLessThanOrEqual(MAX_DUST);
      expect(out.filter((s) => s.kind === 'drip').length).toBeLessThanOrEqual(MAX_DRIPS);
      expect(out.filter((s) => s.kind === 'spark').length).toBeLessThanOrEqual(MAX_DIG_SPARKS);
    }
    expect(MAX_DUST + MAX_DRIPS + MAX_DIG_SPARKS).toBeLessThanOrEqual(12);
  });
  it('gives every spawn a positive life', () => {
    for (const s of run(decor(['stalactite']), ['dig'])) expect(s.life).toBeGreaterThan(0);
  });
});

describe('flicker', () => {
  it('stays in 0.7..1.0 and is deterministic', () => {
    for (let t = 0; t < 2000; t++) {
      const f = flicker(7, t);
      expect(f).toBeGreaterThanOrEqual(0.7);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBe(flicker(7, t));
    }
  });
  it('changes smoothly between adjacent ticks', () => {
    for (let t = 0; t < 2000; t++) expect(Math.abs(flicker(3, t + 1) - flicker(3, t))).toBeLessThan(0.08);
  });
  it('varies over time and between seeds', () => {
    const vals = new Set(Array.from({ length: 200 }, (_, t) => flicker(1, t).toFixed(3)));
    expect(vals.size).toBeGreaterThan(20);
    expect(flicker(1, 10)).not.toBe(flicker(2, 10));
  });
});
