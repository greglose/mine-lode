import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { GRAPHICS, GRAPHICS_LABELS } from '../src/lib/graphics';
import { SITE_URL, exists, filesWithExt, html, importClosure, read, scriptClosure } from './helpers';

const ROOT = join(__dirname, '..');

describe('Mine Lode page', () => {
  const $ = () => html('index.html');
  const game = () => $()('[data-game]');

  it('has one h1, a title and a description of its own', () => {
    expect($()('h1').length).toBe(1);
    expect($()('title').text()).toContain('Mine Lode');
    const description = $()('meta[name="description"]').attr('content') ?? '';
    expect(description.length).toBeGreaterThanOrEqual(40);
  });
  it('starts on the menu with the other panels hidden', () => {
    expect(game().attr('data-screen')).toBe('menu');
    expect(game().find('[data-panel="menu"]').attr('hidden')).toBeUndefined();
    for (const p of ['pause', 'clear', 'over', 'error', 'scores', 'initials']) {
      expect(game().find(`[data-panel="${p}"]`).attr('hidden'), p).toBeDefined();
    }
  });
  it('has every hook the game script needs', () => {
    const hooks = [
      'canvas[data-canvas]', '[data-hud-level]', '[data-hud-score]', '[data-hud-lives]', '[data-hud-gold]',
      'button[data-act="pause"]', 'button[data-act="campaign"]', '[data-levels]', 'input[data-seed]',
      'button[data-act="endless"]', '[data-best-campaign]', '[data-best-endless]', '[data-update]',
      'button[data-act="reload"]', 'button[data-act="resume"]', 'button[data-act="restart"]',
      'button[data-act="toggle-effects"][aria-pressed]', 'button[data-act="toggle-music"][aria-pressed]',
      'button[data-act="next"]', '[data-over-title]', '[data-over-score]',
      ...['left', 'right', 'up', 'down', 'digL', 'digR'].map((b) => `button[data-btn="${b}"]`),
    ];
    for (const sel of hooks) expect(game().find(sel).length, sel).toBe(1);
    expect(game().find('button[data-act="menu"]').length).toBe(2);
    expect(game().find('input[data-seed]').attr('maxlength')).toBe('32');
    expect(game().find('[data-update]').attr('hidden')).toBeDefined();
  });
  it('labels every button that has no words', () => {
    game().find('button').each((_, el) => {
      const b = $()(el);
      expect((b.text().trim() + (b.attr('aria-label') ?? '')).length, $().html(el) ?? '').toBeGreaterThan(0);
    });
    for (const b of ['left', 'right', 'up', 'down', 'digL', 'digR']) {
      expect(game().find(`button[data-btn="${b}"]`).attr('aria-label'), b).toBeTruthy();
    }
  });
  it('explains the WebGL requirement in the error panel', () => {
    expect(game().find('[data-panel="error"]').text()).toMatch(/WebGL/);
  });
  it('describes the game in plain text for people who cannot play it', () => {
    const about = $()('[data-about]').text();
    expect(about).toMatch(/collect/i);
    expect(about).toMatch(/keyboard/i);
    expect(about).toMatch(/screen reader/i);
  });
});

