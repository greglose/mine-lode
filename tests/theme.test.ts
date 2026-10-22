import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'tokens.css'), 'utf-8');
const body = (selector: string): string => {
  const at = css.indexOf(selector);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe('tokens', () => {
  it('keeps the two dark blocks identical', () => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(body(':root:not([data-theme="light"])'))).toBe(norm(body(':root[data-theme="dark"]')));
  });
  it('keeps the --crt-* case colours the same in light and dark', () => {
    const crt = (s: string) => s.split(';').map((d) => d.trim()).filter((d) => d.startsWith('--crt-')).join(';');
    expect(crt(body(':root {'))).toBe(crt(body(':root[data-theme="dark"]')));
  });
  it('defines every token the page and the radios read', () => {
    const page = readFileSync(join(__dirname, '..', 'src', 'pages', 'index.astro'), 'utf-8') +
      readFileSync(join(__dirname, '..', 'src', 'components', 'GraphicsRadios.astro'), 'utf-8') +
      readFileSync(join(__dirname, '..', 'src', 'styles', 'global.css'), 'utf-8');
    // Custom properties the page declares for itself (such as --pad) are not tokens.
    const own = new Set([...page.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]));
    const used = new Set([...page.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]).filter((t) => !own.has(t)));
    expect(used.size).toBeGreaterThan(10);
    for (const token of used) expect(body(':root {'), token).toContain(`${token}:`);
  });
});
