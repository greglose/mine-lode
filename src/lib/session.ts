// One play-through: mode, level number, lives and banked score.
export type Mode = 'campaign' | 'endless';
export interface Session { mode: Mode; level: number; lives: number; score: number; seed: string }

export const START_LIVES = 5;
export const CAMPAIGN_LEVELS = 20;
export const SEED_MAX = 32;

/** Trim and cut by whole characters, so a character outside the basic plane is never split. */
export const cleanSeed = (text: string): string => [...text.trim()].slice(0, SEED_MAX).join('');

export const newSession = (mode: Mode, level: number, seed: string): Session => ({
  mode, level, lives: START_LIVES, score: 0, seed,
});

export function afterDeath(s: Session): { session: Session; gameOver: boolean } {
  const lives = Math.max(0, s.lives - 1);
  return { session: { ...s, lives }, gameOver: lives === 0 };
}

export function afterClear(s: Session, levelScore: number): { session: Session; campaignDone: boolean } {
  const campaignDone = s.mode === 'campaign' && s.level >= CAMPAIGN_LEVELS;
  return {
    session: { ...s, score: s.score + levelScore, lives: s.lives + 1, level: campaignDone ? s.level : s.level + 1 },
    campaignDone,
  };
}
