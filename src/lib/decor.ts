// Static extras the Modern view adds to a level: background layers, props, lanterns and their lights.
// Pure and seeded: the same (level, seed) always gives the same decor. Nothing here is ever drawn in
// front of the play plane (z > 0), and the only props on the plane are small moss and pebbles on the
// top face of exposed dirt or stone.
import { COLS, ROWS, idx, xOf, type Level } from './level';
import { int, rngFor, shuffle, type Rng } from './rng';

export type PropKind = 'lantern' | 'timber' | 'stalactite' | 'crystal' | 'rail' | 'cart' | 'moss' | 'pebble';
/** x, y in cell units like scene blocks. z < 0 is behind the play plane, z = 0 sits on it. */
export interface Prop { kind: PropKind; x: number; y: number; z: number; scale: number; rot: number; variant: number }
export interface Light { x: number; y: number; z: number; color: number; intensity: number; flickerSeed: number }
/** `depth` is the layer's z (negative); layers come nearest first, so depth decreases down the list. */
export interface BackLayer { depth: number; tint: number; seed: number }
export interface Decor { props: Prop[]; lights: Light[]; layers: BackLayer[] }

export const PLAY_PLANE_Z = 0;
export const BACK_Z_MIN = -12;
export const BACK_Z_MAX = -3;
export const LIGHT_Z = -0.4;
/** Crystals grow out of the near wall: never nearer the play plane than this. */
export const CRYSTAL_Z_MAX = -2.5;
const CRYSTAL_Z = BACK_Z_MAX + 0.3;
/** How far a crystal sits from its cell centre, toward the block it grows on (cell units). */
const CRYSTAL_INSET = 0.3;

export const MAX_PER_KIND: Record<PropKind, number> = {
  lantern: 8, timber: 8, stalactite: 12, crystal: 6, rail: 4, cart: 1, moss: 16, pebble: 16,
};
export const MAX_PROPS = 60;
export const MAX_LIGHTS = MAX_PER_KIND.lantern;

const LAMP_COLORS = [0xffb347, 0xff9d3c, 0xffc766, 0xff8a2a];
/** Warm brown-grey, darker with depth. */
const LAYER_TINTS = [0x2a241e, 0x1f1a16, 0x14110e];
const MIN_LANTERN_GAP = 5;

// Order is priority: when the total cap bites, the last kinds (moss, pebbles) go first.
const KIND_ORDER: PropKind[] = ['rail', 'cart', 'lantern', 'timber', 'stalactite', 'crystal', 'moss', 'pebble'];
const KIND_SALT: Record<PropKind, number> = {
  lantern: 1, timber: 2, stalactite: 3, crystal: 4, rail: 5, cart: 6, moss: 7, pebble: 8,
};

const tileAt = (l: Level, x: number, y: number): string => (x < 0 || x >= COLS || y < 0 || y >= ROWS ? 'outside' : l.tiles[idx(x, y)]);
const isBlock = (l: Level, x: number, y: number): boolean => ['dirt', 'stone'].includes(tileAt(l, x, y));
const cells = (): [number, number][] => Array.from({ length: COLS * ROWS }, (_, i): [number, number] => [xOf(i), Math.floor(i / COLS)]);
const prop = (kind: PropKind, x: number, y: number, z: number, r: Rng, scale: number, rot = 0): Prop => ({
  kind, x, y, z, scale, rot, variant: int(r, 0, 2),
});

