// How a person looks. Pure: the poses and joint angles are decided and tested here; character.ts only applies them.
import { tileAt, type GameState } from './state';

export type Pose = 'idle' | 'walk' | 'climb' | 'hang' | 'fall' | 'dig' | 'trapped' | 'dead' | 'cheer';
export type LoopPose = 'walk' | 'climb' | 'hang' | 'idle' | 'trapped' | 'fall';

/** Ticks per full cycle of each looping pose. */
export const POSE_PERIOD: Record<LoopPose, number> = { walk: 24, climb: 24, hang: 36, idle: 120, trapped: 30, fall: 12 };

/** Poses that play once, driven by progress rather than a looping phase. */
const ONE_SHOT: readonly Pose[] = ['dead', 'cheer'];
export const isOneShot = (pose: Pose): boolean => ONE_SHOT.includes(pose);

export interface PoseState { pose: Pose; phase: number }

const looping = (pose: LoopPose, tick: number): PoseState => ({ pose, phase: (tick % POSE_PERIOD[pose]) / POSE_PERIOD[pose] });

export function poseOfHero(s: GameState): PoseState {
  const h = s.hero;
  if (s.status === 'dead') return { pose: 'dead', phase: 0 };
  if (s.status === 'won') return { pose: 'cheer', phase: 0 };
  const moving = h.t > 0;
  if (moving && h.fromX === h.x && h.fromY === h.y) return { pose: 'dig', phase: 1 - h.t / h.total };
  if (h.falling) return looping('fall', s.tick);
  const vertical = moving && h.fromY !== h.y;
  if (!vertical && tileAt(s, h.x, h.y) === 'rope') return looping('hang', s.tick);
  if (vertical) return looping('climb', s.tick);
  if (moving) return looping('walk', s.tick);
  return looping('idle', s.tick);
}

export function poseOfGuard(s: GameState, i: number): PoseState {
  const g = s.guards[i];
  if (g.trapped > 0) return looping('trapped', s.tick);
  const moving = g.t > 0;
  if (g.falling) return looping('fall', s.tick);
  if (tileAt(s, g.x, g.y) === 'rope') return looping('hang', s.tick);
  if (moving && g.fromX === g.x && g.fromY !== g.y) return looping('climb', s.tick);
  if (moving) return looping('walk', s.tick);
  return looping('idle', s.tick);
}

/**
 * Joint angles in radians. arm/leg: swing about the shoulder/hip (0 = hanging down, PI = straight up).
 * turn: body yaw (0 faces the camera, PI/2 faces right, PI faces away). lean: body roll. bob: vertical offset in cells.
 * armR is the tool arm: the character is mirrored when turn < 0, so it is always the arm nearest the camera.
 */
export interface Joints { armL: number; armR: number; legL: number; legR: number; turn: number; lean: number; bob: number }

export const TAU = Math.PI * 2;
const RAISED = 2.6;
const DIG_SWINGS = 3;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const still: Joints = { armL: 0, armR: 0, legL: 0, legR: 0, turn: 0, lean: 0, bob: 0 };

/** `progress` (0..1) drives the one-shot poses dead and cheer; the renderer counts frames to feed it. */
export function jointsFor(pose: Pose, phase: number, facing: -1 | 1, progress = 0): Joints {
  const s = Math.sin(phase * TAU);
  const p = clamp01(progress);
  switch (pose) {
    case 'walk':
      return { ...still, armL: 0.9 * s, armR: -0.9 * s, legL: -0.8 * s, legR: 0.8 * s, turn: facing * (Math.PI / 2), bob: 0.03 * Math.abs(s) };
    case 'climb':
      return { ...still, armL: 2.4 + 0.7 * s, armR: 2.4 - 0.7 * s, legL: -0.7 * s, legR: 0.7 * s, turn: Math.PI };
    case 'hang':
      return { ...still, armL: Math.PI - 0.1 + 0.1 * s, armR: Math.PI - 0.1 - 0.1 * s, legL: 0.15 * s, legR: -0.15 * s };
    case 'fall':
      return { ...still, armL: 2.7 + 0.3 * s, armR: 2.7 - 0.3 * s, legL: 0.4 * s, legR: -0.4 * s };
    case 'dig': {
      const swing = (phase * DIG_SWINGS) % 1;
      return { ...still, armL: -0.3, armR: RAISED + (0.3 - RAISED) * swing, turn: facing * (Math.PI / 2), lean: 0.1 * facing * swing };
    }
    case 'trapped':
      return { ...still, armL: 2.7 + 0.4 * s, armR: 2.7 - 0.4 * s, bob: 0.02 * Math.abs(s) };
    case 'dead':
      return { ...still, armL: 0.6 * p, armR: 0.6 * p, legL: 0.2 * p, legR: -0.2 * p, turn: facing * (Math.PI / 2), lean: -facing * (Math.PI / 2) * p, bob: 0.2 * p };
    case 'cheer':
      return { ...still, armL: RAISED * p + 0.2 * p * Math.sin(p * 4 * TAU), armR: RAISED * p - 0.2 * p * Math.sin(p * 4 * TAU), bob: 0.12 * Math.abs(Math.sin(p * 2 * TAU)) };
    case 'idle':
      return { ...still, armL: 0.04 * s, armR: -0.04 * s, bob: 0.01 * s };
  }
}

