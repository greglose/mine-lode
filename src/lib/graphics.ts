// Which look the game wears, and the order Modern sheds cost when frames run slow. Pure.
export const GRAPHICS = ['classic', 'modern'] as const;
export type Graphics = (typeof GRAPHICS)[number];
export const DEFAULT_GRAPHICS: Graphics = 'classic';
export const GRAPHICS_LABELS: Record<Graphics, string> = { classic: 'Classic', modern: 'Modern' };

export const isGraphics = (v: unknown): v is Graphics => typeof v === 'string' && (GRAPHICS as readonly string[]).includes(v);

/** Costly effects Modern switches off, cheapest to lose first. */
export const STEP_DOWN = ['post', 'shadows', 'particles'] as const;
export type QualityStep = (typeof STEP_DOWN)[number];

export const nextStepDown = (disabled: readonly QualityStep[]): QualityStep | null =>
  STEP_DOWN.find((step) => !disabled.includes(step)) ?? null;

/** A frame slower than this counts as slow; slow for this long triggers a step down. */
export const SLOW_FRAME_MS = 20;
export const SLOW_FOR_MS = 3000;

export const FALLBACK_NOTICE = 'Modern graphics are not available here; using Classic.';

/** The seed Modern decor uses for a level: stable per level, so the same level always looks the same. */
export const levelSeed = (mode: 'campaign' | 'endless', levelNumber: number, endlessSeed: string): string =>
  mode === 'campaign' ? `campaign-${levelNumber}` : `endless-${endlessSeed}-${levelNumber}`;
