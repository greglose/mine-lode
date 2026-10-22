import { describe, expect, it } from 'vitest';
import { MAX_STEPS, TICK_MS, stepsDue } from './clock';

describe('stepsDue', () => {
  it('runs one step per tick of elapsed time and keeps the remainder', () => {
    const r = stepsDue(0, TICK_MS * 2.5);
    expect(r.steps).toBe(2);
    expect(r.acc).toBeCloseTo(TICK_MS * 0.5);
  });
  it('carries the remainder into the next frame', () => {
    expect(stepsDue(TICK_MS * 0.5, TICK_MS * 0.6).steps).toBe(1);
  });
  it('does not fast-forward after a long stall', () => {
    const r = stepsDue(0, 5 * 60 * 1000);
    expect(r.steps).toBe(MAX_STEPS);
    expect(r.acc).toBe(0);
  });
  it('treats negative or broken time as no time', () => {
    expect(stepsDue(0, -50)).toEqual({ steps: 0, acc: 0 });
    expect(stepsDue(0, Number.NaN)).toEqual({ steps: 0, acc: 0 });
  });
});
