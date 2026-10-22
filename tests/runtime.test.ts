// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { read } from './helpers';
import { CAMPAIGN_LEVELS } from '../src/lib/session';
import { FALLBACK_NOTICE, GRAPHICS, GRAPHICS_LABELS } from '../src/lib/graphics';

const renderer = vi.hoisted(() => ({
  fail: false, draws: 0, effects: 0,
  modernFails: false, importFails: false,
  classic: { created: 0, disposed: 0 },
  modern: { created: 0, disposed: 0, draws: 0, levels: [] as { decor: unknown; seed: string }[], lost: null as (() => void) | null },
}));
vi.mock('../src/scripts/render', () => ({
  createRenderer: () => {
    if (renderer.fail) throw new Error('no webgl');
    renderer.classic.created++;
    return {
      draw: () => void renderer.draws++,
      resize: () => {},
      shake: () => {},
      effects: () => void renderer.effects++,
      dispose: () => void renderer.classic.disposed++,
    };
  },
}));
vi.mock('../src/scripts/render-modern', () => ({
  // vitest keeps a factory's result across vi.resetModules(), so a module that fails to load is a getter that
  // throws when the shell reads the export: the shell's load step rejects just as a failed chunk fetch would.
  get createModernRenderer() {
    if (renderer.importFails) throw new Error('offline');
    return (_canvas: unknown, opts: { onLost: () => void }) => {
      if (renderer.modernFails) throw new Error('no webgl 2');
      renderer.modern.created++;
      renderer.modern.lost = opts.onLost;
      return {
        draw: () => void renderer.modern.draws++,
        resize: () => {},
        shake: () => {},
        effects: () => {},
        dispose: () => void renderer.modern.disposed++,
        setLevel: (decor: unknown, seed: string) => void renderer.modern.levels.push({ decor, seed }),
      };
    };
  },
}));

// The network and the human check are stubbed. The session is created with a banked score so a game can end
// through the restart key (five lives, five presses) without being played.
const net = vi.hoisted(() => ({
  stamp: null as string | null,
  top: null as unknown,
  post: null as unknown,
  posted: [] as unknown[],
  token: null as string | null,
  opened: 0,
  startScore: 0,
}));
vi.mock('../src/scripts/scores-client', () => ({
  createScoresClient: () => ({
    start: async () => net.stamp,
    top: async () => net.top,
    post: async (body: unknown) => {
      net.posted.push(body);
      return net.post;
    },
  }),
}));
vi.mock('../src/scripts/scores-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/scripts/scores-ui')>()),
  createHumanCheck: () => ({ open: () => void net.opened++, wait: async () => net.token, reset: () => {} }),
}));
vi.mock('../src/lib/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/session')>();
  return { ...real, newSession: (...a: Parameters<typeof real.newSession>) => ({ ...real.newSession(...a), score: net.startScore }) };
});

let frame: FrameRequestCallback = () => {};
const root = () => document.querySelector<HTMLElement>('[data-game]')!;
const q = (sel: string) => root().querySelector<HTMLElement>(sel)!;
const click = (sel: string) => q(sel).click();
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const saved = () => JSON.parse(localStorage.getItem('cls.mine-lode') ?? 'null');

// The page is read once, waiting for dist/ to exist: a build running alongside (it empties dist/ first) made
// the first boot() throw ENOENT.
let page = '';
beforeAll(async () => {
  page = await vi.waitFor(() => read('index.html'), { timeout: 60_000, interval: 250 });
}, 65_000);

async function boot(music?: string | null): Promise<void> {
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)![1].replace(/<script[\s\S]*?<\/script>/g, '');
  if (music === null) root().removeAttribute('data-music');
  else if (music !== undefined) root().setAttribute('data-music', music);
  vi.resetModules();
  await import('../src/scripts/main.ts');
}

