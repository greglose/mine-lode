import { describe, expect, it } from 'vitest';
import { SAVE_KEY, freshSave, loadSave, withProgress, withScore, writeSave } from './save';
import { BOARD_SIZE, type ScoreRow } from './scores';
import { CAMPAIGN_LEVELS, newSession } from './session';

const store = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SAVE_KEY, initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};
const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
};

describe('save', () => {
  it('starts fresh when nothing is stored', () => {
    expect(loadSave(store())).toEqual(freshSave());
    expect(freshSave()).toEqual({
      version: 2, unlocked: 1, best: { campaign: 0, endless: 0 }, lastSeed: '', effects: true, music: true, crt: true, graphics: 'classic',
      scores: { campaign: [], endless: [] }, initials: '',
    });
  });
  it('round-trips', () => {
    const s = store();
    const save = { ...freshSave(), unlocked: 4, best: { campaign: 900, endless: 50 }, lastSeed: 'abc', music: false };
    writeSave(s, save);
    expect(loadSave(s)).toEqual(save);
  });
  it.each([
    ['not JSON', '{oops'],
    ['a JSON null', 'null'],
    ['an array', '[]'],
    ['a future version', JSON.stringify({ ...freshSave(), version: 3 })],
    ['a wrong type', JSON.stringify({ ...freshSave(), unlocked: 'three' })],
    ['an out-of-range level', JSON.stringify({ ...freshSave(), unlocked: 99 })],
    ['a missing field', JSON.stringify({ version: 2, unlocked: 2 })],
    ['a negative score', JSON.stringify({ ...freshSave(), best: { campaign: -5, endless: 0 } })],
  ])('starts fresh from %s', (_name, raw) => {
    expect(loadSave(store(raw))).toEqual(freshSave());
  });
  it('accepts unlocked 20 and an older save, and rejects 21', () => {
    for (const unlocked of [10, 20]) {
      expect(loadSave(store(JSON.stringify({ ...freshSave(), unlocked }))).unlocked).toBe(unlocked);
    }
    expect(loadSave(store(JSON.stringify({ ...freshSave(), unlocked: 21 })))).toEqual(freshSave());
  });
  it('survives storage that throws or is missing', () => {
    expect(loadSave(throwing)).toEqual(freshSave());
    expect(loadSave(undefined)).toEqual(freshSave());
    expect(() => writeSave(throwing, freshSave())).not.toThrow();
    expect(() => writeSave(undefined, freshSave())).not.toThrow();
  });
});

describe('withProgress', () => {
  it('unlocks the next campaign level and keeps the best score', () => {
    const next = withProgress(freshSave(), { ...newSession('campaign', 4, ''), score: 3000 });
    expect(next.unlocked).toBe(4);
    expect(next.best.campaign).toBe(3000);
    expect(withProgress(next, { ...newSession('campaign', 2, ''), score: 10 })).toEqual(next);
  });
  it('never unlocks past the last level', () => {
    expect(withProgress(freshSave(), newSession('campaign', CAMPAIGN_LEVELS + 1, '')).unlocked).toBe(CAMPAIGN_LEVELS);
  });
  it('records endless best and seed without touching the campaign', () => {
    const next = withProgress(freshSave(), { ...newSession('endless', 7, 'abc'), score: 500 });
    expect(next).toEqual({ ...freshSave(), best: { campaign: 0, endless: 500 }, lastSeed: 'abc' });
  });
});

const r = (score: number, over: Partial<ScoreRow> = {}): ScoreRow => ({
  name: 'ABC', score, level: 2, seed: '', date: '2026-10-13', ...over,
});
const v1 = { version: 1, unlocked: 7, best: { campaign: 4200, endless: 900 }, lastSeed: 'abc', effects: false, music: false };

