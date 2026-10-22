// The simulation: one call advances the level by one 60 Hz tick.
import { COLS, ROWS, idx } from './level';
import { nextGuardCell } from './guards';
import { canClimbDown, canClimbUp, canDig, canStep, isSolid, supported } from './physics';
import {
  DIG_TICKS, FALL_TICKS, GUARD_TICKS, HERO_TICKS, HOLE_TICKS, SCORE_CLEAR, SCORE_GOLD, SCORE_KILL, SCORE_TRAP,
  TRAP_RETRY_TICKS, TRAP_TICKS, begin, getterOf, posOf, tileAt,
  type GameEvent, type GameState, type Guard, type Input,
} from './state';

const clone = (s: GameState): GameState => ({
  ...s,
  tiles: [...s.tiles],
  gold: [...s.gold],
  hero: { ...s.hero },
  guards: s.guards.map((g) => ({ ...g })),
  holes: s.holes.map((h) => ({ ...h })),
});

/** A trapped guard stands in the cell (a guard in a hole is a floor), optionally ignoring one guard. */
const trappedGuardAt = (s: GameState, except?: Guard) => (x: number, y: number): boolean =>
  s.guards.some((g) => g !== except && g.trapped > 0 && g.x === x && g.y === y);

function heroArrive(s: GameState, ev: GameEvent[]): void {
  const h = s.hero;
  const cell = idx(h.x, h.y);
  if (s.gold[cell]) {
    s.gold[cell] = false;
    s.goldLeft--;
    s.score += SCORE_GOLD;
    ev.push('gold');
    if (s.goldLeft === 0) {
      s.exitOpen = true;
      ev.push('allGold');
    }
  }
  if (s.exitOpen && h.y === 0) {
    s.status = 'won';
    s.score += SCORE_CLEAR;
    ev.push('levelClear');
  }
}

function tickHoles(s: GameState, ev: GameEvent[]): void {
  for (const hole of s.holes) hole.ticks--;
  const closing = s.holes.filter((h) => h.ticks <= 0);
  if (!closing.length) return;
  s.holes = s.holes.filter((h) => h.ticks > 0);
  for (const hole of closing) {
    s.tiles[idx(hole.x, hole.y)] = 'dirt';
    ev.push('refill');
    if (s.hero.x === hole.x && s.hero.y === hole.y && s.status === 'playing') {
      s.status = 'dead';
      ev.push('death');
    }
    s.guards.forEach((g, i) => {
      if (g.x === hole.x && g.y === hole.y) buryGuard(s, i, ev);
    });
  }
}

function tryDig(s: GameState, dir: -1 | 1): boolean {
  const h = s.hero;
  const x = h.x + dir;
  const y = h.y + 1;
  if (!canDig(getterOf(s), (cx, cy) => s.gold[idx(cx, cy)], x, y)) return false;
  s.tiles[idx(x, y)] = 'empty';
  s.holes.push({ x, y, ticks: HOLE_TICKS });
  return true;
}

function buryGuard(s: GameState, i: number, ev: GameEvent[]): void {
  const g = s.guards[i];
  s.score += SCORE_KILL;
  ev.push('guardKilled');
  g.trapped = 0;
  g.falling = false;
  for (let y = 0; y < ROWS; y++) {
    for (let k = 0; k < COLS; k++) {
      const x = (s.tick * 7 + i * 11 + k) % COLS;
      const taken = s.guards.some((o, j) => j !== i && o.x === x && o.y === y) || (s.hero.x === x && s.hero.y === y);
      if (tileAt(s, x, y) === 'empty' && !taken) {
        g.x = g.fromX = x;
        g.y = g.fromY = y;
        g.t = g.total = 0;
        ev.push('guardRespawn');
        return;
      }
    }
  }
}

function guardArrive(s: GameState, g: Guard, ev: GameEvent[]): void {
  const cell = idx(g.x, g.y);
  if (s.holes.some((h) => h.x === g.x && h.y === g.y)) {
    g.trapped = TRAP_TICKS;
    s.score += SCORE_TRAP;
    ev.push('guardTrapped');
    const above = idx(g.x, g.y - 1);
    if (g.gold && g.y > 0 && tileAt(s, g.x, g.y - 1) === 'empty' && !s.gold[above]) {
      s.gold[above] = true;
      g.gold = false;
    }
    return;
  }
  if (s.gold[cell] && !g.gold) {
    s.gold[cell] = false;
    g.gold = true;
  }
}

