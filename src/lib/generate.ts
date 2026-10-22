// Endless mode: a level from (seed, level number). Same inputs always give the same level.
import { CAMPAIGN } from './campaign';
import { COLS, ROWS, idx, xOf, yOf, type Level, type Tile } from './level';
import { goldCount, guardCount } from './limits';
import { int, rngFor, shuffle, type Rng } from './rng';
import { effectiveTile, isSolid, supported } from './physics';
import { isSolvable } from './solve';

export const MAX_ATTEMPTS = 50;
const PLATFORM_ROWS = [3, 6, 9, 12];
const FLOOR = ROWS - 1;

export { goldCount, guardCount };

function build(r: Rng, levelNumber: number): Level | null {
  const tiles: Tile[] = Array.from({ length: COLS * ROWS }, () => 'empty');
  for (let x = 0; x < COLS; x++) tiles[idx(x, FLOOR)] = 'stone';

  for (const y of PLATFORM_ROWS) {
    let x = int(r, 0, 3);
    while (x < COLS) {
      const length = int(r, 4, 11);
      for (let i = x; i < Math.min(x + length, COLS); i++) tiles[idx(i, y)] = r() < 0.12 ? 'stone' : 'dirt';
      x += length + int(r, 1, 4);
    }
  }

  for (const top of PLATFORM_ROWS) {
    const columns = shuffle(r, Array.from({ length: COLS }, (_, x) => x).filter((x) => isSolid(tiles[idx(x, top)])));
    if (columns.length < 2) return null;
    for (const x of columns.slice(0, int(r, 2, 3))) {
      for (let y = top; y < FLOOR && (y === top || !isSolid(tiles[idx(x, y)])); y++) tiles[idx(x, y)] = 'ladder';
    }
  }

  for (let n = int(r, 0, 2); n > 0; n--) {
    const y = [4, 7, 10][int(r, 0, 2)];
    const start = int(r, 2, 18);
    for (let x = start; x < start + int(r, 4, 8); x++) {
      if (tiles[idx(x, y)] === 'empty') tiles[idx(x, y)] = 'rope';
    }
  }

  const exitColumns = Array.from({ length: COLS }, (_, x) => x).filter(
    (x) => isSolid(tiles[idx(x, 3)]) && [0, 1, 2].every((y) => tiles[idx(x, y)] === 'empty'),
  );
  if (!exitColumns.length) return null;
  const exitX = exitColumns[int(r, 0, exitColumns.length - 1)];
  for (const y of [0, 1, 2]) tiles[idx(exitX, y)] = 'exit';

  const get = (x: number, y: number): Tile => effectiveTile(tiles, false, x, y);
  const standable = shuffle(
    r,
    tiles
      .map((t, cell) => cell)
      .filter((cell) => {
        return yOf(cell) < FLOOR && tiles[cell] === 'empty' && supported(get, xOf(cell), yOf(cell));
      }),
  );
  const hero = standable.find((cell) => yOf(cell) === FLOOR - 1);
  if (hero === undefined) return null;
  const far = (cell: number): boolean => Math.abs(xOf(cell) - xOf(hero)) + Math.abs(yOf(cell) - yOf(hero)) >= 10;
  const guards = standable.filter((cell) => cell !== hero && far(cell)).slice(0, guardCount(levelNumber));
  const gold = standable.filter((cell) => cell !== hero && !guards.includes(cell)).slice(0, goldCount(levelNumber));
  if (guards.length < guardCount(levelNumber) || gold.length < goldCount(levelNumber)) return null;

  return { tiles, gold, hero, guards };
}

export function generateLevel(seed: string, levelNumber: number): Level {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const level = build(rngFor(seed, levelNumber, attempt), levelNumber);
    if (level && isSolvable(level)) return level;
  }
  return CAMPAIGN[0];
}