describe('version 2 upgrade', () => {
  it('upgrades a valid version 1 save in place, keeping everything', () => {
    expect(loadSave(store(JSON.stringify(v1)))).toEqual({
      ...v1, version: 2, crt: true, graphics: 'classic', scores: { campaign: [], endless: [] }, initials: '',
    });
  });
  it('still rejects a broken version 1 save', () => {
    expect(loadSave(store(JSON.stringify({ ...v1, unlocked: 99 })))).toEqual(freshSave());
  });
  it('round-trips score rows and initials', () => {
    const s = store();
    const save = { ...freshSave(), initials: 'GRG', scores: { campaign: [r(500)], endless: [r(90, { seed: 'moon' })] } };
    writeSave(s, save);
    expect(loadSave(s)).toEqual(save);
  });
  it('drops only the malformed rows and keeps the rest of the save', () => {
    const good = r(300);
    const bad = [
      r(1, { name: 'abc' }), r(1, { name: 'AB' }), r(1, { name: 'FUK' }), r(0), r(-4), r(1.5), r(1, { level: 0 }),
      r(1, { level: 2.5 }), r(1, { seed: 'x'.repeat(33) }), r(1, { date: '13/10/2026' }), r(1, { date: '2026-1-1' }),
      { name: 'ABC' }, null, 'row', [], r(1, { seed: 5 as unknown as string }),
    ];
    const raw = JSON.stringify({ ...v1, version: 2, initials: 'ABC', scores: { campaign: [good, ...bad], endless: 'nope' } });
    const out = loadSave(store(raw));
    expect(out.scores).toEqual({ campaign: [good], endless: [] });
    expect(out.unlocked).toBe(7);
    expect(out.best).toEqual(v1.best);
    expect(out.initials).toBe('ABC');
  });
  it('ranks and cuts each loaded table to the board size', () => {
    const rows = Array.from({ length: 14 }, (_, i) => r(i + 1));
    const out = loadSave(store(JSON.stringify({ ...freshSave(), scores: { campaign: rows, endless: [] } })));
    expect(out.scores.campaign).toHaveLength(BOARD_SIZE);
    expect(out.scores.campaign[0].score).toBe(14);
  });
  it('accepts blank or valid initials and blanks a bad value', () => {
    expect(loadSave(store(JSON.stringify({ ...freshSave(), initials: 'abc' }))).initials).toBe('');
    expect(loadSave(store(JSON.stringify({ ...freshSave(), initials: 7 }))).initials).toBe('');
    expect(loadSave(store(JSON.stringify({ ...freshSave(), initials: '' }))).initials).toBe('');
  });
});

describe('withScore', () => {
  it('adds a row to the right table, ranked, without touching the other', () => {
    let save = withScore(freshSave(), 'campaign', r(100));
    save = withScore(save, 'campaign', r(300, { name: 'TOP' }));
    save = withScore(save, 'endless', r(50, { seed: 'a' }));
    expect(save.scores.campaign.map((x) => x.score)).toEqual([300, 100]);
    expect(save.scores.endless).toHaveLength(1);
  });
  it('keeps at most the board size and does not mutate the input', () => {
    const base = freshSave();
    let save = base;
    for (let i = 1; i <= 12; i++) save = withScore(save, 'endless', r(i));
    expect(save.scores.endless).toHaveLength(BOARD_SIZE);
    expect(save.scores.endless[BOARD_SIZE - 1].score).toBe(3);
    expect(base.scores.endless).toEqual([]);
  });
});

describe('screen effect setting', () => {
  const v2 = { ...v1, version: 2, scores: { campaign: [], endless: [] }, initials: '' };
  it('a version 2 save without the field loads with it on and keeps everything else', () => {
    const loaded = loadSave(store(JSON.stringify({ ...v2, unlocked: 5, lastSeed: 'xyz' })));
    expect(loaded).toEqual({ ...v2, unlocked: 5, lastSeed: 'xyz', crt: true, graphics: 'classic' });
  });
  it('replaces a non-boolean value with on', () => {
    for (const crt of ['no', 0, null, [], {}]) {
      expect(loadSave(store(JSON.stringify({ ...v2, crt }))).crt, JSON.stringify(crt)).toBe(true);
    }
  });
  it('round-trips off', () => {
    const s = store();
    writeSave(s, { ...freshSave(), crt: false });
    expect(loadSave(s).crt).toBe(false);
  });
});

describe('graphics setting', () => {
  const v2 = { ...v1, version: 2, crt: false, scores: { campaign: [], endless: [] }, initials: '' };
  it('a save without the field loads classic and keeps everything else', () => {
    const loaded = loadSave(store(JSON.stringify({ ...v2, unlocked: 5 })));
    expect(loaded).toEqual({ ...v2, unlocked: 5, graphics: 'classic' });
    expect(loaded.version).toBe(2);
  });
  it('replaces an unknown value with classic', () => {
    for (const graphics of ['ultra', 'Modern', 1, null, [], {}]) {
      expect(loadSave(store(JSON.stringify({ ...v2, graphics }))).graphics, JSON.stringify(graphics)).toBe('classic');
    }
  });
  it('round-trips modern', () => {
    const s = store();
    writeSave(s, { ...freshSave(), graphics: 'modern' });
    expect(loadSave(s).graphics).toBe('modern');
  });
});