// Each boot() adds window listeners; drop the previous page's so a game left on the initials panel cannot swallow keys.
const windowListeners: Parameters<typeof window.addEventListener>[] = [];
const addToWindow = window.addEventListener.bind(window);
window.addEventListener = ((...args: Parameters<typeof window.addEventListener>) => {
  windowListeners.push(args);
  addToWindow(...args);
}) as typeof window.addEventListener;

beforeEach(() => {
  for (const args of windowListeners.splice(0)) window.removeEventListener(args[0], args[1], args[2]);
  localStorage.clear();
  Object.assign(net, { stamp: null, top: null, post: null, posted: [], token: null, opened: 0, startScore: 0 });
  renderer.fail = false;
  renderer.draws = 0;
  renderer.effects = 0;
  renderer.modernFails = false;
  renderer.importFails = false;
  renderer.classic = { created: 0, disposed: 0 };
  renderer.modern = { created: 0, disposed: 0, draws: 0, levels: [], lost: null };
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  window.matchMedia = globalThis.matchMedia;
});

describe('menu', () => {
  it('shows the menu with one button per campaign level and only level 1 unlocked', async () => {
    await boot();
    expect(root().dataset.screen).toBe('menu');
    expect(q('[data-panel="menu"]').hidden).toBe(false);
    const levels = [...root().querySelectorAll<HTMLButtonElement>('[data-levels] button')];
    expect(levels.length).toBe(CAMPAIGN_LEVELS);
    expect(levels.filter((b) => !b.disabled).map((b) => b.textContent)).toEqual(['1']);
  });
  it('unlocks levels and shows best scores from a saved game', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify({
      version: 1, unlocked: 3, best: { campaign: 4200, endless: 900 }, lastSeed: 'abc', effects: true, music: false,
    }));
    await boot();
    expect(root().querySelectorAll('[data-levels] button:not([disabled])').length).toBe(3);
    expect(q('[data-best-campaign]').textContent).toBe('4200');
    expect(q('[data-best-endless]').textContent).toBe('900');
    expect((q('[data-seed]') as HTMLInputElement).value).toBe('abc');
    expect(q('[data-act="toggle-music"]').getAttribute('aria-pressed')).toBe('false');
  });
  it('still starts when the saved data is garbage', async () => {
    localStorage.setItem('cls.mine-lode', '{not json');
    await boot();
    expect(root().dataset.screen).toBe('menu');
    expect(root().querySelectorAll('[data-levels] button:not([disabled])').length).toBe(1);
  });
});

describe('music setting', () => {
  it('boots and plays with data-music missing or malformed', async () => {
    for (const music of [null, '{not json', '[1,2]', '{"menu":5}']) {
      await boot(music);
      expect(root().dataset.screen).toBe('menu');
      click('[data-act="campaign"]');
      expect(root().dataset.screen).toBe('play');
    }
  });
});

describe('playing', () => {
  it('starts the campaign with five lives on level 1', async () => {
    await boot();
    click('[data-act="campaign"]');
    expect(root().dataset.screen).toBe('play');
    expect(q('[data-panel="menu"]').hidden).toBe(true);
    expect(q('[data-hud-lives]').textContent).toBe('5');
    expect(q('[data-hud-level]').textContent).toBe('1');
    expect(Number(q('[data-hud-gold]').textContent)).toBeGreaterThan(0);
  });
  it('starts a chosen unlocked level', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify({
      version: 1, unlocked: 3, best: { campaign: 0, endless: 0 }, lastSeed: '', effects: true, music: true,
    }));
    await boot();
    click('[data-levels] button[data-level="2"]');
    expect(q('[data-hud-level]').textContent).toBe('2');
  });
  it('starts endless mode and fills in a seed when the box is blank or only spaces', async () => {
    await boot();
    (q('[data-seed]') as HTMLInputElement).value = '   ';
    click('[data-act="endless"]');
    expect(root().dataset.screen).toBe('play');
    expect((q('[data-seed]') as HTMLInputElement).value.trim().length).toBeGreaterThan(0);
  });
  it('draws frames and survives a very long gap between them', async () => {
    await boot();
    click('[data-act="campaign"]');
    const before = renderer.draws;
    frame(1000);
    frame(1016);
    expect(() => frame(1016 + 10 * 60 * 1000)).not.toThrow();
    expect(renderer.draws).toBeGreaterThan(before);
    expect(root().dataset.screen).toBe('play');
    expect(q('[data-hud-lives]').textContent).toBe('5');
  });
});

