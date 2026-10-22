import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TICK_HZ } from './clock';
import { act, I, mk } from './testkit';
import { SCORE_CLEAR, SCORE_GOLD, SCORE_KILL, SCORE_TRAP, TRAP_TICKS, initState } from './state';
import { CAMPAIGN_GOLD, CAMPAIGN_GUARDS, goldCount, guardCount } from './limits';
import {
  BLOCKED_NAMES, BOARD_SIZE, FARM_POINTS, FARM_WINDOW_MS, MIN_MS_PER_LEVEL, NAME_PATTERN, checkPlausible,
  insertRow, maxPlausibleScore, minElapsedMs, qualifies, rank, validName, validateSubmission,
  type ScoreRow, type Submission,
} from './scores';
import {
  dayKey, findRow, initialsOrDefault, isDeviceRow, isMode, isScoreRow, needsInitials,SCORES_PATH, SCORES_START_PATH, scoreCells, scoreColumns, scoreEntry,
  setInitial, stepInitial,
} from './scores';

const row = (score: number, date = '2026-01-01', name = 'AAA'): ScoreRow => ({ name, score, level: 1, seed: '', date });
const sub = (over: Record<string, unknown> = {}): unknown => ({
  mode: 'campaign', name: 'ABC', score: 1000, level: 3, cleared: 2, seed: '', ...over,
});
const okSub = (over: Record<string, unknown> = {}): Submission => {
  const r = validateSubmission(sub(over));
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('validName', () => {
  it('accepts three capitals', () => {
    expect(validName('ABC')).toBe(true);
    expect(NAME_PATTERN.test('XYZ')).toBe(true);
  });
  it.each(['abc', 'AB', 'ABCD', 'A1C', 'A C', '', 'ÅBC'])('rejects %j', (n) => expect(validName(n)).toBe(false));
  it('rejects every blocklisted combination', () => {
    expect(BLOCKED_NAMES.length).toBeGreaterThan(0);
    for (const n of BLOCKED_NAMES) {
      expect(NAME_PATTERN.test(n), n).toBe(true);
      expect(validName(n), n).toBe(false);
    }
  });
});

describe('rank, qualifies, insertRow', () => {
  it('sorts by score then earlier date, cut to the board size', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(i * 10));
    const out = rank(rows);
    expect(out).toHaveLength(BOARD_SIZE);
    expect(out[0].score).toBe(140);
    expect(rank([row(5, '2026-02-01', 'LAT'), row(5, '2026-01-01', 'EAR')]).map((r) => r.name)).toEqual(['EAR', 'LAT']);
  });
  it('does not mutate its input', () => {
    const rows = [row(1), row(2)];
    rank(rows);
    expect(rows.map((r) => r.score)).toEqual([1, 2]);
  });
  it('never qualifies a zero', () => {
    expect(qualifies([], 0)).toBe(false);
    expect(qualifies([], 1)).toBe(true);
  });
  it('qualifies on a short table, and above the lowest on a full one', () => {
    const full = Array.from({ length: BOARD_SIZE }, (_, i) => row(100 + i));
    expect(qualifies(full.slice(0, 9), 1)).toBe(true);
    expect(qualifies(full, 100)).toBe(false);
    expect(qualifies(full, 101)).toBe(true);
  });
  it('inserts and keeps the table ranked and cut', () => {
    const full = Array.from({ length: BOARD_SIZE }, (_, i) => row(100 + i));
    const out = insertRow(full, row(500, '2026-03-03', 'NEW'));
    expect(out).toHaveLength(BOARD_SIZE);
    expect(out[0].name).toBe('NEW');
    expect(out.some((r) => r.score === 100)).toBe(false);
  });
});

