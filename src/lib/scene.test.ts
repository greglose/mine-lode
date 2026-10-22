import { describe, expect, it } from 'vitest';
import { idx } from './level';
import { REFILL_GROW_TICKS, effectsOf, sceneOf } from './scene';
import { step } from './sim';
import { DIG_TICKS, HERO_TICKS, HOLE_TICKS, initState, type GameState } from './state';
import { I, mk, wait } from './testkit';

const at = (s: ReturnType<typeof sceneOf>, x: number, y: number) => s.blocks.filter((b) => b.x === x && b.y === y);

describe('sceneOf blocks', () => {
  const s = initState(mk(['&.$0H-XS', '#@']));
  const scene = sceneOf(s);
  it('draws tiles as blocks', () => {
    expect(at(scene, 0, 15)).toEqual([{ kind: 'dirt', x: 0, y: 15, scale: 1 }]);
    expect(at(scene, 1, 15)[0].kind).toBe('stone');
    expect(at(scene, 4, 14)[0].kind).toBe('ladder');
    expect(at(scene, 5, 14)[0].kind).toBe('rope');
  });
  it('draws a trapdoor exactly like dirt', () => {
    expect(at(scene, 6, 14)).toEqual([{ kind: 'dirt', x: 6, y: 14, scale: 1 }]);
  });
  it('draws gold on the ground and nothing for empty cells', () => {
    expect(at(scene, 2, 14)).toEqual([{ kind: 'gold', x: 2, y: 14, scale: 1 }]);
    expect(at(scene, 1, 14)).toEqual([]);
  });
  it('hides the exit until it opens', () => {
    expect(at(scene, 7, 14)).toEqual([]);
    expect(at(sceneOf({ ...s, exitOpen: true }), 7, 14)[0].kind).toBe('ladder');
  });
});

describe('sceneOf holes', () => {
  const hole = (ticks: number) => {
    const s = initState(mk(['&.$', '###']));
    s.tiles[idx(1, 15)] = 'empty';
    s.holes = [{ x: 1, y: 15, ticks }];
    return at(sceneOf(s), 1, 15);
  };
  it('breaks the block down in three stages', () => {
    const third = DIG_TICKS / 3;
    expect(hole(HOLE_TICKS)[0]).toEqual({ kind: 'dirt', x: 1, y: 15, scale: 0.75 });
    expect(hole(HOLE_TICKS - third)[0].scale).toBe(0.5);
    expect(hole(HOLE_TICKS - 2 * third)[0].scale).toBe(0.25);
  });
  it('shows nothing while the hole is fully open', () => {
    expect(hole(HOLE_TICKS - DIG_TICKS)).toEqual([]);
    expect(hole(REFILL_GROW_TICKS + 1)).toEqual([]);
  });
  it('grows the block back just before it refills', () => {
    expect(hole(REFILL_GROW_TICKS)[0].scale).toBe(0);
    expect(hole(REFILL_GROW_TICKS / 2)[0].scale).toBeCloseTo(0.5);
  });
});

describe('sceneOf actors', () => {
  it('places the hero and guards at their interpolated positions', () => {
    let s = step(initState(mk(['&....0$'])), I(1)).state;
    s = wait(s, HERO_TICKS / 2).s;
    const { actors } = sceneOf(s);
    expect(actors[0].kind).toBe('hero');
    expect(actors[0].x).toBeCloseTo(0.5);
    expect(actors[0].facing).toBe(1);
    expect(actors[1].kind).toBe('guard');
    expect(actors[1].x).toBeLessThan(5);
    expect(actors[1].facing).toBe(-1);
  });
  it('marks a guard that carries gold', () => {
    const s = initState(mk(['&....0$']));
    s.guards[0].gold = true;
    expect(sceneOf(s).actors[1].carrying).toBe(true);
    expect(sceneOf(s).actors[0].carrying).toBe(false);
  });
});

describe('sceneOf poses', () => {
  it('gives every actor a pose and phase from the pure pose rules', () => {
    let s = step(initState(mk(['&....0$'])), I(1)).state;
    expect(sceneOf(s).actors[0]).toMatchObject({ pose: 'walk' });
    expect(sceneOf(s).actors[1]).toMatchObject({ pose: 'walk' });
    s = wait(initState(mk(['&.$', '###'])), 1).s;
    expect(sceneOf(s).actors[0]).toMatchObject({ pose: 'idle' });
  });
  it('shows the hero digging with a phase', () => {
    const s = wait(step(initState(mk(['&.$', '###'])), I(0, 0, 1)).state, 6).s;
    expect(sceneOf(s).actors[0]).toMatchObject({ pose: 'dig', phase: 0.5 });
  });
  it('shows a trapped guard', () => {
    const s = initState(mk(['&....0$']));
    s.guards[0].trapped = 50;
    expect(sceneOf(s).actors[1].pose).toBe('trapped');
  });
});

describe('effectsOf', () => {
  const floor = () => initState(mk(['&.$', '###']));
  const held = (s: GameState, cells: [number, number][]): GameState => ({
    ...s,
    holes: cells.map(([x, y]) => ({ x, y, ticks: 1 })),
  });
  it('puts chunks at the hole a dig just opened', () => {
    const prev = floor();
    const r = step(prev, I(0, 0, 1));
    expect(r.events).toContain('dig');
    expect(effectsOf(prev, r.state, r.events)).toEqual([{ kind: 'chunks', x: 1, y: 15 }]);
  });
  it('puffs at the hole that just refilled', () => {
    const prev = held(floor(), [[1, 15]]);
    expect(effectsOf(prev, { ...prev, holes: [] }, ['refill'])).toEqual([{ kind: 'puff', x: 1, y: 15 }]);
  });
  it('puffs at both holes when two refill in one tick', () => {
    const prev = held(floor(), [[1, 15], [2, 15]]);
    const out = effectsOf(prev, { ...prev, holes: [] }, ['refill', 'refill']);
    expect(out).toEqual([{ kind: 'puff', x: 1, y: 15 }, { kind: 'puff', x: 2, y: 15 }]);
  });
  it('does not puff at holes that stay open', () => {
    const prev = held(floor(), [[1, 15], [2, 15]]);
    expect(effectsOf(prev, held(floor(), [[2, 15]]), ['refill'])).toEqual([{ kind: 'puff', x: 1, y: 15 }]);
  });
  it('sparkles at the hero cell on a gold event', () => {
    const prev = floor();
    const next = { ...prev, hero: { ...prev.hero, x: 2, y: 14 } };
    expect(effectsOf(prev, next, ['gold'])).toEqual([{ kind: 'sparkle', x: 2, y: 14 }]);
  });
  it('has no effects for a tick with no events or for other events', () => {
    const s = floor();
    expect(effectsOf(s, s, [])).toEqual([]);
    expect(effectsOf(s, s, ['step', 'climb', 'land', 'death', 'allGold', 'guardTrapped'])).toEqual([]);
  });
});
