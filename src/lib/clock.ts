// Fixed-tick catch-up. After a long stall the missed time is dropped, never replayed.
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const MAX_STEPS = 5;

export function stepsDue(acc: number, dt: number): { steps: number; acc: number } {
  const total = acc + (Number.isFinite(dt) && dt > 0 ? dt : 0);
  const steps = Math.floor(total / TICK_MS);
  if (steps > MAX_STEPS) return { steps: MAX_STEPS, acc: 0 };
  return { steps, acc: total - steps * TICK_MS };
}
