import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS, FALLBACK_NOTICE, GRAPHICS, GRAPHICS_LABELS, SLOW_FOR_MS, SLOW_FRAME_MS, STEP_DOWN, isGraphics, levelSeed, nextStepDown,
} from './graphics';

describe('graphics', () => {
  it('has classic and modern, defaulting to classic', () => {
    expect([...GRAPHICS]).toEqual(['classic', 'modern']);
    expect(DEFAULT_GRAPHICS).toBe('classic');
    expect(GRAPHICS_LABELS).toEqual({ classic: 'Classic', modern: 'Modern' });
  });
  it('recognises only the two values', () => {
    expect(isGraphics('modern')).toBe(true);
    expect(isGraphics('classic')).toBe(true);
    for (const v of ['Modern', '', 1, null, undefined, {}, []]) expect(isGraphics(v)).toBe(false);
  });
  it('steps down post, shadows, particles in order', () => {
    expect([...STEP_DOWN]).toEqual(['post', 'shadows', 'particles']);
    expect(nextStepDown([])).toBe('post');
    expect(nextStepDown(['post'])).toBe('shadows');
    expect(nextStepDown(['post', 'shadows'])).toBe('particles');
    expect(nextStepDown(['post', 'shadows', 'particles'])).toBeNull();
  });
  it('returns the first step not yet disabled even when the list has gaps', () => {
    expect(nextStepDown(['shadows'])).toBe('post');
    expect(nextStepDown(['post', 'particles'])).toBe('shadows');
  });
  it('pins the thresholds and the notice', () => {
    expect(SLOW_FRAME_MS).toBe(20);
    expect(SLOW_FOR_MS).toBe(3000);
    expect(FALLBACK_NOTICE).toBe('Modern graphics are not available here; using Classic.');
  });
});

describe('levelSeed', () => {
  it('names a campaign level by its number, ignoring the endless seed', () => {
    expect(levelSeed('campaign', 7, '')).toBe('campaign-7');
    expect(levelSeed('campaign', 1, 'abc')).toBe('campaign-1');
  });
  it('names an endless level by its seed and number', () => {
    expect(levelSeed('endless', 3, 'abc')).toBe('endless-abc-3');
    expect(levelSeed('endless', 3, 'abd')).not.toBe(levelSeed('endless', 3, 'abc'));
    expect(levelSeed('endless', 4, 'abc')).not.toBe(levelSeed('endless', 3, 'abc'));
  });
});
