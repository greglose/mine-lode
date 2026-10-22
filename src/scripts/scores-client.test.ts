import { describe, expect, it, vi } from 'vitest';
import { createScoresClient, type PostBody } from './scores-client';

const rowJson = { name: 'ABC', score: 100, level: 2, seed: '', date: '2026-10-13T08:00:00.000Z' };
const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const client = (f: typeof fetch, timeoutMs = 50) => createScoresClient({ fetch: f, timeoutMs });
const body: PostBody = {
  mode: 'campaign', name: 'ABC', score: 100, level: 2, cleared: 1, seed: '', stamp: 's', turnstile: 't',
};

describe('requests', () => {
  it('asks for the top table of a mode', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL) => reply({ scores: [rowJson] }));
    expect(await client(f).top('endless')).toEqual([rowJson]);
    expect(f.mock.calls[0][0]).toBe('/api/scores?mode=endless');
  });
  it('asks for a start stamp with the mode', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => reply({ stamp: 'abc.def' }));
    expect(await client(f).start('campaign')).toBe('abc.def');
    expect(f.mock.calls[0][0]).toBe('/api/scores/start');
    expect(f.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ mode: 'campaign' });
  });
  it('posts a score and returns the rank and board', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => reply({ rank: 1, scores: [rowJson] }));
    expect(await client(f).post(body)).toEqual({ rank: 1, scores: [rowJson] });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual(body);
    expect(await client(async () => reply({ rank: null, scores: [] })).post(body)).toEqual({ rank: null, scores: [] });
  });
});

describe('failures resolve to null and never throw', () => {
  const calls = (c: ReturnType<typeof createScoresClient>) => [c.start('campaign'), c.top('campaign'), c.post(body)];
  const allNull = async (f: typeof fetch) => expect(await Promise.all(calls(client(f)))).toEqual([null, null, null]);

  it('on a network error', () => allNull(async () => { throw new TypeError('offline'); }));
  it('on a non-ok status, even with a good body', () => allNull(async () => reply({ stamp: 'x', scores: [rowJson], rank: 1 }, 503)));
  it('on a body that is not JSON', () => allNull(async () => new Response('<html>', { status: 200 })));
  it('on a missing fetch', () => allNull(undefined as unknown as typeof fetch));
  it('on the wrong shape', async () => {
    const c = (b: unknown) => client(async () => reply(b));
    expect(await c({}).start('campaign')).toBeNull();
    expect(await c({ stamp: 5 }).start('campaign')).toBeNull();
    expect(await c({ stamp: '' }).start('campaign')).toBeNull();
    expect(await c({}).top('campaign')).toBeNull();
    expect(await c({ scores: 'x' }).top('campaign')).toBeNull();
    expect(await c({ scores: [{ ...rowJson, score: -1 }] }).top('campaign')).toBeNull();
    expect(await c({ scores: [{ ...rowJson, name: 'abc' }] }).top('campaign')).toBeNull();
    expect(await c(null).top('campaign')).toBeNull();
    expect(await c({ scores: [] }).post(body)).toBeNull();
    expect(await c({ rank: 'one', scores: [] }).post(body)).toBeNull();
    expect(await c({ rank: 1, scores: [{ nope: true }] }).post(body)).toBeNull();
  });
  it('on a timeout, and aborts the request', async () => {
    let aborted = false;
    const hang = (_u: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('x', 'AbortError')); }));
    expect(await client(hang as typeof fetch, 10).top('campaign')).toBeNull();
    expect(aborted).toBe(true);
  });
  it('on a fetch that ignores the abort signal', async () => {
    expect(await client((() => new Promise<Response>(() => {})) as typeof fetch, 10).start('endless')).toBeNull();
  });
});
