// Progress and sound settings in localStorage. Bad or missing data is replaced, never trusted.
import { NAME_PATTERN, insertRow, isDeviceRow, rank, type ScoreRow } from './scores';
import { DEFAULT_GRAPHICS, isGraphics, type Graphics } from './graphics';
import { CAMPAIGN_LEVELS, type Mode, type Session } from './session';

export interface Save {
  version: 2;
  unlocked: number;
  best: { campaign: number; endless: number };
  lastSeed: string;
  effects: boolean;
  music: boolean;
  /** Scanline overlay on the retro monitor screen. */
  crt: boolean;
  /** Classic canvas look or the Modern WebGL look. */
  graphics: Graphics;
  scores: { campaign: ScoreRow[]; endless: ScoreRow[] };
  initials: string;
}

export const SAVE_KEY = 'cls.mine-lode';

export const freshSave = (): Save => ({
  version: 2, unlocked: 1, best: { campaign: 0, endless: 0 }, lastSeed: '', effects: true, music: true, crt: true, graphics: DEFAULT_GRAPHICS,
  scores: { campaign: [], endless: [] }, initials: '',
});

const score = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const cleanTable = (v: unknown): ScoreRow[] =>
  rank(Array.isArray(v) ? v.filter(isDeviceRow).map(({ name, score: sc, level, seed, date }) => ({ name, score: sc, level, seed, date })) : []);

function validBase(v: unknown): v is Record<string, unknown> & Omit<Save, 'version' | 'scores' | 'initials' | 'crt' | 'graphics'> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  const best = s.best as Record<string, unknown> | undefined;
  return (
    Number.isInteger(s.unlocked) && (s.unlocked as number) >= 1 && (s.unlocked as number) <= CAMPAIGN_LEVELS &&
    typeof best === 'object' && best !== null && score(best.campaign) && score(best.endless) &&
    typeof s.lastSeed === 'string' && typeof s.effects === 'boolean' && typeof s.music === 'boolean'
  );
}

export function loadSave(storage: Pick<Storage, 'getItem'> | undefined): Save {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(SAVE_KEY) ?? 'null');
    if (!validBase(parsed) || (parsed.version !== 1 && parsed.version !== 2)) return freshSave();
    const { unlocked, best, lastSeed, effects, music } = parsed;
    const crt = typeof parsed.crt === 'boolean' ? parsed.crt : true;
    const graphics = isGraphics(parsed.graphics) ? parsed.graphics : DEFAULT_GRAPHICS;
    const kept = { version: 2 as const, unlocked, best: { campaign: best.campaign, endless: best.endless }, lastSeed, effects, music, crt, graphics };
    if (parsed.version === 1) return { ...kept, scores: { campaign: [], endless: [] }, initials: '' };
    const scores = (parsed.scores ?? {}) as Record<string, unknown>;
    const initials = typeof parsed.initials === 'string' && (parsed.initials === '' || NAME_PATTERN.test(parsed.initials)) ? parsed.initials : '';
    return { ...kept, scores: { campaign: cleanTable(scores.campaign), endless: cleanTable(scores.endless) }, initials };
  } catch {
    return freshSave();
  }
}

export function writeSave(storage: Pick<Storage, 'setItem'> | undefined, save: Save): void {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Private mode or a full disk: the game plays on and simply does not remember.
  }
}

export function withProgress(save: Save, s: Session): Save {
  if (s.mode === 'endless') {
    return { ...save, lastSeed: s.seed, best: { ...save.best, endless: Math.max(save.best.endless, s.score) } };
  }
  return {
    ...save,
    unlocked: Math.max(save.unlocked, Math.min(s.level, CAMPAIGN_LEVELS)),
    best: { ...save.best, campaign: Math.max(save.best.campaign, s.score) },
  };
}

export const withScore = (save: Save, mode: Mode, row: ScoreRow): Save => ({
  ...save,
  scores: { ...save.scores, [mode]: insertRow(save.scores[mode], row) },
});
