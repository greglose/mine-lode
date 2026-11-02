import { describe, expect, it } from 'vitest';
import { CAMPAIGN, CAMPAIGN_GUARDS, assertCampaignValid, loadCampaign } from './campaign';
import { COLS, ROWS } from './level';
import { readdirSync, readFileSync } from 'node:fs';
import { CAMPAIGN_LEVELS } from './session';
import * as limits from './limits';

describe('campaign', () => {
  it('has CAMPAIGN_LEVELS levels', () => {
    expect(CAMPAIGN.length).toBe(CAMPAIGN_LEVELS);
  });
  it('passes validation and the solver', () => {
    expect(() => assertCampaignValid()).not.toThrow();
  });
  it('ramps guards from none to five as designed', () => {
    expect(CAMPAIGN_GUARDS).toEqual([0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5]);
    expect(CAMPAIGN.map((l) => l.guards.length)).toEqual(CAMPAIGN_GUARDS);
  });
  it('keeps level 1 guard-free and gives every later level at least one guard', () => {
    expect(CAMPAIGN[0].guards.length).toBe(0);
    CAMPAIGN.slice(1).forEach((level, i) => {
      expect(level.guards.length, `level ${i + 2}`).toBeGreaterThanOrEqual(1);
    });
  });
  it('has between 4 and 12 gold in every level', () => {
    CAMPAIGN.forEach((level, i) => {
      expect(level.gold.length, `level ${i + 1}`).toBeGreaterThanOrEqual(4);
      expect(level.gold.length, `level ${i + 1}`).toBeLessThanOrEqual(12);
    });
  });
  it('keeps every guard start apart from the hero and on empty ground', () => {
    CAMPAIGN.forEach((level, i) => {
      for (const g of level.guards) {
        const far = Math.abs((g % COLS) - (level.hero % COLS)) >= 8 || Math.abs(Math.floor(g / COLS) - Math.floor(level.hero / COLS)) >= 3;
        expect(far, `level ${i + 1} guard ${g}`).toBe(true);
        expect(level.tiles[g], `level ${i + 1} guard ${g}`).toBe('empty');
        const below = level.tiles[g + COLS];
        expect(['dirt', 'stone', 'ladder'], `level ${i + 1} guard ${g} needs ground`).toContain(below);
      }
    });
  });
  it('has no two identical level files', () => {
    const dir = new URL('../levels/', import.meta.url);
    const texts = readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => readFileSync(new URL(f, dir), 'utf8'));
    expect(texts.length).toBe(CAMPAIGN_LEVELS);
    expect(new Set(texts).size).toBe(texts.length);
  });
  it('starts the hero on the bottom walking row in every level', () => {
    for (const level of CAMPAIGN) expect(Math.floor(level.hero / COLS)).toBe(ROWS - 2);
  });
  it('names the file when a level is broken', () => {
    expect(() => loadCampaign({ '/x/levels/01.txt': 'nope' })).toThrow(/01\.txt: Level invalid:/);
  });
  it('rejects a campaign with an unsolvable level', () => {
    const blank = Array.from({ length: ROWS - 1 }, () => '.'.repeat(COLS));
    const stuck = [...blank, '&$'.padEnd(COLS, '.')].join('\n');
    const levels = loadCampaign({ '/x/levels/01.txt': stuck });
    expect(() => assertCampaignValid(levels)).toThrow(/Campaign invalid: level 1 cannot be finished/);
  });
  it('rejects a campaign whose level count differs from CAMPAIGN_LEVELS', () => {
    expect(() => assertCampaignValid(CAMPAIGN.slice(1))).toThrow(/Campaign invalid: expected \d+ levels, found \d+/);
  });
  it('rejects a campaign whose guard counts differ from CAMPAIGN_GUARDS', () => {
    const levels = CAMPAIGN.map((l, i) => (i === 3 ? { ...l, guards: [] } : l));
    expect(() => assertCampaignValid(levels)).toThrow(/Campaign invalid: level 4 has 0 guards, expected 1/);
  });
  it('keeps the plain limits table equal to the real level files', () => {
    expect(limits.CAMPAIGN_GUARDS).toEqual(CAMPAIGN.map((l) => l.guards.length));
    expect(limits.CAMPAIGN_GOLD).toEqual(CAMPAIGN.map((l) => l.gold.length));
    expect(limits.CAMPAIGN_GOLD).toHaveLength(CAMPAIGN_LEVELS);
    expect(CAMPAIGN_GUARDS).toBe(limits.CAMPAIGN_GUARDS);
  });
});
