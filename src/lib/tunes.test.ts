import { describe, expect, it } from 'vitest';
import { TUNES, midiToHz } from './tunes';

describe('tunes', () => {
  it('converts MIDI notes to hertz', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
  it.each(Object.entries(TUNES))('%s is a 32-step loop with playable notes', (_name, tune) => {
    expect(tune.lead.length).toBe(32);
    expect(tune.bass.length).toBe(32);
    expect(tune.bpm).toBeGreaterThan(60);
    for (const n of [...tune.lead, ...tune.bass]) {
      if (n !== null) {
        expect(n).toBeGreaterThanOrEqual(33);
        expect(n).toBeLessThanOrEqual(96);
      }
    }
    expect(tune.lead.some((n) => n !== null)).toBe(true);
  });
});