describe('Mine Lode high scores', () => {
  const $ = () => html('index.html');
  const game = () => $()('[data-game]');
  const once = [
    'button[data-act="scores"]', '[data-panel="scores"]', '[data-scores-tab="campaign"]', '[data-scores-tab="endless"]',
    '[data-scores-scope="everyone"]', '[data-scores-scope="device"]', '[data-scores-body]', '[data-scores-note]',
    'button[data-act="scores-close"]', '[data-panel="initials"]', '[data-turnstile]', '[data-initials-note]',
    'button[data-act="initials-ok"]', 'button[data-act="initials-skip"]', '[data-initials-public]',
  ];

  it('strikes through only the three settings toggles, never the scores tabs', () => {
    // This page's own stylesheets only: other game pages style their own toggles.
    const linked = $()('link[rel="stylesheet"]').map((_, el) => ($()(el).attr('href') ?? '').replace(/^\//, '')).get();
    expect(linked.length).toBeGreaterThan(0);
    const css = linked.map(read).join('\n') + $()('style').text();
    const rules = css.match(/[^{}]+\{[^{}]*line-through[^{}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      const sel = r.slice(0, r.indexOf('{'));
      expect(sel).toMatch(/toggle-effects/);
      expect(sel).toMatch(/toggle-music/);
      expect(sel).toMatch(/toggle-crt/);
      expect(sel).not.toMatch(/scores/);
      expect(sel).not.toMatch(/^[^,]*\.gbtn\[aria-pressed=("?)false\1\]\s*$/);
    }
    expect(game().find('[data-scores-tab], [data-scores-scope]').filter((_, e) => $()(e).attr('aria-pressed') === undefined).length).toBe(0);
  });
  it('has every score hook exactly once, and three of each initials control', () => {
    for (const sel of once) expect(game().find(sel).length, sel).toBe(1);
    for (const sel of ['[data-initial]', 'button[data-initial-up]', 'button[data-initial-down]']) {
      expect(game().find(sel).length, sel).toBe(3);
    }
  });
  it('keeps the menu button inside the menu panel and the table inside the scores panel', () => {
    expect(game().find('[data-panel="menu"] button[data-act="scores"]').length).toBe(1);
    expect(game().find('[data-panel="scores"] table [data-scores-body]').length).toBe(1);
  });
  it('gives the scores table a caption and column headers', () => {
    const table = game().find('[data-panel="scores"] table');
    expect(table.find('caption').text().trim().length).toBeGreaterThan(0);
    const heads = table.find('thead th');
    expect(heads.length).toBeGreaterThanOrEqual(5);
    heads.each((_, el) => {
      expect($()(el).attr('scope')).toBe('col');
      expect($()(el).text().trim().length).toBeGreaterThan(0);
    });
  });
  it('labels the up and down buttons and the slots, and lets keyboard users reach the slots', () => {
    for (const sel of ['button[data-initial-up]', 'button[data-initial-down]', '[data-initial]']) {
      game().find(sel).each((_, el) => expect($()(el).attr('aria-label'), sel).toBeTruthy());
    }
    game().find('[data-initial]').each((_, el) => expect($()(el).attr('tabindex')).toBe('0'));
  });
  it('says the score and initials will be shown publicly', () => {
    expect(game().find('[data-initials-public]').text()).toMatch(/shown publicly/i);
  });
  it('hands the script the human-check site key and loads no Turnstile script itself', () => {
    expect(game().attr('data-turnstile-key') ?? '').toMatch(/^[0-9A-Za-z_-]{10,}$/);
    const page = read('index.html');
    expect(page).not.toMatch(/<script[^>]*challenges\.cloudflare\.com/i);
    expect($()('script[src*="challenges.cloudflare.com"]').length).toBe(0);
  });
  it('mentions the Turnstile address only as text in the loader, never as a tag', () => {
    const closure = scriptClosure('index.html').map((p) => read(p.slice(1))).join('\n');
    expect(closure).toContain('challenges.cloudflare.com/turnstile/v0/api.js');
    expect(closure).not.toMatch(/<script[^>]*challenges\.cloudflare/i);
  });
});

describe('web manifest and icons', () => {
  it('serves a root-scoped manifest whose icons exist', () => {
    expect(exists('manifest.webmanifest')).toBe(true);
    const m = JSON.parse(read('manifest.webmanifest'));
    expect(m.scope).toBe('/');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('fullscreen');
    expect(m.orientation).toBe('landscape');
    for (const icon of m.icons) expect(existsSync(join(ROOT, 'public', icon.src)), icon.src).toBe(true);
  });
  it('has all three home-screen icon sizes on disk', () => {
    for (const size of [180, 192, 512]) expect(existsSync(join(ROOT, 'public', `icon-${size}.png`)), `icon-${size}.png`).toBe(true);
  });
  it('has install tags, a canonical link on the site root and no site chrome', () => {
    const $ = html('index.html');
    expect($('link[rel="manifest"]').attr('href')).toBe('/manifest.webmanifest');
    expect($('link[rel="canonical"]').attr('href')).toBe(`${SITE_URL}/`);
    expect($('link[rel="apple-touch-icon"]').attr('href')).toBe('/icon-180.png');
    expect($('meta[name="theme-color"]').attr('content')).toBe('#1B2A3A');
    expect($('header, nav').length).toBe(0);
  });
  it('carries the background colour for the renderer and the play tracks as a list of urls', () => {
    expect(html('index.html')('[data-game][data-bg]').attr('data-bg')).toBe('#1B2A3A');
    expect(JSON.parse(html('index.html')('[data-game]').attr('data-music')!)).toEqual({
      play: ['/music/pulsing-drive-1.mp3', '/music/pulsing-drive-2.mp3'],
    });
  });
  it('links the source and the publisher in the footer, and states the privacy facts in the page', () => {
    const $ = html('index.html');
    expect($('footer a[href="https://github.com/greglose/mine-lode"]').length).toBe(1);
    expect($('footer a[href="https://cantlosesoftware.com/games/"]').length).toBe(1);
    expect($('footer').text()).toMatch(/open source \(MIT\)/);
    const text = $('[data-about]').text().replace(/\s+/g, ' ');
    expect(text).toMatch(/local storage/i);
    expect(text).toMatch(/three\s+initials/i);
    expect(text).toMatch(/level reached/i);
    expect(text).toMatch(/shown publicly/i);
    expect(text).toMatch(/IP address is not stored/i);
  });
});

describe('Mine Lode retro monitor frame', () => {
  const $ = () => html('index.html');
  const game = () => $()('[data-game]');
  const css = () => filesWithExt('.css').map(read).join('\n') + $()('style').text();
  const hiding = (query: RegExp) => {
    const blocks = [...css().matchAll(/@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\}/g)].filter((m) => query.test(m[1]));
    return blocks.some((m) => /monitor/.test(m[2]) && /display:\s*contents|display:\s*none/.test(m[2]));
  };

  it('wraps the stage, with every existing hook still inside the game', () => {
    expect(game().find('[data-monitor]').length).toBe(1);
    expect(game().find('[data-monitor] .stage').length).toBe(1);
    expect(game().find('[data-monitor] .stage [data-canvas]').length).toBe(1);
    expect(game().find('[data-monitor] .stage .hud').length).toBe(1);
    expect(game().find('[data-monitor] .stage [data-panel]').length).toBe(7);
    expect(game().find('[data-monitor] .stage .touch').length).toBe(1);
    expect($()('[data-monitor]').parents('[data-game]').length).toBe(1);
  });
  it('puts the screen effect overlay inside the stage, hidden from assistive tech', () => {
    const fx = game().find('.stage [data-crt-fx]');
    expect(game().find('[data-crt-fx]').length).toBe(1);
    expect(fx.length).toBe(1);
    expect(fx.attr('aria-hidden')).toBe('true');
  });
  it('carries the MINE LODE badge and hides every decorative part', () => {
    const badge = game().find('[data-monitor] [data-badge]');
    expect(badge.length).toBe(1);
    expect(badge.text().trim()).toBe('MINE LODE');
    expect(badge.closest('[aria-hidden="true"]').length).toBe(1);
    const decor = game().find('[data-monitor] [data-decor]');
    expect(decor.length).toBeGreaterThan(3);
    decor.each((_, el) => {
      expect($()(el).closest('[aria-hidden="true"]').length, $().html(el) ?? '').toBe(1);
      expect($()(el).attr('tabindex')).toBeUndefined();
      expect($()(el).find('button, a, input').length).toBe(0);
    });
    expect(game().find('[data-monitor] :not(.stage, .stage *)').filter((_, el) => ['button', 'a', 'input'].includes(el.tagName)).length).toBe(0);
  });
  it('keeps the canvas label', () => {
    expect(game().find('canvas[data-canvas]').attr('aria-label')).toBe('Mine Lode game board');
  });
  it('has the screen effect toggle once, in the pause panel', () => {
    expect(game().find('button[data-act="toggle-crt"][aria-pressed]').length).toBe(1);
    expect(game().find('[data-panel="pause"] button[data-act="toggle-crt"]').text().trim()).toBe('Screen effect');
  });
  it('hides the case on narrow or short screens', () => {
    expect(hiding(/(max-width:\s*820px|width\s*<=\s*820px)[\s\S]*(max-height:\s*520px|height\s*<=\s*520px)/)).toBe(true);
  });
  it('hides the case when installed or fullscreen', () => {
    expect(hiding(/display-mode:\s*fullscreen/)).toBe(true);
    expect(hiding(/display-mode:\s*standalone/)).toBe(true);
  });
  it('colours the case only from --crt- tokens', () => {
    const rules = (css().match(/[^{}]*\{[^{}]*\}/g) ?? []).filter((r) => {
      const sel = r.slice(0, r.indexOf('{'));
      return /astro-cid/.test(sel) && /\.(?:monitor|bezel|vents|chin|badge|knob|led|stand|crt-fx)\b/.test(sel);
    });
    expect(rules.length).toBeGreaterThan(8);
    for (const r of rules) expect(r, r).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:black|white)\b/i);
    expect(rules.join('\n')).toMatch(/var\(--crt-case\)/);
    expect(rules.join('\n')).toMatch(/var\(--crt-led-on\)/);
  });
  it('shows the effects only while the root says on', () => {
    expect(css()).toMatch(/\[data-crt[=~]?["']?off["']?\][^{}]*\{[^}]*display:\s*none/);
  });
});

describe('Mine Lode Graphics setting', () => {
  const $ = () => html('index.html');
  const game = () => $()('[data-game]');

  it('has one labelled radio group per panel, Classic and Modern, with the labels from the setting', () => {
    expect(game().find('input[data-graphics]').length).toBe(2 * GRAPHICS.length);
    for (const panel of ['menu', 'pause']) {
      const group = game().find(`[data-panel="${panel}"] fieldset`);
      expect(group.length, panel).toBe(1);
      expect(group.find('legend').text().trim(), panel).toBe('Graphics');
      const radios = group.find('input[type="radio"]');
      expect(radios.length, panel).toBe(GRAPHICS.length);
      expect(radios.map((_, el) => $()(el).attr('value')).get(), panel).toEqual([...GRAPHICS]);
      expect(new Set(radios.map((_, el) => $()(el).attr('name')).get()).size, `${panel} shares one name`).toBe(1);
      radios.each((i, el) => {
        const id = $()(el).attr('id') ?? '';
        expect(id, panel).toBeTruthy();
        expect(group.find(`label[for="${id}"]`).text().trim(), id).toBe(GRAPHICS_LABELS[GRAPHICS[i]]);
      });
      expect(radios.filter((_, el) => $()(el).attr('checked') !== undefined).map((_, el) => $()(el).attr('value')).get()).toEqual(['classic']);
    }
  });
  it('keeps every radio id and each panel group name distinct', () => {
    const radios = game().find('input[data-graphics]');
    expect(new Set(radios.map((_, el) => $()(el).attr('id')).get()).size).toBe(radios.length);
    const names = new Set(radios.map((_, el) => $()(el).attr('name')).get());
    expect(names.size).toBe(2);
  });
  it('has one polite live region for the fallback notice, outside the panels and empty at load', () => {
    const note = game().find('[data-gfx-note]');
    expect(note.length).toBe(1);
    expect(note.attr('role')).toBe('status');
    expect(note.text()).toBe('');
    expect(note.closest('[data-panel]').length).toBe(0);
  });
  it('fits the pause panel: the three toggles share one wrapping row, the Graphics group sits on the row below', () => {
    const pause = game().find('[data-panel="pause"]');
    const row = pause.find('.settings-row');
    expect(row.length).toBe(1);
    expect(row.children('button').map((_, el) => $()(el).attr('data-act')).get()).toEqual(['toggle-effects', 'toggle-music', 'toggle-crt']);
    expect(row.next().is('fieldset[data-graphics-group="pause"]')).toBe(true);
    const css = filesWithExt('.css').map(read).join('\n') + $()('style').text();
    const rules = (css.match(/[^{}]*\{[^{}]*\}/g) ?? []).filter((r) => /\.settings-row\b/.test(r.slice(0, r.indexOf('{'))));
    expect(rules.join('\n')).toMatch(/display:\s*flex/);
    expect(rules.join('\n')).toMatch(/flex-wrap:\s*wrap/);
  });
  it('colours the control from tokens only', () => {
    const css = filesWithExt('.css').map(read).join('\n') + $()('style').text();
    const rules = (css.match(/[^{}]*\{[^{}]*\}/g) ?? []).filter((r) => /\.(?:gfx|gfx-note)\b/.test(r.slice(0, r.indexOf('{'))) && /astro-cid/.test(r.slice(0, r.indexOf('{'))));
    expect(rules.length).toBeGreaterThan(3);
    for (const r of rules) expect(r, r).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:black|white)\b/i);
  });
});

describe('game page weight', () => {
  const gamePage = 'index.html';
  const dynamicDeps = (path: string): string[] =>
    [...read(path.slice(1)).matchAll(/\bimport\(\s*["'`]\.\/([^"'`/]+\.js)["'`]\s*\)/g)].map((m) => `/_astro/${m[1]}`);
  const gz = (paths: string[]) => paths.reduce((sum, p) => sum + gzipSync(read(p.slice(1))).length, 0);
  const everything = scriptClosure(gamePage);
  // Start-up: page scripts and their static imports only, what loads before anyone asks for Modern.
  const startup = scriptClosure(gamePage, [], { staticOnly: true });
  // The Modern chunk: a file the start-up set loads by dynamic import() and that defines the contract's export.
  const MARKER = 'createModernRenderer';
  const modernEntries = [...new Set(startup.flatMap(dynamicDeps))].filter((p) => !startup.includes(p) && read(p.slice(1)).includes(MARKER));
  // Everything the Modern entry needs that start-up does not already load: its own code, passes and textures.
  const modern = importClosure(modernEntries, { staticOnly: true }).filter((p) => !startup.includes(p));

  it('loads at most 250 KB of gzipped script at start-up', () => {
    expect(startup.length).toBeGreaterThan(0);
    expect(gz(startup)).toBeLessThanOrEqual(250 * 1024);
  });
  it('keeps the Modern renderer out of the start-up set and loads it only by dynamic import', () => {
    expect(modernEntries.length, `no dynamically imported chunk defines ${MARKER}`).toBe(1);
    expect(startup).not.toContain(modernEntries[0]);
    for (const p of startup) expect(read(p.slice(1)), `${p} defines ${MARKER}`).not.toMatch(new RegExp(`\\bas\\s+${MARKER}\\b|function\\s+${MARKER}\\b`));
  });
  it('caps the Modern chunk at 120 KB gzipped', () => {
    expect(modern.length).toBeGreaterThan(0);
    expect(gz(modern)).toBeLessThanOrEqual(120 * 1024);
  });
  it('keeps the heavy game code off every other page', () => {
    // Only one page ships today; this guards a second one against pulling the 3D library in by accident.
    const heavy = everything.filter((p) => read(p.slice(1)).length > 100 * 1024);
    expect(heavy.length, 'expected the game to have at least one large script (the 3D library)').toBeGreaterThan(0);
    for (const page of filesWithExt('.html').filter((p) => p !== gamePage)) {
      const others = scriptClosure(page);
      for (const big of heavy) expect(others, `${page} loads ${big}`).not.toContain(big);
      for (const big of modern) expect(others, `${page} loads ${big}`).not.toContain(big);
    }
  });
  it('adds no image or model files beyond the three home-screen icons', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    const dirs = ['public', 'src'];
    const media = dirs
      .filter((d) => existsSync(join(ROOT, d)))
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => /\.(png|jpe?g|webp|gif|avif|glb|gltf|obj|fbx|mtl|bin)$/i.test(f))
      .map((f) => relative(ROOT, f))
      .sort();
    expect(media).toEqual(['icon-180.png', 'icon-192.png', 'icon-512.png'].map((f) => `public/${f}`));
  });
});
