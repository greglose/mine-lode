// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInput, type GameInput } from './input';

let input: GameInput;
let root: HTMLElement;

const key = (type: 'keydown' | 'keyup', k: string, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
const touch = (type: string, name: string) =>
  root.querySelector(`[data-btn="${name}"]`)!.dispatchEvent(new Event(type, { bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = `<div id="root">
    <input id="seed" />
    ${['left', 'right', 'up', 'down', 'digL', 'digR'].map((b) => `<button data-btn="${b}"></button>`).join('')}
  </div>`;
  root = document.getElementById('root')!;
  input = createInput(window, root);
});
afterEach(() => input.destroy());

describe('keyboard', () => {
  it.each([
    ['ArrowLeft', { dx: -1, dy: 0, dig: 0 }], ['a', { dx: -1, dy: 0, dig: 0 }], ['A', { dx: -1, dy: 0, dig: 0 }],
    ['ArrowRight', { dx: 1, dy: 0, dig: 0 }], ['d', { dx: 1, dy: 0, dig: 0 }],
    ['ArrowUp', { dx: 0, dy: -1, dig: 0 }], ['w', { dx: 0, dy: -1, dig: 0 }],
    ['ArrowDown', { dx: 0, dy: 1, dig: 0 }], ['s', { dx: 0, dy: 1, dig: 0 }],
    ['z', { dx: 0, dy: 0, dig: -1 }], ['q', { dx: 0, dy: 0, dig: -1 }],
    ['x', { dx: 0, dy: 0, dig: 1 }], ['e', { dx: 0, dy: 0, dig: 1 }],
  ])('%s held', (k, expected) => {
    key('keydown', k);
    expect(input.read()).toEqual(expected);
    key('keyup', k);
    expect(input.read()).toEqual({ dx: 0, dy: 0, dig: 0 });
  });
  it('cancels opposite directions', () => {
    key('keydown', 'ArrowLeft');
    key('keydown', 'd');
    key('keydown', 'z');
    key('keydown', 'x');
    expect(input.read()).toEqual({ dx: 0, dy: 0, dig: 0 });
  });
  it('stops arrow keys from scrolling the page', () => {
    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
  it('ignores keys typed into a text field', () => {
    key('keydown', 'a', document.getElementById('seed')!);
    expect(input.read().dx).toBe(0);
  });
  it('reports actions once per press, not on repeat', () => {
    const cb = vi.fn();
    input.onAction(cb);
    key('keydown', 'p');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', repeat: true, bubbles: true }));
    key('keydown', 'Escape');
    key('keydown', 'r');
    key('keydown', 'm');
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['pause', 'pause', 'restart', 'mute']);
  });
  it('lets go of everything when the window loses focus', () => {
    key('keydown', 'ArrowRight');
    touch('pointerdown', 'digL');
    window.dispatchEvent(new Event('blur'));
    expect(input.read()).toEqual({ dx: 0, dy: 0, dig: 0 });
  });
});

describe('touch', () => {
  it('holds while pressed and releases on up, cancel and leave', () => {
    for (const end of ['pointerup', 'pointercancel', 'pointerleave']) {
      touch('pointerdown', 'right');
      expect(input.read().dx).toBe(1);
      touch(end, 'right');
      expect(input.read().dx).toBe(0);
    }
  });
  it('maps every button', () => {
    touch('pointerdown', 'up');
    touch('pointerdown', 'digR');
    expect(input.read()).toEqual({ dx: 0, dy: -1, dig: 1 });
  });
  it('combines with the keyboard and still cancels opposites', () => {
    key('keydown', 'ArrowLeft');
    touch('pointerdown', 'right');
    expect(input.read().dx).toBe(0);
    key('keyup', 'ArrowLeft');
    expect(input.read().dx).toBe(1);
  });
});

describe('lifecycle', () => {
  it('clear() drops held inputs', () => {
    key('keydown', 'ArrowRight');
    input.clear();
    expect(input.read().dx).toBe(0);
  });
  it('destroy() stops listening', () => {
    input.destroy();
    key('keydown', 'ArrowRight');
    expect(input.read().dx).toBe(0);
  });
});
