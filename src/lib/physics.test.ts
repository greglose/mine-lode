import { describe, expect, it } from 'vitest';
import { COLS, ROWS, idx, type Level } from './level';
import { canClimbDown, canClimbUp, canDig, canStep, effectiveTile, isSolid, supported, walkMoves, type TileGetter } from './physics';
import { mk } from './testkit';

const getter = (level: Level): TileGetter => (x, y) => {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 'stone';
  const t = level.tiles[idx(x, y)];
  return t === 'exit' ? 'empty' : t;
};

describe('isSolid', () => {
  it('is true only for dirt and stone', () => {
    expect(['dirt', 'stone'].every((t) => isSolid(t as never))).toBe(true);
    expect(['empty', 'ladder', 'rope', 'trap'].some((t) => isSolid(t as never))).toBe(false);
  });
});

describe('supported', () => {
  const get = getter(mk(['...H-', '&$.H.X', '##...X']));
  it('holds on solid ground, the bottom row, a ladder and a rope', () => {
    expect(supported(get, 0, 14)).toBe(true); // dirt below
    expect(supported(get, 2, 15)).toBe(true); // bottom row
    expect(supported(get, 3, 13)).toBe(true); // on a ladder
    expect(supported(get, 4, 13)).toBe(true); // on a rope
    expect(supported(get, 3, 12)).toBe(true); // standing on a ladder top
  });
  it('fails over empty space and over a trapdoor', () => {
    expect(supported(get, 2, 13)).toBe(false);
    expect(supported(get, 5, 13)).toBe(false); // trap below
  });
  it('counts the extra predicate as ground', () => {
    expect(supported(get, 2, 13, (x, y) => x === 2 && y === 14)).toBe(true);
  });
});

describe('walkMoves', () => {
  const get = getter(mk(['...H', '&$.H', '####']));
  it('only falls when unsupported', () => {
    expect(walkMoves(get, 2, 12)).toEqual([[2, 13]]);
  });
  it('walks left and right but not into solid tiles or off the grid', () => {
    expect(walkMoves(get, 0, 14)).toEqual([[1, 14]]);
  });
  it('climbs up a ladder and steps down onto one', () => {
    expect(walkMoves(get, 3, 14)).toContainEqual([3, 13]);
    expect(walkMoves(get, 3, 12)).toContainEqual([3, 13]);
  });
});

describe('effectiveTile', () => {
  const level = mk(['&$S']);
  it('treats out of bounds as stone', () => {
    for (const [x, y] of [[-1, 0], [COLS, 0], [0, -1], [0, ROWS]]) expect(effectiveTile(level.tiles, false, x, y)).toBe('stone');
  });
  it('turns the exit into a ladder only when open', () => {
    expect(effectiveTile(level.tiles, false, 2, 15)).toBe('empty');
    expect(effectiveTile(level.tiles, true, 2, 15)).toBe('ladder');
    expect(effectiveTile(level.tiles, false, 0, 15)).toBe('empty');
  });
});

describe('step rules', () => {
  const get = getter(mk(['&$H.@', '.#...', '#####']));
  it('canStep refuses edges and solid cells', () => {
    expect(canStep(get, 0, 13, -1)).toBe(false);
    expect(canStep(get, 0, 13, 1)).toBe(true);
    expect(canStep(get, COLS - 1, 13, 1)).toBe(false);
    expect(canStep(get, 3, 13, 1)).toBe(false);
  });
  it('canClimbUp needs a ladder here and a free cell above', () => {
    expect(canClimbUp(get, 2, 13)).toBe(true);
    expect(canClimbUp(get, 1, 13)).toBe(false);
    expect(canClimbUp(get, 2, 14)).toBe(false);
  });
  it('canClimbDown needs a non-solid cell below, inside the grid', () => {
    expect(canClimbDown(get, 0, 13)).toBe(true);
    expect(canClimbDown(get, 1, 13)).toBe(false);
    expect(canClimbDown(get, 0, ROWS - 1)).toBe(false);
  });
});

describe('canDig', () => {
  const get = getter(mk(['&$...', '#####']));
  const none = () => false;
  it('needs dirt with an empty, goldless cell above', () => {
    expect(canDig(get, none, 1, 15)).toBe(true);
    expect(canDig(get, (x, y) => x === 1 && y === 14, 1, 15)).toBe(false);
    expect(canDig(get, none, 1, 14)).toBe(false);
  });
  it('refuses out of bounds', () => {
    expect(canDig(get, none, -1, 15)).toBe(false);
    expect(canDig(get, none, COLS, 15)).toBe(false);
    expect(canDig(get, none, 1, ROWS)).toBe(false);
  });
});
