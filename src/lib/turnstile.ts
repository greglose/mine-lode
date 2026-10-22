// Cloudflare's always-pass test key. Tokens it issues are rejected by a real secret,
// so it must never ship in a production build.
const TEST_SITE_KEY = '1x00000000000000000000AA';

export function turnstileSiteKey(env: { PUBLIC_TURNSTILE_SITE_KEY?: string; CF_PAGES?: string }): string {
  if (env.PUBLIC_TURNSTILE_SITE_KEY) return env.PUBLIC_TURNSTILE_SITE_KEY;
  if (env.CF_PAGES) throw new Error('PUBLIC_TURNSTILE_SITE_KEY must be set for Cloudflare Pages builds');
  return TEST_SITE_KEY;
}