export function decorOf(level: Level, seed: string): Decor {
  const rng = (kind: PropKind): Rng => rngFor(seed, KIND_SALT[kind]);
  const all = cells();
  const byKind: Record<PropKind, Prop[]> = {
    lantern: [], timber: [], stalactite: [], crystal: [], rail: [], cart: [], moss: [], pebble: [],
  };

  // Rail along the floor row: one piece per solid floor span, and at most one cart on the longest.
  const railY = ROWS - 2;
  const spans: { from: number; to: number }[] = [];
  for (let x = 0; x < COLS; x++) {
    if (!isBlock(level, x, ROWS - 1)) continue;
    const last = spans[spans.length - 1];
    if (last && last.to === x - 1) last.to = x;
    else spans.push({ from: x, to: x });
  }
  const railR = rng('rail');
  const railSpans = spans.filter((s) => s.to - s.from >= 3).slice(0, MAX_PER_KIND.rail);
  for (const s of railSpans) {
    byKind.rail.push(prop('rail', (s.from + s.to) / 2, railY, -0.4, railR, s.to - s.from + 1));
  }
  if (railSpans.length) {
    const cartR = rng('cart');
    const longest = railSpans.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
    if (cartR() < 0.7) byKind.cart.push(prop('cart', int(cartR, longest.from + 1, longest.to - 1), railY, -0.4, cartR, 1));
  }

  // Timber frames around some ladder runs (one prop per run, scale = run length in cells).
  const timberR = rng('timber');
  const ladderRuns: { x: number; top: number; bottom: number }[] = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (tileAt(level, x, y) !== 'ladder') continue;
      const open = ladderRuns.find((r) => r.x === x && r.bottom === y - 1);
      if (open) open.bottom = y;
      else ladderRuns.push({ x, top: y, bottom: y });
    }
  }
  for (const run of shuffle(timberR, ladderRuns)) {
    if (byKind.timber.length >= MAX_PER_KIND.timber) break;
    if (timberR() < 0.55) {
      const len = run.bottom - run.top + 1;
      byKind.timber.push(prop('timber', run.x, (run.top + run.bottom) / 2, -0.5, timberR, len));
    }
  }

  // Lanterns on the wall behind open cells just above a platform, spread apart.
  const lanternR = rng('lantern');
  const standable = all.filter(([x, y]) => tileAt(level, x, y) === 'empty' && isBlock(level, x, y + 1));
  const lanternTarget = int(lanternR, 3, MAX_PER_KIND.lantern);
  for (const [x, y] of shuffle(lanternR, standable)) {
    if (byKind.lantern.length >= lanternTarget) break;
    if (byKind.lantern.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < MIN_LANTERN_GAP)) continue;
    byKind.lantern.push(prop('lantern', x, y, -0.6, lanternR, 1));
  }
  if (!byKind.lantern.length && standable.length) {
    const [x, y] = standable[0];
    byKind.lantern.push(prop('lantern', x, y, -0.6, lanternR, 1));
  }

  // Stalactites under solid blocks with open space below.
  const stalR = rng('stalactite');
  const hanging = all.filter(([x, y]) => isBlock(level, x, y - 1) && tileAt(level, x, y) === 'empty' && y < ROWS - 1);
  for (const [x, y] of shuffle(stalR, hanging).slice(0, int(stalR, 6, MAX_PER_KIND.stalactite))) {
    byKind.stalactite.push(prop('stalactite', x, y, -0.5, stalR, 0.6 + stalR() * 0.8, (stalR() - 0.5) * 0.2));
  }

  // Small crystal clusters grown out of the near wall, each sitting on the top of a block or hanging under
  // one. y is moved off the cell centre toward the supporting face: below the centre sits, above hangs.
  const crystalR = rng('crystal');
  const crystalCells = [
    ...standable.map(([x, y]): [number, number, number] => [x, y, CRYSTAL_INSET]),
    ...hanging.map(([x, y]): [number, number, number] => [x, y, -CRYSTAL_INSET]),
  ];
  for (const [x, y, dy] of shuffle(crystalR, crystalCells).slice(0, int(crystalR, 2, MAX_PER_KIND.crystal))) {
    byKind.crystal.push(prop('crystal', x, y + dy, CRYSTAL_Z, crystalR, 0.4 + crystalR() * 0.3, (crystalR() - 0.5) * 0.4));
  }

  // Moss and pebbles on the play plane: only the top face of exposed dirt or stone, small, and never on
  // gold, ladders, ropes, trapdoors, the exit column or the hero and guard starts.
  const exitColumns = new Set(level.tiles.flatMap((t, i) => (t === 'exit' ? [xOf(i)] : [])));
  const taken = new Set([level.hero, ...level.guards, ...level.gold]);
  const free = standable.filter(([x, y]) => !taken.has(idx(x, y)) && !exitColumns.has(x));
  const mossR = rng('moss');
  const pebbleR = rng('pebble');
  const shuffled = shuffle(mossR, free);
  const mossCells = shuffled.slice(0, int(mossR, 6, MAX_PER_KIND.moss));
  const pebbleCells = shuffled.slice(mossCells.length).slice(0, int(pebbleR, 6, MAX_PER_KIND.pebble));
  for (const [x, y] of mossCells) byKind.moss.push(prop('moss', x, y, PLAY_PLANE_Z, mossR, 0.3 + mossR() * 0.2));
  for (const [x, y] of pebbleCells) byKind.pebble.push(prop('pebble', x, y, PLAY_PLANE_Z, pebbleR, 0.2 + pebbleR() * 0.2, pebbleR() * Math.PI));

  const props = KIND_ORDER.flatMap((k) => byKind[k].slice(0, MAX_PER_KIND[k])).slice(0, MAX_PROPS);

  const lightR = rng('lantern');
  const lights: Light[] = props
    .filter((p) => p.kind === 'lantern')
    .map((p) => ({
      x: p.x, y: p.y, z: LIGHT_Z,
      color: LAMP_COLORS[int(lightR, 0, LAMP_COLORS.length - 1)],
      intensity: 0.8 + lightR() * 0.6,
      flickerSeed: int(lightR, 1, 0x7fffffff),
    }));

  const layerR = rngFor(seed, 9);
  const count = int(layerR, 2, 3);
  const step = (BACK_Z_MAX - BACK_Z_MIN) / (count - 1);
  const layers: BackLayer[] = Array.from({ length: count }, (_, i) => ({
    depth: BACK_Z_MAX - step * i,
    tint: LAYER_TINTS[i],
    seed: int(layerR, 1, 0x7fffffff),
  }));

  return { props, lights, layers };
}
