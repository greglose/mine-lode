// Daily Lode: one generated level per local calendar day, the same for everyone. Pure: time is always an argument.
import { generateLevel } from './generate';
import type { Level } from './level';
import type { Save } from './save';
import { dayKey } from './scores';

export interface DailyResult { cleared: boolean; timeMs: number; deaths: number }
export interface DailyState { results: Record<string, DailyResult>; streak: number; lastKey?: string }

/** Level number the daily is generated at: the lowest one that gives two guards (`guardCount`). */
export const DAILY_DIFFICULTY = 3;
/** How many day keys the save remembers. */
export const DAILY_KEEP = 60;
/** Where a shared result points; the page passes its own canonical URL instead. */
export const DAILY_SHARE_URL = 'https://mine-lode.cantlosesoftware.com/';

export const dailyKey = (date: Date): string => dayKey(date);
export const dailySeed = (key: string): string => `daily-${key}`;
export const dailyLevel = (key: string): Level => generateLevel(dailySeed(key), DAILY_DIFFICULTY);

/** Milliseconds from `now` to the next local midnight. */
export function msUntilNextDaily(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** h:mm, rounded up to the minute so it never reads 0:00 before midnight. */
export function formatCountdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** m:ss, whole seconds. */
export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

/** The key of the day before `key`. */
function previousKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/** True when `next` is a better result than `old`: cleared first, then fewer deaths, then faster. */
function better(next: DailyResult, old: DailyResult): boolean {
  if (next.cleared !== old.cleared) return next.cleared;
  if (next.deaths !== old.deaths) return next.deaths < old.deaths;
  return next.timeMs < old.timeMs;
}

/** Consecutive cleared days ending today, or ending yesterday while today is still unplayed or lost. */
export function dailyStreak(save: Save, todayKey: string): number {
  const { results } = save.daily;
  let key = results[todayKey]?.cleared ? todayKey : previousKey(todayKey);
  let streak = 0;
  while (results[key]?.cleared && streak < DAILY_KEEP) {
    streak++;
    key = previousKey(key);
  }
  return streak;
}

export function recordDaily(save: Save, key: string, result: DailyResult): Save {
  const old = save.daily.results[key];
  const kept = old && !better(result, old) ? old : result;
  const results = Object.fromEntries(
    Object.entries({ ...save.daily.results, [key]: kept }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(-DAILY_KEEP),
  );
  const next: Save = { ...save, daily: { results, streak: 0, lastKey: key } };
  return { ...next, daily: { ...next.daily, streak: dailyStreak(next, key) } };
}

export function dailyShareText(key: string, result: DailyResult, url: string = DAILY_SHARE_URL): string {
  const deaths = `${result.deaths} ${result.deaths === 1 ? 'death' : 'deaths'}`;
  const outcome = result.cleared ? `cleared in ${formatTime(result.timeMs)}, ${deaths}` : `not cleared, ${deaths}`;
  return `Daily Lode ${key} - ${outcome}\n${url}`;
}
