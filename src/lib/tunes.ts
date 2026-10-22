// Two original loops, one entry per sixteenth note. Numbers are MIDI notes; null is a rest.
export interface Tune { bpm: number; lead: (number | null)[]; bass: (number | null)[] }
export type TuneName = 'menu' | 'play';

export const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

const _ = null;

export const TUNES: Record<TuneName, Tune> = {
  // A minor, unhurried.
  menu: {
    bpm: 96,
    lead: [69, _, 72, _, 76, _, 72, _, 74, _, 71, _, 67, _, 71, _, 65, _, 69, _, 72, _, 69, _, 67, _, 71, _, 74, _, _, _],
    bass: [45, _, _, _, 45, _, _, _, 43, _, _, _, 43, _, _, _, 41, _, _, _, 41, _, _, _, 43, _, _, _, 47, _, _, _],
  },
  // D minor, driving.
  play: {
    bpm: 132,
    lead: [62, 65, 69, 65, 62, 65, 69, 72, 60, 64, 67, 64, 60, 64, 67, 70, 58, 62, 65, 62, 58, 62, 65, 69, 57, 61, 64, 61, 57, 64, 69, _],
    bass: [38, _, 38, _, 50, _, 38, _, 36, _, 36, _, 48, _, 36, _, 34, _, 34, _, 46, _, 34, _, 33, _, 33, _, 45, _, 45, _],
  },
};

/** Every tune name, derived from TUNES so a new tune needs no second list. */
export const TUNE_NAMES = Object.keys(TUNES) as TuneName[];
