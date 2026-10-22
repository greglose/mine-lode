// Ambient specks for Modern: dust by the hero's lamp, drips under stalactites, sparks from digging. Pure and seeded.
// Positions and velocities are grid cells like scene blocks (y grows downward); the renderer owns what they look like.
import type { Decor } from './decor';
import { rngFor } from './rng';
import type { GameEvent } from './state';

export type AmbientKind = 'dust' | 'drip' | 'spark';
export interface Spawn { kind: AmbientKind; x: number; y: number; z: number; vx: number; vy: number; life: number }

export const MAX_DUST = 1;
export const MAX_DRIPS = 2;
export const MAX_DIG_SPARKS = 6;

const DUST_CHANCE = 0.2;
const DRIP_CHANCE = 0.01;

export function ambientOf(
  tick: number, seed: string, decor: Decor, events: readonly GameEvent[], hero: { x: number; y: number; facing: -1 | 1 },
): Spawn[] {
  const r = rngFor(seed, tick, 1);
  const out: Spawn[] = [];

  if (r() < DUST_CHANCE) {
    out.push({
      kind: 'dust', x: hero.x + hero.facing * (0.5 + r() * 3.5), y: hero.y + (r() - 0.5) * 3, z: (r() - 0.5) * 0.6,
      vx: (r() - 0.5) * 0.02, vy: (r() - 0.5) * 0.01, life: 90 + Math.floor(r() * 60),
    });
  }

  let drips = 0;
  decor.props.forEach((p, i) => {
    if (p.kind !== 'stalactite' || drips >= MAX_DRIPS) return;
    const d = rngFor(seed, tick, 2, i);
    if (d() >= DRIP_CHANCE) return;
    drips++;
    out.push({ kind: 'drip', x: p.x + (d() - 0.5) * 0.1, y: p.y + 0.5, z: p.z, vx: 0, vy: 0.02, life: 40 });
  });

  if (events.includes('dig')) {
    const s = rngFor(seed, tick, 3);
    const count = Math.min(MAX_DIG_SPARKS, 4 + Math.floor(s() * 3));
    for (let i = 0; i < count; i++) {
      out.push({
        kind: 'spark', x: hero.x + hero.facing * (0.5 + s() * 1.5), y: hero.y + 0.5 + s() * 0.5, z: (s() - 0.5) * 0.4,
        vx: hero.facing * s() * 0.08, vy: -0.02 - s() * 0.06, life: 12 + Math.floor(s() * 10),
      });
    }
  }
  return out;
}

const hash01 = (seed: number, n: number): number => {
  let h = Math.imul((seed | 0) ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const FLICKER_STEP = 8;

/** Lamp brightness, 0.7..1.0: values at every eighth tick are random and the ticks between are smoothly interpolated. */
export function flicker(seed: number, tick: number): number {
  const k = Math.floor(tick / FLICKER_STEP);
  const f = (tick - k * FLICKER_STEP) / FLICKER_STEP;
  const t = f * f * (3 - 2 * f);
  const a = hash01(seed, k);
  const b = hash01(seed, k + 1);
  return 0.7 + 0.3 * (a + (b - a) * t);
}
