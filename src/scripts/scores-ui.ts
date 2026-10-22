// The High scores panel and the initials panel, and the human check behind the initials panel.
// Nothing here throws into the game: every network step can fail and the device table still works.
import { withScore, type Save } from '../lib/save';
import type { Mode } from '../lib/session';
import {
  INITIALS_LENGTH, findRow, initialsOrDefault, scoreCells, setInitial, stepInitial, validName,
  type ScoreEntry, type ScoreRow,
} from '../lib/scores';
import type { ScoresClient } from './scores-client';

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const TOKEN_WAIT_MS = 10_000;
const DEVICE_ONLY = 'Saved on this device only. The shared board did not take the score.';

/** The one seam to Cloudflare's human check. The script is fetched on the first open(), never before. */
export interface HumanCheck {
  open(el: HTMLElement, siteKey: string): void;
  /** Resolves with the latest token, or null if the script failed, errored or no token came in time. */
  wait(timeoutMs?: number): Promise<string | null>;
  /** Tokens are single-use: drop this one and ask for a fresh one. */
  reset(): void;
}

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
}

export function createHumanCheck(doc: Document): HumanCheck {
  let token: string | null = null;
  let failed = false;
  let loaded = false;
  let widget: string | undefined;
  const waiters = new Set<() => void>();
  const wake = (): void => waiters.forEach((w) => w());
  const api = (): TurnstileApi | undefined => (doc.defaultView as (Window & { turnstile?: TurnstileApi }) | null)?.turnstile;

  const render = (el: HTMLElement, siteKey: string): void => {
    try {
      widget = api()?.render(el, {
        sitekey: siteKey,
        callback: (t: string) => {
          token = t;
          wake();
        },
        'error-callback': () => {
          token = null;
          failed = true;
          wake();
        },
        'expired-callback': () => {
          token = null;
        },
      });
      failed = widget === undefined;
    } catch {
      failed = true;
    }
    wake();
  };

  return {
    open(el, siteKey) {
      if (loaded) {
        this.reset();
        return;
      }
      loaded = true;
      const script = doc.createElement('script');
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.onload = () => render(el, siteKey);
      script.onerror = () => {
        failed = true;
        wake();
      };
      doc.head.append(script);
    },
    wait(timeoutMs = TOKEN_WAIT_MS) {
      if (token !== null || failed) return Promise.resolve(token);
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (): void => {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(token);
        };
        const check = (): void => {
          if (token !== null || failed) finish();
        };
        timer = setTimeout(finish, timeoutMs);
        waiters.add(check);
      });
    },
    reset() {
      token = null;
      if (widget !== undefined) api()?.reset(widget);
    },
  };
}

export type Target = 'menu' | 'over' | 'scores' | 'initials';
type Origin = 'menu' | 'over';
type Scope = 'everyone' | 'device';

export interface ScoresUiDeps {
  root: HTMLElement;
  client: ScoresClient;
  humanCheck: HumanCheck;
  siteKey: string;
  getSave(): Save;
  /** Stores the save (state and localStorage). */
  commit(save: Save): void;
  /** The start stamp of the game that just ended, once. Null when none arrived. */
  takeStamp(): string | null;
  show(target: Target): void;
}

export interface ScoresUi {
  /** Last shared board fetched for a mode, or null if none yet. */
  sharedBoard(mode: Mode): ScoreRow[] | null;
  askInitials(entry: ScoreEntry): void;
  /** Handles a click on a High scores or initials action. */
  act(name: string): void;
  /** Handles a key while the initials panel is open. */
  key(e: KeyboardEvent): void;
}