describe('effects', () => {
  it('hands the renderer the effects of every simulated tick without throwing', async () => {
    await boot();
    click('[data-act="campaign"]');
    frame(1000);
    expect(() => {
      for (let t = 1016; t < 1016 + 600; t += 16) frame(t);
    }).not.toThrow();
    expect(renderer.effects).toBeGreaterThan(0);
    expect(root().dataset.screen).toBe('play');
  });
});

describe('pausing', () => {
  it('toggles with P and with the buttons', async () => {
    await boot();
    click('[data-act="campaign"]');
    key('p');
    expect(root().dataset.screen).toBe('pause');
    expect(q('[data-panel="pause"]').hidden).toBe(false);
    key('p');
    expect(root().dataset.screen).toBe('play');
    click('[data-act="pause"]');
    click('[data-act="resume"]');
    expect(root().dataset.screen).toBe('play');
  });
  it('pauses when the tab is hidden', async () => {
    await boot();
    click('[data-act="campaign"]');
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root().dataset.screen).toBe('pause');
  });
  it('does not pause from the menu', async () => {
    await boot();
    key('p');
    expect(root().dataset.screen).toBe('menu');
  });
  it('restarting costs a life', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await boot();
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    click('[data-act="restart"]');
    vi.runAllTimers();
    vi.useRealTimers();
    expect(root().dataset.screen).toBe('play');
    expect(q('[data-hud-lives]').textContent).toBe('4');
  });
  it('quits to the menu', async () => {
    await boot();
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    click('[data-panel="pause"] [data-act="menu"]');
    expect(root().dataset.screen).toBe('menu');
  });
});

describe('sound settings', () => {
  it('saves each toggle', async () => {
    await boot();
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    click('[data-act="toggle-music"]');
    expect(q('[data-act="toggle-music"]').getAttribute('aria-pressed')).toBe('false');
    expect(saved().music).toBe(false);
    expect(saved().effects).toBe(true);
  });
  it('flips the screen effect on the root, the button and the save', async () => {
    await boot();
    expect(root().dataset.crt).toBe('on');
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    expect(q('[data-act="toggle-crt"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-act="toggle-crt"]');
    expect(root().dataset.crt).toBe('off');
    expect(q('[data-act="toggle-crt"]').getAttribute('aria-pressed')).toBe('false');
    expect(saved().crt).toBe(false);
    expect(saved().music).toBe(true);
    click('[data-act="toggle-crt"]');
    expect(root().dataset.crt).toBe('on');
    expect(saved().crt).toBe(true);
  });
  it('boots with the effect off when the save says so, and the button agrees', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify({
      version: 2, unlocked: 1, best: { campaign: 0, endless: 0 }, lastSeed: '', effects: true, music: true, crt: false,
      scores: { campaign: [], endless: [] }, initials: '',
    }));
    await boot();
    expect(root().dataset.crt).toBe('off');
    expect(q('[data-act="toggle-crt"]').getAttribute('aria-pressed')).toBe('false');
  });
  it('leaves the sound toggles working after the screen effect is flipped', async () => {
    await boot();
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    click('[data-act="toggle-crt"]');
    click('[data-act="toggle-effects"]');
    expect(saved().effects).toBe(false);
    expect(saved().crt).toBe(false);
  });
  it('M mutes everything, then unmutes everything', async () => {
    await boot();
    key('m');
    expect([saved().effects, saved().music]).toEqual([false, false]);
    key('m');
    expect([saved().effects, saved().music]).toEqual([true, true]);
  });
});

