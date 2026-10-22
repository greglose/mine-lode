import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './campaign';
import {
  BACK_Z_MAX, BACK_Z_MIN, CRYSTAL_Z_MAX, MAX_LIGHTS, MAX_PER_KIND, MAX_PROPS, PLAY_PLANE_Z, decorOf, type PropKind,
} from './decor';
import { generateLevel } from './generate';
import { COLS, ROWS, idx, xOf, type Level } from './level';

const KINDS = Object.keys(MAX_PER_KIND) as PropKind[];
const FRONT_KINDS: PropKind[] = ['moss', 'pebble'];

const levels: { name: string; level: Level; seed: string }[] = [
  ...CAMPAIGN.map((level, i) => ({ name: `campaign ${i + 1}`, level, seed: `campaign-${i + 1}` })),
  ...['alpha', 'beta'].flatMap((seed) =>
    Array.from({ length: 50 }, (_, i) => ({ name: `endless ${seed} ${i + 1}`, level: generateLevel(seed, i + 1), seed: `${seed}-${i + 1}` })),
  ),
];

const solid = (l: Level, x: number, y: number): boolean =>
  x >= 0 && x < COLS && y >= 0 && y < ROWS && (l.tiles[idx(x, y)] === 'dirt' || l.tiles[idx(x, y)] === 'stone');

