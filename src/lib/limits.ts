// Per-level limits shared by the game and the scores Pages Function. Plain TypeScript only:
// no import.meta.glob, no ?raw, no astro: imports (the Functions bundler is not Vite).
import { MAX_GUARDS } from './level';

/** Guards per campaign level, level 1 first. */
export const CAMPAIGN_GUARDS = [0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5];
/** Gold per campaign level, level 1 first. A test keeps both tables equal to the level files. */
export const CAMPAIGN_GOLD = [6, 5, 6, 5, 5, 6, 6, 6, 6, 6, 7, 7, 6, 7, 7, 8, 7, 6, 7, 9];

export const guardCount = (levelNumber: number): number => Math.min(1 + Math.floor(levelNumber / 3), MAX_GUARDS);
export const goldCount = (levelNumber: number): number => Math.min(4 + Math.floor(levelNumber / 2), 10);
