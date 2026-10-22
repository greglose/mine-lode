import { describe, expect, it } from 'vitest';
import { nextGuardCell, rowRating } from './guards';
import { idx } from './level';
import { initState } from './state';
import { mk } from './testkit';

/** A full-width level row: `cells` overrides single columns, `fill` is everywhere else. */
const row = (cells: Record<number, string>, fill = '.'): string =>
  Array.from({ length: 28 }, (_, x) => cells[x] ?? fill).join('');
const FLOOR = row({}, '#');

/** Move the (only) guard to a cell, as the simulation would after it arrived there. */
function place(s: ReturnType<typeof initState>, x: number, y: number): void {
  const g = s.guards[0];
  g.x = g.fromX = x;
  g.y = g.fromY = y;
}

describe('classic pursuit rule 1: same row, clear walk', () => {
  it('steps right toward a runner on the right', () => {
    expect(nextGuardCell(initState(mk(['0....&$', '#######'])), 0)).toEqual([1, 14]);
  });
  it('steps left toward a runner on the left', () => {
    expect(nextGuardCell(initState(mk(['&....0$', '#######'])), 0)).toEqual([4, 14]);
  });
  it('walks over ladders and ropes on the way', () => {
    expect(nextGuardCell(initState(mk(['0.H.-.&$', '########'])), 0)).toEqual([1, 14]);
  });
  it('does not walk into a solid block on the way; the rating rule takes over and dithers', () => {
    const s = initState(mk(['0.#.&$', '######']));
    // The closest column to the runner that it can reach is column 1, so it goes there...
    expect(nextGuardCell(s, 0)).toEqual([1, 14]);
    // ...and from there the only candidate is back to column 0 (the intended dither).
    place(s, 1, 14);
    expect(nextGuardCell(s, 0)).toEqual([0, 14]);
  });
  it('is blocked by a gap in the floor on the way, and rates the drop point instead', () => {
    const s = initState(mk(['0....&$', '###.###', '.......']));
    expect(nextGuardCell(s, 0)).toEqual([1, 13]);
    place(s, 2, 13);
    expect(nextGuardCell(s, 0)).toEqual([3, 13]);
  });
});

describe('classic pursuit rule 2: rating', () => {
  it('rates the runner row by distance, rows above from 100, rows below from 200', () => {
    expect(rowRating(10, 5, 10, 9)).toBe(4);
    expect(rowRating(10, 5, 8, 0)).toBe(102);
    expect(rowRating(10, 5, 12, 0)).toBe(202);
    // runner row beats a row above, which beats a row below, whatever the distances
    expect(rowRating(10, 5, 10, 27)).toBeLessThan(rowRating(10, 5, 9, 5));
    expect(rowRating(10, 5, 0, 5)).toBeLessThan(rowRating(10, 5, 11, 5));
  });
  it('runner above: heads for the ladder, then climbs it', () => {
    const s = initState(mk([
      row({ 3: 'H', 6: '&', 7: '$' }),
      row({ 3: 'H' }, '#'),
      row({ 3: 'H', 7: '0' }),
      FLOOR,
    ]));
    expect(nextGuardCell(s, 0)).toEqual([6, 14]);
    place(s, 3, 14);
    expect(nextGuardCell(s, 0)).toEqual([3, 13]);
  });
  it('runner below: heads for a ladder down, then climbs down it', () => {
    const s = initState(mk([row({ 0: '0' }), row({ 5: 'H' }, '#'), row({ 9: '&', 10: '$' })]));
    expect(nextGuardCell(s, 0)).toEqual([1, 13]);
    place(s, 5, 13);
    expect(nextGuardCell(s, 0)).toEqual([5, 14]);
  });
  it('runner below: heads for a ledge to drop from', () => {
    const s = initState(mk(['0.....', '#####', '.......&$']));
    expect(nextGuardCell(s, 0)).toEqual([1, 13]);
    place(s, 4, 13);
    expect(nextGuardCell(s, 0)).toEqual([5, 13]);
  });
  it('a route that reaches the runner row beats one that only gets partway below it', () => {
    // Runner on a ledge four rows up. The ladder at column 4 only reaches row 12; the ladder at
    // column 18 reaches the runner row and wins, though it is farther away.
    const s = initState(mk([
      row({ 18: 'H', 24: '&', 25: '$' }),
      row({ 18: 'H' }, '#'),
      row({ 18: 'H' }),
      row({ 4: 'H', 18: 'H' }),
      row({ 4: 'H', 10: '0', 18: 'H' }),
      FLOOR,
    ]));
    expect(nextGuardCell(s, 0)).toEqual([11, 14]);
  });
  it('a route that reaches the runner row beats the rest of the guard row (above it)', () => {
    // Guard on a high platform, runner lower. The pit at column 16 lands on the runner row.
    const s = initState(mk([
      row({ 9: '0' }),
      row({ 16: '.' }, '#'),
      row({}),
      row({ 22: '&', 23: '$' }),
      FLOOR,
      FLOOR,
    ]));
    expect(nextGuardCell(s, 0)).toEqual([10, 10]);
  });
  it('a tie between a left and a right candidate goes left', () => {
    const s = initState(mk([
      row({ 2: 'H', 6: 'H', 10: '&', 11: '$' }),
      row({ 2: 'H', 6: 'H' }),
      row({ 2: 'H', 4: '0', 6: 'H' }),
      FLOOR,
    ]));
    s.hero.x = 4;
    s.hero.y = 5;
    expect(nextGuardCell(s, 0)).toEqual([3, 14]);
  });
  it('with nothing to rate, stays put', () => {
    expect(nextGuardCell(initState(mk(['@0@&$', '@@@@@'])), 0)).toEqual([1, 14]);
  });
  it('stays when it is already on the runner', () => {
    const s = initState(mk(['&0$', '###']));
    place(s, 0, 14);
    expect(nextGuardCell(s, 0)).toEqual([0, 14]);
  });
});

describe('classic pursuit rule: intended quirks', () => {
  it('quirk: picks a walled-off ladder that rates better although the shortest route is the other ladder', () => {
    // The shortest walk is left to the ladder at column 2. The ladder at column 22 reaches the
    // runner row at distance 2, so the rule goes right, to a pocket with no way to the runner.
    const s = initState(mk([
      row({ 22: '#' }),
      row({ 2: 'H', 19: '$', 20: '&', 21: '#', 22: 'H' }),
      row({ 2: 'H', 22: 'H' }, '#'),
      row({ 2: 'H', 10: '0', 22: 'H' }),
      FLOOR,
    ]));
    expect(nextGuardCell(s, 0)).toEqual([11, 14]);
  });
  it('does not see open holes: walks over them as if still dirt', () => {
    const s = initState(mk(['&....0$', '#######']));
    s.tiles[idx(2, 15)] = 'empty';
    s.holes = [{ x: 2, y: 15, ticks: 300 }];
    place(s, 3, 14);
    expect(nextGuardCell(s, 0)).toEqual([2, 14]);
  });
});
