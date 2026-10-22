import { describe, expect, it } from 'vitest';
import { idx } from './level';
import { step } from './sim';
import { DIG_TICKS, HOLE_TICKS, initState } from './state';
import { I, act, mk, wait } from './testkit';

const floor = (top: string, ground = '########') => initState(mk([top, ground]));

describe('digging', () => {
  it('opens the dirt block diagonally below, on the chosen side', () => {
    const right = act(floor('.&...$'), I(0, 0, 1));
    expect(right.s.tiles[idx(2, 15)]).toBe('empty');
    expect(right.s.holes).toEqual([{ x: 2, y: 15, ticks: HOLE_TICKS - DIG_TICKS }]);
    expect(right.ev).toContain('dig');
    expect(right.s.hero.facing).toBe(1);
    const left = act(floor('.&...$'), I(0, 0, -1));
    expect(left.s.tiles[idx(0, 15)]).toBe('empty');
    expect(left.s.hero.facing).toBe(-1);
  });
  it('keeps the hero busy for DIG_TICKS', () => {
    const s = step(floor('.&...$'), I(0, 0, 1)).state;
    expect(s.hero.t).toBe(DIG_TICKS);
    expect(step(s, I(1)).state.hero.x).toBe(1);
  });
  it.each([
    ['stone', '.&...$', '##@#####'],
    ['a ladder above the target', '.&H..$', '########'],
    ['gold above the target', '.&$...', '########'],
    ['a rope above the target', '.&-..$', '########'],
    ['a block above the target', '.&#..$', '########'],
  ])('refuses %s', (_name, top, ground) => {
    const { s, ev } = act(floor(top, ground), I(0, 0, 1));
    expect(s.holes).toEqual([]);
    expect(ev).not.toContain('dig');
  });
  it('refuses at the grid edge and on the bottom row', () => {
    expect(act(floor('&....$'), I(0, 0, -1)).s.holes).toEqual([]);
    expect(act(initState(mk(['&...$'])), I(0, 0, 1)).s.holes).toEqual([]);
  });
  it('refuses while falling', () => {
    let s = step(initState(mk(['&.', '#.', '..', '..', '####$'])), I(1)).state;
    s = wait(s, 12).s;
    expect(s.hero.falling).toBe(true);
    expect(step(s, I(0, 0, 1)).state.holes).toEqual([]);
  });
});

describe('holes', () => {
  it('refill after HOLE_TICKS and report it', () => {
    const dug = act(floor('.&...$'), I(0, 0, 1)).s;
    const before = wait(dug, HOLE_TICKS - DIG_TICKS - 1);
    expect(before.s.tiles[idx(2, 15)]).toBe('empty');
    const after = wait(before.s, 1);
    expect(after.s.tiles[idx(2, 15)]).toBe('dirt');
    expect(after.s.holes).toEqual([]);
    expect(after.ev).toContain('refill');
  });
  it('let the hero drop through a one-block floor', () => {
    let s = initState(mk(['.&...$', '######', '......', '......']));
    s = act(s, I(0, 0, 1)).s;
    s = act(s, I(1)).s;
    expect([s.hero.x, s.hero.y]).toEqual([2, 15]);
    expect(s.status).toBe('playing');
  });
  it('kill a hero who is inside when one refills', () => {
    let s = floor('.&...$');
    s = act(s, I(0, 0, 1)).s;
    s = act(s, I(1)).s;
    expect([s.hero.x, s.hero.y]).toEqual([2, 15]);
    const { s: end, ev } = wait(s, HOLE_TICKS);
    expect(end.status).toBe('dead');
    expect(ev.filter((e) => e === 'death').length).toBe(1);
  });
});
