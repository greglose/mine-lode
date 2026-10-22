// The renderer's clear colour comes from the page (the registry), not from a constant in the renderer.
export const FALLBACK_BG = 0x1b2a3a;

/** The one `#rrggbb` pattern. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb` as a number; anything else gives the fallback. */
export function parseBackground(raw: string | undefined): number {
  return raw !== undefined && HEX_COLOR.test(raw) ? parseInt(raw.slice(1), 16) : FALLBACK_BG;
}
