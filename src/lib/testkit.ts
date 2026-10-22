// Test-only helpers. Not imported by production code.
import { COLS, ROWS, parseLevel, type Level } from './level';
import { step } from './sim';
import { NO_INPUT, type GameEvent, type GameState, type Input } from './state';

/** Build a full 28x16 level from a few rows. Rows sit at the bottom; short rows are padded with '.'. */
export function mk(rows: string[]): Level {
  const padded = rows.map((r) => r.padEnd(COLS, '.'));
  const empty = Array.from({ length: ROWS - padded.length }, () => '.'.repeat(COLS));
  return parseLevel([...empty, ...padded].join('\n'));
}

export const I = (dx = 0, dy = 0, dig = 0): Input => ({ dx, dy, dig }) as Input;

/** Run `ticks` idle ticks. */
export function wait(s: GameState, ticks: number): { s: GameState; ev: GameEvent[] } {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = step(s, NO_INPUT);
    s = r.state;
    ev.push(...r.events);
  }
  return { s, ev };
}

/** Apply `input` for one tick, then idle until the hero comes to rest (or the level ends). */
export function act(s: GameState, input: Input): { s: GameState; ev: GameEvent[] } {
  const first = step(s, input);
  s = first.state;
  const ev = [...first.events];
  for (let n = 0; n < 600 && s.hero.t > 0 && s.status === 'playing'; n++) {
    const r = step(s, NO_INPUT);
    s = r.state;
    ev.push(...r.events);
  }
  return { s, ev };
}