export function createScoresUi(deps: ScoresUiDeps): ScoresUi {
  const { root, client, humanCheck } = deps;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const all = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
  const shared: Record<Mode, ScoreRow[] | null> = { campaign: null, endless: null };
  const device = (m: Mode): ScoreRow[] => deps.getSave().scores[m];

  // ---- High scores panel ----
  let mode: Mode = 'campaign';
  let scope: Scope = 'everyone';
  let origin: Origin = 'menu';
  let mine: { mode: Mode; row: ScoreRow } | null = null;
  let ticket = 0;

  const draw = (rows: ScoreRow[], source: Scope, noteText: string): void => {
    const hit = mine && mine.mode === mode ? findRow(rows, mine.row) : -1;
    q('[data-scores-body]').replaceChildren(
      ...rows.map((r, i) => {
        const tr = document.createElement('tr');
        for (const text of scoreCells(mode, r, i)) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        if (i === hit) tr.setAttribute('aria-current', 'true');
        return tr;
      }),
    );
    q('[data-col="seed"]').hidden = mode !== 'endless';
    q('[data-scores-caption]').textContent = `${mode === 'endless' ? 'Endless' : 'Campaign'} high scores, ${source === 'device' ? 'this device' : 'everyone'}`;
    for (const b of all('[data-scores-tab]')) b.setAttribute('aria-pressed', String(b.dataset.scoresTab === mode));
    for (const b of all('[data-scores-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scoresScope === scope));
    q('[data-scores-note]').textContent = noteText;
  };

  const refresh = (): void => {
    const request = ++ticket;
    const own = device(mode);
    if (scope === 'device') {
      draw(own, 'device', own.length ? '' : 'No scores yet on this device.');
      return;
    }
    draw(own, 'device', 'Loading the shared board...');
    void client.top(mode).then((rows) => {
      if (request !== ticket) return;
      if (rows) {
        shared[mode] = rows;
        draw(rows, 'everyone', rows.length ? '' : 'No shared scores yet.');
      } else {
        scope = 'device';
        draw(own, 'device', 'The shared board is unavailable. Showing this device.');
      }
    });
  };

  const openBoard = (from: Origin): void => {
    origin = from;
    mine = null;
    scope = 'everyone';
    deps.show('scores');
    refresh();
  };

  /** The board after a save: the shared rows when the post worked, this device's rows otherwise. */
  const openAfterSave = (entryMode: Mode, row: ScoreRow, noteText: string, remote: ScoreRow[] | null): void => {
    origin = 'over';
    mode = entryMode;
    mine = { mode: entryMode, row };
    scope = remote ? 'everyone' : 'device';
    ticket++;
    deps.show('scores');
    draw(remote ?? device(entryMode), scope, noteText);
  };

  root.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-scores-tab], [data-scores-scope], [data-initial-up], [data-initial-down]');
    if (!el) return;
    if (el.dataset.scoresTab) {
      mode = el.dataset.scoresTab === 'endless' ? 'endless' : 'campaign';
      refresh();
    } else if (el.dataset.scoresScope) {
      scope = el.dataset.scoresScope === 'device' ? 'device' : 'everyone';
      refresh();
    } else {
      const up = el.hasAttribute('data-initial-up');
      const at = all(up ? '[data-initial-up]' : '[data-initial-down]').indexOf(el);
      slot = at;
      step(at, up ? 1 : -1);
    }
  });

  // ---- Initials panel ----
  let entry: ScoreEntry | null = null;
  let letters = initialsOrDefault('');
  let slot = 0;
  let busy = false;

  const slotEls = (): HTMLElement[] => all('[data-initial]');
  const paint = (): void => {
    slotEls().forEach((el, i) => {
      el.textContent = letters[i];
      el.setAttribute('aria-valuenow', String(letters.charCodeAt(i) - 64));
      el.setAttribute('aria-valuetext', letters[i]);
    });
  };
  function step(at: number, delta: 1 | -1): void {
    letters = setInitial(letters, at, stepInitial(letters[at], delta));
    paint();
  }
  const focusSlot = (at: number): void => {
    slot = Math.min(Math.max(at, 0), INITIALS_LENGTH - 1);
    slotEls()[slot]?.focus();
  };
  root.addEventListener('focusin', (e) => {
    const at = slotEls().indexOf((e.target as Element).closest<HTMLElement>('[data-initial]')!);
    if (at >= 0) slot = at;
  });
  const initialsNote = (text: string): void => {
    q('[data-initials-note]').textContent = text;
  };
  const lock = (on: boolean): void => {
    busy = on;
    q<HTMLButtonElement>('[data-act="initials-ok"]').disabled = on;
    q<HTMLButtonElement>('[data-act="initials-skip"]').disabled = on;
  };

  async function confirm(): Promise<void> {
    if (!entry || busy) return;
    const name = letters;
    if (!validName(name)) {
      initialsNote('Those initials are not allowed. Please pick others.');
      return;
    }
    const done = entry;
    const row: ScoreRow = { ...done.row, name };
    lock(true);
    // The device table always comes first; the network is only ever an extra.
    deps.commit(withScore({ ...deps.getSave(), initials: name }, done.mode, row));
    entry = null;
    const stamp = deps.takeStamp();
    if (!stamp) {
      lock(false);
      openAfterSave(done.mode, row, DEVICE_ONLY, null);
      return;
    }
    initialsNote('Saved. Sending...');
    const turnstile = await humanCheck.wait();
    const result = turnstile
      ? await client.post({ mode: done.mode, name, score: row.score, level: row.level, cleared: done.cleared, seed: row.seed, stamp, turnstile })
      : null;
    humanCheck.reset();
    lock(false);
    if (!result) {
      openAfterSave(done.mode, row, DEVICE_ONLY, null);
      return;
    }
    shared[done.mode] = result.scores;
    openAfterSave(done.mode, row, result.rank ? `Saved. You are number ${result.rank} on the shared board.` : 'Saved. It did not reach the top ten of the shared board.', result.scores);
  }

  return {
    sharedBoard: (m) => shared[m],
    askInitials(next) {
      entry = next;
      mode = next.mode;
      letters = initialsOrDefault(deps.getSave().initials);
      lock(false);
      paint();
      q('[data-initials-score]').textContent = String(next.row.score);
      initialsNote('');
      deps.show('initials');
      humanCheck.open(q('[data-turnstile]'), deps.siteKey);
      focusSlot(0);
    },
    act(name) {
      if (name === 'scores') openBoard('menu');
      else if (name === 'scores-close') deps.show(origin);
      else if (name === 'initials-ok') void confirm();
      else if (name === 'initials-skip' && !busy) {
        entry = null;
        deps.show('over');
      }
    },
    key(e) {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        step(slot, k === 'ArrowUp' ? 1 : -1);
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        focusSlot(slot + (k === 'ArrowRight' ? 1 : -1));
      } else if (k === 'Enter') {
        // On a button, Enter is the button's own click.
        if (!(e.target instanceof Element && e.target.closest('button'))) {
          e.preventDefault();
          void confirm();
        }
      } else if (/^[a-z]$/i.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        letters = setInitial(letters, slot, k);
        paint();
        if (slot < INITIALS_LENGTH - 1) focusSlot(slot + 1);
      }
    },
  };
}
