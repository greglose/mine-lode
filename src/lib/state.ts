// Game state for one level. Plain data: safe to JSON-compare in tests.
import { idx, xOf, yOf, type Level, type Tile } from './level';
import { effectiveTile, type TileGetter } from './physics';

export const HERO_TICKS = 8;
export const GUARD_TICKS = 12;
export const FALL_TICKS = 5;
export const DIG_TICKS = 12;
export const HOLE_TICKS = 480;
export const TRAP_TICKS = 240;
/** Ticks a guard stays trapped before retrying when both sides of the hole are blocked. */
export const TRAP_RETRY_TICKS = 30;

export const SCORE_GOLD = 250;
export const SCORE_TRAP = 75;
export const SCORE_KILL = 75;
export const SCORE_CLEAR = 1500;

/**
 * (x, y) is the destination cell. While t > 0 the mover is on its way there from (fromX, fromY).
 * `falling` is set by the simulation when a fall begins (the mover is not supported) and cleared once it is.
 */
export interface Mover { x: number; y: number; fromX: number; fromY: number; t: number; total: number; falling: boolean }
export interface Hero extends Mover { facing: -1 | 1 }
export interface Guard extends Mover { gold: boolean; trapped: number }
export interface Hole { x: number; y: number; ticks: number }
export type Status = 'playing' | 'dead' | 'won';

export interface GameState {
  tiles: Tile[];
  gold: boolean[];
  /** Gold on the ground plus gold carried by guards. */
  goldLeft: number;
  hero: Hero;
  guards: Guard[];
  holes: Hole[];
  exitOpen: boolean;
  status: Status;
  tick: number;
  score: number;
}

export interface Input { dx: -1 | 0 | 1; dy: -1 | 0 | 1; dig: -1 | 0 | 1 }
export const NO_INPUT: Input = { dx: 0, dy: 0, dig: 0 };

export type GameEvent =
  | 'step' | 'climb' | 'dig' | 'refill' | 'gold' | 'allGold' | 'land'
  | 'guardTrapped' | 'guardKilled' | 'guardRespawn' | 'death' | 'levelClear';

const at = (cell: number): Mover => ({ x: xOf(cell), y: yOf(cell), fromX: xOf(cell), fromY: yOf(cell), t: 0, total: 0, falling: false });

export function initState(level: Level): GameState {
  const gold = level.tiles.map(() => false);
  for (const cell of level.gold) gold[cell] = true;
  return {
    tiles: [...level.tiles],
    gold,
    goldLeft: level.gold.length,
    hero: { ...at(level.hero), facing: 1 },
    guards: level.guards.map((cell) => ({ ...at(cell), gold: false, trapped: 0 })),
    holes: [],
    exitOpen: false,
    status: 'playing',
    tick: 0,
    score: 0,
  };
}

/** Effective tile: out of bounds is stone; the exit is a ladder once open, empty before. */
export const tileAt = (s: GameState, x: number, y: number): Tile => effectiveTile(s.tiles, s.exitOpen, x, y);

export const getterOf = (s: GameState): TileGetter => (x, y) => tileAt(s, x, y);

/** Position in cell units, interpolated along the current move. */
export function posOf(m: Mover): [number, number] {
  const k = m.total > 0 ? m.t / m.total : 0;
  return [m.x + (m.fromX - m.x) * k, m.y + (m.fromY - m.y) * k];
}

export function begin(m: Mover, x: number, y: number, ticks: number): void {
  m.fromX = m.x;
  m.fromY = m.y;
  m.x = x;
  m.y = y;
  m.t = ticks;
  m.total = ticks;
}
