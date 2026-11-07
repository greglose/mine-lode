import { describe, expect, it } from 'vitest';
import {
  DAILY_DIFFICULTY, DAILY_KEEP, dailyKey, dailyLevel, dailySeed, dailyShareText, dailyStreak, formatCountdown, formatTime,
  msUntilNextDaily, recordDaily, type DailyResult,
} from './daily';
import { guardCount } from './generate';
import { isSolvable } from './solve';
import { freshSave } from './save';

const win = (timeMs = 83000, deaths = 0): DailyResult => ({ cleared: true, timeMs, deaths });
const loss = (deaths = 3, timeMs = 40000): DailyResult => ({ cleared: false, timeMs, deaths });

describe('daily keys and levels', () => {
  it('uses the lowest level number that gives two guards', () => {
    expect(guardCount(DAILY_DIFFICULTY)).toBe(2);
    expect(guardCount(DAILY_DIFFICULTY - 1)).toBeLessThan(2);
  });
  it('makes a local day key, zero padded', () => {
    expect(dailyKey(new Date(2026, 10, 7, 23, 59, 59))).toBe('2026-11-07');
    expect(dailyKey(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
  });
  it('seeds from the key', () => {
    expect(dailySeed('2026-11-07')).toBe('daily-2026-11-07');
  });
  it('gives the identical level for the same key', () => {
    expect(dailyLevel('2026-11-07')).toEqual(dailyLevel('2026-11-07'));
  });
  it('gives different levels for different keys', () => {
    const seen = new Set(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'].map((k) => JSON.stringify(dailyLevel(k))));
    expect(seen.size).toBe(4);
  });
  it('gives a solvable level with two guards', () => {
    const level = dailyLevel('2026-11-07');
    expect(isSolvable(level)).toBe(true);
    expect(level.guards).toHaveLength(2);
  });
});

describe('next daily countdown', () => {
  it('counts to local midnight', () => {
    expect(msUntilNextDaily(new Date(2026, 10, 7, 23, 59, 0))).toBe(60_000);
    expect(msUntilNextDaily(new Date(2026, 10, 7, 12, 0, 0))).toBe(12 * 3_600_000);
  });
  it('is correct across midnight and month ends', () => {
    expect(msUntilNextDaily(new Date(2026, 10, 8, 0, 0, 0))).toBe(24 * 3_600_000);
    expect(msUntilNextDaily(new Date(2026, 10, 30, 23, 0, 0))).toBe(3_600_000);
    expect(msUntilNextDaily(new Date(2026, 11, 31, 23, 30, 0))).toBe(1_800_000);
  });
  it('formats as h:mm, rounding up to the minute', () => {
    expect(formatCountdown(12 * 3_600_000)).toBe('12:00');
    expect(formatCountdown(60_000)).toBe('0:01');
    expect(formatCountdown(61_000)).toBe('0:02');
    expect(formatCountdown(5 * 3_600_000 + 7 * 60_000)).toBe('5:07');
    expect(formatCountdown(0)).toBe('0:00');
  });
  it('formats play time as m:ss', () => {
    expect(formatTime(83_000)).toBe('1:23');
    expect(formatTime(5_000)).toBe('0:05');
    expect(formatTime(83_999)).toBe('1:23');
  });
});

describe('recordDaily', () => {
  it('stores the first result and the last key', () => {
    const s = recordDaily(freshSave(), '2026-11-07', win());
    expect(s.daily.results['2026-11-07']).toEqual(win());
    expect(s.daily.lastKey).toBe('2026-11-07');
    expect(s.daily.streak).toBe(1);
  });
  it('does not mutate the save it was given', () => {
    const before = freshSave();
    recordDaily(before, '2026-11-07', win());
    expect(before.daily.results).toEqual({});
  });
  it('cleared beats not cleared, never the other way round', () => {
    const lost = recordDaily(freshSave(), 'k', loss(0, 1000));
    expect(recordDaily(lost, 'k', win(999999, 4)).daily.results.k).toEqual(win(999999, 4));
    expect(recordDaily(recordDaily(freshSave(), 'k', win(999999, 4)), 'k', loss(0, 1)).daily.results.k).toEqual(win(999999, 4));
  });
  it('then fewer deaths, then faster', () => {
    const base = recordDaily(freshSave(), 'k', win(60000, 2));
    expect(recordDaily(base, 'k', win(90000, 1)).daily.results.k).toEqual(win(90000, 1));
    expect(recordDaily(base, 'k', win(10000, 3)).daily.results.k).toEqual(win(60000, 2));
    expect(recordDaily(base, 'k', win(50000, 2)).daily.results.k).toEqual(win(50000, 2));
    expect(recordDaily(base, 'k', win(70000, 2)).daily.results.k).toEqual(win(60000, 2));
  });
  it('keeps only the last 60 keys', () => {
    let s = freshSave();
    for (let i = 0; i < 70; i++) s = recordDaily(s, dailyKey(new Date(2026, 0, 1 + i)), win());
    const keys = Object.keys(s.daily.results).sort();
    expect(keys).toHaveLength(DAILY_KEEP);
    expect(keys.at(-1)).toBe(dailyKey(new Date(2026, 0, 70)));
    expect(keys[0]).toBe(dailyKey(new Date(2026, 0, 11)));
  });
});

describe('dailyStreak', () => {
  const play = (keys: string[], result = win()) => keys.reduce((s, k) => recordDaily(s, k, result), freshSave());
  it('is zero with no results', () => {
    expect(dailyStreak(freshSave(), '2026-11-07')).toBe(0);
  });
  it('counts consecutive cleared days ending today', () => {
    expect(dailyStreak(play(['2026-11-05', '2026-11-06', '2026-11-07']), '2026-11-07')).toBe(3);
  });
  it('counts across a month end', () => {
    expect(dailyStreak(play(['2026-10-30', '2026-10-31', '2026-11-01']), '2026-11-01')).toBe(3);
  });
  it('stays alive when today is not played yet but yesterday was cleared', () => {
    expect(dailyStreak(play(['2026-11-05', '2026-11-06']), '2026-11-07')).toBe(2);
  });
  it('is broken by a missed day', () => {
    expect(dailyStreak(play(['2026-11-04', '2026-11-05']), '2026-11-07')).toBe(0);
    expect(dailyStreak(play(['2026-11-03', '2026-11-05', '2026-11-06']), '2026-11-06')).toBe(2);
  });
  it('is broken by a day played but not cleared', () => {
    const s = recordDaily(play(['2026-11-05', '2026-11-07']), '2026-11-06', loss());
    expect(dailyStreak(s, '2026-11-07')).toBe(1);
  });
  it('is stored on the save by recordDaily', () => {
    expect(play(['2026-11-05', '2026-11-06']).daily.streak).toBe(2);
  });
});

describe('dailyShareText', () => {
  const url = 'https://example.test/';
  it('says cleared with time and deaths', () => {
    expect(dailyShareText('2026-11-07', win(83000, 0), url)).toBe(`Daily Lode 2026-11-07 - cleared in 1:23, 0 deaths\n${url}`);
  });
  it('says not cleared with deaths', () => {
    expect(dailyShareText('2026-11-07', loss(3), url)).toBe(`Daily Lode 2026-11-07 - not cleared, 3 deaths\n${url}`);
  });
  it('uses the singular for one death', () => {
    expect(dailyShareText('2026-11-07', win(61000, 1), url)).toContain('1:01, 1 death\n');
  });
  it('defaults to the live site and is ASCII only', () => {
    const text = dailyShareText('2026-11-07', win());
    expect(text.split('\n')[1]).toBe('https://mine-lode.cantlosesoftware.com/');
    expect(text).toMatch(/^[\x20-\x7e\n]+$/);
  });
});
