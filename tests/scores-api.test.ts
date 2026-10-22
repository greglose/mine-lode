import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost } from '../functions/api/scores';
import { onRequestPost as startPost } from '../functions/api/scores/start';
import { BOARD_SIZE, KEEP_ROWS, STAMP_MAX_AGE_MS, maxPlausibleScore } from '../src/lib/scores';
import { CAMPAIGN_GUARDS } from '../src/lib/limits';
import { json, verifyTurnstile } from '../functions/api/_shared';
import type { ScoresEnv } from '../functions/api/_scores-shared';
import { readStamp, signStamp } from '../src/lib/stamp';

type Row = { id: number; mode: string; name: string; score: number; level: number; seed: string; created_at: string };

// In-memory D1. Recognises exactly the statements the functions use and THROWS on anything else.
function fakeDb() {
  const state = { scores: [] as Row[], stamps: new Map<string, number>(), nextId: 1, fail: false };
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const order = (a: Row, b: Row) => b.score - a.score || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || a.id - b.id;
  const topOf = (mode: string, n: number) => state.scores.filter((r) => r.mode === mode).sort(order).slice(0, n);

  const exec = (sql: string, a: (string | number)[]) => {
    if (state.fail) throw new Error('D1_ERROR: database offline');
    const q = norm(sql);
    if (q === 'SELECT id, name, score, level, seed, created_at FROM scores WHERE mode = ? ORDER BY score DESC, created_at ASC, id ASC LIMIT ?') {
      return { results: topOf(a[0] as string, a[1] as number).map((r) => ({ ...r })), meta: {} };
    }
    if (q === 'INSERT INTO used_stamps (id, used_at) VALUES (?, ?)') {
      if (state.stamps.has(a[0] as string)) throw new Error('D1_ERROR: UNIQUE constraint failed: used_stamps.id');
      state.stamps.set(a[0] as string, a[1] as number);
      return { results: [], meta: {} };
    }
    if (q === 'INSERT INTO scores (mode, name, score, level, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)') {
      const id = state.nextId++;
      state.scores.push({ id, mode: a[0] as string, name: a[1] as string, score: a[2] as number, level: a[3] as number, seed: a[4] as string, created_at: a[5] as string });
      return { results: [], meta: { last_row_id: id } };
    }
    if (q === 'DELETE FROM used_stamps WHERE used_at < ?') {
      for (const [id, at] of state.stamps) if (at < (a[0] as number)) state.stamps.delete(id);
      return { results: [], meta: {} };
    }
    if (q === 'DELETE FROM scores WHERE mode = ? AND id NOT IN (SELECT id FROM scores WHERE mode = ? ORDER BY score DESC, created_at ASC, id ASC LIMIT ?)') {
      const keep = new Set(topOf(a[1] as string, a[2] as number).map((r) => r.id));
      state.scores = state.scores.filter((r) => r.mode !== a[0] || keep.has(r.id));
      return { results: [], meta: {} };
    }
    throw new Error(`fake D1: unrecognised statement: ${q}`);
  };
  const prepare = (sql: string) => {
    let args: (string | number)[] = [];
    const st = {
      bind: (...v: (string | number)[]) => { args = v; return st; },
      all: async () => exec(sql, args),
      first: async () => exec(sql, args).results[0] ?? null,
      run: async () => exec(sql, args),
    };
    return st;
  };
  return { state, db: { prepare } as unknown as NonNullable<Parameters<typeof onRequestGet>[0]['env']['SCORES_DB']> };
}

const SECRET = 'scores-secret';
const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);
let fake: ReturnType<typeof fakeDb>;
const env = (): ScoresEnv => ({ SCORES_DB: fake.db, SCORES_SECRET: SECRET, TURNSTILE_SECRET_KEY: 'ts' });

