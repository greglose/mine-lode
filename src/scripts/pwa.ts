// Offline support: registers the worker at the site base, and warms its cache with the assets the page already
// loaded (the worker was not in control yet on the first visit). The cache name and asset rule must match public/sw.js.

/** window.localStorage, or undefined when the browser blocks access to it. */
export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Must match CACHE in public/sw.js. */
export const CACHE_NAME = 'mine-lode-v1';

/** Static assets the worker serves cache-first, as a path under the site base. Must match isStatic in public/sw.js. */
export const isCacheableAsset = (rest: string): boolean =>
  /^_astro\//.test(rest) || /^icon-\d+\.png$/.test(rest) || /^music\/[a-z0-9-]+\.mp3$/.test(rest) || rest === 'manifest.webmanifest';

export interface SWRegistration {
  addEventListener(type: 'updatefound', listener: () => void): void;
  installing?: { state: string; addEventListener(type: 'statechange', listener: () => void): void } | null;
}

export interface SWOptions {
  /** Site base such as "/". The worker lives at <base>sw.js and controls <base>. */
  base: string;
  dev: boolean;
  container: { controller?: unknown; ready?: Promise<unknown>; register(url: string, options: { scope: string }): Promise<unknown> } | undefined;
  /** Called when a newer build installs while an older one was running. */
  onUpdate?: () => void;
  /** Same-origin URLs already loaded by the page (performance resource entries). Cached after the worker is ready. */
  loaded?: () => string[];
  cacheStorage?: Pick<CacheStorage, 'open'>;
}

/** Registers the offline worker. Skipped in dev; failures are ignored because the page works without it. */
export async function registerSW({ base, dev, container, onUpdate, loaded, cacheStorage }: SWOptions): Promise<void> {
  if (dev || !container) return;
  try {
    const hadController = Boolean(container.controller);
    const registration = (await container.register(`${base}sw.js`, { scope: base })) as SWRegistration | undefined;
    registration?.addEventListener?.('updatefound', () => {
      const incoming = registration.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && hadController) onUpdate?.();
      });
    });
    await container.ready;
    if (!loaded || !cacheStorage) return;
    const urls = loaded().filter((href) => {
      const u = new URL(href);
      return u.pathname.startsWith(base) && isCacheableAsset(u.pathname.slice(base.length));
    });
    const cache = await cacheStorage.open(CACHE_NAME);
    await cache.addAll([...new Set(urls)]);
  } catch {
    // Offline support is best-effort.
  }
}
