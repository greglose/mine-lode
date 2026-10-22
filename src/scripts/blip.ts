// Synthesized blips shared by the games: a decaying gain envelope and an oscillator sweep through it.

export interface Tone { wave: OscillatorType; from: number; to: number; dur: number; gain: number }

/** Sets `param` to `from` at `at` and ramps it to `to` over `dur` (no ramp when they are equal). */
export function glide(param: AudioParam, from: number, to: number, at: number, dur: number): void {
  param.setValueAtTime(from, at);
  if (to !== from) param.exponentialRampToValueAtTime(to, at + dur);
}

/** A gain node at `level` from `at`, decaying to near silence over `dur`, connected to `out`. */
export function decayGain(ctx: BaseAudioContext, level: number, at: number, dur: number, out: AudioNode): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  gain.connect(out);
  return gain;
}

/** One oscillator of `wave` sweeping `from` to `to` Hz into `out`, from `at` for `dur` seconds. */
export function sweep(ctx: BaseAudioContext, wave: OscillatorType, tone: Pick<Tone, 'from' | 'to' | 'dur'>, at: number, out: AudioNode): void {
  const osc = ctx.createOscillator();
  osc.type = wave;
  glide(osc.frequency, tone.from, tone.to, at, tone.dur);
  osc.connect(out);
  osc.start(at);
  osc.stop(at + tone.dur);
}

/** One blip: an oscillator sweep through a decaying gain into `out`. */
export function playTone(ctx: BaseAudioContext, tone: Tone, at: number, out: AudioNode): void {
  sweep(ctx, tone.wave, tone, at, decayGain(ctx, tone.gain, at, tone.dur, out));
}
