import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, SEED_MAX, START_LIVES, afterClear, afterDeath, cleanSeed, newSession } from './session';

describe('cleanSeed', () => {
  it('trims and cuts to the limit', () => {
    expect(cleanSeed('  abc  ')).toBe('abc');
    expect(cleanSeed('x'.repeat(100)).length).toBe(SEED_MAX);
  });
  it('returns an empty string for blank input', () => {
    expect(cleanSeed('   ')).toBe('');
    expect(cleanSeed('')).toBe('');
  });
  it('does not split a character outside the basic plane', () => {
    const out = cleanSeed('\u{1F600}'.repeat(40));
    expect([...out].length).toBe(SEED_MAX);
    expect(out.endsWith('\u{1F600}')).toBe(true);
  });
});

describe('session', () => {
  it('starts with five lives and no score', () => {
    expect(newSession('campaign', 3, '')).toEqual({ mode: 'campaign', level: 3, lives: START_LIVES, score: 0, seed: '' });
  });
  it('loses a life on death and ends at zero', () => {
    let s = newSession('endless', 1, 'abc');
    for (let i = 1; i < START_LIVES; i++) {
      const r = afterDeath(s);
      expect(r.gameOver).toBe(false);
      s = r.session;
    }
    expect(s.lives).toBe(1);
    const last = afterDeath(s);
    expect(last.gameOver).toBe(true);
    expect(last.session.lives).toBe(0);
    expect(last.session.level).toBe(1);
  });
  it('banks the level score and moves on when a level is cleared', () => {
    const r = afterClear(newSession('campaign', 3, ''), 2250);
    expect(r.session.level).toBe(4);
    expect(r.session.score).toBe(2250);
    expect(r.campaignDone).toBe(false);
  });
  it('awards one extra life for clearing a level', () => {
    const s = newSession('campaign', 3, '');
    expect(s.lives).toBe(5);
    const cleared = afterClear(s, 100).session;
    expect(cleared.lives).toBe(6);
    expect(afterDeath(cleared).session.lives).toBe(5);
  });
  it('awards the extra life on the last campaign level and in endless mode', () => {
    expect(afterClear(newSession('campaign', CAMPAIGN_LEVELS, ''), 100).session.lives).toBe(START_LIVES + 1);
    expect(afterClear(newSession('endless', 4, 'abc'), 100).session.lives).toBe(START_LIVES + 1);
  });
  it('still ends the game at zero lives after extra lives are earned', () => {
    let s = afterClear(newSession('campaign', 1, ''), 100).session;
    for (let i = 1; i < START_LIVES + 1; i++) s = afterDeath(s).session;
    expect(s.lives).toBe(1);
    expect(afterDeath(s)).toMatchObject({ gameOver: true, session: { lives: 0 } });
  });
  it('plays twenty campaign levels', () => {
    expect(CAMPAIGN_LEVELS).toBe(20);
  });
  it('finishes the campaign after the last level', () => {
    const r = afterClear(newSession('campaign', CAMPAIGN_LEVELS, ''), 100);
    expect(r.campaignDone).toBe(true);
    expect(r.session.level).toBe(CAMPAIGN_LEVELS);
  });
  it('never finishes endless mode', () => {
    const r = afterClear(newSession('endless', 500, 'abc'), 100);
    expect(r.campaignDone).toBe(false);
    expect(r.session.level).toBe(501);
  });
});
