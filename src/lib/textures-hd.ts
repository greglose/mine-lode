// 32x32 block textures with a height map for bump shading, generated in code from fixed seeds so they
// are identical on every device. Colours come from the 16x16 set in textures.ts. Row 0 is the BOTTOM
// row, as WebGL reads raw texture data.
import { int, rngFor, type Rng } from './rng';
import { BASE, GOLD_GLINT, GOLD_SHADE, LADDER_DARK, LADDER_WOOD, type Rgb } from './textures';

export const HD_SIZE = 32;
export type HdKind = 'dirt' | 'stone' | 'gold' | 'ladder' | 'timber' | 'crystal' | 'wall';

const N = HD_SIZE;
const HD_SEED: Record<HdKind, number> = { dirt: 1, stone: 2, gold: 3, ladder: 4, timber: 5, crystal: 6, wall: 7 };
const TIMBER: Rgb = [140, 100, 58];
const CRYSTAL: Rgb = [120, 150, 230];
/** How far the height map moves the colour, in 0..255 levels per 255 of height. */
const SHADE: Record<HdKind, number> = { dirt: 0.3, stone: 0.3, gold: 0.14, ladder: 0.2, timber: 0.25, crystal: 0.35, wall: 0.25 };
const FINE: Record<HdKind, number> = { dirt: 10, stone: 8, gold: 5, ladder: 4, timber: 5, crystal: 4, wall: 5 };

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Tileable value noise in 0..1: a wrapped lattice of `cells` x `cells` points, smoothly interpolated. */
function noiseField(r: Rng, cells: number): (x: number, y: number) => number {
  const lattice = Array.from({ length: cells * cells }, () => r());
  const at = (cx: number, cy: number): number => lattice[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / N) * cells;
    const fy = (y / N) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

export function makeHdTexture(kind: HdKind): { color: Uint8Array; height: Uint8Array } {
  const color = new Uint8Array(N * N * 4);
  const height = new Uint8Array(N * N);
  const r = rngFor('mine-lode-texture-hd', HD_SEED[kind]);
  const coarse = noiseField(r, 4);
  const fine = noiseField(r, 8);
  const put = (x: number, y: number, h: number, [cr, cg, cb]: Rgb, a = 255): void => {
    height[y * N + x] = clamp(h);
    const i = (y * N + x) * 4;
    color[i] = clamp(cr);
    color[i + 1] = clamp(cg);
    color[i + 2] = clamp(cb);
    color[i + 3] = a;
  };
  const shaded = (base: Rgb, h: number, grain: number): Rgb => {
    const d = (h - 128) * SHADE[kind] + grain;
    return [base[0] + d, base[1] + d, base[2] + d];
  };

  // Cracks for stone and wall: a few wandering lines pushed into the height map.
  const cracks = new Set<number>();
  if (kind === 'stone' || kind === 'wall') {
    for (let n = 0; n < 4; n++) {
      let x = int(r, 2, N - 3);
      for (let y = int(r, 0, 10); y < int(r, 16, N - 1); y++) {
        cracks.add(y * N + x);
        x = Math.min(N - 1, Math.max(0, x + int(r, -1, 1)));
      }
    }
  }
  // Ore nuggets for gold: a few bumps.
  const bumps = kind === 'gold' ? Array.from({ length: 7 }, () => [int(r, 3, N - 4), int(r, 3, N - 4), int(r, 2, 4)]) : [];

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const grain = (fine(x, y) - 0.5) * 2 * FINE[kind];
      let h = coarse(x, y) * 110 + fine(x, y) * 90 + 20;

      if (kind === 'ladder') {
        const rail = (x >= 4 && x <= 6) || (x >= 25 && x <= 27);
        const rung = y % 8 >= 2 && y % 8 <= 3 && x >= 4 && x <= 27;
        if (rail || rung) {
          const round = rail ? 200 - Math.abs((x < 16 ? 5 : 26) - x) * 30 : 190;
          put(x, y, round + grain, x >= 25 || x === 6 ? LADDER_DARK : LADDER_WOOD);
        } else put(x, y, 0, [0, 0, 0], 0);
        continue;
      }
      if (kind === 'dirt') {
        h += Math.sin((y + coarse(x, y) * 6) * 0.9) * 40; // strata
        if (fine((x * 3) % N, (y * 5) % N) > 0.78) h -= 60; // pits
      }
      if (kind === 'stone' || kind === 'wall') {
        h += (kind === 'wall' ? 0 : 20) + (cracks.has(y * N + x) ? -110 : 0);
      }
      if (kind === 'timber') h = 140 + Math.sin(x * 1.1 + coarse(x, y) * 5) * 60 + (y % 16 === 0 ? -70 : 0);
      if (kind === 'crystal') h = 255 - Math.abs(((x + y) % 11) - 5) * 40 + grain;
      let base: Rgb = kind === 'timber' ? TIMBER : kind === 'crystal' ? CRYSTAL : BASE[kind];
      if (kind === 'gold') {
        for (const [bx, by, br] of bumps) {
          const d = Math.hypot(x - bx, y - by);
          if (d < br) h += (1 - d / br) * 120;
        }
        if (x === N - 1 || y === 0) {
          put(x, y, 40, GOLD_SHADE);
          continue;
        }
        if (h > 230) base = GOLD_GLINT;
      }
      put(x, y, h, shaded(base, h, grain));
    }
  }
  return { color, height };
}
