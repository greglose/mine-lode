import { describe, expect, it } from 'vitest';
import { HD_SIZE, makeHdTexture, type HdKind } from './textures-hd';

const KINDS: HdKind[] = ['dirt', 'stone', 'gold', 'ladder', 'timber', 'crystal', 'wall'];
const pixels = (kind: HdKind) => {
  const d = makeHdTexture(kind).color;
  return Array.from({ length: d.length / 4 }, (_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]]);
};
const range = (a: Uint8Array): number => Math.max(...a) - Math.min(...a);

describe('makeHdTexture', () => {
  it('is 32x32', () => expect(HD_SIZE).toBe(32));
  it.each(KINDS)('%s has a 32x32 RGBA colour map and a 32x32 height map', (kind) => {
    const t = makeHdTexture(kind);
    expect(t.color).toBeInstanceOf(Uint8Array);
    expect(t.height).toBeInstanceOf(Uint8Array);
    expect(t.color.length).toBe(HD_SIZE * HD_SIZE * 4);
    expect(t.height.length).toBe(HD_SIZE * HD_SIZE);
  });
  it('is the same every time', () => {
    for (const kind of KINDS) expect(makeHdTexture(kind)).toEqual(makeHdTexture(kind));
  });
  it('is fully opaque wherever the 16x16 block is opaque', () => {
    for (const kind of KINDS.filter((k) => k !== 'ladder')) {
      expect(pixels(kind).every((p) => p[3] === 255), kind).toBe(true);
    }
  });
  it('keeps see-through gaps in the ladder', () => {
    const a = pixels('ladder').map((p) => p[3]);
    expect(a.some((v) => v === 0)).toBe(true);
    expect(a.some((v) => v === 255)).toBe(true);
    const gaps = a.filter((v) => v === 0).length / a.length;
    expect(gaps).toBeGreaterThan(0.4);
  });
  it('reads gold: well over half of the gold pixels are yellow', () => {
    const share = pixels('gold').filter(([r, g, b]) => r > 200 && g > 150 && b < 120).length / (HD_SIZE * HD_SIZE);
    expect(share).toBeGreaterThan(0.55);
  });
  it('uses a real range in the height maps of dirt, stone and gold', () => {
    for (const kind of ['dirt', 'stone', 'gold'] as HdKind[]) {
      expect(range(makeHdTexture(kind).height), kind).toBeGreaterThanOrEqual(80);
    }
  });
  it('raises the ladder rails above the gaps', () => {
    const { color, height } = makeHdTexture('ladder');
    const solidH = Array.from(height).filter((_, i) => color[i * 4 + 3] === 255);
    const gapH = Array.from(height).filter((_, i) => color[i * 4 + 3] === 0);
    expect(Math.min(...solidH)).toBeGreaterThan(Math.max(...gapH));
  });
  it('gives each kind its own look', () => {
    expect(new Set(KINDS.map((k) => makeHdTexture(k).color.join(','))).size).toBe(KINDS.length);
    expect(new Set(KINDS.map((k) => makeHdTexture(k).height.join(','))).size).toBe(KINDS.length);
  });
});
