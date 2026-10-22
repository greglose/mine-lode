// Proves a level can be finished with no guards: all gold, then the top row.
import { COLS, ROWS, idx, xOf, yOf, type Level } from './level';
import { canDig, effectiveTile, isSolid, supported, walkMoves, type TileGetter } from './physics';

export function isSolvable(level: Level): boolean {
  const cells = COLS * ROWS;
  const full = (1 << level.gold.length) - 1;
  const bitAt = new Map(level.gold.map((cell, i) => [cell, 1 << i]));
  const getter = (open: boolean): TileGetter => (x, y) => effectiveTile(level.tiles, open, x, y);
  const shut = getter(false);
  const open = getter(true);

  const seen = new Uint8Array(cells * (full + 1));
  const queue: number[] = [];
  const visit = (cell: number, mask: number): void => {
    const next = mask | (bitAt.get(cell) ?? 0);
    const key = next * cells + cell;
    if (!seen[key]) {
      seen[key] = 1;
      queue.push(key);
    }
  };
  visit(level.hero, 0);

  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const cell = key % cells;
    const mask = (key - cell) / cells;
    const x = xOf(cell);
    const y = yOf(cell);
    if (mask === full && y === 0) return true;
    const get = mask === full ? open : shut;
    for (const [nx, ny] of walkMoves(get, x, y)) visit(idx(nx, ny), mask);
    if (!supported(get, x, y)) continue;
    for (const d of [-1, 1]) {
      const tx = x + d;
      if (y + 2 >= ROWS) continue;
      const hasGold = (cx: number, cy: number): boolean => ((bitAt.get(idx(cx, cy)) ?? 0) & ~mask) !== 0;
      if (canDig(get, hasGold, tx, y + 1) && !isSolid(get(tx, y + 2))) {
        visit(idx(tx, y + 2), mask);
      }
    }
  }
  return false;
}
