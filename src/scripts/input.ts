// Keyboard and touch, combined into one Input per tick.
import type { Input } from '../lib/state';

export type Action = 'pause' | 'restart' | 'mute';
type Held = 'left' | 'right' | 'up' | 'down' | 'digL' | 'digR';

export interface GameInput {
  read(): Input;
  onAction(cb: (a: Action) => void): void;
  clear(): void;
  destroy(): void;
}

const HELD_KEYS: Record<string, Held> = {
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  z: 'digL', q: 'digL', x: 'digR', e: 'digR',
};
const ACTION_KEYS: Record<string, Action> = { p: 'pause', escape: 'pause', r: 'restart', m: 'mute' };
const BUTTONS: Held[] = ['left', 'right', 'up', 'down', 'digL', 'digR'];

export function createInput(win: Window, root: HTMLElement): GameInput {
  const keys = new Set<Held>();
  const touches = new Set<Held>();
  const listeners: ((a: Action) => void)[] = [];
  const stop = new AbortController();
  const { signal } = stop;

  const typing = (e: Event): boolean => Boolean((e.target as Element | null)?.closest?.('input, textarea, select'));
  const held = (name: Held): boolean => keys.has(name) || touches.has(name);
  const axis = (minus: Held, plus: Held): -1 | 0 | 1 => ((held(plus) ? 1 : 0) - (held(minus) ? 1 : 0)) as -1 | 0 | 1;
  const clear = (): void => {
    keys.clear();
    touches.clear();
  };

  win.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    const name = HELD_KEYS[k];
    if (name) {
      keys.add(name);
      e.preventDefault();
      return;
    }
    const action = ACTION_KEYS[k];
    if (action && !e.repeat) listeners.forEach((cb) => cb(action));
  }, { signal });
  win.addEventListener('keyup', (e) => {
    const name = HELD_KEYS[e.key.toLowerCase()];
    if (name) keys.delete(name);
  }, { signal });
  win.addEventListener('blur', clear, { signal });

  for (const el of root.querySelectorAll<HTMLElement>('[data-btn]')) {
    const name = el.dataset.btn as Held;
    if (!BUTTONS.includes(name)) continue;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      touches.add(name);
    }, { signal });
    for (const end of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(end, () => touches.delete(name), { signal });
    }
  }

  return {
    read: () => ({ dx: axis('left', 'right'), dy: axis('up', 'down'), dig: axis('digL', 'digR') }),
    onAction: (cb) => void listeners.push(cb),
    clear,
    destroy: () => stop.abort(),
  };
}
