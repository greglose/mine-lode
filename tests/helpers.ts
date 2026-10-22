import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

export const DIST = join(__dirname, '..', 'dist');
export const SITE_URL = 'https://mine-lode.cantlosesoftware.com';

export const exists = (path: string) => existsSync(join(DIST, path));
export const read = (path: string) => readFileSync(join(DIST, path), 'utf-8');
export const html = (path: string) => cheerio.load(read(path));

/** Every file under dist/ with the given extension, as dist-relative paths. */
export function filesWithExt(ext: string, dir = DIST, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) return filesWithExt(ext, full, rel);
    return name.endsWith(ext) ? [rel] : [];
  });
}

const ANY_IMPORT = /["'](?:\.\/|\/_astro\/)([^"'/]+\.js)["']/g;
const STATIC_IMPORT = /(?:\bfrom\s*|\bimport\s*)["'](?:\.\/|\/_astro\/)([^"'/]+\.js)["']/g;

/**
 * Every /_astro/ script a page loads (plus any extra start paths), following imports.
 * By default dynamic import() edges are followed too; `staticOnly` gives the start-up set.
 */
export function scriptClosure(page: string, extraStarts: string[] = [], { staticOnly = false } = {}): string[] {
  const $ = html(page);
  const inline = $('script:not([src])').map((_, el) => $(el).text()).get().join('\n');
  const start = [
    ...$('script[src]').map((_, el) => $(el).attr('src') ?? '').get(),
    ...$('link[rel="modulepreload"]').map((_, el) => $(el).attr('href') ?? '').get(),
    ...[...inline.matchAll(/["'](\/_astro\/[^"']+\.js)["']/g)].map((m) => m[1]),
    ...extraStarts,
  ].filter((s) => s.startsWith('/_astro/'));
  return importClosure(start, { staticOnly });
}

/** The /_astro/ scripts reachable from `starts` by import edges (static only, or dynamic too). */
export function importClosure(starts: string[], { staticOnly = false } = {}): string[] {
  const edge = staticOnly ? STATIC_IMPORT : ANY_IMPORT;
  const seen = new Set<string>();
  const todo = [...starts];
  while (todo.length) {
    const path = todo.pop()!;
    if (seen.has(path) || !exists(path.slice(1))) continue;
    seen.add(path);
    for (const m of read(path.slice(1)).matchAll(edge)) todo.push(`/_astro/${m[1]}`);
  }
  return [...seen];
}
