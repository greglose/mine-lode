import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './campaign';
import { generateLevel, goldCount, guardCount } from './generate';
import { COLS, MAX_GOLD, MAX_GUARDS, ROWS } from './level';
import { isSolvable } from './solve';

describe('difficulty ramp', () => {
  it('follows the guard formula', () => {
    expect([1, 2, 3, 5, 6, 9, 12, 40].map(guardCount)).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
  });
  it('follows the gold formula and stays under the solver limit', () => {
    expect([1, 2, 4, 12, 40].map(goldCount)).toEqual([4, 5, 6, 10, 10]);
    expect(goldCount(999)).toBeLessThanOrEqual(MAX_GOLD);
    expect(guardCount(999)).toBeLessThanOrEqual(MAX_GUARDS);
  });
});

describe('generateLevel', () => {
  it('gives the same level for the same seed and number', () => {
    expect(generateLevel('abc', 4)).toEqual(generateLevel('abc', 4));
  });
  it('gives different levels for different numbers and seeds', () => {
    expect(generateLevel('abc', 4)).not.toEqual(generateLevel('abc', 5));
    expect(generateLevel('abc', 4)).not.toEqual(generateLevel('abd', 4));
  });
  it('accepts junk seeds', () => {
    for (const seed of ['', ' ', 'x'.repeat(500), '\u{1F600}']) {
      expect(isSolvable(generateLevel(seed, 1))).toBe(true);
    }
  });
  it('produces only solvable levels with the right counts, and never the fallback', { timeout: 120_000 }, () => {
    const fallback = JSON.stringify(CAMPAIGN[0]);
    for (const seed of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      for (let n = 1; n <= 100; n++) {
        const level = generateLevel(seed, n);
        const where = `${seed} #${n}`;
        expect(level.tiles.length, where).toBe(COLS * ROWS);
        expect(level.gold.length, where).toBe(goldCount(n));
        expect(level.guards.length, where).toBe(guardCount(n));
        expect(new Set([level.hero, ...level.gold, ...level.guards]).size, where).toBe(1 + level.gold.length + level.guards.length);
        expect(isSolvable(level), where).toBe(true);
        expect(JSON.stringify(level), where).not.toBe(fallback);
      }
    }
  });
});
