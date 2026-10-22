// The music contract: file-name rule, served URL, on-disk path, build guard, data-music parsing.
export const MAX_MUSIC_BYTES = 3 * 1024 * 1024;
/** A music file name: lower-case, digits and hyphens, .mp3, no path. The service worker rule mirrors it. */
export const MUSIC_FILE_PATTERN = /^[a-z0-9-]+\.mp3$/;

/** Where a music file is served from (under the site base, such as "/") and where it lives on disk. */
export const musicPaths = (base: string, file: string): { url: string; disk: string } => ({
  url: `${base}music/${file}`,
  disk: `public/music/${file}`,
});

/** The finished `{ tune: url }` map a game page hands to its shell. */
export function musicTracks(base: string, music: Readonly<Partial<Record<string, string>>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tune, file] of Object.entries(music ?? {})) if (file) out[tune] = musicPaths(base, file).url;
  return out;
}

/** Tracks from a data-music attribute, limited to known tune names; missing or malformed means none. */
export function parseTracks<N extends string>(raw: string | undefined, names: readonly N[]): Partial<Record<N, string>> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Partial<Record<N, string>> = {};
    for (const name of names) {
      const url = (parsed as Record<string, unknown>)[name];
      if (typeof url === 'string') out[name] = url;
    }
    return out;
  } catch {
    return {};
  }
}

/** `stat` returns a file's size in bytes, or undefined when it does not exist. `tunes`, when given, lists the allowed keys. */
export function assertMusicValid(
  music: Readonly<Partial<Record<string, string>>> | undefined,
  stat: (path: string) => number | undefined,
  tunes?: readonly string[],
): void {
  const problems: string[] = [];
  for (const [tune, file] of Object.entries(music ?? {})) {
    if (tunes && !tunes.includes(tune)) problems.push(`${tune}: not a tune of this game (expected one of ${tunes.join(', ')})`);
    if (!file) continue;
    const path = musicPaths('/', file).disk;
    const size = stat(path);
    if (size === undefined) problems.push(`${tune}: ${file} is missing (expected ${path})`);
    else if (size > MAX_MUSIC_BYTES) problems.push(`${tune}: ${file} is ${size} bytes, over the ${MAX_MUSIC_BYTES} byte cap`);
  }
  if (problems.length) throw new Error(`Music invalid:\n- ${problems.join('\n- ')}`);
}
