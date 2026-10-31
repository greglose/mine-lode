// Mine Lode shell: menus, HUD, the fixed-tick loop, and the wiring between the pure game and the browser.
import { CAMPAIGN } from '../lib/campaign';
import { stepsDue } from '../lib/clock';
import { decorOf } from '../lib/decor';
import { FALLBACK_NOTICE, isGraphics, levelSeed, type Graphics } from '../lib/graphics';
import { generateLevel } from '../lib/generate';
import type { Level } from '../lib/level';
import { loadSave, withProgress, writeSave, type Save } from '../lib/save';
import {
  CAMPAIGN_LEVELS, afterClear, afterDeath, cleanSeed, newSession, type Mode, type Session,
} from '../lib/session';
import { effectsOf } from '../lib/scene';
import { step } from '../lib/sim';
import { initState, type GameEvent, type GameState } from '../lib/state';
import { TUNE_NAMES } from '../lib/tunes';
import { parseBackground } from '../lib/color';
import { parseTracks, pickPlayTrack, trackCount } from '../lib/music';
import { dayKey, needsInitials, scoreEntry } from '../lib/scores';
import { createAudio } from './audio';
import { createInput } from './input';
import { createRenderer } from './render';
import type { Renderer } from './render-shared';
import { createScoresClient } from './scores-client';
import { createHumanCheck, createScoresUi } from './scores-ui';
import { registerSW, safeStorage } from './pwa';

/** How long the fallback notice stays up. */
const NOTICE_MS = 8000;

type Screen = 'menu' | 'play' | 'pause' | 'clear' | 'over' | 'error' | 'scores' | 'initials';
const RESPAWN_MS = 900;