function climbOut(s: GameState, g: Guard): void {
  const y = g.y - 1;
  const first = s.hero.x >= g.x ? 1 : -1;
  for (const d of [first, -first]) {
    const x = g.x + d;
    if (y >= 0 && !isSolid(tileAt(s, g.x, y)) && canStep(getterOf(s), g.x, y, d)) {
      begin(g, x, y, GUARD_TICKS * 2);
      return;
    }
  }
  g.trapped = TRAP_RETRY_TICKS;
}

function moveGuards(s: GameState, ev: GameEvent[]): void {
  const get = getterOf(s);
  s.guards.forEach((g, i) => {
    if (g.trapped > 0) {
      g.trapped--;
      if (g.trapped === 0) climbOut(s, g);
      return;
    }
    if (g.t > 0) {
      g.t--;
      if (g.t > 0) return;
      g.falling = false;
      guardArrive(s, g, ev);
      if (g.trapped > 0) return;
    }
    if (!supported(get, g.x, g.y, trappedGuardAt(s, g))) {
      g.falling = true;
      begin(g, g.x, g.y + 1, FALL_TICKS);
      return;
    }
    const [nx, ny] = nextGuardCell(s, i);
    if (nx === g.x && ny === g.y) return;
    if (s.guards.some((o) => o !== g && o.x === nx && o.y === ny)) return;
    begin(g, nx, ny, GUARD_TICKS);
  });
}

function checkCaught(s: GameState, ev: GameEvent[]): void {
  const [hx, hy] = posOf(s.hero);
  const caught = s.guards.some((g) => {
    const [gx, gy] = posOf(g);
    return Math.abs(gx - hx) < 0.6 && Math.abs(gy - hy) < 0.6;
  });
  if (caught) {
    s.status = 'dead';
    ev.push('death');
  }
}

function moveHero(s: GameState, input: Input, ev: GameEvent[]): void {
  const h = s.hero;
  if (h.t > 0) {
    h.t--;
    if (h.t > 0) return;
    heroArrive(s, ev);
    if (s.status !== 'playing') return;
  }
  const get = getterOf(s);
  const onGuard = trappedGuardAt(s);
  if (!supported(get, h.x, h.y, onGuard)) {
    h.falling = true;
    begin(h, h.x, h.y + 1, FALL_TICKS);
    return;
  }
  if (h.falling) {
    h.falling = false;
    ev.push('land');
  }
  if (input.dig !== 0) {
    if (tryDig(s, input.dig)) {
      h.facing = input.dig;
      begin(h, h.x, h.y, DIG_TICKS);
      ev.push('dig');
    }
    return;
  }
  if (input.dy === -1 && canClimbUp(get, h.x, h.y)) {
    begin(h, h.x, h.y - 1, HERO_TICKS);
    ev.push('climb');
    return;
  }
  if (input.dy === 1 && canClimbDown(get, h.x, h.y) && !onGuard(h.x, h.y + 1)) {
    begin(h, h.x, h.y + 1, HERO_TICKS);
    ev.push('climb');
    return;
  }
  if (input.dx !== 0) {
    h.facing = input.dx;
    if (canStep(get, h.x, h.y, input.dx)) {
      begin(h, h.x + input.dx, h.y, HERO_TICKS);
      ev.push('step');
    }
  }
}

export function step(prev: GameState, input: Input): { state: GameState; events: GameEvent[] } {
  if (prev.status !== 'playing') return { state: prev, events: [] };
  const s = clone(prev);
  const events: GameEvent[] = [];
  s.tick++;
  tickHoles(s, events);
  if (s.status === 'playing') moveHero(s, input, events);
  if (s.status === 'playing') moveGuards(s, events);
  if (s.status === 'playing') checkCaught(s, events);
  return { state: s, events };
}
