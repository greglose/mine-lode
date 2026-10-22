// Talks to /api/scores. Every method resolves to null on any failure and never rejects:
// the game must keep working with the network slow, gone or wrong.
import { SCORES_PATH, SCORES_START_PATH, isScoreRow, type ScoreRow, type Submission } from '../lib/scores';
import type { Mode } from '../lib/session';

export type PostBody = Submission & { stamp: string; turnstile: string };
export interface PostResult { rank: number | null; scores: ScoreRow[] }
export interface ScoresClient {
  start(mode: Mode): Promise<string | null>;
  top(mode: Mode): Promise<ScoreRow[] | null>;
  post(body: PostBody): Promise<PostResult | null>;
}
export interface ScoresClientOptions { fetch?: typeof fetch; timeoutMs?: number }

const TIMEOUT_MS = 8000;
const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const rowsOf = (v: unknown): ScoreRow[] | null => (Array.isArray(v) && v.every(isScoreRow) ? v : null);

export function createScoresClient(opts: ScoresClientOptions = {}): ScoresClient {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function call(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(null);
      }, timeoutMs);
    });
    const work = (async (): Promise<Record<string, unknown> | null> => {
      try {
        const res = await (opts.fetch ?? ((u, i) => globalThis.fetch(u, i)))(url, { ...init, signal: ctrl.signal });
        return res.ok ? record(await res.json()) : null;
      } catch {
        return null;
      }
    })();
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  const send = (url: string, payload: unknown) =>
    call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

  return {
    async start(mode) {
      const stamp = (await send(SCORES_START_PATH, { mode }))?.stamp;
      return typeof stamp === 'string' && stamp !== '' ? stamp : null;
    },
    async top(mode) {
      return rowsOf((await call(`${SCORES_PATH}?mode=${mode}`))?.scores);
    },
    async post(body) {
      const r = await send(SCORES_PATH, body);
      const scores = rowsOf(r?.scores);
      const rankOk = r !== null && (r.rank === null || (typeof r.rank === 'number' && Number.isInteger(r.rank) && r.rank > 0));
      return r !== null && scores !== null && rankOk ? { rank: r.rank as number | null, scores } : null;
    },
  };
}
