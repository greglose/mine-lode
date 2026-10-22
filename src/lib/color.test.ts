import { describe, expect, it } from 'vitest';
import { FALLBACK_BG, HEX_COLOR, parseBackground } from './color';

describe('parseBackground', () => {
  it('reads a #rrggbb colour as a number', () => {
    expect(parseBackground('#1B2A3A')).toBe(0x1b2a3a);
    expect(parseBackground('#ffffff')).toBe(0xffffff);
  });
  it('falls back when missing or malformed', () => {
    for (const v of [undefined, '', 'red', '#fff', '#12345g', '1b2a3a', '#1b2a3a00']) expect(parseBackground(v), String(v)).toBe(FALLBACK_BG);
  });
});

describe('HEX_COLOR', () => {
  it('is the one #rrggbb pattern', () => {
    expect(HEX_COLOR.test('#1b2A3a')).toBe(true);
    for (const v of ['#12345', '#1234567', '123456', '#gggggg']) expect(HEX_COLOR.test(v)).toBe(false);
  });
});
