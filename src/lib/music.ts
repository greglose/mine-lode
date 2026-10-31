// The music contract: file-name rule, served URL, on-disk path, build guard, data-music parsing.
export const MAX_MUSIC_BYTES = 3 * 1024 * 1024;
/** A music file name: lower-case, digits and hyphens, .mp3, no path. The service worker rule mirrors it. */
export const MUSIC_FILE_PATTERN = /^[a-z0-9-]+\.mp3$/;

/** Where a music file is served from (under the site base, such as "/") and where it lives on disk. */
export const musicPaths = (base: string, file: string): { url: string; disk: string } => ({
  url: `${base}music/${file}`,
  disk: `public/music/${file}`,
});

/** A tune's configured file: one name, or (play) a list whose order is level 1's file, level 2's file, then the rest of the pool. */
export type MusicFiles = string | readonly string[];
export type MusicConfig = Readonly<Partial<Record<string, MusicFiles>>>;
/** The served form of {@link MusicFiles}. */
export type TrackUrls = string | string[];

const filesOf = (value: MusicFiles | undefined): readonly string[] => (value === undefined ? [] : typeof value === 'string' ? [value] : value);

/** The finished `{ tune: url | urls }` map a game page hands to its shell. */
export function musicTracks(base: string, music: MusicConfig | undefined): Record<string, TrackUrls> {
  const out: Record<string, TrackUrls> = {};
  for (const [tune, value] of Object.entries(music ?? {})) {
    if (typeof value === 'string') {
      if (value) out[tune] = musicPaths(base, value).url;
    } else if (value) {
      out[tune] = value.filter(Boolean).map((file) => musicPaths(base, file).url);
    }
  }
  return out;
}

/** Tracks from a data-music attribute, limited to known tune names; missing or malformed means none. */
export function parseTracks<N extends string>(raw: string | undefined, names: readonly N[]): Partial<Record<N, TrackUrls>> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Partial<Record<N, TrackUrls>> = {};
    for (const name of names) {
      const value = (parsed as Record<string, unknown>)[name];
      if (typeof value === 'string') out[name] = value;
      else if (Array.isArray(value)) {
        const urls = value.filter((u): u is string => typeof u === 'string');
        if (urls.length) out[name] = urls;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** How many files a tune has. */
export const trackCount = (value: TrackUrls | undefined): number => filesOf(value).length;

/**
 * Which of `count` play tracks a level starts with: level 1 the first, level 2 the second, level 3 and up a random one
 * (`rand` is a 0..1 source, so this stays pure). One track or none is always index 0.
 */
export function pickPlayTrack(count: number, levelNumber: number, rand: () => number): number {
  if (count <= 1) return 0;
  if (levelNumber <= 1) return 0;
  if (levelNumber === 2) return 1;
  return Math.min(count - 1, Math.floor(rand() * count));
}

/** `stat` returns a file's size in bytes, or undefined when it does not exist. `tunes`, when given, lists the allowed keys. */
export function assertMusicValid(
  music: MusicConfig | undefined,
  stat: (path: string) => number | undefined,
  tunes?: readonly string[],
): void {
  const problems: string[] = [];
  for (const [tune, value] of Object.entries(music ?? {})) {
    if (tunes && !tunes.includes(tune)) problems.push(`${tune}: not a tune of this game (expected one of ${tunes.join(', ')})`);
    for (const file of filesOf(value)) {
      if (!file) continue;
      if (!MUSIC_FILE_PATTERN.test(file)) {
        problems.push(`${tune}: ${file} is not a valid file name (lower-case letters, digits and hyphens, .mp3)`);
        continue;
      }
      const path = musicPaths('/', file).disk;
      const size = stat(path);
      if (size === undefined) problems.push(`${tune}: ${file} is missing (expected ${path})`);
      else if (size > MAX_MUSIC_BYTES) problems.push(`${tune}: ${file} is ${size} bytes, over the ${MAX_MUSIC_BYTES} byte cap`);
    }
  }
  if (problems.length) throw new Error(`Music invalid:\n- ${problems.join('\n- ')}`);
}