describe('validateSubmission', () => {
  it('accepts a good campaign and endless submission', () => {
    expect(okSub()).toEqual({ mode: 'campaign', name: 'ABC', score: 1000, level: 3, cleared: 2, seed: '' });
    expect(okSub({ mode: 'endless', seed: 'moon', level: 9, cleared: 8 }).seed).toBe('moon');
  });
  it('accepts a seed of exactly 32 characters', () => {
    expect(validateSubmission(sub({ mode: 'endless', seed: 'x'.repeat(32) })).ok).toBe(true);
  });
  it('accepts a completed campaign: cleared equals level 20', () => {
    expect(validateSubmission(sub({ level: 20, cleared: 20 })).ok).toBe(true);
    expect(validateSubmission(sub({ mode: 'endless', level: 20, cleared: 20 })).ok).toBe(false);
  });
  it.each([
    ['null', null], ['an array', []], ['a string', 'x'], ['a number', 4], ['undefined', undefined],
    ['missing mode', sub({ mode: undefined })], ['unknown mode', sub({ mode: 'speed' })],
    ['missing name', sub({ name: undefined })], ['lowercase name', sub({ name: 'abc' })],
    ['blocked name', sub({ name: BLOCKED_NAMES[0] })],
    ['missing score', sub({ score: undefined })], ['float score', sub({ score: 10.5 })],
    ['negative score', sub({ score: -1 })], ['zero score', sub({ score: 0 })],
    ['string score', sub({ score: '10' })], ['NaN score', sub({ score: Number.NaN })],
    ['float level', sub({ level: 2.5 })], ['negative level', sub({ level: -1 })], ['zero level', sub({ level: 0 })],
    ['campaign level 21', sub({ level: 21, cleared: 20 })],
    ['float cleared', sub({ cleared: 1.5 })], ['negative cleared', sub({ level: 1, cleared: -1 })],
    ['cleared too small', sub({ level: 5, cleared: 1 })], ['cleared too big', sub({ level: 3, cleared: 3 })],
    ['cleared over 20', sub({ level: 22, cleared: 21 })],
    ['33-character seed', sub({ mode: 'endless', seed: 'x'.repeat(33) })],
    ['seed on a campaign row', sub({ seed: 'abc' })], ['non-string seed', sub({ seed: 5 })],
  ])('rejects %s with an error string', (_n, input) => {
    const r = validateSubmission(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe('plausibility', () => {
  it('minElapsedMs is per level cleared', () => {
    expect(minElapsedMs(0)).toBe(0);
    expect(minElapsedMs(3)).toBe(3 * MIN_MS_PER_LEVEL);
  });
  it('ceiling grows with elapsed time and with levels cleared', () => {
    const a = maxPlausibleScore('campaign', 5, 1, 60_000);
    expect(maxPlausibleScore('campaign', 5, 1, 120_000)).toBeGreaterThan(a);
    expect(maxPlausibleScore('campaign', 6, 1, 60_000)).toBeGreaterThan(a);
    const e = maxPlausibleScore('endless', 5, 1, 60_000);
    expect(maxPlausibleScore('endless', 6, 1, 60_000)).toBeGreaterThan(e);
    expect(maxPlausibleScore('endless', 5, 1, 120_000)).toBeGreaterThan(e);
  });
  it('computes the campaign ceiling from the level table', () => {
    let gold = 0;
    for (let i = 0; i < 2; i++) gold += CAMPAIGN_GOLD[i] * SCORE_GOLD + SCORE_CLEAR;
    gold += CAMPAIGN_GOLD[2] * SCORE_GOLD; // level in progress
    const guards = Math.max(...CAMPAIGN_GUARDS.slice(0, 3));
    expect(maxPlausibleScore('campaign', 2, 0, 9_999)).toBe(gold + FARM_POINTS * guards * 2);
    expect(FARM_WINDOW_MS).toBe(Math.round((TRAP_TICKS / TICK_HZ) * 1000));
  });
  it('computes the endless ceiling from the generator formulas', () => {
    const gold = goldCount(1) * SCORE_GOLD + SCORE_CLEAR + goldCount(2) * SCORE_GOLD;
    const guards = Math.max(guardCount(1), guardCount(2));
    expect(maxPlausibleScore('endless', 1, 0, 8_000)).toBe(gold + FARM_POINTS * guards * 2);
  });
  it('lets a believable score pass and one point over the ceiling fail', () => {
    const s = okSub({ score: 1000 });
    const elapsed = 120_000;
    expect(checkPlausible(s, elapsed)).toEqual({ ok: true });
    const ceiling = maxPlausibleScore('campaign', s.cleared, CAMPAIGN_GUARDS[s.level - 1], elapsed);
    expect(checkPlausible({ ...s, score: ceiling }, elapsed).ok).toBe(true);
    const over = checkPlausible({ ...s, score: ceiling + 1 }, elapsed);
    expect(over.ok).toBe(false);
  });
  it('fails a too-fast post with the time error, distinct from the score error', () => {
    const s = okSub();
    const fast = checkPlausible(s, minElapsedMs(s.cleared) - 1);
    const high = checkPlausible({ ...s, score: 9_999_999 }, 600_000);
    expect(fast.ok).toBe(false);
    expect(high.ok).toBe(false);
    if (!fast.ok && !high.ok) expect(fast.error).not.toBe(high.error);
  });
  it('checks time before score', () => {
    const s = okSub({ score: 9_999_999 });
    const r = checkPlausible(s, 0);
    const t = checkPlausible(okSub(), 0);
    expect(r).toEqual(t);
  });
});

describe('isScoreRow', () => {
  const good = { name: 'ABC', score: 10, level: 2, seed: '', date: '2026-10-13' };
  it('accepts a device row and a server row with a time', () => {
    expect(isScoreRow(good)).toBe(true);
    expect(isScoreRow({ ...good, date: '2026-10-13T08:30:00.000Z' })).toBe(true);
    expect(isScoreRow({ ...good, date: '2026-10-13 08:30:00' })).toBe(true);
  });
  it('rejects every bad field', () => {
    for (const bad of [
      null, 'x', [], { ...good, name: 'abc' }, { ...good, name: 'ASS' }, { ...good, score: 0 }, { ...good, score: 1.5 },
      { ...good, level: '2' }, { ...good, seed: 5 }, { ...good, seed: 'x'.repeat(33) }, { ...good, date: 'yesterday' },
      { ...good, date: undefined },
    ]) expect(isScoreRow(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('initials stepping', () => {
  it('moves a letter up and down and wraps at both ends', () => {
    expect(stepInitial('A', 1)).toBe('B');
    expect(stepInitial('B', -1)).toBe('A');
    expect(stepInitial('Z', 1)).toBe('A');
    expect(stepInitial('A', -1)).toBe('Z');
  });
  it('steps one slot of a three-letter string', () => {
    expect(setInitial('AAA', 1, 'q')).toBe('AQA');
    expect(setInitial('AAA', 2, 'Z')).toBe('AAZ');
    expect(setInitial('AAA', 5, 'Z')).toBe('AAA');
    expect(setInitial('AAA', 0, '7')).toBe('AAA');
    expect(initialsOrDefault('')).toBe('AAA');
    expect(initialsOrDefault('XYZ')).toBe('XYZ');
  });
});

describe('needsInitials', () => {
  const full = Array.from({ length: BOARD_SIZE }, (_, i) => row(1000 - i));
  it('asks when the score enters the device table or the last-fetched shared table', () => {
    expect(needsInitials([], null, 50)).toBe(true);
    expect(needsInitials(full, null, 5)).toBe(false);
    expect(needsInitials(full, [], 5)).toBe(true);
    expect(needsInitials(full, full, 5)).toBe(false);
    expect(needsInitials(full, full, 5000)).toBe(true);
  });
  it('never asks for a zero score', () => {
    expect(needsInitials([], [], 0)).toBe(false);
  });
});

describe('scoreEntry', () => {
  const s = { mode: 'campaign' as const, level: 4, score: 900, seed: '' };
  it('builds a pending row with levels cleared one below the level reached', () => {
    expect(scoreEntry(s, false, '2026-10-13')).toEqual({
      mode: 'campaign', cleared: 3, row: { name: '', score: 900, level: 4, seed: '', date: '2026-10-13' },
    });
  });
  it('counts every campaign level as cleared when the campaign is finished', () => {
    expect(scoreEntry({ ...s, level: 20 }, true, '2026-10-13')?.cleared).toBe(20);
  });
  it('keeps the seed for endless and drops it for campaign', () => {
    expect(scoreEntry({ ...s, mode: 'endless', seed: 'abc' }, false, 'd')?.row.seed).toBe('abc');
    expect(scoreEntry({ ...s, seed: 'abc' }, false, 'd')?.row.seed).toBe('');
  });
  it('records nothing for a zero score', () => {
    expect(scoreEntry({ ...s, score: 0 }, false, 'd')).toBeNull();
  });
});

describe('table cells', () => {
  const r: ScoreRow = { name: 'ABC', score: 1200, level: 3, seed: 'moon', date: '2026-10-13T08:30:00.000Z' };
  it('lists columns, with a seed column for endless only', () => {
    expect(scoreColumns('campaign')).toEqual(['Rank', 'Initials', 'Score', 'Level', 'Date']);
    expect(scoreColumns('endless')).toEqual(['Rank', 'Initials', 'Score', 'Level', 'Seed', 'Date']);
  });
  it('turns a row into cell text matching the columns', () => {
    expect(scoreCells('campaign', r, 0)).toEqual(['1', 'ABC', '1200', '3', '2026-10-13']);
    expect(scoreCells('endless', r, 4)).toEqual(['5', 'ABC', '1200', '3', 'moon', '2026-10-13']);
  });
  it('finds the row to highlight by what the player sent', () => {
    const rows = [row(5, '2026-01-01', 'ZZZ'), { ...r, date: '2026-10-13' }];
    expect(findRow(rows, r)).toBe(1);
    expect(findRow(rows, { ...r, score: 7 })).toBe(-1);
  });
  it('makes a local day key', () => {
    expect(dayKey(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });
});

describe('row date modes', () => {
  const good = { name: 'ABC', score: 10, level: 2, seed: '', date: '2026-10-13' };
  const stamped = { ...good, date: '2026-10-13T08:30:00.000Z' };
  it('a day key passes both; a timestamp passes only the shared form', () => {
    expect(isDeviceRow(good)).toBe(true);
    expect(isScoreRow(good)).toBe(true);
    expect(isScoreRow(stamped)).toBe(true);
    expect(isDeviceRow(stamped)).toBe(false);
  });
  it('a bad name, zero score, float level or 33-character seed fail both', () => {
    for (const bad of [{ ...good, name: 'abc' }, { ...good, score: 0 }, { ...good, level: 1.5 }, { ...good, seed: 'x'.repeat(33) }]) {
      expect(isDeviceRow(bad), JSON.stringify(bad)).toBe(false);
      expect(isScoreRow(bad), JSON.stringify(bad)).toBe(false);
    }
  });
  it('names the modes and paths once', () => {
    expect(isMode('endless')).toBe(true);
    expect(isMode('x')).toBe(false);
    expect([SCORES_PATH, SCORES_START_PATH]).toEqual(['/api/scores', '/api/scores/start']);
  });
});

describe('point values come from the simulation', () => {
  it('imports the point values rather than retyping them', () => {
    const src = readFileSync(join(__dirname, 'scores.ts'), 'utf-8');
    expect(src).toMatch(/from '\.\/state'/);
    expect(src).not.toMatch(/=\s*(250|1500|150|4000)\b/);
  });
  it('derives the farm values from the simulation constants', () => {
    expect(FARM_POINTS).toBe(SCORE_TRAP + SCORE_KILL);
    expect(FARM_WINDOW_MS).toBe(Math.round((TRAP_TICKS / TICK_HZ) * 1000));
  });
  it('accepts what the real simulation awards for gold, a trap and a clear', () => {
    // Clear a tiny level: two gold and the exit.
    const tower = [...Array.from({ length: 15 }, () => '...S'), '&$$S'];
    let s = initState(mk(tower));
    for (const input of [I(1), I(1), I(1)]) s = act(s, input).s;
    for (let i = 0; i < 15 && s.status === 'playing'; i++) s = act(s, I(0, -1)).s;
    expect(s.status).toBe('won');
    expect(s.score).toBe(2 * SCORE_GOLD + SCORE_CLEAR);
    const cleared: Submission = { mode: 'endless', name: 'AAA', score: s.score, level: 2, cleared: 1, seed: '' };
    expect(cleared.score).toBeLessThanOrEqual(maxPlausibleScore('endless', 1, 0, 10_000));
    expect(checkPlausible(cleared, 10_000)).toEqual({ ok: true });
    // Trap a guard in a dug hole.
    let t = initState(mk(['&...0..$', '########']));
    t = act(t, I(0, 0, 1)).s;
    for (let i = 0; i < 200 && t.score === 0; i++) t = act(t, I(0, 0, 0)).s;
    expect(t.score).toBe(SCORE_TRAP);
    const trapped: Submission = { mode: 'endless', name: 'AAA', score: t.score + SCORE_KILL, level: 1, cleared: 0, seed: '' };
    expect(trapped.score).toBeLessThanOrEqual(maxPlausibleScore('endless', 0, 1, FARM_WINDOW_MS));
    expect(checkPlausible(trapped, FARM_WINDOW_MS)).toEqual({ ok: true });
  });
});
