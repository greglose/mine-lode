import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// MINE_LODE_SKIP_BUILD=1 reuses the existing dist/ (for running the unit specs alone).
// The build is pinned to the default site and base so the specs do not depend on the caller's environment.
export default function setup(): void {
  if (process.env.MINE_LODE_SKIP_BUILD) return;
  const root = join(__dirname, '..');
  execFileSync('npx', ['astro', 'build'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, MINE_LODE_SITE: '', MINE_LODE_BASE: '/', CF_PAGES: '' },
  });
}
