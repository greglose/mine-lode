// Cloudflare Pages Function - POST /api/scores/start
// Returns a signed "game started" stamp for a mode. Env: SCORES_SECRET.
import { isMode } from '../../../src/lib/scores';
import { signStamp } from '../../../src/lib/stamp';
import { json } from '../_shared';
import { fail, type ScoresEnv } from '../_scores-shared';

export const onRequestPost = async ({ request, env }: { request: Request; env: ScoresEnv }): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('body must be JSON', 400);
  }
  const mode = typeof body === 'object' && body !== null ? (body as { mode?: unknown }).mode : undefined;
  if (!isMode(mode)) return fail('mode must be campaign or endless', 400);
  if (!env.SCORES_SECRET) return fail('scores are not set up', 503);
  const stamp = await signStamp(env.SCORES_SECRET, mode, Date.now(), crypto.randomUUID());
  return json({ stamp }, 200);
};
