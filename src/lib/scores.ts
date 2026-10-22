// High-score rules shared by the game and the scores Pages Function. Plain TypeScript only.
// Time is always an argument; nothing here reads a clock.
import { TICK_HZ } from './clock';
import { SCORE_CLEAR, SCORE_GOLD, SCORE_KILL, SCORE_TRAP, TRAP_TICKS } from './state';
import { CAMPAIGN_GOLD, CAMPAIGN_GUARDS, goldCount, guardCount } from './limits';
import { CAMPAIGN_LEVELS, SEED_MAX, type Mode } from './session';

export interface ScoreRow { name: string; score: number; level: number; seed: string; date: string }

export const SCORES_PATH = '/api/scores';
export const SCORES_START_PATH = '/api/scores/start';
export const MODES: readonly Mode[] = ['campaign', 'endless'];
export const isMode = (v: unknown): v is Mode => MODES.some((m) => m === v);
export const BOARD_SIZE = 10;
export const KEEP_ROWS = 100;
export const NAME_PATTERN = /^[A-Z]{3}$/;
/** A short list of offensive combinations. The owner may extend it. */
export const BLOCKED_NAMES: readonly string[] = ['ASS', 'CUM', 'FAG', 'FCK', 'FUK', 'KKK', 'NIG', 'SEX', 'TIT'];
export const STAMP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MIN_MS_PER_LEVEL = 5000;
/** Most a guard can be worth per trap cycle, and the shortest time one cycle takes. Both follow the simulation. */
export const FARM_POINTS = SCORE_TRAP + SCORE_KILL;
export const FARM_WINDOW_MS = Math.round((TRAP_TICKS / TICK_HZ) * 1000);

export const validName = (name: string): boolean => NAME_PATTERN.test(name) && !BLOCKED_NAMES.includes(name);

export const rank = (rows: ScoreRow[]): ScoreRow[] =>
  [...rows]
    .sort((a, b) => b.score - a.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, BOARD_SIZE);

export const qualifies = (rows: ScoreRow[], score: number): boolean =>
  score > 0 && (rows.length < BOARD_SIZE || score > Math.min(...rows.map((r) => r.score)));

export const insertRow = (rows: ScoreRow[], row: ScoreRow): ScoreRow[] => rank([...rows, row]);

export interface Submission { mode: Mode; name: string; score: number; level: number; cleared: number; seed: string }
type Fail = { ok: false; error: string };

const wholeScore = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

export function validateSubmission(input: unknown): { ok: true; value: Submission } | Fail {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'body must be an object' };
  const b = input as Record<string, unknown>;
  const { mode, name, score, level, cleared, seed } = b;
  if (!isMode(mode)) return { ok: false, error: 'mode must be campaign or endless' };
  if (typeof name !== 'string' || !validName(name)) return { ok: false, error: 'name must be three allowed capital letters' };
  if (!wholeScore(score)) return { ok: false, error: 'score must be a positive integer' };
  if (!wholeScore(level)) return { ok: false, error: 'level must be a positive integer' };
  if (mode === 'campaign' && level > CAMPAIGN_LEVELS) return { ok: false, error: 'level is past the last campaign level' };
  if (typeof cleared !== 'number' || !Number.isInteger(cleared) || cleared < 0) {
    return { ok: false, error: 'cleared must be a non-negative integer' };
  }
  const finished = mode === 'campaign' && level === CAMPAIGN_LEVELS && cleared === CAMPAIGN_LEVELS;
  if (cleared !== level - 1 && !finished) return { ok: false, error: 'cleared does not match level' };
  if (typeof seed !== 'string' || [...seed].length > SEED_MAX) return { ok: false, error: 'seed must be text of at most 32 characters' };
  if (mode === 'campaign' && seed !== '') return { ok: false, error: 'campaign rows have no seed' };
  return { ok: true, value: { mode, name, score, level, cleared, seed } };
}

export const minElapsedMs = (cleared: number): number => cleared * MIN_MS_PER_LEVEL;

const goldOf = (mode: Mode, n: number): number =>
  mode === 'campaign' ? (CAMPAIGN_GOLD[Math.min(n, CAMPAIGN_LEVELS) - 1] ?? 0) : goldCount(n);
const guardsOf = (mode: Mode, n: number): number =>
  mode === 'campaign' ? (CAMPAIGN_GUARDS[Math.min(n, CAMPAIGN_LEVELS) - 1] ?? 0) : guardCount(n);

/** The most a player could have banked: gold and clear bonus per cleared level, the gold of the
 *  level in progress, and trap points limited by elapsed time. `guardsNow` can only raise the guard count. */
