// Movement rules shared by the simulation, the guard chase and the solver.
import { COLS, ROWS, idx, type Tile } from './level';

/** Returns the effective tile. Out of bounds is 'stone'. Never returns 'exit'. */
export type TileGetter = (x: number, y: number) => Tile;
export type CellTest = (x: number, y: number) => boolean;

export const isSolid = (t: Tile): boolean => t === 'dirt' || t === 'stone';

/** True when something at (x, y) does not fall. `extra` marks cells that also count as ground. */
export function supported(get: TileGetter, x: number, y: number, extra?: CellTest): boolean {
  const here = get(x, y);
  if (here === 'ladder' || here === 'rope') return true;
  if (y === ROWS - 1) return true;
  const below = get(x, y + 1);
  return isSolid(below) || below === 'ladder' || Boolean(extra?.(x, y + 1));
}

/** Effective tile: out of bounds is stone; the exit is a ladder once open, empty before. */
export function effectiveTile(tiles: readonly Tile[], exitOpen: boolean, x: number, y: number): Tile {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 'stone';
  const t = tiles[idx(x, y)];
  if (t === 'exit') return exitOpen ? 'ladder' : 'empty';
  return t;
}

/** A sideways step of dx is open. */
export const canStep = (get: TileGetter, x: number, y: number, dx: number): boolean => {
  const nx = x + dx;
  return nx >= 0 && nx < COLS && !isSolid(get(nx, y));
};

/** The mover is on a ladder with room above. */
export const canClimbUp = (get: TileGetter, x: number, y: number): boolean =>
  get(x, y) === 'ladder' && y > 0 && !isSolid(get(x, y - 1));

/** The cell below is inside the grid and not solid. */
export const canClimbDown = (get: TileGetter, x: number, y: number): boolean =>
  y < ROWS - 1 && !isSolid(get(x, y + 1));

/**
 * (x, y) is the tile to dig: inside the grid, dirt, with an empty cell above it that holds no gold.
 * `hasGold` says whether a cell holds loose gold.
 */
export function canDig(get: TileGetter, hasGold: CellTest, x: number, y: number): boolean {
  if (x < 0 || x >= COLS || y < 1 || y >= ROWS) return false;
  return get(x, y) === 'dirt' && get(x, y - 1) === 'empty' && !hasGold(x, y - 1);
}

/** Cells reachable in one move without digging. An unsupported mover can only fall. */
export function walkMoves(get: TileGetter, x: number, y: number, extra?: CellTest): [number, number][] {
  if (!supported(get, x, y, extra)) return [[x, y + 1]];
  const out: [number, number][] = [];
  for (const dx of [-1, 1]) if (canStep(get, x, y, dx)) out.push([x + dx, y]);
  if (canClimbUp(get, x, y)) out.push([x, y - 1]);
  if (canClimbDown(get, x, y)) out.push([x, y + 1]);
  return out;
}
