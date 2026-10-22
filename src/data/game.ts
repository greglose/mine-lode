// The one place the game's name, copy and colours live. The page, the web manifest and the tests read it.
export const GAME = {
  name: 'Mine Lode',
  shortName: 'Mine Lode',
  tagline: 'Dig, dodge and grab every gold block in a free voxel puzzle platformer.',
  description:
    'Collect all the gold, dig holes to trap the guards, then climb out. Twenty handmade levels plus endless generated ones. Works offline.',
  themeColor: '#1B2A3A',
  backgroundColor: '#1B2A3A',
  /** Optional MP3s, keys are tune names (menu, play); files live in public/music/ (lowercase name, 3 MB cap). */
  music: {} as Readonly<Partial<Record<string, string>>>,
  companyUrl: 'https://cantlosesoftware.com/games/',
  privacyUrl: 'https://cantlosesoftware.com/support/privacy/',
  sourceUrl: 'https://github.com/greglose/mine-lode',
} as const;
