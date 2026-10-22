// The twenty handmade campaign levels, read from src/levels/*.txt.
import { parseLevel, type Level } from './level';
import { CAMPAIGN_GUARDS } from './limits';
import { CAMPAIGN_LEVELS } from './session';
import { isSolvable } from './solve';

const files = import.meta.glob<string>('../levels/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Guards per campaign level, level 1 first (lives in limits.ts, shared with the scores function). */
export { CAMPAIGN_GUARDS };

export function loadCampaign(sources: Record<string, string>): Level[] {
  return Object.keys(sources)
    .sort()
    .map((path) => {
      try {
        return parseLevel(sources[path]);
      } catch (e) {
        throw new Error(`${path.split('/').pop()}: ${(e as Error).message}`);
      }
    });
}

export const CAMPAIGN: Level[] = loadCampaign(files);

/** Build-time check: every level can be finished and the guard ramp is as designed. */
export function assertCampaignValid(levels: Level[] = CAMPAIGN): void {
  levels.forEach((level, i) => {
    if (!isSolvable(level)) throw new Error(`Campaign invalid: level ${i + 1} cannot be finished`);
  });
  if (levels.length !== CAMPAIGN_LEVELS) {
    throw new Error(`Campaign invalid: expected ${CAMPAIGN_LEVELS} levels, found ${levels.length}`);
  }
  levels.forEach((level, i) => {
    if (level.guards.length !== CAMPAIGN_GUARDS[i]) {
      throw new Error(`Campaign invalid: level ${i + 1} has ${level.guards.length} guards, expected ${CAMPAIGN_GUARDS[i]}`);
    }
  });
}