/** Elbow and knee bend in radians (0 = straight), added on top of Joints; character.ts applies them when it has the joints. */
export interface LimbJoints { elbowL: number; elbowR: number; kneeL: number; kneeR: number }

const straight: LimbJoints = { elbowL: 0, elbowR: 0, kneeL: 0, kneeR: 0 };
const pos = (v: number): number => Math.max(0, v);

export function limbsFor(pose: Pose, phase: number, facing: -1 | 1, progress = 0): LimbJoints {
  const s = Math.sin(phase * TAU);
  const p = clamp01(progress);
  switch (pose) {
    case 'walk': // a knee bends while its leg swings forward (legL = -0.8 s, so s < 0 is forward for L)
      return { elbowL: 0.25 + 0.15 * pos(s), elbowR: 0.25 + 0.15 * pos(-s), kneeL: 0.9 * pos(-s), kneeR: 0.9 * pos(s) };
    case 'climb':
      return { elbowL: 0.9 + 0.4 * s, elbowR: 0.9 - 0.4 * s, kneeL: 0.8 + 0.5 * s, kneeR: 0.8 - 0.5 * s };
    case 'dig': {
      const swing = (phase * DIG_SWINGS) % 1;
      return { ...straight, elbowL: 0.1, elbowR: 0.2 + 1.1 * swing };
    }
    case 'hang':
      return { elbowL: 0.15 + 0.1 * s, elbowR: 0.15 - 0.1 * s, kneeL: 0.2 + 0.1 * s, kneeR: 0.2 - 0.1 * s };
    case 'fall':
      return { elbowL: 0.5 + 0.2 * s, elbowR: 0.5 - 0.2 * s, kneeL: 0.4 + 0.2 * s, kneeR: 0.4 - 0.2 * s };
    case 'trapped':
      return { elbowL: 0.4 + 0.2 * s, elbowR: 0.4 - 0.2 * s, kneeL: 0.1, kneeR: 0.1 };
    case 'dead':
      return { elbowL: 0.5 * p, elbowR: 0.5 * p, kneeL: 0.3 * p, kneeR: 0.5 * p };
    case 'cheer':
      return { elbowL: 0.3 * p + 0.2 * p * Math.sin(p * 4 * TAU), elbowR: 0.3 * p - 0.2 * p * Math.sin(p * 4 * TAU), kneeL: 0.2 * p * Math.abs(Math.sin(p * 2 * TAU)), kneeR: 0.2 * p * Math.abs(Math.sin(p * 2 * TAU)) };
    case 'idle':
      return { elbowL: 0.05, elbowR: 0.05, kneeL: 0.02, kneeR: 0.02 };
  }
  void facing;
}

/** Ticks a change of pose takes to cross-fade. */
export const POSE_BLEND_TICKS = 6;

/** Cross-fades any joint set (body `Joints` or `LimbJoints`) key by key; t is clamped to 0..1. */
export function blendJoints<T extends Joints | LimbJoints>(from: T, to: T, t: number): T {
  const k = clamp01(t);
  const out = { ...to };
  for (const key of Object.keys(to) as (keyof T)[]) {
    const a = from[key] as number;
    const b = to[key] as number;
    out[key] = (k === 1 ? b : a + (b - a) * k) as T[keyof T];
  }
  return out;
}

const GLANCE_RANGE = 8;
const GLANCE_MAX = 0.6;

/** A small yaw toward the nearest guard within range (positive = to the right); 0 when none is near. */
export function glanceTurn(hero: { x: number; y: number }, guards: readonly { x: number; y: number }[]): number {
  let best: { dx: number; d: number } | null = null;
  for (const g of guards) {
    const dx = g.x - hero.x;
    const d = Math.hypot(dx, g.y - hero.y);
    if (d <= GLANCE_RANGE && (best === null || d < best.d)) best = { dx, d };
  }
  if (best === null || best.dx === 0) return 0;
  return Math.sign(best.dx) * GLANCE_MAX * Math.min(1, Math.abs(best.dx) / 3);
}
