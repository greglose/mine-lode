import type { APIRoute } from 'astro';
import { GAME } from '../data/game';

const base = import.meta.env.BASE_URL;

// Built from the base so id, start_url, scope and icon paths stay correct wherever the site is hosted.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        id: base,
        name: GAME.name,
        short_name: GAME.shortName,
        description: GAME.tagline,
        lang: 'en',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: GAME.backgroundColor,
        theme_color: GAME.themeColor,
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