const stubTurnstile = (ok: boolean) => {
  const f = vi.fn(async () => new Response(JSON.stringify({ success: ok })));
  vi.stubGlobal('fetch', f);
  return f;
};
const req = (body: unknown) =>
  new Request('https://x.test/api/scores', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const stampFor = (mode: 'campaign' | 'endless', issued: number, id: string) => signStamp(SECRET, mode, issued, id);

const base = { mode: 'campaign', name: 'ABC', score: 100, level: 1, cleared: 0, seed: '', turnstile: 'tok' };
async function post(over: Record<string, unknown> = {}, stampId = 'id1', issued = T0 - 60_000, e = env()) {
  const stamp = 'stamp' in over ? over.stamp : await stampFor((over.mode as 'campaign' | 'endless') ?? 'campaign', issued, stampId);
  return onRequestPost({ request: req({ ...base, ...over, stamp }), env: e });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  fake = fakeDb();
  stubTurnstile(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GET /api/scores', () => {
  const get = (q: string, e = env()) => onRequestGet({ request: new Request(`https://x.test/api/scores${q}`), env: e });
  it('returns the top 10 sorted with the cache header', async () => {
    for (let i = 1; i <= 12; i++) {
      fake.state.scores.push({ id: i, mode: 'campaign', name: 'AAA', score: i * 10, level: 1, seed: '', created_at: `2026-01-${String(i).padStart(2, '0')}T00:00:00.000Z` });
    }
    fake.state.scores.push({ id: 99, mode: 'endless', name: 'ZZZ', score: 9999, level: 1, seed: 's', created_at: 'x' });
    const res = await get('?mode=campaign');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=30');
    const { scores } = (await res.json()) as { scores: { score: number; date: string }[] };
    expect(scores).toHaveLength(BOARD_SIZE);
    expect(scores.map((s) => s.score)).toEqual([120, 110, 100, 90, 80, 70, 60, 50, 40, 30]);
    expect(scores[0]).toEqual({ name: 'AAA', score: 120, level: 1, seed: '', date: '2026-01-12T00:00:00.000Z' });
  });
  it('400 on a bad mode', async () => {
    expect((await get('?mode=nope')).status).toBe(400);
    expect((await get('')).status).toBe(400);
  });
  it('503 without the binding', async () => {
    const res = await get('?mode=campaign', { ...env(), SCORES_DB: undefined });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
  it('503 when the query throws', async () => {
    fake.state.fail = true;
    expect((await get('?mode=endless')).status).toBe(503);
  });
});

describe('POST /api/scores/start', () => {
  const start = (body: unknown, e: ScoresEnv = env()) =>
    startPost({ request: new Request('https://x.test/api/scores/start', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env: e });
  it('returns a stamp readStamp accepts, with a fresh id each time', async () => {
    const a = (await (await start({ mode: 'endless' })).json()) as { stamp: string };
    const b = (await (await start({ mode: 'endless' })).json()) as { stamp: string };
    const read = await readStamp(SECRET, a.stamp);
    expect(read).toMatchObject({ mode: 'endless', issuedMs: T0 });
    expect(read?.id).not.toBe((await readStamp(SECRET, b.stamp))?.id);
  });
  it('400 on a bad mode and on bad JSON', async () => {
    expect((await start({ mode: 'x' })).status).toBe(400);
    expect((await start('{nope')).status).toBe(400);
  });
  it('503 without the secret', async () => {
    const res = await start({ mode: 'campaign' }, { ...env(), SCORES_SECRET: undefined });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe('POST /api/scores', () => {
  it('happy path inserts the row and returns rank 1', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rank: number; scores: { name: string; date: string }[] };
    expect(body.rank).toBe(1);
    expect(body.scores).toEqual([{ name: 'ABC', score: 100, level: 1, seed: '', date: new Date(T0).toISOString() }]);
    expect(fake.state.scores).toHaveLength(1);
    expect(fake.state.stamps.has('id1')).toBe(true);
  });
  it('a better score ranks above', async () => {
    await post({ score: 100 }, 'a');
    const res = await post({ score: 200, name: 'DEF' }, 'b');
    const body = (await res.json()) as { rank: number; scores: { score: number }[] };
    expect(body.rank).toBe(1);
    expect(body.scores.map((s) => s.score)).toEqual([200, 100]);
  });
  it('rank is null when the row does not make the top 10', async () => {
    for (let i = 0; i < BOARD_SIZE; i++) await post({ score: 100 + i }, `s${i}`);
    const res = await post({ score: 50 }, 'low');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rank: number | null }).rank).toBeNull();
  });
  it('400 for non-JSON and for a missing token', async () => {
    expect((await onRequestPost({ request: req('{nope'), env: env() })).status).toBe(400);
    const f = stubTurnstile(true);
    const res = await post({ turnstile: undefined });
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    expect(fake.state.scores).toHaveLength(0);
  });
  it('403 when the human check fails, nothing inserted', async () => {
    stubTurnstile(false);
    expect((await post()).status).toBe(403);
    expect(fake.state.scores).toHaveLength(0);
    expect(fake.state.stamps.size).toBe(0);
  });
  it('403 for a forged stamp, a stamp for the other mode, and an expired stamp', async () => {
    expect((await post({ stamp: 'campaign.1.x.AAAA' })).status).toBe(403);
    expect((await post({ stamp: await signStamp('other-secret', 'campaign', T0 - 1000, 'f') })).status).toBe(403);
    expect((await post({ stamp: await stampFor('endless', T0 - 1000, 'm') })).status).toBe(403);
    expect((await post({}, 'old', T0 - STAMP_MAX_AGE_MS - 1)).status).toBe(403);
    expect(fake.state.scores).toHaveLength(0);
  });
  it('422 when played too fast for the levels cleared', async () => {
    const res = await post({ level: 2, cleared: 1 }, 'fast', T0 - 4000);
    expect(res.status).toBe(422);
    expect(fake.state.scores).toHaveLength(0);
  });
  it('422 one point over the ceiling, accepted at the ceiling', async () => {
    const ceiling = maxPlausibleScore('campaign', 0, CAMPAIGN_GUARDS[0], 60_000);
    expect((await post({ score: ceiling + 1 }, 'over')).status).toBe(422);
    expect((await post({ score: ceiling }, 'at')).status).toBe(200);
  });
  it('403 on a reused stamp and only one row is stored', async () => {
    expect((await post({}, 'same')).status).toBe(200);
    expect((await post({ score: 90 }, 'same')).status).toBe(403);
    expect(fake.state.scores).toHaveLength(1);
  });
  it('a racing double post of one stamp stores one row', async () => {
    const results = await Promise.all([post({}, 'race'), post({}, 'race')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(fake.state.scores).toHaveLength(1);
  });
  it('400 for a bad name, lowercase, and a blocklisted name', async () => {
    for (const name of ['AB', 'abc', 'AB1', 'FCK']) expect((await post({ name }, `n${name}`)).status).toBe(400);
    expect(fake.state.scores).toHaveLength(0);
  });
  it('prunes a mode to exactly KEEP_ROWS, dropping the lowest, and leaves the other mode alone', async () => {
    for (let i = 1; i <= KEEP_ROWS; i++) {
      fake.state.scores.push({ id: fake.state.nextId++, mode: 'campaign', name: 'AAA', score: 1000 + i, level: 1, seed: '', created_at: '2026-01-01T00:00:00.000Z' });
    }
    fake.state.scores.push({ id: fake.state.nextId++, mode: 'endless', name: 'EEE', score: 1, level: 1, seed: '', created_at: '2026-01-01T00:00:00.000Z' });
    expect((await post({ score: 200 }, 'p1')).status).toBe(200);
    const campaign = fake.state.scores.filter((r) => r.mode === 'campaign');
    expect(campaign).toHaveLength(KEEP_ROWS);
    expect(campaign.some((r) => r.score === 200)).toBe(false);
    expect(Math.min(...campaign.map((r) => r.score))).toBe(1001);
    expect(fake.state.scores.filter((r) => r.mode === 'endless')).toHaveLength(1);
  });
  it('deletes used stamps older than the stamp lifetime', async () => {
    fake.state.stamps.set('ancient', T0 - STAMP_MAX_AGE_MS - 1);
    fake.state.stamps.set('recent', T0 - 1000);
    await post({}, 'fresh');
    expect([...fake.state.stamps.keys()].sort()).toEqual(['fresh', 'recent']);
  });
  it('503 when the binding or secret is missing', async () => {
    expect((await post({}, 'a', T0 - 60_000, { ...env(), SCORES_DB: undefined })).status).toBe(503);
    expect((await post({}, 'a', T0 - 60_000, { ...env(), SCORES_SECRET: undefined })).status).toBe(503);
  });
  it('503, not an exception, when the database throws', async () => {
    fake.state.fail = true;
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe('shared Turnstile helper', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('json sets status and content type', async () => {
    const r = json({ a: 1 }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.json()).toEqual({ a: 1 });
  });
  it('verifyTurnstile posts to siteverify with the request address', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain('remoteip=1.2.3.4');
      return new Response(JSON.stringify({ success: true }));
    });
    vi.stubGlobal('fetch', f);
    const req = new Request('https://x.test/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    expect(await verifyTurnstile('s', 'tok', req)).toBe(true);
    expect(String(f.mock.calls[0][0])).toContain('siteverify');
  });
});
