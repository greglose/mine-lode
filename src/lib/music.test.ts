import { describe, expect, it } from 'vitest';
import { MAX_MUSIC_BYTES, MUSIC_FILE_PATTERN, assertMusicValid, musicPaths, musicTracks, parseTracks, pickPlayTrack, trackCount } from './music';
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

describe('pickPlayTrack', () => {
  it('level 1 is always the first track and level 2 the second', () => {
    for (const r of [0, 0.5, 0.99]) {
      expect(pickPlayTrack(3, 1, () => r)).toBe(0);
      expect(pickPlayTrack(3, 2, () => r)).toBe(1);
    }
  });
  it('level 2 falls back to the first track when there is only one', () => {
    expect(pickPlayTrack(1, 2, () => 0.9)).toBe(0);
  });
  it('level 3 and up picks at random across all tracks, first to last', () => {
    expect(pickPlayTrack(3, 3, () => 0)).toBe(0);
    expect(pickPlayTrack(3, 3, () => 0.5)).toBe(1);
    expect(pickPlayTrack(3, 9, () => 0.99)).toBe(2);
    expect(pickPlayTrack(2, 5, () => 0.99)).toBe(1);
    expect(pickPlayTrack(2, 5, () => 0)).toBe(0);
  });
  it('is index 0 for no track or one track, at any level', () => {
    for (const level of [1, 2, 3, 40]) {
      expect(pickPlayTrack(0, level, () => 0.99)).toBe(0);
      expect(pickPlayTrack(1, level, () => 0.99)).toBe(0);
    }
  });
});

describe('play as a list of files', () => {
  const ok = () => 1000;
  it('accepts a list of existing files under the cap', () => {
    const seen: string[] = [];
    expect(() => assertMusicValid({ play: ['a-1.mp3', 'b-2.mp3'] }, (p) => (seen.push(p), 1000))).not.toThrow();
    expect(seen).toEqual(['public/music/a-1.mp3', 'public/music/b-2.mp3']);
  });
  it('names a missing file in the list', () => {
    expect(() => assertMusicValid({ play: ['a.mp3', 'gone.mp3'] }, (p) => (p.includes('gone') ? undefined : 1))).toThrow(/gone\.mp3[\s\S]*missing/);
  });
  it('names an oversized file in the list', () => {
    expect(() => assertMusicValid({ play: ['a.mp3', 'big.mp3'] }, (p) => (p.includes('big') ? 4 * MB : 1))).toThrow(/big\.mp3[\s\S]*4194304/);
  });
  it('rejects a bad file name', () => {
    expect(() => assertMusicValid({ play: ['a.mp3', 'Bad Name.mp3'] }, ok)).toThrow(/Bad Name\.mp3[\s\S]*name/);
    expect(() => assertMusicValid({ play: ['../x.mp3'] }, ok)).toThrow(/name/);
  });
  it('only allows known tunes for a list too', () => {
    expect(() => assertMusicValid({ boss: ['a.mp3'] }, ok, TUNE_NAMES)).toThrow(/boss/);
  });
  it('builds an array of urls for a list and a string for a string', () => {
    expect(musicTracks('/', { menu: 'menu.mp3', play: ['a.mp3', 'b.mp3'] })).toEqual({ menu: '/music/menu.mp3', play: ['/music/a.mp3', '/music/b.mp3'] });
  });
  it('parses an array of urls and drops non-string entries', () => {
    expect(parseTracks('{"play":["/a.mp3","/b.mp3"]}', ['menu', 'play'])).toEqual({ play: ['/a.mp3', '/b.mp3'] });
    expect(parseTracks('{"play":["/a.mp3",3]}', ['play'])).toEqual({ play: ['/a.mp3'] });
    expect(parseTracks('{"play":[]}', ['play'])).toEqual({});
  });
  it('counts tracks', () => {
    expect(trackCount(undefined)).toBe(0);
    expect(trackCount('/a.mp3')).toBe(1);
    expect(trackCount(['/a.mp3', '/b.mp3'])).toBe(2);
  });
});
