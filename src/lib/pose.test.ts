import { describe, expect, it } from 'vitest';
import { idx } from './level';
import { POSE_BLEND_TICKS, POSE_PERIOD, blendJoints, glanceTurn, jointsFor, limbsFor, poseOfGuard, poseOfHero, type Pose } from './pose';
import { step } from './sim';
import { NO_INPUT, initState, type GameState, type Guard, type Hero, type Input } from './state';
import { I, mk } from './testkit';

const base = (): GameState => initState(mk(['&.0.$', '#####']));
const withHero = (patch: Partial<Hero>, edit?: (s: GameState) => void): GameState => {
  const s = base();
  Object.assign(s.hero, patch);
  edit?.(s);
  return s;
};
const withGuard = (patch: Partial<Guard>, edit?: (s: GameState) => void): GameState => {
  const s = base();
  Object.assign(s.guards[0], patch);
  edit?.(s);
  return s;
};

describe('poseOfHero', () => {
  it('is idle at rest', () => {
    expect(poseOfHero(base()).pose).toBe('idle');
  });
  it('walks while moving sideways', () => {
    expect(poseOfHero(withHero({ x: 1, fromX: 0, t: 4, total: 8 })).pose).toBe('walk');
  });
  it('climbs while moving vertically on a ladder', () => {
    const s = withHero({ x: 0, y: 13, fromX: 0, fromY: 14, t: 4, total: 8 }, (g) => { g.tiles[idx(0, 14)] = 'ladder'; });
    expect(poseOfHero(s).pose).toBe('climb');
  });
  it('hangs on a rope, at rest or sliding along it', () => {
    const rope = (g: GameState) => { g.tiles[idx(1, 14)] = 'rope'; g.tiles[idx(2, 14)] = 'rope'; };
    expect(poseOfHero(withHero({ x: 1 }, rope)).pose).toBe('hang');
    expect(poseOfHero(withHero({ x: 2, fromX: 1, t: 3, total: 8 }, rope)).pose).toBe('hang');
  });
  it('climbs, not hangs, when moving vertically onto a rope', () => {
    const s = withHero({ x: 1, y: 14, fromX: 1, fromY: 13, t: 3, total: 8 }, (g) => { g.tiles[idx(1, 14)] = 'rope'; });
    expect(poseOfHero(s).pose).toBe('climb');
  });
  it('falls while falling, even over a rope', () => {
    expect(poseOfHero(withHero({ y: 15, fromY: 14, t: 2, total: 5, falling: true })).pose).toBe('fall');
  });
  it('digs while busy in place, with phase running 0 to 1', () => {
    expect(poseOfHero(withHero({ t: 12, total: 12 }))).toEqual({ pose: 'dig', phase: 0 });
    expect(poseOfHero(withHero({ t: 6, total: 12 }))).toEqual({ pose: 'dig', phase: 0.5 });
    expect(poseOfHero(withHero({ t: 3, total: 12 })).phase).toBeCloseTo(0.75);
  });
  it('shows dead and cheer from status, ahead of everything else', () => {
    expect(poseOfHero(withHero({ t: 6, total: 12 }, (g) => { g.status = 'dead'; }))).toEqual({ pose: 'dead', phase: 0 });
    expect(poseOfHero(withHero({ falling: true }, (g) => { g.status = 'won'; }))).toEqual({ pose: 'cheer', phase: 0 });
  });
  it('takes the phase of a looping pose from the tick, and repeats each period', () => {
    const at = (tick: number) => poseOfHero(withHero({ x: 1, fromX: 0, t: 4, total: 8 }, (g) => { g.tick = tick; }));
    expect(at(0).phase).toBe(0);
    expect(at(POSE_PERIOD.walk / 2).phase).toBeCloseTo(0.5);
    expect(at(POSE_PERIOD.walk)).toEqual(at(0));
    expect(at(POSE_PERIOD.walk + 3)).toEqual(at(3));
  });
  it('keeps every phase inside [0, 1)', () => {
    for (let tick = 0; tick < 500; tick++) {
      const p = poseOfHero({ ...base(), tick }).phase;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe('poseOfGuard', () => {
  it('is idle at rest', () => {
    expect(poseOfGuard(base(), 0).pose).toBe('idle');
  });
  it('is trapped while in a hole, ahead of anything else', () => {
    expect(poseOfGuard(withGuard({ trapped: 10, x: 3, fromX: 2, t: 2, total: 12 }), 0).pose).toBe('trapped');
  });
  it('walks on horizontal and diagonal moves (climbing out of a hole)', () => {
    expect(poseOfGuard(withGuard({ x: 3, fromX: 2, t: 5, total: 12 }), 0).pose).toBe('walk');
    expect(poseOfGuard(withGuard({ x: 3, y: 13, fromX: 2, fromY: 14, t: 5, total: 24 }), 0).pose).toBe('walk');
  });
  it('climbs on a vertical move from a ladder', () => {
    const s = withGuard({ y: 13, fromY: 14, t: 4, total: 12 }, (g) => { g.tiles[idx(2, 14)] = 'ladder'; });
    expect(poseOfGuard(s, 0).pose).toBe('climb');
  });
  it('climbs down a ladder instead of falling', () => {
    const s = withGuard({ y: 15, fromY: 14, t: 6, total: 12 }, (g) => { g.tiles[idx(2, 14)] = 'ladder'; });
    expect(poseOfGuard(s, 0).pose).toBe('climb');
  });
  it('hangs on a rope', () => {
    const s = withGuard({ x: 3, fromX: 2, t: 4, total: 12 }, (g) => { g.tiles[idx(3, 14)] = 'rope'; });
    expect(poseOfGuard(s, 0).pose).toBe('hang');
  });
  it('uses the tick for looping phases', () => {
    const s = withGuard({ x: 3, fromX: 2, t: 4, total: 12 }, (g) => { g.tick = POSE_PERIOD.walk / 4; });
    expect(poseOfGuard(s, 0).phase).toBeCloseTo(0.25);
  });
});

const swing = (pose: Pose, phase: number, facing: -1 | 1 = 1) => jointsFor(pose, phase, facing);
const PHASES = Array.from({ length: 24 }, (_, i) => i / 24);

describe('jointsFor', () => {
  it('walk swings the arms against each other and each arm against its same-side leg', () => {
    for (const p of PHASES) {
      const j = swing('walk', p);
      expect(j.armL * j.armR).toBeLessThanOrEqual(1e-9);
      expect(j.armL * j.legL).toBeLessThanOrEqual(1e-9);
      expect(j.armR * j.legR).toBeLessThanOrEqual(1e-9);
    }
    const quarter = swing('walk', 0.25);
    expect(Math.abs(quarter.armL)).toBeGreaterThan(0.5);
    expect(Math.abs(quarter.legL)).toBeGreaterThan(0.5);
  });
  it('walk is periodic', () => {
    const a = swing('walk', 0);
    const b = swing('walk', 1 - 1e-9);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(a[k]).toBeCloseTo(b[k], 4);
  });
  it('walk faces the travel direction, climb faces away, others face the camera', () => {
    expect(swing('walk', 0.3, 1).turn).toBeCloseTo(Math.PI / 2);
    expect(swing('walk', 0.3, -1).turn).toBeCloseTo(-Math.PI / 2);
    expect(swing('climb', 0.3).turn).toBeCloseTo(Math.PI);
    for (const pose of ['hang', 'idle', 'cheer'] as const) expect(swing(pose, 0.3, -1).turn).toBe(0);
  });
  it('idle keeps the limbs almost still', () => {
    for (const p of PHASES) {
      const j = swing('idle', p);
      for (const v of [j.armL, j.armR, j.legL, j.legR]) expect(Math.abs(v)).toBeLessThan(0.15);
    }
  });
  it('hang and fall raise both arms', () => {
    for (const pose of ['hang', 'fall'] as const) {
      for (const p of PHASES) {
        const j = swing(pose, p);
        expect(Math.abs(j.armL), pose).toBeGreaterThan(2.4);
        expect(Math.abs(j.armR), pose).toBeGreaterThan(2.4);
        expect(Math.abs(j.armL)).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
  it('climb alternates the arms', () => {
    const sign = (p: number) => Math.sign(swing('climb', p).armL - swing('climb', p).armR);
    expect(sign(0.25)).toBe(1);
    expect(sign(0.75)).toBe(-1);
  });
  it('dig brings the tool arm from raised to down three times and turns toward facing', () => {
    for (const k of [0, 1, 2]) {
      expect(swing('dig', k / 3 + 0.01).armR).toBeGreaterThan(2.4);
      expect(swing('dig', (k + 1) / 3 - 0.01).armR).toBeLessThan(0.8);
    }
    expect(swing('dig', 0.2, 1).turn).toBeCloseTo(Math.PI / 2);
    expect(swing('dig', 0.2, -1).turn).toBeCloseTo(-Math.PI / 2);
  });
  it('trapped waves both arms raised', () => {
    for (const p of PHASES) {
      const j = swing('trapped', p);
      expect(j.armL).toBeGreaterThan(2);
      expect(j.armR).toBeGreaterThan(2);
    }
  });
  it('dead falls over as progress runs 0 to 1', () => {
    expect(Math.abs(jointsFor('dead', 0, 1, 0).lean)).toBeLessThan(0.05);
    expect(Math.abs(jointsFor('dead', 0, 1, 1).lean)).toBeCloseTo(Math.PI / 2, 2);
    expect(Math.abs(jointsFor('dead', 0, 1, 0.5).lean)).toBeGreaterThan(0.2);
    expect(Math.abs(jointsFor('dead', 0, 1, 0.5).lean)).toBeLessThan(Math.PI / 2);
  });
  it('cheer raises both arms once progress is full', () => {
    const j = jointsFor('cheer', 0, 1, 1);
    expect(j.armL).toBeGreaterThan(2.4);
    expect(j.armR).toBeGreaterThan(2.4);
  });
  it('is deterministic', () => {
    expect(swing('walk', 0.37)).toEqual(swing('walk', 0.37));
  });
});

/** Drive the real simulation and record each mover's pose after every tick. */
function posesOver(s: GameState, who: 'hero' | 'guard', input: (tick: number) => Input, ticks: number): string[] {
  const out: string[] = [];
  for (let n = 0; n < ticks && s.status === 'playing'; n++) {
    s = step(s, input(n)).state;
    out.push((who === 'hero' ? poseOfHero(s) : poseOfGuard(s, 0)).pose);
  }
  return out;
}

describe('one falling rule for hero and guards (driven through step)', () => {
  const ledge = (who: 'hero' | 'guard'): GameState =>
    initState(mk(who === 'guard' ? ['.0.....$', '.###....', '.....&..', '########'] : ['&......$', '#.......', '........', '########']));

  it('a guard that walks off a ledge is posed fall while falling and not after landing', () => {
    const poses = posesOver(ledge('guard'), 'guard', () => NO_INPUT, 120);
    const first = poses.indexOf('fall');
    expect(first).toBeGreaterThan(0);
    expect(poses.slice(0, first).every((p) => p === 'walk')).toBe(true);
    const last = poses.lastIndexOf('fall');
    expect(last).toBeLessThan(poses.length - 1);
    expect(poses[last + 1]).not.toBe('fall');
  });
  it('the hero that walks off a ledge follows the same rule', () => {
    const poses = posesOver(ledge('hero'), 'hero', (n) => (n === 0 ? I(1) : NO_INPUT), 60);
    const first = poses.indexOf('fall');
    expect(first).toBeGreaterThan(0);
    const last = poses.lastIndexOf('fall');
    expect(last).toBeLessThan(poses.length - 1);
    expect(poses[last + 1]).not.toBe('fall');
  });
  it('a guard walking down onto a ladder head climbs, it does not fall', () => {
    const s = initState(mk(['0#...$', 'H.....', 'H&....']));
    const poses = posesOver(s, 'guard', () => NO_INPUT, 12);
    expect(poses.length).toBeGreaterThan(0);
    expect(poses).not.toContain('fall');
    expect(poses[0]).toBe('climb');
  });
  it('the hero walking down onto a ladder head climbs, it does not fall', () => {
    const s = initState(mk(['&....$', 'H.....', 'H.....']));
    const poses = posesOver(s, 'hero', () => I(0, 1), 8);
    expect(poses).not.toContain('fall');
    expect(poses[0]).toBe('climb');
  });
  it('a respawned guard keeps no stale falling flag: it is falling only if it is on its way down', () => {
    const s = initState(mk(['&..$0', '#####']));
    s.guards[0].falling = true;
    s.guards[0].trapped = 50;
    s.tiles[idx(4, 14)] = 'empty';
    s.holes = [{ x: 4, y: 14, ticks: 1 }];
    const r = step(s, NO_INPUT);
    expect(r.events).toContain('guardRespawn');
    const g = r.state.guards[0];
    expect(g.falling).toBe(g.t > 0 && g.y > g.fromY && g.x === g.fromX);
    expect(poseOfGuard(r.state, 0).pose).toBe(g.falling ? 'fall' : 'idle');
  });
});

describe('limbsFor', () => {
  const POSES: Pose[] = ['idle', 'walk', 'climb', 'hang', 'fall', 'dig', 'trapped', 'dead', 'cheer'];
  it('is finite for every pose and phase', () => {
    for (const p of POSES) for (const ph of [0, 0.25, 0.5, 0.75, 1]) {
      for (const v of Object.values(limbsFor(p, ph, 1, ph))) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('walk bends the knee of the leg swinging forward, in time with the legs', () => {
    for (const ph of [0.1, 0.3, 0.6, 0.9]) {
      const j = jointsFor('walk', ph, 1);
      const l = limbsFor('walk', ph, 1);
      expect(l.kneeL).toBeGreaterThanOrEqual(0);
      expect(l.kneeR).toBeGreaterThanOrEqual(0);
      if (Math.abs(j.legL) > 0.2) expect(l.kneeL > l.kneeR).toBe(j.legL > j.legR);
    }
    expect(limbsFor('walk', 0.25, 1).kneeL + limbsFor('walk', 0.25, 1).kneeR).toBeGreaterThan(0.2);
    expect(Math.max(limbsFor('walk', 0.25, 1).elbowL, limbsFor('walk', 0.25, 1).elbowR)).toBeGreaterThan(0);
  });
  it('climb bends both knees and elbows', () => {
    const l = limbsFor('climb', 0.25, 1);
    expect(l.kneeL).toBeGreaterThan(0);
    expect(l.kneeR).toBeGreaterThan(0);
    expect(l.elbowL).toBeGreaterThan(0);
    expect(l.elbowR).toBeGreaterThan(0);
  });
  it('dig bends the swinging arm elbow only', () => {
    const l = limbsFor('dig', 0.1, 1);
    expect(l.elbowR).toBeGreaterThan(0);
    expect(l.elbowL).toBeLessThan(l.elbowR);
  });
  it('idle is near straight', () => {
    for (const v of Object.values(limbsFor('idle', 0.3, 1))) expect(Math.abs(v)).toBeLessThan(0.2);
  });
  it('fall and hang are loose (some bend)', () => {
    for (const p of ['fall', 'hang'] as const) {
      const l = limbsFor(p, 0.25, 1);
      expect(l.elbowL + l.elbowR + l.kneeL + l.kneeR).toBeGreaterThan(0);
    }
  });
  it('dead and cheer follow progress', () => {
    for (const p of ['dead', 'cheer'] as const) {
      const a = limbsFor(p, 0, 1, 0);
      const b = limbsFor(p, 0, 1, 1);
      expect(Object.values(a)).not.toEqual(Object.values(b));
      expect(limbsFor(p, 0, 1, 5)).toEqual(b);
    }
  });
});

describe('blendJoints', () => {
  const a = jointsFor('walk', 0.25, 1);
  const b = jointsFor('dig', 0.5, -1);
  it('returns the ends at t=0 and t=1 and clamps outside', () => {
    expect(blendJoints(a, b, 0)).toEqual(a);
    expect(blendJoints(a, b, 1)).toEqual(b);
    expect(blendJoints(a, b, -3)).toEqual(a);
    expect(blendJoints(a, b, 9)).toEqual(b);
  });
  it('is linear per joint', () => {
    const m = blendJoints(a, b, 0.5);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(m[k]).toBeCloseTo((a[k] + b[k]) / 2, 10);
  });
  it('blends elbows and knees by the same rule', () => {
    const la = limbsFor('walk', 0.25, 1);
    const lb = limbsFor('dig', 0.5, -1);
    expect(blendJoints(la, lb, 0)).toEqual(la);
    expect(blendJoints(la, lb, 1)).toEqual(lb);
    expect(blendJoints(la, lb, 9)).toEqual(lb);
    const m = blendJoints(la, lb, 0.5);
    for (const k of Object.keys(la) as (keyof typeof la)[]) expect(m[k]).toBeCloseTo((la[k] + lb[k]) / 2, 10);
  });
  it('blends over about six ticks', () => {
    expect(POSE_BLEND_TICKS).toBeGreaterThanOrEqual(4);
    expect(POSE_BLEND_TICKS).toBeLessThanOrEqual(8);
  });
});

describe('glanceTurn', () => {
  const hero = { x: 10, y: 5 };
  it('is 0 with no guard in range', () => {
    expect(glanceTurn(hero, [])).toBe(0);
    expect(glanceTurn(hero, [{ x: 19, y: 5 }, { x: 0, y: 5 }])).toBe(0);
  });
  it('turns toward the nearest guard, sign following his side', () => {
    expect(glanceTurn(hero, [{ x: 14, y: 5 }])).toBeGreaterThan(0);
    expect(glanceTurn(hero, [{ x: 6, y: 5 }])).toBeLessThan(0);
    expect(glanceTurn(hero, [{ x: 17, y: 5 }, { x: 8, y: 5 }])).toBeLessThan(0);
  });
  it('is bounded by about 0.6 rad', () => {
    for (const x of [-20, 2, 9, 10, 11, 12, 18]) expect(Math.abs(glanceTurn(hero, [{ x, y: 5 }]))).toBeLessThanOrEqual(0.6);
  });
});
