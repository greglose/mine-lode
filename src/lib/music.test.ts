import { describe, expect, it } from 'vitest';
import { MAX_MUSIC_BYTES, MUSIC_FILE_PATTERN, assertMusicValid, musicPaths, musicTracks, parseTracks } from './music';
import { TUNES, TUNE_NAMES } from './tunes';

const MB = 1024 * 1024;

describe('assertMusicValid', () => {
  it('accepts a game with no music', () => {
    expect(() => assertMusicValid(undefined, () => undefined)).not.toThrow();
    expect(() => assertMusicValid({}, () => undefined)).not.toThrow();
  });
  it('accepts files that exist under the cap', () => {
    const seen: string[] = [];
    expect(() =>
      assertMusicValid({ menu: 'menu.mp3', play: 'play.mp3' }, (p) => {
        seen.push(p);
        return MAX_MUSIC_BYTES;
      }),
    ).not.toThrow();
    expect(seen).toEqual(['public/music/menu.mp3', 'public/music/play.mp3']);
  });
  it('names a missing file', () => {
    expect(() => assertMusicValid({ menu: 'menu.mp3' }, () => undefined)).toThrow(/^Music invalid:[\s\S]*menu\.mp3[\s\S]*missing/);
  });
  it('names an oversized file and its size', () => {
    expect(() => assertMusicValid({ play: 'big.mp3' }, () => 4 * MB)).toThrow(/^Music invalid:[\s\S]*big\.mp3[\s\S]*4194304/);
  });
  it('caps at 3 MB', () => {
    expect(MAX_MUSIC_BYTES).toBe(3 * MB);
  });
});

describe('unknown tune names (moved here from the registry schema)', () => {
  it('rejects a key that is not an allowed tune, as a Games music error', () => {
    expect(() => assertMusicValid({ boss: 'boss.mp3' }, () => 10, TUNE_NAMES)).toThrow(/^Music invalid:[\s\S]*boss/);
  });
  it('accepts allowed keys', () => {
    expect(() => assertMusicValid({ menu: 'menu.mp3' }, () => 10, TUNE_NAMES)).not.toThrow();
  });
});

describe('one music contract', () => {
  it('derives tune names from TUNES', () => {
    expect([...TUNE_NAMES]).toEqual(Object.keys(TUNES));
  });
  it('has one file-name pattern', () => {
    expect(MUSIC_FILE_PATTERN.test('a-1.mp3')).toBe(true);
    expect(MUSIC_FILE_PATTERN.test('../a.mp3')).toBe(false);
  });
  it('gives the public url and the disk path from one place', () => {
    expect(musicPaths('/', 'menu.mp3')).toEqual({ url: '/music/menu.mp3', disk: 'public/music/menu.mp3' });
    expect(musicPaths('/mine-lode/', 'menu.mp3').url).toBe('/mine-lode/music/menu.mp3');
  });
  it('builds the url map the page hands to the shell', () => {
    expect(musicTracks('/', { menu: 'menu.mp3' })).toEqual({ menu: '/music/menu.mp3' });
    expect(musicTracks('/', undefined)).toEqual({});
  });
  it('parses data-music, dropping unknown names and bad values', () => {
    expect(parseTracks('{"menu":"/a.mp3","x":"/b.mp3","play":3}', ['menu', 'play'])).toEqual({ menu: '/a.mp3' });
    expect(parseTracks('nope', ['menu'])).toEqual({});
    expect(parseTracks(undefined, ['menu'])).toEqual({});
    expect(parseTracks('[1]', ['menu'])).toEqual({});
  });
  it('a tune added to TUNES-shaped input reaches the tracks passed to createAudio', () => {
    const tunes = { ...TUNES, boss: TUNES.play };
    const names = Object.keys(tunes);
    const raw = JSON.stringify(musicTracks('/', { boss: 'boss.mp3', menu: 'menu.mp3' }));
    expect(parseTracks(raw, names)).toEqual({ boss: '/music/boss.mp3', menu: '/music/menu.mp3' });
  });
});
