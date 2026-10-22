import { describe, expect, it } from 'vitest';
import { isSolvable } from './solve';
import { mk } from './testkit';

const above = (n: number, row: string) => Array.from({ length: n }, () => row);

describe('isSolvable', () => {
  it('accepts a level where gold and exit are both reachable', () => {
    expect(isSolvable(mk([...above(15, '..S'), '&$S']))).toBe(true);
  });
  it('rejects a level with no way to the top row', () => {
    expect(isSolvable(mk(['&$']))).toBe(false);
  });
  it('rejects a level with gold on an unreachable ledge', () => {
    expect(isSolvable(mk([...above(13, 'S'), 'S..$', 'S..#', 'S&..']))).toBe(false);
  });
  it('accepts a level that needs a ladder', () => {
    expect(isSolvable(mk([...above(13, 'S'), 'S..$', 'S.H#', 'S&H.']))).toBe(true);
  });
  it('accepts a level that needs a dig to drop through a floor', () => {
    const rows = [...above(12, '......S'), '@&..@.S', '@###@.S', '@.$...S', '@@@@@@S'];
    expect(isSolvable(mk(rows))).toBe(true);
  });
  it('rejects the same level when the floor is stone', () => {
    const rows = [...above(12, '......S'), '@&..@.S', '@@@@@.S', '@.$...S', '@@@@@@S'];
    expect(isSolvable(mk(rows))).toBe(false);
  });
  it('lets the hero fall through a trapdoor', () => {
    const rows = [...above(12, '......S'), '@&..@.S', '@#X#@.S', '@.$...S', '@@@@@@S'];
    expect(isSolvable(mk(rows))).toBe(true);
  });
  it('does not open the exit before all gold is collected', () => {
    // The only way to the second gold is to climb the exit column, which is shut until it is collected.
    expect(isSolvable(mk([...above(13, 'S'), 'S$', 'S#', 'S&$']))).toBe(false);
  });
  it('handles the maximum gold count quickly', () => {
    const started = performance.now();
    expect(isSolvable(mk([...above(15, '.............S'), '&$$$$$$$$$$$$S']))).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
