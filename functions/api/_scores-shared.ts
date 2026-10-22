// Helpers shared by the scores Pages Functions. No routes are exported from here.
import { json } from './_shared';
import type { ScoreRow } from '../../src/lib/scores';

export interface D1Result<T> { results: T[]; meta?: { last_row_id?: number } }
export interface D1Statement {
  bind(...values: (string | number)[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1Like { prepare(sql: string): D1Statement }

export interface ScoresEnv {
  SCORES_DB?: D1Like;
  SCORES_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export const fail = (error: string, status: number): Response => json({ error }, status);

export const ORDER_BY_RANK = 'ORDER BY score DESC, created_at ASC, id ASC';

export const SELECT_TOP = `SELECT id, name, score, level, seed, created_at FROM scores WHERE mode = ? ${ORDER_BY_RANK} LIMIT ?`;

export interface TopRow { id: number; name: string; score: number; level: number; seed: string; created_at: string }

export const toScoreRow = (r: TopRow): ScoreRow => ({
  name: r.name, score: r.score, level: r.level, seed: r.seed, date: r.created_at,
});
