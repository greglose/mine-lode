// Cloudflare Pages Function - GET and POST /api/scores
// Env: SCORES_DB (D1), SCORES_SECRET (stamp signing), TURNSTILE_SECRET_KEY.
// The IP address is only forwarded to siteverify; it is never stored or logged.
import {
  BOARD_SIZE, KEEP_ROWS, isMode, STAMP_MAX_AGE_MS, checkPlausible, validateSubmission,
} from '../../src/lib/scores';
import { readStamp } from '../../src/lib/stamp';
import { json, verifyTurnstile } from './_shared';
import {
  ORDER_BY_RANK, SELECT_TOP, fail, toScoreRow, type D1Like, type ScoresEnv, type TopRow,
} from './_scores-shared';

type Ctx = { request: Request; env: ScoresEnv };

const INSERT_STAMP = 'INSERT INTO used_stamps (id, used_at) VALUES (?, ?)';
const INSERT_SCORE = 'INSERT INTO scores (mode, name, score, level, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)';
const DELETE_OLD_STAMPS = 'DELETE FROM used_stamps WHERE used_at < ?';
const PRUNE = `DELETE FROM scores WHERE mode = ? AND id NOT IN (SELECT id FROM scores WHERE mode = ? ${ORDER_BY_RANK} LIMIT ?)`;

const top = async (db: D1Like, mode: string): Promise<TopRow[]> =>
  (await db.prepare(SELECT_TOP).bind(mode, BOARD_SIZE).all<TopRow>()).results;

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const mode = new URL(request.url).searchParams.get('mode');
  if (!isMode(mode)) return fail('mode must be campaign or endless', 400);
  if (!env.SCORES_DB) return fail('scores are not set up', 503);
  try {
    const rows = await top(env.SCORES_DB, mode);
    return json({ scores: rows.map(toScoreRow) }, 200, { 'cache-control': 'public, max-age=30' });
  } catch {
    return fail('scores are unavailable', 503);
  }
};

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const db = env.SCORES_DB;
  const secret = env.SCORES_SECRET;
  if (!db || !secret || !env.TURNSTILE_SECRET_KEY) return fail('scores are not set up', 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('body must be JSON', 400);
  }

  // 1. Shape.
  const checked = validateSubmission(body);
  if (!checked.ok) return fail(checked.error, 400);
  const sub = checked.value;
  const { turnstile, stamp } = body as { turnstile?: unknown; stamp?: unknown };

  // 2. Human check.
  if (typeof turnstile !== 'string' || turnstile === '') return fail('human check token missing', 400);
  let human: boolean;
  try {
    human = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstile, request);
  } catch {
    return fail('human check unavailable', 503);
  }
  if (!human) return fail('human check failed', 403);

  // 3. Start stamp.
  const now = Date.now();
  const read = typeof stamp === 'string' ? await readStamp(secret, stamp) : null;
  if (!read) return fail('start stamp is not valid', 403);
  if (read.mode !== sub.mode) return fail('start stamp is for another mode', 403);
  const elapsed = now - read.issuedMs;
  if (elapsed > STAMP_MAX_AGE_MS) return fail('start stamp has expired', 403);

  // 4 and 5. Time floor and plausibility ceiling.
  const plausible = checkPlausible(sub, elapsed);
  if (!plausible.ok) return fail(plausible.error, 422);

  try {
    // 6. Stamp reuse: the primary key makes a second use of the same id fail, even when racing.
    try {
      await db.prepare(INSERT_STAMP).bind(read.id, now).run();
    } catch (e) {
      if (/unique|constraint|primary key/i.test(e instanceof Error ? e.message : String(e))) {
        return fail('start stamp was already used', 403);
      }
      throw e;
    }
    const inserted = await db
      .prepare(INSERT_SCORE)
      .bind(sub.mode, sub.name, sub.score, sub.level, sub.seed, new Date(now).toISOString())
      .run();
    await db.prepare(DELETE_OLD_STAMPS).bind(now - STAMP_MAX_AGE_MS).run();
    await db.prepare(PRUNE).bind(sub.mode, sub.mode, KEEP_ROWS).run();
    const rows = await top(db, sub.mode);
    const index = rows.findIndex((r) => r.id === inserted.meta?.last_row_id);
    return json({ rank: index === -1 ? null : index + 1, scores: rows.map(toScoreRow) }, 200);
  } catch {
    return fail('scores are unavailable', 503);
  }
};
