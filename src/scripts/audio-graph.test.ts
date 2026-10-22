// Golden record: the node graph every game sound builds, so an audio refactor can be checked against it.
import { describe, expect, it } from 'vitest';
import { recordMineLode } from './audio-recorder';
import { EFFECTS, createAudio } from './audio';
import golden from './audio-graph.fixture.json';

describe('game sound graphs', () => {
  it('builds the recorded graph for every effect and tune', () => {
    const sounds = Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>;
    expect(recordMineLode(createAudio, sounds, ['menu', 'play'])).toEqual(golden);
  });
});