describe('decorOf', () => {
  it('is deterministic, and a different seed gives a different result', () => {
    const l = CAMPAIGN[0];
    expect(decorOf(l, 's')).toEqual(decorOf(l, 's'));
    expect(decorOf(l, 's')).not.toEqual(decorOf(l, 't'));
  });

  it('has two or three background layers behind the play plane, ordered nearest to farthest', () => {
    for (const { name, level, seed } of levels) {
      const { layers } = decorOf(level, seed);
      expect(layers.length, name).toBeGreaterThanOrEqual(2);
      expect(layers.length, name).toBeLessThanOrEqual(3);
      layers.forEach((l, i) => {
        expect(l.depth, name).toBeGreaterThanOrEqual(BACK_Z_MIN);
        expect(l.depth, name).toBeLessThanOrEqual(BACK_Z_MAX);
        expect(l.depth, name).toBeLessThan(PLAY_PLANE_Z);
        if (i > 0) expect(l.depth, name).toBeLessThan(layers[i - 1].depth);
      });
    }
  });

  it('sits every crystal on top of a solid block or hangs it under one, far back behind the other props', () => {
    expect(CRYSTAL_Z_MAX).toBeLessThan(-2);
    expect(CRYSTAL_Z_MAX).toBeGreaterThanOrEqual(BACK_Z_MAX);
    let seen = 0;
    for (const { name, level, seed } of levels) {
      const props = decorOf(level, seed).props;
      const deepestOther = Math.min(...props.filter((p) => p.kind === 'timber' || p.kind === 'stalactite').map((p) => p.z));
      for (const p of props.filter((q) => q.kind === 'crystal')) {
        seen++;
        const cx = Math.round(p.x);
        const cy = Math.round(p.y);
        const where = `${name} crystal ${p.x},${p.y}`;
        expect(level.tiles[idx(cx, cy)], where).toBe('empty');
        // The fraction says which face it hugs: below the centre sits on the block under, above hangs from the block over.
        if (p.y > cy) expect(solid(level, cx, cy + 1), where).toBe(true);
        else {
          expect(p.y, where).toBeLessThan(cy);
          expect(solid(level, cx, cy - 1), where).toBe(true);
        }
        expect(p.z, where).toBeLessThanOrEqual(CRYSTAL_Z_MAX);
        expect(p.z, where).toBeGreaterThan(BACK_Z_MAX);
        if (Number.isFinite(deepestOther)) expect(p.z, where).toBeLessThan(deepestOther);
        expect(p.scale, where).toBeLessThanOrEqual(0.7);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('never draws anything in front of the play plane', () => {
    for (const { name, level, seed } of levels) {
      const d = decorOf(level, seed);
      for (const p of d.props) expect(p.z, `${name} ${p.kind}`).toBeLessThanOrEqual(PLAY_PLANE_Z);
      for (const l of d.lights) expect(l.z, name).toBeLessThanOrEqual(PLAY_PLANE_Z);
    }
  });

  it('puts only moss and pebbles on the play plane, and the rest behind it', () => {
    for (const { name, level, seed } of levels) {
      for (const p of decorOf(level, seed).props) {
        if (FRONT_KINDS.includes(p.kind)) expect(p.z, name).toBe(PLAY_PLANE_Z);
        else expect(p.z, `${name} ${p.kind}`).toBeLessThan(PLAY_PLANE_Z);
      }
    }
  });

  it('puts moss and pebbles only on the exposed top face of dirt or stone, on nothing that matters', () => {
    for (const { name, level, seed } of levels) {
      const exitColumns = new Set(level.tiles.map((t, i) => (t === 'exit' ? xOf(i) : -1)));
      const special = new Set([level.hero, ...level.guards, ...level.gold]);
      for (const p of decorOf(level, seed).props.filter((q) => q.z === PLAY_PLANE_Z)) {
        const where = `${name} ${p.kind} ${p.x},${p.y}`;
        expect(Number.isInteger(p.x) && Number.isInteger(p.y), where).toBe(true);
        expect(level.tiles[idx(p.x, p.y)], where).toBe('empty');
        expect(solid(level, p.x, p.y + 1), where).toBe(true);
        expect(['dirt', 'stone'], where).toContain(level.tiles[idx(p.x, p.y + 1)]);
        expect(special.has(idx(p.x, p.y)), where).toBe(false);
        expect(exitColumns.has(p.x), where).toBe(false);
        expect(p.scale, where).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('stays inside the grid', () => {
    for (const { name, level, seed } of levels) {
      for (const p of decorOf(level, seed).props) {
        expect(p.x, name).toBeGreaterThanOrEqual(0);
        expect(p.x, name).toBeLessThanOrEqual(COLS);
        expect(p.y, name).toBeGreaterThanOrEqual(0);
        expect(p.y, name).toBeLessThanOrEqual(ROWS);
      }
    }
  });

  it('keeps counts within the caps', () => {
    for (const { name, level, seed } of levels) {
      const d = decorOf(level, seed);
      expect(d.props.length, name).toBeLessThanOrEqual(MAX_PROPS);
      for (const k of KINDS) {
        expect(d.props.filter((p) => p.kind === k).length, `${name} ${k}`).toBeLessThanOrEqual(MAX_PER_KIND[k]);
      }
      expect(d.props.filter((p) => p.kind === 'cart').length, name).toBeLessThanOrEqual(1);
    }
  });

  it('has a handful of props of each background kind on a normal level', () => {
    const d = decorOf(CAMPAIGN[0], 'campaign-1');
    for (const k of ['rail', 'lantern'] as PropKind[]) expect(d.props.some((p) => p.kind === k), k).toBe(true);
    expect(d.props.length).toBeGreaterThan(8);
  });

  it('gives each lantern exactly one warm light, and at least one light per level', () => {
    for (const { name, level, seed } of levels) {
      const d = decorOf(level, seed);
      const lanterns = d.props.filter((p) => p.kind === 'lantern');
      expect(d.lights.length, name).toBe(lanterns.length);
      expect(d.lights.length, name).toBeGreaterThanOrEqual(1);
      expect(d.lights.length, name).toBeLessThanOrEqual(MAX_LIGHTS);
      for (const l of d.lights) {
        const r = (l.color >> 16) & 255;
        const g = (l.color >> 8) & 255;
        const b = l.color & 255;
        expect(r >= g && g >= b, `${name} colour ${l.color.toString(16)}`).toBe(true);
        expect(l.intensity, name).toBeGreaterThan(0);
      }
      lanterns.forEach((p, i) => {
        expect(d.lights[i].x, name).toBe(p.x);
        expect(d.lights[i].y, name).toBe(p.y);
      });
    }
  });

  it('hangs stalactites under solid blocks with open space below', () => {
    for (const { name, level, seed } of levels) {
      for (const p of decorOf(level, seed).props.filter((q) => q.kind === 'stalactite')) {
        expect(solid(level, p.x, p.y - 1), name).toBe(true);
        expect(level.tiles[idx(p.x, p.y)], name).not.toBe('dirt');
        expect(level.tiles[idx(p.x, p.y)], name).not.toBe('stone');
      }
    }
  });

  it('lays a rail along the floor row', () => {
    for (const { name, level, seed } of levels) {
      const rails = decorOf(level, seed).props.filter((p) => p.kind === 'rail');
      expect(rails.length, name).toBeGreaterThanOrEqual(1);
      for (const r of rails) expect(r.y, name).toBe(ROWS - 2);
    }
  });
});
