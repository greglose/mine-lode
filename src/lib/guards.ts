// Guard pursuit: the classic rating rule, deliberately not shortest-path. Its quirks are intended:
// guards can be lured, dither at a ladder base, prefer the left on ties, and walk into dug holes.
import { idx } from './level';
import { canClimbDown, canClimbUp, canStep, supported, type TileGetter } from './physics';
import { tileAt, type GameState } from './state';

type Cell = [number, number];

/** Lower is better: the runner's row by column distance, then rows above it, then rows below it. */
export const rowRating = (runnerRow: number, runnerCol: number, row: number, col: number): number => {
  if (row === runnerRow) return Math.abs(col - runnerCol);
  return row < runnerRow ? 100 + (runnerRow - row) : 200 + (row - runnerRow);
};

/** Guards do not see holes: an open hole looks like the dirt it was. */
function guardView(s: GameState): TileGetter {
  const holes = new Set(s.holes.map((h) => idx(h.x, h.y)));
  return (x, y) => {
    const t = tileAt(s, x, y);
    return t === 'empty' && holes.has(idx(x, y)) ? 'dirt' : t;
  };
}

/** Rule 1: every cell from the guard to the runner can be walked, and each one in between holds a guard up. */
function clearWalk(get: TileGetter, gx: number, gy: number, hx: number): boolean {
  const dx = Math.sign(hx - gx);
  for (let x = gx; x !== hx; x += dx) {
    if (!canStep(get, x, gy, dx)) return false;
    if (x + dx !== hx && !supported(get, x + dx, gy)) return false;
  }
  return true;
}

/** Best rating among the resting places on the way down from (x, y): climbing down, or falling. */
function bestBelow(get: TileGetter, x: number, y: number, rate: (row: number, col: number) => number): number {
  let best = Infinity;
  for (let cy = y; canClimbDown(get, x, cy); ) {
    cy++;
    if (supported(get, x, cy)) best = Math.min(best, rate(cy, x));
  }
  return best;
}

/** Best rating among the rows reached climbing up the ladder at (x, y). */
function bestAbove(get: TileGetter, x: number, y: number, rate: (row: number, col: number) => number): number {
  let best = Infinity;
  for (let cy = y; canClimbUp(get, x, cy); ) best = Math.min(best, rate(--cy, x));
  return best;
}

/** The farthest column the guard can walk to along row y: stops at a block, the edge, or the first drop point. */
function reach(get: TileGetter, x: number, y: number, dx: number): number {
  let cx = x;
  while (canStep(get, cx, y, dx)) {
    cx += dx;
    if (!supported(get, cx, y)) break;
  }
  return cx;
}

/** The adjacent cell the guard moves to next, or its own cell to stay. */
export function nextGuardCell(s: GameState, guardIndex: number): Cell {
  const g = s.guards[guardIndex];
  const { x: gx, y: gy } = g;
  const { x: hx, y: hy } = s.hero;
  if (gx === hx && gy === hy) return [gx, gy];
  const get = guardView(s);

  // Rule 1: same row with a clear walk: step toward the runner.
  if (gy === hy && clearWalk(get, gx, gy, hx)) return [gx + Math.sign(hx - gx), gy];

  // Rule 2: take the candidate with the lowest rating; a tie keeps the earlier one.
  const rate = (row: number, col: number): number => rowRating(hy, hx, row, col);
  let bestRating = Infinity;
  let bestMove: Cell = [gx, gy];
  const offer = (rating: number, move: Cell): void => {
    if (rating < bestRating) {
      bestRating = rating;
      bestMove = move;
    }
  };

  offer(bestBelow(get, gx, gy, rate), [gx, gy + 1]);
  offer(bestAbove(get, gx, gy, rate), [gx, gy - 1]);
  for (const dx of [-1, 1]) {
    const move: Cell = [gx + dx, gy];
    for (let c = reach(get, gx, gy, dx); c !== gx; c -= dx) {
      offer(bestBelow(get, c, gy, rate), move);
      offer(bestAbove(get, c, gy, rate), move);
      offer(rate(gy, c), move);
    }
  }
  // Rule 3: one step toward the chosen candidate.
  return bestMove;
}
