// What to draw for a game state. Pure: the renderer only turns this list into meshes.
import { COLS, ROWS, idx } from './level';
import { poseOfGuard, poseOfHero, type Pose } from './pose';
import { DIG_TICKS, HOLE_TICKS, posOf, tileAt, type GameEvent, type GameState, type Hole } from './state';

export type BlockKind = 'dirt' | 'stone' | 'ladder' | 'rope' | 'gold';
export interface Block { kind: BlockKind; x: number; y: number; scale: number }
export interface Actor {
  kind: 'hero' | 'guard'; x: number; y: number; facing: -1 | 1; carrying: boolean; pose: Pose; phase: number;
}
export interface Effect { kind: 'chunks' | 'puff' | 'sparkle'; x: number; y: number }

export const REFILL_GROW_TICKS = 30;
const DIG_STAGES = [0.75, 0.5, 0.25];

export function sceneOf(s: GameState): { blocks: Block[]; actors: Actor[] } {
  const blocks: Block[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = tileAt(s, x, y);
      if (t === 'dirt' || t === 'stone' || t === 'ladder' || t === 'rope') blocks.push({ kind: t, x, y, scale: 1 });
      else if (t === 'trap') blocks.push({ kind: 'dirt', x, y, scale: 1 });
      if (s.gold[idx(x, y)]) blocks.push({ kind: 'gold', x, y, scale: 1 });
    }
  }
  for (const hole of s.holes) {
    const age = HOLE_TICKS - hole.ticks;
    if (age < DIG_TICKS) {
      blocks.push({ kind: 'dirt', x: hole.x, y: hole.y, scale: DIG_STAGES[Math.floor(age / (DIG_TICKS / 3))] });
    } else if (hole.ticks <= REFILL_GROW_TICKS) {
      blocks.push({ kind: 'dirt', x: hole.x, y: hole.y, scale: 1 - hole.ticks / REFILL_GROW_TICKS });
    }
  }
  const [hx, hy] = posOf(s.hero);
  const actors: Actor[] = [{ kind: 'hero', x: hx, y: hy, facing: s.hero.facing, carrying: false, ...poseOfHero(s) }];
  s.guards.forEach((g, i) => {
    const [gx, gy] = posOf(g);
    actors.push({ kind: 'guard', x: gx, y: gy, facing: g.x < g.fromX ? -1 : 1, carrying: g.gold, ...poseOfGuard(s, i) });
  });
  return { blocks, actors };
}

const sameHole = (a: Hole) => (b: Hole): boolean => a.x === b.x && a.y === b.y;

/** One-off visual effects for the events of a tick. Cells are grid coordinates. */
export function effectsOf(prev: GameState, next: GameState, events: readonly GameEvent[]): Effect[] {
  const out: Effect[] = [];
  if (events.includes('dig')) {
    for (const h of next.holes) if (!prev.holes.some(sameHole(h))) out.push({ kind: 'chunks', x: h.x, y: h.y });
  }
  if (events.includes('refill')) {
    for (const h of prev.holes) if (!next.holes.some(sameHole(h))) out.push({ kind: 'puff', x: h.x, y: h.y });
  }
  if (events.includes('gold')) out.push({ kind: 'sparkle', x: next.hero.x, y: next.hero.y });
  return out;
}
