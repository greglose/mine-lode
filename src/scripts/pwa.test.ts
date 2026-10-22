import { describe, expect, it, vi } from 'vitest';
import { CACHE_NAME, isCacheableAsset, registerSW, safeStorage } from './pwa';

describe('registerSW', () => {
  it('registers the worker at the base, with the base as scope', async () => {
    const register = vi.fn(async () => ({}));
    await registerSW({ base: '/', dev: false, container: { register } });
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    await registerSW({ base: '/mine-lode/', dev: false, container: { register } });
    expect(register).toHaveBeenLastCalledWith('/mine-lode/sw.js', { scope: '/mine-lode/' });
  });
  it('does nothing in dev', async () => {
    const register = vi.fn(async () => ({}));
    await registerSW({ base: '/', dev: true, container: { register } });
    expect(register).not.toHaveBeenCalled();
  });
  it('does nothing when service workers are unavailable', async () => {
    await expect(registerSW({ base: '/', dev: false, container: undefined })).resolves.toBeUndefined();
  });
  it('swallows a registration failure (offline support is best-effort)', async () => {
    const register = vi.fn(async () => { throw new Error('nope'); });
    await expect(registerSW({ base: '/', dev: false, container: { register } })).resolves.toBeUndefined();
  });
  it('reports an update only when an older build was already in control', async () => {
    for (const controller of [{}, undefined]) {
      let fire: () => void = () => {};
      const worker = { state: 'installed', addEventListener: (_: string, fn: () => void) => void (fire = fn) };
      let found: () => void = () => {};
      const registration = { installing: worker, addEventListener: (_: string, fn: () => void) => void (found = fn) };
      const onUpdate = vi.fn();
      await registerSW({ base: '/', dev: false, container: { controller, register: async () => registration }, onUpdate });
      found();
      fire();
      expect(onUpdate).toHaveBeenCalledTimes(controller ? 1 : 0);
    }
  });
  it('warms the cache with the same-origin assets the page loaded, and nothing else', async () => {
    const addAll = vi.fn(async () => {});
    const open = vi.fn(async () => ({ addAll }));
    await registerSW({
      base: '/',
      dev: false,
      container: { register: async () => ({}), ready: Promise.resolve() },
      cacheStorage: { open } as never,
      loaded: () => [
        'https://x.test/_astro/main.abc.js',
        'https://x.test/_astro/main.abc.js',
        'https://x.test/icon-192.png',
        'https://x.test/api/scores?mode=campaign',
        'https://x.test/',
      ],
    });
    expect(open).toHaveBeenCalledWith(CACHE_NAME);
    expect(addAll).toHaveBeenCalledWith(['https://x.test/_astro/main.abc.js', 'https://x.test/icon-192.png']);
  });
});

describe('isCacheableAsset', () => {
  it('matches hashed bundles, icons, music and the manifest only', () => {
    for (const p of ['_astro/a.js', 'icon-512.png', 'music/menu.mp3', 'manifest.webmanifest']) expect(isCacheableAsset(p), p).toBe(true);
    for (const p of ['', 'api/scores', 'music/../x.mp3', 'music/Menu.mp3', 'sw.js']) expect(isCacheableAsset(p), p).toBe(false);
  });
});

describe('safeStorage', () => {
  it('returns undefined when the browser blocks storage', () => {
    vi.stubGlobal('window', { get localStorage(): Storage { throw new Error('blocked'); } });
    expect(safeStorage()).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
