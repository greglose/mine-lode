// @ts-check
import { defineConfig } from 'astro/config';

// Where the site is served. Defaults match the Cloudflare Pages project at the root of
// mine-lode.cantlosesoftware.com; override for another host or a sub-path (MINE_LODE_BASE=/mine-lode/). Every asset
// URL, the web manifest, the canonical link and the service worker scope follow the base, so nothing else needs editing.
const SITE = process.env.MINE_LODE_SITE || 'https://mine-lode.cantlosesoftware.com';
const BASE = `/${(process.env.MINE_LODE_BASE ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
});
