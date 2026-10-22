import { describe, expect, it } from 'vitest';
import { idx } from './level';
import { step } from './sim';
import { GUARD_TICKS, NO_INPUT, SCORE_KILL, SCORE_TRAP, TRAP_RETRY_TICKS, TRAP_TICKS, initState, type GameEvent, type GameState } from './state';
import { I, act, mk, wait } from './testkit';

/** Idle until `event` fires or `max` ticks pass. */
function until(s: GameState, event: GameEvent, max: number): { s: GameState; ev: GameEvent[] } {
  const ev: GameEvent[] = [];
  for (let i = 0; i < max && !ev.includes(event); i++) {
    const r = step(s, NO_INPUT);
    s = r.state;
    ev.push(...r.events);
  }
  return { s, ev };
}

/** A level with one guard sitting trapped in an open hole at (5, 15). */
function trappedSetup(top = '&....0...$', holeTicks = 400, trapped = 1): GameState {
  const s = initState(mk([top, '##########']));
  s.tiles[idx(5, 15)] = 'empty';
  s.holes = [{ x: 5, y: 15, ticks: holeTicks }];
  const g = s.guards[0];
  g.y = g.fromY = 15;
  g.trapped = trapped;
  return s;
}

describe('guards chasing', () => {
  it('catch and kill the hero', () => {
    const { s, ev } = until(initState(mk(['&..0$'])), 'death', 200);
    expect(s.status).toBe('dead');
    expect(ev.filter((e) => e === 'death').length).toBe(1);
  });
  it('take GUARD_TICKS per cell', () => {
    const s = wait(initState(mk(['&........0$'])), 1 + GUARD_TICKS).s;
    expect(s.guards[0].x).toBeLessThanOrEqual(8);
    expect(wait(initState(mk(['&........0$'])), GUARD_TICKS).s.guards[0].t).toBeGreaterThan(0);
  });
  it('never share a cell', () => {
    let s = initState(mk(['&.......00$']));
    for (let i = 0; i < 80 && s.status === 'playing'; i++) {
      s = step(s, NO_INPUT).state;
      expect(idx(s.guards[0].x, s.guards[0].y)).not.toBe(idx(s.guards[1].x, s.guards[1].y));
    }
  });
});

describe('guards and holes', () => {
  it('fall into a dug hole, get trapped, and can be walked over', () => {
    let s = initState(mk(['&...0..$', '########']));
    s = act(s, I(0, 0, 1)).s;
    const trapped = until(s, 'guardTrapped', 200);
    s = trapped.s;
    expect(trapped.ev).toContain('guardTrapped');
    expect([s.guards[0].x, s.guards[0].y]).toEqual([1, 15]);
    expect(s.guards[0].trapped).toBeGreaterThan(0);
    expect(s.score).toBe(SCORE_TRAP);
    expect(s.status).toBe('playing');
    s = act(s, I(1)).s;
    expect([s.hero.x, s.hero.y, s.hero.falling]).toEqual([1, 14, false]);
    expect(s.status).toBe('playing');
  });
  it('climb out after the trap time, toward the hero', () => {
    let s = trappedSetup();
    s = step(s, NO_INPUT).state;
    expect(s.guards[0].trapped).toBe(0);
    expect([s.guards[0].x, s.guards[0].y]).toEqual([4, 14]);
    expect(s.guards[0].t).toBe(GUARD_TICKS * 2);
  });
  it('wait and retry when both sides are blocked', () => {
    const s = step(trappedSetup('&...#0#..$'), NO_INPUT).state;
    expect([s.guards[0].x, s.guards[0].y]).toEqual([5, 15]);
    expect(s.guards[0].trapped).toBe(TRAP_RETRY_TICKS);
  });
  it('stay trapped for TRAP_TICKS when they fall in', () => {
    let s = initState(mk(['&...0..$', '########']));
    s = act(s, I(0, 0, 1)).s;
    s = until(s, 'guardTrapped', 200).s;
    expect(s.guards[0].trapped).toBe(TRAP_TICKS);
  });
  it('are buried when the hole refills, score, and respawn on the top row', () => {
    const r = step(trappedSetup('&....0...$', 1, 100), NO_INPUT);
    expect(r.events).toEqual(expect.arrayContaining(['refill', 'guardKilled', 'guardRespawn']));
    expect(r.state.tiles[idx(5, 15)]).toBe('dirt');
    // It respawns on row 0 and, with nothing under it, starts falling in the same tick.
    expect(r.state.guards[0].fromY).toBe(0);
    expect(r.state.guards[0].trapped).toBe(0);
    expect(r.state.score).toBe(SCORE_KILL);
    expect(r.state.status).toBe('playing');
  });
});

describe('guards and gold', () => {
  it('pick up gold they walk over, which still counts as gold left', () => {
    const s = wait(initState(mk(['&......$0.$', '###########'])), GUARD_TICKS + 1).s;
    expect(s.guards[0].gold).toBe(true);
    expect(s.gold[idx(7, 14)]).toBe(false);
    expect(s.goldLeft).toBe(2);
  });
  it('carry only one', () => {
    const s = wait(initState(mk(['&.....$$0', '#########'])), 2 * GUARD_TICKS + 2).s;
    expect(s.gold[idx(6, 14)]).toBe(true);
  });
  it('drop it on the cell above when trapped', () => {
    const s0 = trappedSetup('&....0...$', 400, 0);
    const g = s0.guards[0];
    g.y = g.fromY = 14;
    g.gold = true;
    s0.goldLeft = 2;
    const { s, ev } = until(s0, 'guardTrapped', 30);
    expect(ev).toContain('guardTrapped');
    expect(s.guards[0].gold).toBe(false);
    expect(s.gold[idx(5, 14)]).toBe(true);
    expect(s.goldLeft).toBe(2);
  });
  it('keep the exit shut while one carries the last gold', () => {
    let s = initState(mk(['&$.....$0', '#########']));
    s = act(s, I(1)).s;
    s = wait(s, 6).s;
    expect(s.gold.some(Boolean)).toBe(false);
    expect(s.guards[0].gold).toBe(true);
    expect(s.goldLeft).toBe(1);
    expect(s.exitOpen).toBe(false);
  });
});
