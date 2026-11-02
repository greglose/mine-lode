# Mine Lode - CLAUDE.md

Standalone source of truth for the Mine Lode browser game. Astro 7 static site (one page) plus two Cloudflare Pages
Functions for the shared high-score board. Live at https://mine-lode.cantlosesoftware.com/ (Cloudflare Pages, domain
root). Public, MIT. Extracted from the Can't Lose Software site; that site now only links here.

## Stack

Astro 7, TypeScript 6 (pinned), Three.js (Modern graphics only), Vitest + happy-dom + cheerio. No fonts, no analytics,
no cookies. Cloudflare D1 (`SCORES_DB`) and Turnstile for the optional shared board.

## Commands

```bash
npm run dev      # local dev server
npm test         # builds first (global-setup), then vitest against dist/ and src/
npm run check    # astro check, must report 0 errors
npm run build    # dist/
```

`MINE_LODE_SKIP_BUILD=1 npx vitest run` reuses an existing `dist/`. `MINE_LODE_SITE` / `MINE_LODE_BASE` override the
site and base (defaults `https://mine-lode.cantlosesoftware.com`, `/`).

## Rules

- `src/lib/` is pure and deterministic: no `Math.random`, `Date.now`, or DOM. Randomness from `rng.ts`; time is an argument.
- `render.ts` / `render-modern.ts` are thin shells over `sceneOf` (`src/lib/scene.ts`); what is visible is decided and tested there.
- Levels: `src/levels/NN.txt`, 16 rows of 28 characters, twenty of them (level 1 has no guards, 2-6 one, 7-10 two, 11-14 three, 15-18 four, 19-20 five). `CAMPAIGN_GUARDS` in `limits.ts` is enforced by
  `assertCampaignValid`, and the page frontmatter runs it, so an unfinishable level fails the build. The solver ignores
  guards; check guard starts by eye. Gold cannot sit on a rope or ladder cell.
- Guard pursuit (`guards.ts`) is the classic rating rule, not shortest-path. Its quirks are intended. Do not "fix" them.
- Modern graphics load by dynamic `import()` only; build test caps: 250 KB gzipped start-up script, 120 KB Modern chunk,
  no image or model files beyond the three icons.
- Save is `localStorage` key `cls.mine-lode`, version 2 (existing saves must keep loading). The device top-ten is saved
  first; the shared post is an extra and never blocks play.
- Turnstile: the script is injected by `scores-ui.ts` when the initials panel opens, never written into page HTML. The
  service worker never touches `/api/` or another origin. A `CF_PAGES` build without `PUBLIC_TURNSTILE_SITE_KEY` fails
  on purpose. Endpoints answer 503 without `SCORES_DB`, `SCORES_SECRET`, `TURNSTILE_SECRET_KEY`.
- Anything more sent off-device than three initials, score, level reached, mode and seed needs a privacy change first
  (README, the page's How to play section, and the company policy).
- Colours only in `src/styles/tokens.css` (two dark blocks identical, `--crt-*` identical in light and dark); game canvas
  textures are exempt. Sound effects are synthesized (`EFFECTS` in `audio.ts`). Optional music: `public/music/`, listed in
  `src/data/game.ts`; `play` is a list (file 1 = level 1, file 2 = level 2, level 3+ a random pick from the whole list, `pickPlayTrack`), 3 MB cap per file.
- Never name the games that inspired Mine Lode or any computer maker/model (`tests/brand.test.ts` scans `dist`). No
  mention of the owner's health-app brand. ASCII only in content: `'` and `-`, no curly quotes or long dashes.
- Extend `tests/runtime.test.ts` whenever `src/scripts/main.ts` changes. `init()` stays the last statement of `main.ts`.