describe('failure', () => {
  it('shows the error panel when WebGL is unavailable', async () => {
    renderer.fail = true;
    await boot();
    click('[data-act="campaign"]');
    expect(root().dataset.screen).toBe('error');
    expect(q('[data-panel="error"]').hidden).toBe(false);
  });
  it('still runs when storage throws', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    try {
      await boot();
      click('[data-act="campaign"]');
      expect(root().dataset.screen).toBe('play');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

const row = (score: number, name = 'AAA', over: Record<string, unknown> = {}) => ({
  name, score, level: 3, seed: '', date: '2026-10-01', ...over,
});
const seed = (extra: Record<string, unknown> = {}) =>
  localStorage.setItem('cls.mine-lode', JSON.stringify({
    version: 2, unlocked: 1, best: { campaign: 0, endless: 0 }, lastSeed: '', effects: true, music: true,
    scores: { campaign: [], endless: [] }, initials: '', ...extra,
  }));
const rows = () => [...root().querySelectorAll('[data-scores-body] tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
const slots = () => [...root().querySelectorAll<HTMLElement>('[data-initial]')].map((el) => el.textContent).join('');
const note = (sel: string) => q(sel).textContent ?? '';
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const onSlot = (i: number, k: string) =>
  root().querySelectorAll('[data-initial]')[i].dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

/** Starts a campaign game and ends it with the restart key, after the start stamp has had time to arrive. */
async function endGame(score = 500): Promise<void> {
  net.startScore = score;
  click('[data-act="campaign"]');
  await settle();
  for (let i = 0; i < 5; i++) key('r');
}

describe('high scores panel', () => {
  it('opens from the menu and shows the device table at once', async () => {
    seed({ scores: { campaign: [row(900, 'ZED'), row(400, 'AMY')], endless: [] } });
    await boot();
    click('[data-act="scores"]');
    expect(root().dataset.screen).toBe('scores');
    expect(q('[data-panel="scores"]').hidden).toBe(false);
    expect(rows()).toEqual([['1', 'ZED', '900', '3', '2026-10-01'], ['2', 'AMY', '400', '3', '2026-10-01']]);
  });
  it('says the shared board is unavailable and keeps the device rows when the client fails', async () => {
    seed({ scores: { campaign: [row(900, 'ZED')], endless: [] } });
    await boot();
    click('[data-act="scores"]');
    expect(note('[data-scores-note]')).toMatch(/loading the shared board/i);
    await vi.waitFor(() => expect(note('[data-scores-note]')).toMatch(/shared board is unavailable\. showing this device\./i));
    expect(rows()).toEqual([['1', 'ZED', '900', '3', '2026-10-01']]);
    expect(q('[data-scores-scope="device"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-scores-scope="everyone"]');
    await vi.waitFor(() => expect(note('[data-scores-note]')).toMatch(/unavailable/i));
    expect(rows().length).toBe(1);
  });
  it('shows the shared rows when the client answers', async () => {
    net.top = [row(5000, 'BOB', { date: '2026-10-12T09:00:00.000Z' })];
    await boot();
    click('[data-act="scores"]');
    await vi.waitFor(() => expect(rows()).toEqual([['1', 'BOB', '5000', '3', '2026-10-12']]));
    expect(q('[data-scores-scope="everyone"]').getAttribute('aria-pressed')).toBe('true');
  });
  it('switches between the campaign and endless tables, and endless rows show the seed', async () => {
    seed({ scores: { campaign: [row(900, 'ZED')], endless: [row(300, 'EVE', { seed: 'moon' })] } });
    await boot();
    click('[data-act="scores"]');
    click('[data-scores-scope="device"]');
    click('[data-scores-tab="endless"]');
    expect(rows()).toEqual([['1', 'EVE', '300', '3', 'moon', '2026-10-01']]);
    expect(q('[data-scores-tab="endless"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-scores-tab="campaign"]');
    expect(rows()[0][1]).toBe('ZED');
  });
  it('builds rows from text only', async () => {
    seed({ scores: { campaign: [row(900, 'ZED')], endless: [] } });
    await boot();
    click('[data-act="scores"]');
    expect(root().querySelector('[data-scores-body] *:not(tr):not(td)')).toBeNull();
  });
  it('closes back to the menu', async () => {
    await boot();
    click('[data-act="scores"]');
    click('[data-act="scores-close"]');
    expect(root().dataset.screen).toBe('menu');
  });
  it('still boots a version 1 save and opens an empty board', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify({
      version: 1, unlocked: 3, best: { campaign: 10, endless: 0 }, lastSeed: '', effects: true, music: true,
    }));
    await boot();
    expect(root().querySelectorAll('[data-levels] button:not([disabled])').length).toBe(3);
    click('[data-act="scores"]');
    click('[data-scores-scope="device"]');
    expect(rows()).toEqual([]);
    expect(note('[data-scores-note]')).toMatch(/no scores yet/i);
  });
});

describe('initials after a game', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 12));
  });
  afterEach(() => vi.useRealTimers());

  it('asks for initials, prefilled with AAA, and loads the human check once it opens', async () => {
    await boot();
    expect(net.opened).toBe(0);
    await endGame();
    expect(root().dataset.screen).toBe('initials');
    expect(q('[data-panel="initials"]').hidden).toBe(false);
    expect(slots()).toBe('AAA');
    expect(net.opened).toBe(1);
  });
  it('prefills the last initials used', async () => {
    seed({ initials: 'XYZ' });
    await boot();
    await endGame();
    expect(slots()).toBe('XYZ');
  });
  it('skips initials for a zero score', async () => {
    await boot();
    await endGame(0);
    expect(root().dataset.screen).toBe('over');
    expect(net.opened).toBe(0);
  });
  it('skips initials when the score enters neither table', async () => {
    const full = Array.from({ length: 10 }, (_, i) => row(5000 - i, 'AAA'));
    seed({ scores: { campaign: full, endless: [] } });
    await boot();
    await endGame(100);
    expect(root().dataset.screen).toBe('over');
  });
  it('asks when the score only enters the last-fetched shared board', async () => {
    const full = Array.from({ length: 10 }, (_, i) => row(5000 - i, 'AAA'));
    seed({ scores: { campaign: full, endless: [] } });
    net.top = [row(50, 'BOB')];
    await boot();
    click('[data-act="scores"]');
    await vi.waitFor(() => expect(rows()[0][1]).toBe('BOB'));
    click('[data-act="scores-close"]');
    await endGame(100);
    expect(root().dataset.screen).toBe('initials');
  });

  it('changes the focused letter with the arrow keys and wraps, without moving or pausing the game', async () => {
    await boot();
    await endGame();
    key('ArrowUp');
    expect(slots()).toBe('BAA');
    key('ArrowDown');
    key('ArrowDown');
    expect(slots()).toBe('ZAA');
    key('ArrowRight');
    key('ArrowUp');
    expect(slots()).toBe('ZBA');
    key('ArrowLeft');
    key('ArrowUp');
    expect(slots()).toBe('ABA');
    expect(root().dataset.screen).toBe('initials');
  });
  it('types a letter into the slot and advances, and game keys do not act', async () => {
    await boot();
    await endGame();
    for (const k of ['p', 'm', 'r']) key(k);
    expect(slots()).toBe('PMR');
    expect(root().dataset.screen).toBe('initials');
    expect(saved().music).toBe(true);
    key('q');
    expect(slots()).toBe('PMQ');
  });
  it('leaves the arrow keys to the game when the panel is not open', async () => {
    await boot();
    click('[data-act="campaign"]');
    key('ArrowUp');
    expect(root().dataset.screen).toBe('play');
    expect(slots()).toBe('AAA');
  });
  it('changes a letter with the on-screen up and down buttons of that slot', async () => {
    await boot();
    await endGame();
    root().querySelectorAll<HTMLButtonElement>('button[data-initial-up]')[1].click();
    root().querySelectorAll<HTMLButtonElement>('button[data-initial-down]')[2].click();
    expect(slots()).toBe('ABZ');
  });
  it('makes the slots reachable with Tab', async () => {
    await boot();
    await endGame();
    for (const el of root().querySelectorAll('[data-initial]')) expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('saves the initials and the row on this device when OK is pressed, even with no stamp', async () => {
    await boot();
    await endGame(500);
    onSlot(0, 'b');
    key('c');
    key('d');
    expect(slots()).toBe('BCD');
    key('Enter');
    expect(saved().initials).toBe('BCD');
    expect(saved().scores.campaign).toEqual([{ name: 'BCD', score: 500, level: 1, seed: '', date: '2026-10-13' }]);
    expect(net.posted).toEqual([]);
    expect(root().dataset.screen).toBe('scores');
    expect(note('[data-scores-note]')).toMatch(/saved on this device only\. the shared board did not take the score\./i);
    expect(rows()[0].slice(0, 3)).toEqual(['1', 'BCD', '500']);
    expect(q('[data-scores-body] tr').getAttribute('aria-current')).toBe('true');
  });
  it('does not save a blocked combination and says why', async () => {
    await boot();
    await endGame();
    for (const k of ['a', 's', 's']) key(k);
    click('[data-act="initials-ok"]');
    expect(root().dataset.screen).toBe('initials');
    expect(note('[data-initials-note]').length).toBeGreaterThan(0);
    expect(saved().scores.campaign).toEqual([]);
  });
  it('leaves the device row and shows the device-only note when the post fails', async () => {
    net.stamp = 'stamp-1';
    net.token = 'token-1';
    await boot();
    await endGame(500);
    click('[data-act="initials-ok"]');
    expect(note('[data-initials-note]')).toMatch(/saved\. sending/i);
    await vi.waitFor(() => expect(root().dataset.screen).toBe('scores'));
    expect(net.posted).toEqual([{
      mode: 'campaign', name: 'AAA', score: 500, level: 1, cleared: 0, seed: '', stamp: 'stamp-1', turnstile: 'token-1',
    }]);
    expect(saved().scores.campaign.length).toBe(1);
    expect(note('[data-scores-note]')).toMatch(/saved on this device only/i);
    expect(rows().length).toBe(1);
  });
  it('skips the post, but keeps the device row, when the human check gives no token', async () => {
    net.stamp = 'stamp-1';
    await boot();
    await endGame();
    click('[data-act="initials-ok"]');
    await vi.waitFor(() => expect(root().dataset.screen).toBe('scores'));
    expect(net.posted).toEqual([]);
    expect(saved().scores.campaign.length).toBe(1);
    expect(note('[data-scores-note]')).toMatch(/saved on this device only/i);
  });
  it('shows the shared board with the new row marked after a good post', async () => {
    net.stamp = 'stamp-1';
    net.token = 'token-1';
    net.post = { rank: 2, scores: [row(900, 'ZED', { date: '2026-10-12T10:00:00.000Z' }), row(500, 'AAA', { level: 1, date: '2026-10-13T12:00:00.000Z' })] };
    await boot();
    await endGame(500);
    click('[data-act="initials-ok"]');
    await vi.waitFor(() => expect(root().dataset.screen).toBe('scores'));
    expect(rows().map((r) => r[1])).toEqual(['ZED', 'AAA']);
    const marked = [...root().querySelectorAll('[data-scores-body] tr[aria-current="true"]')];
    expect(marked.length).toBe(1);
    expect(marked[0].textContent).toContain('AAA');
    expect(note('[data-scores-note]')).not.toMatch(/device only/i);
    expect(q('[data-scores-scope="everyone"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-act="scores-close"]');
    expect(root().dataset.screen).toBe('over');
  });
  it('saves nothing anywhere when Skip is pressed, and goes to the over panel', async () => {
    net.stamp = 'stamp-1';
    net.token = 'token-1';
    await boot();
    await endGame();
    click('[data-act="initials-skip"]');
    expect(root().dataset.screen).toBe('over');
    expect(saved().scores.campaign).toEqual([]);
    expect(saved().initials).toBe('');
    await settle();
    expect(net.posted).toEqual([]);
  });
  it('records endless games in the endless table with the seed', async () => {
    await boot();
    net.startScore = 700;
    (q('[data-seed]') as HTMLInputElement).value = 'moon';
    click('[data-act="endless"]');
    await settle();
    for (let i = 0; i < 5; i++) key('r');
    click('[data-act="initials-ok"]');
    expect(saved().scores.endless).toEqual([{ name: 'AAA', score: 700, level: 1, seed: 'moon', date: '2026-10-13' }]);
    expect(saved().scores.campaign).toEqual([]);
  });
});

describe('module shape', () => {
  it('calls init as its last statement', () => {
    const source = readFileSync(join(__dirname, '..', 'src/scripts/main.ts'), 'utf-8');
    expect(source.trimEnd().endsWith('\ninit();')).toBe(true);
  });
});

describe('graphics setting', () => {
  const MODERN_SAVE = {
    version: 2, unlocked: 1, best: { campaign: 0, endless: 0 }, lastSeed: '', effects: true, music: true, crt: true, graphics: 'modern',
    scores: { campaign: [], endless: [] }, initials: '',
  };
  const radios = (panel: string) => [...root().querySelectorAll<HTMLInputElement>(`[data-panel="${panel}"] input[data-graphics]`)];
  const checked = (panel: string) => radios(panel).find((r) => r.checked)?.value;
  const modernUp = () => vi.waitFor(() => expect(renderer.modern.created).toBeGreaterThanOrEqual(1));
  const choose = (panel: string, value: string) => radios(panel).find((r) => r.value === value)!.click();

  it('offers Classic and Modern on the menu and the pause panel, Classic checked for a fresh save', async () => {
    await boot();
    for (const panel of ['menu', 'pause']) {
      expect(radios(panel).map((r) => r.value), panel).toEqual([...GRAPHICS]);
      expect(checked(panel), panel).toBe('classic');
      const labels = radios(panel).map((r) => r.closest('label')?.textContent?.trim());
      expect(labels).toEqual(GRAPHICS.map((g) => GRAPHICS_LABELS[g]));
    }
    expect(new Set(radios('menu').concat(radios('pause')).map((r) => r.id)).size).toBe(4);
  });
  it('boots Classic for an old save without the field and never loads Modern', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify({ version: 1, unlocked: 2, best: { campaign: 5, endless: 0 }, lastSeed: '', effects: true, music: true }));
    await boot();
    click('[data-act="campaign"]');
    expect(root().dataset.screen).toBe('play');
    expect(renderer.classic.created).toBe(1);
    expect(renderer.modern.created).toBe(0);
    expect(checked('menu')).toBe('classic');
    expect(root().querySelectorAll('[data-levels] button:not([disabled])').length).toBe(2);
  });
  it('switches to Modern mid-level: saves the choice, swaps the renderer, keeps level, lives and score', async () => {
    await boot();
    click('[data-act="campaign"]');
    const hud = () => ['[data-hud-level]', '[data-hud-score]', '[data-hud-lives]', '[data-hud-gold]'].map((s) => q(s).textContent);
    const before = hud();
    click('[data-act="pause"]');
    choose('pause', 'modern');
    await modernUp();
    expect(renderer.modern.created).toBe(1);
    expect(renderer.classic.disposed).toBe(1);
    expect(saved().graphics).toBe('modern');
    expect(hud()).toEqual(before);
    expect(root().dataset.screen).toBe('pause');
    expect(renderer.modern.draws).toBeGreaterThan(0);
    expect(checked('menu')).toBe('modern');
    expect(checked('pause')).toBe('modern');
    click('[data-act="resume"]');
    expect(root().dataset.screen).toBe('play');
    expect(renderer.modern.created).toBe(1);
  });
  it('gives a Modern renderer the level decor and the campaign seed right after it is created', async () => {
    await boot();
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    choose('pause', 'modern');
    await modernUp();
    const [first] = renderer.modern.levels;
    expect(first.seed).toBe('campaign-1');
    expect(first.decor).toMatchObject({ props: expect.any(Array), lights: expect.any(Array), layers: expect.any(Array) });
  });
  it('boots with the Modern renderer when the save says modern, and calls setLevel on each level start', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
    await boot();
    await modernUp();
    expect(renderer.classic.created).toBe(0);
    expect(checked('menu')).toBe('modern');
    click('[data-act="campaign"]');
    expect(root().dataset.screen).toBe('play');
    expect(renderer.modern.created).toBe(1);
    expect(renderer.modern.levels.map((l) => l.seed)).toEqual(['campaign-1']);
    expect(renderer.modern.levels[0].decor).toMatchObject({ props: expect.any(Array), lights: expect.any(Array), layers: expect.any(Array) });
  });
  it('uses the endless seed and level number for Endless decor', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
    await boot();
    await modernUp();
    (q('[data-seed]') as HTMLInputElement).value = 'abc';
    click('[data-act="endless"]');
    expect(renderer.modern.levels.map((l) => l.seed)).toEqual(['endless-abc-1']);
  });
  it('starts a game that was begun while Modern was still loading', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
    await boot();
    click('[data-act="campaign"]');
    await vi.waitFor(() => expect(root().dataset.screen).toBe('play'));
    expect(renderer.modern.created).toBe(1);
    expect(renderer.classic.created).toBe(0);
  });
  it('switching back to Classic disposes Modern and saves the choice', async () => {
    localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
    await boot();
    await modernUp();
    click('[data-act="campaign"]');
    click('[data-act="pause"]');
    choose('pause', 'classic');
    expect(renderer.modern.disposed).toBe(1);
    expect(renderer.classic.created).toBe(1);
    expect(saved().graphics).toBe('classic');
    expect(checked('menu')).toBe('classic');
    expect(root().dataset.screen).toBe('pause');
  });

  describe('when Modern cannot run', () => {
    const notice = () => q('[data-gfx-note]');
    const expectFallback = async () => {
      await vi.waitFor(() => expect(renderer.classic.created).toBe(1));
      expect(notice().textContent).toBe(FALLBACK_NOTICE);
      expect(root().querySelectorAll('[data-gfx-note]').length).toBe(1);
      expect(notice().getAttribute('role')).toBe('status');
      expect(checked('menu')).toBe('classic');
      expect(checked('pause')).toBe('classic');
      // The saved choice stays modern so the next visit tries again.
      click('[data-act="toggle-music"]');
      expect(saved().graphics).toBe('modern');
      click('[data-act="campaign"]');
      expect(root().dataset.screen).toBe('play');
    };

    it('falls back to Classic with one notice when the renderer throws', async () => {
      localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
      renderer.modernFails = true;
      await boot();
      await expectFallback();
    });
    it('falls back to Classic with one notice when the module fails to load', async () => {
      localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
      renderer.importFails = true;
      await boot();
      await expectFallback();
    });
    it('falls back when the user picks Modern and it fails, leaving the level running', async () => {
      await boot();
      click('[data-act="campaign"]');
      renderer.modernFails = true;
      click('[data-act="pause"]');
      choose('pause', 'modern');
      await vi.waitFor(() => expect(notice().textContent).toBe(FALLBACK_NOTICE));
      expect(renderer.classic.created).toBe(2);
      expect(checked('pause')).toBe('classic');
      expect(root().dataset.screen).toBe('pause');
    });
    it('falls back to Classic when Modern reports a lost context', async () => {
      localStorage.setItem('cls.mine-lode', JSON.stringify(MODERN_SAVE));
      await boot();
      await modernUp();
      click('[data-act="campaign"]');
      renderer.modern.lost?.();
      expect(renderer.modern.disposed).toBe(1);
      expect(renderer.classic.created).toBe(1);
      expect(notice().textContent).toBe(FALLBACK_NOTICE);
      expect(checked('menu')).toBe('classic');
      expect(root().dataset.screen).toBe('play');
    });
  });
});
