import { describe, expect, it } from 'vitest';
import { hashSeed, int, rngFor, shuffle } from './rng';

describe('rng', () => {
  it('gives the same sequence for the same seed and parts', () => {
    const a = rngFor('abc', 3, 0);
    const b = rngFor('abc', 3, 0);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('gives a different sequence when a part changes', () => {
    expect(rngFor('abc', 3, 0)()).not.toBe(rngFor('abc', 3, 1)());
    expect(rngFor('abc', 3, 0)()).not.toBe(rngFor('abd', 3, 0)());
  });
  it('stays in range', () => {
    const r = rngFor('x');
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = int(r, 4, 11);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(11);
    }
  });
  it('hashes any text, including empty and non-ASCII, to an unsigned 32-bit integer', () => {
    for (const s of ['', ' ', 'a'.repeat(500), '\u{1F600}é']) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
  it('shuffles without losing items and without changing the input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffle(rngFor('s'), input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
  });
});
