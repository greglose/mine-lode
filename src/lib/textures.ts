// 16x16 block textures, generated from a fixed seed so they are the same on every device.
// Row 0 is the BOTTOM row, which is how WebGL reads raw texture data.
import { int, rngFor } from './rng';

export const TEXTURE_SIZE = 16;
export type TextureKind =
  | 'dirt' | 'stone' | 'ladder' | 'gold' | 'wall'
  | 'skin' | 'face' | 'overalls' | 'hardhat' | 'uniform' | 'cap' | 'guardface' | 'pickhead' | 'handle';

export type Rgb = [number, number, number];
const N = TEXTURE_SIZE;

export const LADDER_WOOD: Rgb = [176, 132, 80];
export const LADDER_DARK: Rgb = [128, 92, 52];
export const GOLD_SHADE: Rgb = [176, 124, 20];
export const GOLD_GLINT: Rgb = [255, 238, 150];

export const BASE: Record<Exclude<TextureKind, 'ladder'>, Rgb> = {
  dirt: [134, 96, 67],
  stone: [128, 131, 138],
  gold: [226, 176, 40],
  wall: [52, 56, 66],
  skin: [226, 172, 132],
  face: [226, 172, 132],
  overalls: [44, 92, 176],
  hardhat: [244, 196, 40],
  uniform: [128, 28, 36],
  cap: [84, 22, 30],
  guardface: [196, 146, 116],
  pickhead: [150, 156, 166],
  handle: [150, 104, 60],
};
const NOISE: Record<Exclude<TextureKind, 'ladder'>, number> = {
  dirt: 22, stone: 16, gold: 12, wall: 8, skin: 6, face: 6, overalls: 8, hardhat: 6, uniform: 8, cap: 6, guardface: 6, pickhead: 8, handle: 8,
};
const KIND_SEED: Record<TextureKind, number> = {
  dirt: 1, stone: 2, ladder: 3, gold: 4, wall: 7,
  skin: 8, face: 9, overalls: 10, hardhat: 11, uniform: 12, cap: 13, guardface: 14, pickhead: 15, handle: 16,
};

export function makeTexture(kind: TextureKind): Uint8Array {
  const data = new Uint8Array(N * N * 4);
  const put = (x: number, y: number, [r, g, b]: Rgb, a = 255): void => {
    const i = (y * N + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  };

  if (kind === 'ladder') {
    const wood = LADDER_WOOD;
    const dark = LADDER_DARK;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const rail = x === 2 || x === 3 || x === 12 || x === 13;
        const rung = y % 4 === 1 && x >= 2 && x <= 13;
        if (rail) put(x, y, x === 3 || x === 13 ? dark : wood);
        else if (rung) put(x, y, wood);
        else put(x, y, [0, 0, 0], 0);
      }
    }
    return data;
  }

  const r = rngFor('mine-lode-texture', KIND_SEED[kind]);
  const [br, bg, bb] = BASE[kind];
  const spread = NOISE[kind];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = int(r, -spread, spread);
      put(x, y, [br + d, bg + d, bb + d]);
    }
  }

  if (kind === 'dirt') {
    for (let n = 0; n < 14; n++) put(int(r, 0, N - 1), int(r, 0, N - 1), [92, 64, 44]);
  }
  if (kind === 'stone' || kind === 'wall') {
    const crack: Rgb = kind === 'wall' ? [36, 39, 47] : [92, 95, 102];
    for (let n = 0; n < 3; n++) {
      let x = int(r, 1, N - 2);
      for (let y = int(r, 0, 5); y < int(r, 8, N - 1); y++) {
        put(x, y, crack);
        x = Math.min(N - 1, Math.max(0, x + int(r, -1, 1)));
      }
    }
  }
  if (kind === 'gold') {
    const shade = GOLD_SHADE;
    for (let i = 0; i < N; i++) {
      put(i, 0, shade);
      put(N - 1, i, shade);
    }
    for (let n = 0; n < 18; n++) put(int(r, 0, N - 1), int(r, 0, N - 1), shade);
    for (const [cx, cy] of [[4, 11], [11, 9], [6, 4], [12, 12], [9, 13]]) {
      put(cx, cy, GOLD_GLINT);
      put(cx + 1, cy, GOLD_GLINT);
    }
  }
  if (kind === 'face' || kind === 'guardface') {
    const guard = kind === 'guardface';
    const eye: Rgb = guard ? [255, 255, 255] : [30, 30, 40];
    for (const x of [4, 5, 10, 11]) for (const y of [9, 10]) put(x, y, eye);
    if (guard) for (const x of [5, 10]) put(x, 9, [255, 60, 50]);
    for (let x = 6; x <= 9; x++) put(x, 4, guard ? [90, 40, 40] : [150, 70, 60]);
    if (guard) for (let x = 0; x < N; x++) for (const y of [14, 15]) put(x, y, [70, 20, 28]);
  }
  if (kind === 'overalls') {
    for (let y = 0; y < N; y++) for (const x of [3, 12]) put(x, y, [32, 70, 140]);
    for (const x of [3, 12]) put(x, 13, [244, 196, 40]);
  }
  if (kind === 'hardhat') {
    for (let y = 0; y < N; y++) for (const x of [7, 8]) put(x, y, [255, 224, 110]);
  }
  if (kind === 'uniform') {
    for (let y = 1; y < N; y += 4) for (const x of [7, 8]) put(x, y, [236, 192, 60]);
  }
  if (kind === 'cap') {
    for (let x = 0; x < N; x++) put(x, 0, [40, 12, 18]);
  }
  if (kind === 'pickhead') {
    for (let x = 0; x < N; x += 4) for (let y = 0; y < N; y++) put(x, y, [200, 206, 216]);
  }
  if (kind === 'handle') {
    for (let y = 0; y < N; y++) for (const x of [2, 7, 12]) put(x, y, [112, 76, 42]);
  }
  return data;
}
