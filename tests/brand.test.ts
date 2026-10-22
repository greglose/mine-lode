import { describe, expect, it } from 'vitest';
import { filesWithExt, read } from './helpers';

// The patterns are stored base64-encoded so this public source does not spell out the names it guards against.
const banned = (b64: string): RegExp => new RegExp(Buffer.from(b64, 'base64').toString('utf8'), 'i');
const INSPIRATIONS = banned('bG9kZVxzKnJ1bm5lcnxtaW5lY3JhZnQ=');
const COMPUTER_MODELS = banned('YXBwbGVccyppaXxhcHBsZVxzKlxdXFt8XGJJSWVcYg==');

describe('built site wording', () => {
  const files = [
    ...filesWithExt('.html'), ...filesWithExt('.xml'), ...filesWithExt('.js'),
    ...filesWithExt('.css'), ...filesWithExt('.webmanifest'),
    ...filesWithExt('.json'), ...filesWithExt('.txt'),
  ];

  it('scans a real set of built files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never names the games that inspired Mine Lode', () => {
    for (const f of files) expect(read(f), f).not.toMatch(INSPIRATIONS);
  });

  it('never names a computer maker or model in the retro monitor frame or anywhere else', () => {
    // Plain "Apple" stays legal: the apple-touch-icon and apple-mobile-web-app meta names.
    for (const f of files) expect(read(f), f).not.toMatch(COMPUTER_MODELS);
  });

});
