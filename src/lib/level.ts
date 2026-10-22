// Level format for Mine Lode: a 28x16 text grid, row 0 at the top.
export const COLS = 28;
export const ROWS = 16;
export const MAX_GOLD = 12;
export const MAX_GUARDS = 5;

export type Tile = 'empty' | 'dirt' | 'stone' | 'ladder' | 'rope' | 'trap' | 'exit';

export interface Level {
  tiles: Tile[];
  /** Cell indices holding gold at the start. */
  gold: number[];
  hero: number;
  guards: number[];
}

export const idx = (x: number, y: number): number => y * COLS + x;
export const xOf = (i: number): number => i % COLS;
export const yOf = (i: number): number => Math.floor(i / COLS);

const TILES: Record<string, Tile> = {
  '.': 'empty', '#': 'dirt', '@': 'stone', H: 'ladder', '-': 'rope', X: 'trap', S: 'exit',
  $: 'empty', '&': 'empty', '0': 'empty',
};

const fail = (why: string): never => {
  throw new Error(`Level invalid: ${why}`);
};

export function parseLevel(text: string): Level {
  const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  if (rows.length !== ROWS) fail(`expected ${ROWS} rows, found ${rows.length}`);
  const tiles: Tile[] = [];
  const gold: number[] = [];
  const guards: number[] = [];
  const heroes: number[] = [];
  rows.forEach((row, y) => {
    if (row.length !== COLS) fail(`row ${y} has ${row.length} columns, expected ${COLS}`);
    [...row].forEach((ch, x) => {
      const tile = TILES[ch];
      if (!tile) fail(`unknown symbol "${ch}" at row ${y}, column ${x}`);
      tiles.push(tile);
      if (ch === '$') gold.push(idx(x, y));
      if (ch === '0') guards.push(idx(x, y));
      if (ch === '&') heroes.push(idx(x, y));
    });
  });
  if (heroes.length !== 1) fail(`needs exactly one hero start, found ${heroes.length}`);
  if (gold.length < 1) fail('needs at least one gold');
  if (gold.length > MAX_GOLD) fail(`allows at most ${MAX_GOLD} gold, found ${gold.length}`);
  if (guards.length > MAX_GUARDS) fail(`allows at most ${MAX_GUARDS} guards, found ${guards.length}`);
  return { tiles, gold, hero: heroes[0], guards };
}