export function maxPlausibleScore(mode: Mode, cleared: number, guardsNow: number, elapsedMs: number): number {
  let total = 0;
  let guards = guardsNow;
  for (let n = 1; n <= cleared; n++) {
    total += goldOf(mode, n) * SCORE_GOLD + SCORE_CLEAR;
    guards = Math.max(guards, guardsOf(mode, n));
  }
  const inProgress = mode === 'campaign' ? Math.min(cleared + 1, CAMPAIGN_LEVELS) : cleared + 1;
  total += goldOf(mode, inProgress) * SCORE_GOLD;
  guards = Math.max(guards, guardsOf(mode, inProgress));
  return total + FARM_POINTS * guards * Math.floor(Math.max(0, elapsedMs) / FARM_WINDOW_MS);
}

export function checkPlausible(sub: Submission, elapsedMs: number): { ok: true } | Fail {
  if (elapsedMs < minElapsedMs(sub.cleared)) return { ok: false, error: 'played too fast for the levels cleared' };
  if (sub.score > maxPlausibleScore(sub.mode, sub.cleared, guardsOf(sub.mode, sub.level), elapsedMs)) {
    return { ok: false, error: 'score is higher than the levels allow' };
  }
  return { ok: true };
}

// ---- Pure helpers for the score screens (no DOM, no clock) ----

/** A device row (local day key) or a shared row (UTC date, with or without a time). */
const ROW_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isRow(v: unknown, date: RegExp): v is ScoreRow {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.name === 'string' && validName(r.name) && wholeScore(r.score) && wholeScore(r.level) &&
    typeof r.seed === 'string' && [...r.seed].length <= SEED_MAX && typeof r.date === 'string' && date.test(r.date)
  );
}

/** A row from the device table: the date is a local day key only. */
export const isDeviceRow = (v: unknown): v is ScoreRow => isRow(v, DAY_KEY);
/** A row from the shared table: the date is a day key or a server timestamp. */
export const isScoreRow = (v: unknown): v is ScoreRow => isRow(v, ROW_DATE);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DEFAULT_INITIALS = 'AAA';
export const INITIALS_LENGTH = 3;

export const initialsOrDefault = (saved: string): string => (NAME_PATTERN.test(saved) ? saved : DEFAULT_INITIALS);

export function stepInitial(letter: string, delta: 1 | -1): string {
  const at = LETTERS.indexOf(letter);
  return LETTERS[(Math.max(at, 0) + delta + LETTERS.length) % LETTERS.length];
}

/** Puts `letter` (any case) in `slot`; a bad slot or a non-letter changes nothing. */
export function setInitial(initials: string, slot: number, letter: string): string {
  const up = letter.toUpperCase();
  if (!Number.isInteger(slot) || slot < 0 || slot >= INITIALS_LENGTH || up.length !== 1 || !LETTERS.includes(up)) return initials;
  return initials.slice(0, slot) + up + initials.slice(slot + 1);
}

/** Does the score enter the device table, or the shared table as last fetched (null = never fetched)? */
export const needsInitials = (device: ScoreRow[], shared: ScoreRow[] | null, score: number): boolean =>
  qualifies(device, score) || (shared !== null && qualifies(shared, score));

export interface ScoreEntry { mode: Mode; cleared: number; row: ScoreRow }

/** The row to record at the end of a game, name still empty. Null when nothing was banked. */
export function scoreEntry(
  s: { mode: Mode; level: number; score: number; seed: string },
  finished: boolean,
  day: string,
): ScoreEntry | null {
  if (s.score <= 0) return null;
  return {
    mode: s.mode,
    cleared: finished ? CAMPAIGN_LEVELS : s.level - 1,
    row: { name: '', score: s.score, level: s.level, seed: s.mode === 'endless' ? s.seed : '', date: day },
  };
}

export const scoreColumns = (mode: Mode): string[] =>
  mode === 'endless' ? ['Rank', 'Initials', 'Score', 'Level', 'Seed', 'Date'] : ['Rank', 'Initials', 'Score', 'Level', 'Date'];

export function scoreCells(mode: Mode, row: ScoreRow, index: number): string[] {
  const cells = [String(index + 1), row.name, String(row.score), String(row.level)];
  if (mode === 'endless') cells.push(row.seed);
  cells.push(row.date.slice(0, 10));
  return cells;
}

/** Index of the row the player just made (matched by what was sent), or -1. */
export const findRow = (rows: ScoreRow[], mine: ScoreRow): number =>
  rows.findIndex((r) => r.name === mine.name && r.score === mine.score && r.level === mine.level && r.seed === mine.seed);

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