function init(): void {
  const root = document.querySelector<HTMLElement>('[data-game]');
  if (!root) return;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('[data-canvas]');
  const seedInput = q<HTMLInputElement>('[data-seed]');
  const store = safeStorage();

  let save = loadSave(store);
  let screen: Screen = 'menu';
  let session: Session | null = null;
  let state: GameState | null = null;
  let renderer: Renderer | null = null;
  /** The level being played, kept so a renderer created mid-level can be given its decor. */
  let level: Level | null = null;
  /** Which look the live renderer has; null before the first one exists. */
  let current: Graphics | null = null;
  /** Bumped on every renderer swap and every choice, so a late import or a lost-context report from a retired renderer is ignored. */
  let epoch = 0;
  /** A Modern renderer being loaded; a game started meanwhile waits for it. */
  let loading: Promise<void> | null = null;
  let acc = 0;
  let last = 0;
  /** True once the end of the current level (death or clear) has been handled. */
  let settled = false;
  /** Start stamp of the running game; null until the server answers, or if it never does. */
  let stamp: string | null = null;
  let games = 0;

  const tracks = parseTracks(root.dataset.music, TUNE_NAMES);
  const audio = createAudio(() => (typeof AudioContext === 'undefined' ? null : new AudioContext()), { tracks });
  /** Which play file the current level uses; picked once per level (a retry after a death keeps it). */
  let playVariant = 0;
  let pickedFor = '';
  audio.setEffects(save.effects);
  audio.setMusic(save.music);
  const showCrt = (on: boolean): void => {
    root.dataset.crt = on ? 'on' : 'off';
    q('[data-act="toggle-crt"]').setAttribute('aria-pressed', String(on));
  };
  showCrt(save.crt);
  const input = createInput(window, root);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');

  const show = (next: Screen): void => {
    screen = next;
    root.dataset.screen = next;
    for (const panel of root.querySelectorAll<HTMLElement>('[data-panel]')) panel.hidden = panel.dataset.panel !== next;
    input.clear();
    if (next === 'pause') audio.pause();
    else audio.resume();
    if (next === 'play') audio.music('play', playVariant);
    else audio.music(next === 'menu' ? 'menu' : null);
  };

  const renderMenu = (): void => {
    q('[data-levels]').replaceChildren(
      ...Array.from({ length: CAMPAIGN_LEVELS }, (_, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gbtn';
        b.textContent = String(i + 1);
        b.dataset.level = String(i + 1);
        b.disabled = i + 1 > save.unlocked;
        b.setAttribute('aria-label', `Level ${i + 1}${b.disabled ? ' (locked)' : ''}`);
        return b;
      }),
    );
    q('[data-best-campaign]').textContent = String(save.best.campaign);
    q('[data-best-endless]').textContent = String(save.best.endless);
    if (!seedInput.value) seedInput.value = save.lastSeed;
    q('[data-act="toggle-effects"]').setAttribute('aria-pressed', String(save.effects));
    q('[data-act="toggle-music"]').setAttribute('aria-pressed', String(save.music));
  };

  const client = createScoresClient();
  const ui = createScoresUi({
    root,
    client,
    humanCheck: createHumanCheck(document),
    siteKey: root.dataset.turnstileKey ?? '',
    getSave: () => save,
    commit: (next: Save) => {
      save = next;
      writeSave(store, save);
    },
    takeStamp: () => {
      const s = stamp;
      stamp = null;
      return s;
    },
    show,
  });

  const hud = (): void => {
    if (!session || !state) return;
    q('[data-hud-level]').textContent = String(session.level);
    q('[data-hud-score]').textContent = String(session.score + state.score);
    q('[data-hud-lives]').textContent = String(session.lives);
    q('[data-hud-gold]').textContent = String(state.goldLeft);
  };

  const rendererOptions = (onLost: () => void) => ({ background: parseBackground(root.dataset.bg), reducedMotion, onLost });

  const showGraphics = (value: Graphics): void => {
    for (const radio of root.querySelectorAll<HTMLInputElement>('input[data-graphics]')) radio.checked = radio.value === value;
  };

  /** Gives the live renderer the decor of the level in play, if it draws decor. */
  const decorate = (): void => {
    if (!renderer?.setLevel || !session || !level) return;
    const seed = levelSeed(session.mode, session.level, session.seed);
    renderer.setLevel(decorOf(level, seed), seed);
  };

  /** Retires the live renderer and puts `make()` on the same canvas, then catches it up with the game. False if it throws. */
  const mount = (kind: Graphics, make: (live: () => boolean) => Renderer): boolean => {
    renderer?.dispose();
    renderer = null;
    current = null;
    const mine = ++epoch;
    try {
      renderer = make(() => mine === epoch);
    } catch {
      return false;
    }
    current = kind;
    renderer.resize(canvas.clientWidth || 960, canvas.clientHeight || 540);
    decorate();
    if (state) renderer.draw(state);
    return true;
  };

  const mountClassic = (): boolean => {
    const ok = mount('classic', (live) => createRenderer(canvas, rendererOptions(() => {
      if (live()) show('error');
    })));
    if (!ok) show('error');
    return ok;
  };

  let noticeTimer = 0;
  const fallBack = (): void => {
    if (!mountClassic()) return;
    showGraphics('classic');
    // The saved choice stays as it was, so the next visit tries Modern again.
    const note = q('[data-gfx-note]');
    note.textContent = FALLBACK_NOTICE;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      note.textContent = '';
    }, NOTICE_MS);
  };

  const loadModern = (): Promise<void> => {
    const mine = ++epoch;
    const job = (async () => {
      try {
        const { createModernRenderer } = await import('./render-modern');
        if (mine !== epoch) return;
        const made = mount('modern', (live) => createModernRenderer(canvas, rendererOptions(() => {
          if (live()) fallBack();
        })));
        if (!made) fallBack();
      } catch {
        if (mine === epoch) fallBack();
      }
    })();
    const tracked = job.finally(() => {
      if (loading === tracked) loading = null;
    });
    loading = tracked;
    return tracked;
  };

  const ready = (): boolean => {
    if (renderer) return true;
    return mountClassic();
  };

  const chooseGraphics = (value: Graphics): void => {
    save = { ...save, graphics: value };
    writeSave(store, save);
    showGraphics(value);
    if (value === current) return;
    if (value === 'modern') void loadModern();
    else {
      ++epoch;
      if (renderer) mountClassic();
    }
  };

  const startLevel = (): void => {
    if (!session) return;
    level = session.mode === 'campaign' ? CAMPAIGN[session.level - 1] : generateLevel(session.seed, session.level);
    state = initState(level);
    acc = 0;
    settled = false;
    hud();
    const levelKey = `${games}:${session.level}`;
    if (levelKey !== pickedFor) {
      pickedFor = levelKey;
      playVariant = pickPlayTrack(trackCount(tracks.play), session.level, Math.random);
    }
    show('play');
    decorate();
    renderer?.draw(state);
  };

  const start = (mode: Mode, levelNumber: number, seed: string): void => {
    if (loading) {
      void loading.then(() => start(mode, levelNumber, seed));
      return;
    }
    if (!ready()) return;
    session = newSession(mode, levelNumber, seed);
    // The stamp arrives in the background; a game never waits for it.
    const id = ++games;
    stamp = null;
    void client.start(mode).then((s) => {
      if (id === games) stamp = s;
    });
    startLevel();
  };

  const persist = (): void => {
    if (!session) return;
    save = withProgress(save, session);
    writeSave(store, save);
  };

  const finish = (title: string, finished = false): void => {
    q('[data-over-title]').textContent = title;
    q('[data-over-score]').textContent = String(session?.score ?? 0);
    const entry = session ? scoreEntry(session, finished, dayKey(new Date())) : null;
    if (entry && needsInitials(save.scores[entry.mode], ui.sharedBoard(entry.mode), entry.row.score)) ui.askInitials(entry);
    else show('over');
  };

  const loseLife = (delayMs: number): void => {
    if (!session) return;
    const r = afterDeath(session);
    session = r.session;
    hud();
    if (r.gameOver) {
      persist();
      audio.play(['gameOver']);
      finish('Game over');
      return;
    }
    window.setTimeout(() => {
      if (screen === 'play') startLevel();
    }, delayMs);
  };

  const settle = (): void => {
    if (!session || !state || settled || state.status === 'playing') return;
    settled = true;
    if (state.status === 'dead') {
      renderer?.shake();
      loseLife(RESPAWN_MS);
      return;
    }
    const r = afterClear(session, state.score);
    session = r.session;
    persist();
    if (r.campaignDone) finish('Campaign complete', true);
    else show('clear');
  };

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = last ? now - last : 0;
    last = now;
    if (screen !== 'play' || !state || !renderer) return;
    const due = stepsDue(acc, dt);
    acc = due.acc;
    const events: GameEvent[] = [];
    for (let i = 0; i < due.steps; i++) {
      const before = state;
      const r = step(before, input.read());
      state = r.state;
      events.push(...r.events);
      renderer.effects(effectsOf(before, r.state, r.events));
    }
    audio.play(events);
    renderer.draw(state);
    hud();
    settle();
  };

  const toggle = (which: 'effects' | 'music', on = !save[which]): void => {
    save = { ...save, [which]: on };
    writeSave(store, save);
    if (which === 'effects') audio.setEffects(on);
    else audio.setMusic(on);
    q(`[data-act="toggle-${which}"]`).setAttribute('aria-pressed', String(on));
  };

  const toggleCrt = (): void => {
    save = { ...save, crt: !save.crt };
    writeSave(store, save);
    showCrt(save.crt);
  };

  const act = (name: string, el: HTMLElement): void => {
    switch (name) {
      case 'campaign':
        start('campaign', save.unlocked, '');
        break;
      case 'level':
        start('campaign', Number(el.dataset.level), '');
        break;
      case 'endless': {
        const seed = cleanSeed(seedInput.value) || Math.random().toString(36).slice(2, 10);
        seedInput.value = seed;
        start('endless', 1, seed);
        break;
      }
      case 'pause':
        if (screen === 'play') show('pause');
        break;
      case 'resume':
        if (screen === 'pause') show('play');
        break;
      case 'restart':
        if (screen !== 'play' && screen !== 'pause') break;
        settled = true;
        show('play');
        loseLife(0);
        break;
      case 'next':
        startLevel();
        break;
      case 'menu':
        session = null;
        state = null;
        renderMenu();
        show('menu');
        break;
      case 'toggle-effects':
        toggle('effects');
        break;
      case 'toggle-music':
        toggle('music');
        break;
      case 'toggle-crt':
        toggleCrt();
        break;
      case 'reload':
        window.location.reload();
        break;
      case 'scores':
      case 'scores-close':
      case 'initials-ok':
      case 'initials-skip':
        ui.act(name);
        break;
    }
  };

  root.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLButtonElement>('[data-act], [data-level]');
    if (!el || el.disabled) return;
    audio.unlock();
    audio.play(['click']);
    act(el.dataset.act ?? 'level', el);
  });
  root.addEventListener('change', (e) => {
    const radio = (e.target as Element).closest<HTMLInputElement>('input[data-graphics]');
    if (radio?.checked && isGraphics(radio.value)) chooseGraphics(radio.value);
  });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });
  // While the initials panel is open it owns the keyboard: the game must not see these keys.
  window.addEventListener('keydown', (e) => {
    if (screen !== 'initials') return;
    e.stopImmediatePropagation();
    ui.key(e);
  }, true);
  input.onAction((a) => {
    if (a === 'pause') act(screen === 'pause' ? 'resume' : 'pause', root);
    else if (a === 'restart') {
      if (screen === 'play') act('restart', root);
    } else {
      const on = !(save.effects || save.music);
      toggle('effects', on);
      toggle('music', on);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) act('pause', root);
  });
  portrait.addEventListener('change', () => {
    if (portrait.matches) act('pause', root);
  });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => renderer?.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
  }

  void registerSW({
    base: import.meta.env.BASE_URL,
    dev: import.meta.env.DEV,
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    onUpdate: () => {
      q('[data-update]').hidden = false;
    },
    loaded: () => performance.getEntriesByType('resource').map((e) => e.name),
    cacheStorage: typeof caches === 'undefined' ? undefined : caches,
  });
  renderMenu();
  show('menu');
  showGraphics(save.graphics);
  // A saved Modern choice starts loading now, so it is usually ready by the time a game starts.
  if (save.graphics === 'modern') void loadModern();
  requestAnimationFrame(frame);
}

init();
