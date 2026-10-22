import { describe, expect, it } from 'vitest';
import { COLS } from './level';
import { step } from './sim';
import { HERO_TICKS, NO_INPUT, SCORE_CLEAR, SCORE_GOLD, initState, posOf } from './state';
import { I, act, mk, wait } from './testkit';

describe('initState', () => {
  it('places the hero, guards and gold', () => {
    const s = initState(mk(['&.$.0']));
    expect([s.hero.x, s.hero.y]).toEqual([0, 15]);
    expect(s.guards.map((g) => [g.x, g.y])).toEqual([[4, 15]]);
    expect(s.goldLeft).toBe(1);
    expect(s.status).toBe('playing');
    expect(s.exitOpen).toBe(false);
  });
});

describe('walking', () => {
  it('moves one cell and reports a step', () => {
    const { s, ev } = act(initState(mk(['&..$'])), I(1));
    expect([s.hero.x, s.hero.y, s.hero.t]).toEqual([1, 15, 0]);
    expect(ev).toContain('step');
  });
  it('takes HERO_TICKS ticks per cell and interpolates in between', () => {
    let s = step(initState(mk(['&..$'])), I(1)).state;
    s = wait(s, HERO_TICKS / 2).s;
    expect(posOf(s.hero)[0]).toBeCloseTo(0.5);
    expect(wait(s, HERO_TICKS / 2).s.hero.t).toBe(0);
  });
  it('is blocked by dirt, stone and the grid edge', () => {
    expect(act(initState(mk(['&#.$'])), I(1)).s.hero.x).toBe(0);
    expect(act(initState(mk(['&@.$'])), I(1)).s.hero.x).toBe(0);
    expect(act(initState(mk(['&.$'])), I(-1)).s.hero.x).toBe(0);
    const right = initState(mk(['$'.padEnd(COLS - 1, '.') + '&']));
    expect(act(right, I(1)).s.hero.x).toBe(COLS - 1);
  });
  it('faces the way it last tried to move', () => {
    expect(act(initState(mk(['.&.$'])), I(-1)).s.hero.facing).toBe(-1);
  });
  it('does not mutate the previous state', () => {
    const s0 = initState(mk(['&..$']));
    const before = JSON.stringify(s0);
    step(s0, I(1));
    expect(JSON.stringify(s0)).toBe(before);
  });
});

describe('falling', () => {
  it('falls to the ground and reports a landing', () => {
    const { s, ev } = act(initState(mk(['&', '#.', '..$'])), I(1));
    expect([s.hero.x, s.hero.y]).toEqual([1, 15]);
    expect(ev.filter((e) => e === 'land').length).toBe(1);
  });
  it('ignores input while falling', () => {
    let s = step(initState(mk(['&', '#.', '.', '.', '..$'])), I(1)).state;
    s = wait(s, HERO_TICKS + 2).s;
    expect(s.hero.falling).toBe(true);
    for (let i = 0; i < 60; i++) s = step(s, I(1)).state;
    s = wait(s, 20).s;
    expect(s.hero.y).toBe(15);
    expect(s.hero.x).toBeGreaterThanOrEqual(1);
  });
  it('falls through a trapdoor', () => {
    const { s } = act(initState(mk(['&.', '#X', '..$'])), I(1));
    expect([s.hero.x, s.hero.y]).toEqual([1, 15]);
  });
});

describe('ladders and ropes', () => {
  it('climbs a ladder and steps off the top', () => {
    let s = initState(mk(['.H', '.H', '&H$']));
    s = act(s, I(1)).s;
    s = act(s, I(0, -1)).s;
    s = act(s, I(0, -1)).s;
    s = act(s, I(0, -1)).s;
    expect([s.hero.x, s.hero.y]).toEqual([1, 12]);
    expect(act(s, I(0, -1)).s.hero.y).toBe(12); // no ladder here, cannot climb further
  });
  it('reports a climb', () => {
    const s = act(initState(mk(['.H', '&H$'])), I(1)).s;
    expect(act(s, I(0, -1)).ev).toContain('climb');
  });
  it('hangs on a rope and drops when down is pressed', () => {
    let s = initState(mk(['H--', 'H..', 'H..', 'H&.$']));
    s = act(s, I(-1)).s;
    for (let i = 0; i < 3; i++) s = act(s, I(0, -1)).s;
    s = act(s, I(1)).s;
    s = act(s, I(1)).s;
    expect([s.hero.x, s.hero.y]).toEqual([2, 12]);
    expect(wait(s, 60).s.hero.y).toBe(12);
    expect(act(s, I(0, 1)).s.hero.y).toBe(15);
  });
});

describe('gold and the exit', () => {
  const tower = [...Array.from({ length: 15 }, () => '...S'), '&$$S'];
  it('collects gold for points', () => {
    const { s, ev } = act(initState(mk(tower)), I(1));
    expect(s.goldLeft).toBe(1);
    expect(s.score).toBe(SCORE_GOLD);
    expect(ev).toContain('gold');
    expect(s.exitOpen).toBe(false);
  });
  it('keeps the exit ladder hidden until all gold is collected', () => {
    let s = act(initState(mk(tower)), I(1)).s;
    s = act(s, I(1)).s;
    expect(s.exitOpen).toBe(true);
    const closed = initState(mk([...Array.from({ length: 15 }, () => '.S'), '&S$']));
    const tried = act(act(closed, I(1)).s, I(0, -1)).s;
    expect(tried.hero.y).toBe(15);
  });
  it('reports allGold once and wins at the top row', () => {
    let s = initState(mk(tower));
    const events: string[] = [];
    for (const input of [I(1), I(1), I(1)]) {
      const r = act(s, input);
      s = r.s;
      events.push(...r.ev);
    }
    expect(events.filter((e) => e === 'allGold').length).toBe(1);
    for (let i = 0; i < 15 && s.status === 'playing'; i++) {
      const r = act(s, I(0, -1));
      s = r.s;
      events.push(...r.ev);
    }
    expect(s.status).toBe('won');
    expect(s.hero.y).toBe(0);
    expect(events).toContain('levelClear');
    expect(s.score).toBe(2 * SCORE_GOLD + SCORE_CLEAR);
  });
  it('does nothing once the level has ended', () => {
    const s = { ...initState(mk(['&$'])), status: 'won' as const };
    const r = step(s, I(1));
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
});

describe('determinism', () => {
  it('gives identical results for identical inputs', () => {
    const script = [I(1), I(1), I(0, -1), I(-1), NO_INPUT, I(1, 0, 1), I(1)];
    const run = () => {
      let s = initState(mk(['.H..', '&H.$', '####']));
      for (let i = 0; i < 400; i++) s = step(s, script[i % script.length]).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
