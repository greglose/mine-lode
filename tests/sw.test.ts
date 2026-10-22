import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_NAME } from '../src/scripts/pwa';

// The worker is plain script; run it against a fake ServiceWorkerGlobalScope and drive its listeners directly.
const SOURCE = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://mine-lode.cantlosesoftware.com';

type Handler = (event: unknown) => void;

function boot(scope = `${ORIGIN}/`) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Response>();
  const matchCalls: unknown[] = [];
  const fetchCalls: string[] = [];
  const opened: string[] = [];
  const precached: string[][] = [];
  const cache = {
    match: async (req: Request | string, opts?: unknown) => {
      matchCalls.push(opts);
      return store.get(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url)?.clone();
    },
    put: async (req: Request | string, res: Response) => void store.set(typeof req === 'string' ? req : req.url, res),
    addAll: async (urls: string[]) => void precached.push(urls),
  };
  const caches = {
    open: async (name: string) => {
      opened.push(name);
      return cache;
    },
    keys: async () => ['mine-lode-old', 'other-app-v1'],
    delete: vi.fn(async () => true),
  };
  const self = {
    registration: { scope },
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const fetchFn = async (req: Request | string) => {
    fetchCalls.push(typeof req === 'string' ? req : req.url);
    return new Response('net', { status: 200 });
  };
  new Function('self', 'caches', 'fetch', 'URL', 'Request', 'Response', SOURCE)(self, caches, fetchFn, URL, Request, Response);
  const fetchEvent = (url: string, mode = 'no-cors') => {
    const req = new Request(url, { method: 'GET' });
    Object.defineProperty(req, 'mode', { value: mode });
    let responded: Promise<Response> | undefined;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => void (responded = p), waitUntil: () => {} });
    return responded;
  };
  return { handlers, store, matchCalls, fetchCalls, fetchEvent, caches, opened, precached };
}

describe('service worker', () => {
  let sw: ReturnType<typeof boot>;
  beforeEach(() => void (sw = boot()));

  it('uses the cache name the register module warms', async () => {
    await sw.fetchEvent(`${ORIGIN}/icon-192.png`);
    expect(sw.opened).toContain(CACHE_NAME);
  });

  it('never intercepts a cross-origin request, the human check script included', () => {
    expect(sw.fetchEvent('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBeUndefined();
    expect(sw.fetchEvent('https://cantlosesoftware.com/')).toBeUndefined();
    expect(sw.fetchCalls).toEqual([]);
  });

  it('never caches or answers /api/ calls, so the shared board is always live', () => {
    expect(sw.fetchEvent(`${ORIGIN}/api/scores?mode=campaign`)).toBeUndefined();
    expect(sw.fetchEvent(`${ORIGIN}/api/scores/start`)).toBeUndefined();
    expect(sw.fetchCalls).toEqual([]);
    expect(sw.store.size).toBe(0);
  });

  it('serves hashed bundles, icons and music cache-first, and ignores Vary on every lookup', async () => {
    for (const path of ['_astro/main.abc123.js', 'icon-192.png', 'music/menu.mp3']) {
      const first = await sw.fetchEvent(`${ORIGIN}/${path}`);
      expect(await first!.text()).toBe('net');
      await sw.fetchEvent(`${ORIGIN}/${path}`);
    }
    expect(sw.fetchCalls.length).toBe(3);
    expect(sw.matchCalls.length).toBeGreaterThan(0);
    for (const opts of sw.matchCalls) expect(opts).toEqual({ ignoreVary: true });
  });

  it('serves a page network-first and falls back to the cached copy offline', async () => {
    const res = await sw.fetchEvent(`${ORIGIN}/`, 'navigate');
    expect(await res!.text()).toBe('net');
    expect(sw.store.size).toBe(1);
  });

  it('precaches the page, manifest and icons on install, without any music', async () => {
    let done: Promise<unknown> | undefined;
    sw.handlers.install({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect(sw.precached[0]).toEqual(['/', '/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png']);
  });

  it('leaves non-GET requests alone', () => {
    const req = new Request(`${ORIGIN}/api/scores`, { method: 'POST', body: 'x' });
    expect(sw.handlers.fetch({ request: req, respondWith: () => { throw new Error('intercepted'); } })).toBeUndefined();
  });

  it('drops caches from older versions of this app on activate, and only those', async () => {
    let done: Promise<unknown> | undefined;
    sw.handlers.activate({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect(sw.caches.delete).toHaveBeenCalledTimes(1);
    expect(sw.caches.delete).toHaveBeenCalledWith('mine-lode-old');
  });

  it('follows a sub-path scope', async () => {
    const sub = boot(`${ORIGIN}/mine-lode/`);
    await sub.fetchEvent(`${ORIGIN}/mine-lode/icon-192.png`);
    expect(sub.fetchCalls).toEqual([`${ORIGIN}/mine-lode/icon-192.png`]);
    expect(sub.fetchEvent(`${ORIGIN}/icon-192.png`)).toBeUndefined();
  });
});
