import { describe, expect, it } from 'vitest';
import { TEXTURE_SIZE, makeTexture, type TextureKind } from './textures';

const KINDS: TextureKind[] = [
  'dirt', 'stone', 'ladder', 'gold', 'wall',
  'skin', 'face', 'overalls', 'hardhat', 'uniform', 'cap', 'guardface', 'pickhead', 'handle',
];
const alphas = (data: Uint8Array) => Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 3]);

describe('makeTexture', () => {
  it.each(KINDS)('%s is a 16x16 RGBA image', (kind) => {
    expect(makeTexture(kind).length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  });
  it('is the same every time', () => {
    for (const kind of KINDS) expect(makeTexture(kind)).toEqual(makeTexture(kind));
  });
  it('is fully opaque for solid blocks', () => {
    for (const kind of KINDS.filter((k) => k !== 'ladder')) {
      expect(alphas(makeTexture(kind)).every((a) => a === 255), kind).toBe(true);
    }
  });
  it('has see-through gaps in the ladder', () => {
    const a = alphas(makeTexture('ladder'));
    expect(a.some((v) => v === 0)).toBe(true);
    expect(a.some((v) => v === 255)).toBe(true);
  });
  it('gives each kind its own look', () => {
    const seen = new Set(KINDS.map((k) => makeTexture(k).join(',')));
    expect(seen.size).toBe(KINDS.length);
  });
  const pixels = (kind: TextureKind) => {
    const d = makeTexture(kind);
    return Array.from({ length: d.length / 4 }, (_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
  };
  const share = (kind: TextureKind, test: (p: number[]) => boolean) => pixels(kind).filter(test).length / (TEXTURE_SIZE * TEXTURE_SIZE);
  it('makes the gold block clearly gold, with shading and highlights', () => {
    expect(share('gold', ([r, g, b]) => r > 200 && g > 150 && b < 120)).toBeGreaterThan(0.65);
    expect(share('gold', ([r, g, b]) => r > 140 && r <= 200 && g > 90 && b < 80)).toBeGreaterThan(0.04);
    expect(share('gold', ([r, g]) => r > 240 && g > 220)).toBeGreaterThan(0.01);
    expect(share('gold', ([r, g, b]) => Math.abs(r - g) < 20 && Math.abs(g - b) < 20)).toBe(0);
  });
  it('colours the miner: blue overalls, yellow hard hat, a face with eyes', () => {
    expect(share('overalls', ([r, , b]) => b > r + 60)).toBeGreaterThan(0.8);
    expect(share('hardhat', ([r, g, b]) => r > 200 && g > 150 && b < 100)).toBeGreaterThan(0.7);
    expect(share('face', ([r, g, b]) => r < 60 && g < 60 && b < 60)).toBeGreaterThan(0.02);
  });
  it('colours the guard: dark red uniform and cap, bright eyes', () => {
    expect(share('uniform', ([r, g, b]) => r > g + 50 && r > b + 50)).toBeGreaterThan(0.7);
    expect(share('cap', ([r, g, b]) => r > g + 30 && r > b + 30)).toBeGreaterThan(0.7);
    expect(share('guardface', ([r, g, b]) => r > 240 && g > 240 && b > 240)).toBeGreaterThan(0.02);
  });
  it('gives the pickaxe a metal head and a wooden handle', () => {
    expect(share('pickhead', ([r, g, b]) => Math.abs(r - g) < 25 && Math.abs(g - b) < 25)).toBeGreaterThan(0.8);
    expect(share('handle', ([r, , b]) => r > b + 40)).toBeGreaterThan(0.8);
  });
});
