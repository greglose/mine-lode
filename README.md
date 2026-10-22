# Mine Lode

An original voxel dig-and-collect platformer for the browser. Collect every gold block, dig holes to trap the guards,
then climb out. Twenty handmade campaign levels, an Endless mode that generates levels from a seed, Classic (canvas)
and Modern (WebGL, Three.js) graphics, synthesized sound with an optional MP3 music slot, and an offline-capable PWA.
A shared high-score board is optional; every device keeps its own top ten.

Play it: https://mine-lode.cantlosesoftware.com/

## Privacy

- **On your device (always):** progress, sound and graphics settings, your own Campaign and Endless top-ten tables and
  your last initials are kept in this browser's `localStorage` under the key `cls.mine-lode`. No analytics, no cookies,
  no tracking.
- **If you post a score to the shared board:** the page sends three initials, the score, the level reached, the mode
  (Campaign or Endless) and, for Endless, the seed. They are shown publicly on the board. A Cloudflare Turnstile human
  check runs when you enter your initials; its script is loaded only at that moment, never with the page. Your IP
  address is not stored. Posting is optional; skip the initials and nothing leaves your device.
- Company policy: https://cantlosesoftware.com/support/privacy/

## Run it

```
npm install
npm run dev      # http://localhost:4321/
npm test         # builds the site, then runs every spec (vitest, happy-dom)
npm run build    # static site in dist/
npm run preview
npm run check    # astro check
```

Node 22.23.4 or newer. The site is served at the root of its host. Defaults are
`https://mine-lode.cantlosesoftware.com` and `/`; override with the `MINE_LODE_SITE` and `MINE_LODE_BASE` environment
variables (for example `MINE_LODE_BASE=/mine-lode/ npm run build` for a sub-path). The asset URLs, canonical link, web
manifest and service worker scope all follow the base. The shared-score API is always at `/api/scores` on the host's
root, so a sub-path deploy needs its own routing for that.

## Deploy (Cloudflare Pages)

The site is static; the score board is two Pages Functions in `functions/`.

1. Cloudflare Pages: connect this GitHub repo. Build command `npm run build`, output directory `dist`, Node 24
   (`NODE_VERSION=24`).
2. Custom domain: add `mine-lode.cantlosesoftware.com` to the Pages project.
3. Create a D1 database, bind it to the project as `SCORES_DB`, and run the migration:
   `npx wrangler d1 execute <database-name> --remote --file migrations/0001_scores.sql`.
4. Set the secrets `SCORES_SECRET` (any long random string; it signs the start stamps) and `TURNSTILE_SECRET_KEY`.
5. Set the build variable `PUBLIC_TURNSTILE_SITE_KEY`. The Turnstile widget must list the hostname you serve from. A
   build with `CF_PAGES` set and no site key fails on purpose; local builds fall back to Cloudflare's always-pass test
   key, which never ships.

Without the binding and the secrets, `/api/scores` and `/api/scores/start` answer 503 and the game shows this device's
table only. Remove a row: `npx wrangler d1 execute <database-name> --remote --command "DELETE FROM scores WHERE id = <id>"`
(find the id with a `SELECT` first). For local Functions work, put the secrets in `.dev.vars` (git-ignored).

## Project layout

```
src/pages/index.astro            the page: stage, panels, How to play, footer
src/pages/manifest.webmanifest.ts  web manifest, built from the base
src/data/game.ts                 name, copy, colours, optional music tracks
src/levels/01..20.txt            campaign levels
src/lib/                         pure game logic and its specs (no DOM, no clock, no Math.random)
src/scripts/                     browser code: main.ts (menus, loop), renderers, audio, input, scores client and UI, pwa
src/styles/                      tokens (light, dark, --crt-* case colours) and base styles
public/sw.js                     own-origin service worker; public/icon-*.png home-screen icons
functions/api/                   Pages Functions: GET/POST /api/scores, POST /api/scores/start
migrations/0001_scores.sql       D1 schema
tests/                           build, runtime (happy-dom), service worker, scores API, wording and token specs
```

## Rules worth knowing

- **Determinism.** Nothing under `src/lib/` may call `Math.random` or `Date.now`, or touch the DOM. Randomness comes
  from `rng.ts`; time is always an argument. The simulation runs on a fixed tick.
- **Levels** are 16 rows of 28 characters. There are twenty, all original, in a teaching order. `CAMPAIGN_GUARDS`
  (in `src/lib/limits.ts`) fixes the guard count per level and `assertCampaignValid` enforces it; the page's build step
  also runs a solver over every level, so a level that cannot be finished fails the build. The solver ignores guards,
  so check guard starts by eye. Gold cannot sit on a rope or ladder cell.
- **Guard pursuit** is the classic rating rule in `guards.ts`, deliberately not shortest-path. Its quirks (luring,
  dithering at ladders, preferring left on ties) are intended. Do not "fix" them.
- **Graphics.** Modern is loaded by dynamic `import()` only when chosen. `tests/build.test.ts` caps start-up script at
  250 KB gzipped and the Modern chunk at 120 KB, and fails if any image or model file is added beyond the three icons.
  If Modern cannot run, the game falls back to Classic for the session.
- **Scores.** The device row is always saved first; the post is an extra and never blocks the game. Anything more sent
  off the device than initials, score, level reached, mode and seed needs a privacy change first. The Turnstile script
  is injected by `scores-ui.ts` when the initials panel opens, never written into the page HTML (a test fails on it).
  The service worker never touches `/api/` or another origin.
- **Save** is `localStorage` key `cls.mine-lode`, version 2. Keep it readable.
- **Wording.** `tests/brand.test.ts` scans the built site: it must never name the games that inspired Mine Lode, nor a
  computer maker or model (the retro monitor frame is CSS only and carries neither).
- **Music.** Optional MP3s go in `public/music/` and are listed under `music` in `src/data/game.ts` with a tune name as
  the key (`{ menu: 'menu.mp3', play: 'play.mp3' }`; lowercase name, 3 MB cap). The build fails on a missing, oversized
  or unknown-keyed file. With none configured, or if a file fails to load, the generated chiptune plays. Sound effects
  stay synthesized. Only add tracks you hold a license to distribute on the web.
- All colours live in `src/styles/tokens.css`; the two dark blocks must stay identical. Textures generated for the game
  canvas are exempt.

## Credits and licenses

- Everything in this repo: MIT, copyright 2026 Greg Lose (`LICENSE`).
- [Three.js](https://threejs.org) is bundled into the Modern graphics chunk (MIT); see `THIRD-PARTY-NOTICES.md`.
- A [Cant Lose Software](https://cantlosesoftware.com/games/) game.
