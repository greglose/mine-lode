import { describe, expect, it } from 'vitest';
import { COLS, ROWS, idx, parseLevel, xOf, yOf } from './level';
import { mk } from './testkit';

const grid = (rows: string[]) => {
  const padded = rows.map((r) => r.padEnd(COLS, '.'));
  const empty = Array.from({ length: ROWS - padded.length }, () => '.'.repeat(COLS));
  return [...empty, ...padded].join('\n');
};

describe('parseLevel', () => {
  it('reads tiles, gold, hero and guards', () => {
    const level = mk(['&.$0H-X', '#@S']);
    expect(level.hero).toBe(idx(0, 14));
    expect(level.gold).toEqual([idx(2, 14)]);
    expect(level.guards).toEqual([idx(3, 14)]);
    expect(level.tiles[idx(4, 14)]).toBe('ladder');
    expect(level.tiles[idx(5, 14)]).toBe('rope');
    expect(level.tiles[idx(6, 14)]).toBe('trap');
    expect(level.tiles[idx(0, 15)]).toBe('dirt');
    expect(level.tiles[idx(1, 15)]).toBe('stone');
    expect(level.tiles[idx(2, 15)]).toBe('exit');
    expect(level.tiles[idx(0, 14)]).toBe('empty');
    expect(level.tiles.length).toBe(COLS * ROWS);
  });

  it('accepts a trailing newline and Windows line endings', () => {
    expect(() => parseLevel(grid(['&$']).replace(/\n/g, '\r\n') + '\r\n')).not.toThrow();
  });

  it('converts between index and coordinates', () => {
    expect(xOf(idx(5, 3))).toBe(5);
    expect(yOf(idx(5, 3))).toBe(3);
  });

  it.each([
    ['too few rows', '&$', /16 rows/],
    ['a short row', grid(['&$']).slice(0, -1), /row 15 has 27/],
    ['an unknown symbol', grid(['&$?']), /unknown symbol "\?" at row 15, column 2/],
    ['no hero', grid(['$']), /exactly one hero/],
    ['two heroes', grid(['&&$']), /exactly one hero/],
    ['no gold', grid(['&']), /at least one gold/],
    ['too much gold', grid(['&' + '$'.repeat(13)]), /at most 12 gold/],
    ['too many guards', grid(['&$' + '0'.repeat(6)]), /at most 5 guards/],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseLevel(text)).toThrow(message);
    expect(() => parseLevel(text)).toThrow(/^Level invalid:/);
  });
});
