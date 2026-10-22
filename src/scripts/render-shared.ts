// The Renderer contract and the pieces both renderers (Classic render.ts, Modern render-modern.ts) share: camera framing, block motion,
// frame-time and context-loss watching, the one-shot pose clock and the effect particles. No game decisions.
import * as THREE from 'three';
import type { Decor } from '../lib/decor';
import { COLS, ROWS, idx } from '../lib/level';
import { TAU, isOneShot, type Pose } from '../lib/pose';
import type { Block, BlockKind, Effect } from '../lib/scene';
import type { GameState } from '../lib/state';
import type { TextureKind } from '../lib/textures';

/** What main.ts drives; both renderers implement it. */
export interface Renderer {
  draw(state: GameState): void;
  resize(width: number, height: number): void;
  shake(): void;
  effects(list: Effect[]): void;
  dispose(): void;
  /** Modern only: the static decor of the level now in play. */
  setLevel?(decor: Decor, seed: string): void;
}
export interface RendererOptions { background: number; reducedMotion: boolean; onLost: () => void }

export const FOV = 30;
export const CX = (COLS - 1) / 2;
export const CY = (ROWS - 1) / 2;
export const SHAKE_FRAMES = 18;
const LOST_GRACE_MS = 3000;
/** Frames the one-shot poses (dead, cheer) take to play. */
const ONE_SHOT_FRAMES = 40;
const EXIT_RISE_FRAMES = 30;
const EXIT_BLOCK_RISE_FRAMES = 8;

/** Grid rows grow downward; world y grows upward. */
export const worldY = (y: number): number => ROWS - 1 - y;
export const cameraHome = (): THREE.Vector3 => new THREE.Vector3(CX + 2.5, CY + 4, 40);

/** Fit the whole grid (plus a margin) at this size; the same framing in both renderers. */
export function frameCamera(camera: THREE.PerspectiveCamera, home: THREE.Vector3, width: number, height: number): void {
  camera.aspect = width / height;
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  home.z = Math.max((ROWS + 3) / 2 / tan, (COLS + 3) / 2 / tan / camera.aspect);
  camera.position.copy(home);
  camera.lookAt(CX, CY, 0);
  camera.updateProjectionMatrix();
}

/** Camera position for this frame: home plus the shake, if any is left. Returns the shake frames left. */
export function shakeCamera(camera: THREE.PerspectiveCamera, home: THREE.Vector3, shakeLeft: number): number {
  camera.position.copy(home);
  if (shakeLeft <= 0) return 0;
  const k = (shakeLeft / SHAKE_FRAMES) * 0.2;
  camera.position.x += Math.sin(shakeLeft * 2.1) * k;
  camera.position.y += Math.cos(shakeLeft * 1.7) * k;
  return shakeLeft - 1;
}

/** Vertical offset inside the cell, so ropes hang at the top and gold sits on the floor. */
export const OFFSET_Y: Record<BlockKind, number> = { dirt: 0, stone: 0, ladder: 0, rope: 0.36, gold: -0.27 };

/** Gold bob and spin, and the exit ladder rising block by block when it opens. */
export function createBlockMotion(reducedMotion: boolean): {
  begin(state: GameState): void;
  place(dummy: THREE.Object3D, b: Block, state: GameState): void;
} {
  let frames = 0;
  let exitRise = EXIT_RISE_FRAMES;
  let exitWasOpen = false;
  let rising = false;
  return {
    begin(state) {
      frames++;
      if (state.exitOpen && !exitWasOpen && !reducedMotion) exitRise = 0;
      exitWasOpen = state.exitOpen;
      rising = exitRise < EXIT_RISE_FRAMES;
      if (rising) exitRise++;
    },
    place(dummy, b, state) {
      dummy.position.set(b.x, worldY(b.y) + OFFSET_Y[b.kind], 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(b.scale);
      if (b.kind === 'gold' && !reducedMotion) {
        dummy.position.y += Math.sin(frames * 0.06 + b.x * 1.3 + b.y * 0.7) * 0.04;
        dummy.rotation.y = frames * 0.03 + b.x * 0.9 + b.y * 0.5;
      }
      if (rising && b.kind === 'ladder' && state.tiles[idx(b.x, b.y)] === 'exit') {
        const start = (ROWS - 1 - b.y) * ((EXIT_RISE_FRAMES - EXIT_BLOCK_RISE_FRAMES) / (ROWS - 1));
        const k = Math.min(1, Math.max(0, (exitRise - start) / EXIT_BLOCK_RISE_FRAMES));
        dummy.scale.setScalar(Math.max(k, 0.001));
        dummy.position.y -= (1 - k) * 0.5;
      }
      dummy.updateMatrix();
    },
  };
}

/** Feed it each frame's time: true once the running average stays over slowFrameMs for slowForMs, then it starts over. */
export function createFrameWatch(slowFrameMs: number, slowForMs: number): (now: number) => boolean {
  let lastFrame = 0;
  let average = 16;
  let slowSince = 0;
  return (now) => {
    if (lastFrame && now - lastFrame < 500) average = average * 0.9 + (now - lastFrame) * 0.1;
    lastFrame = now;
    if (average <= slowFrameMs) {
      slowSince = 0;
      return false;
    }
    slowSince ||= now;
    if (now - slowSince <= slowForMs) return false;
    slowSince = 0;
    return true;
  };
}

/** Calls onLost if the WebGL context is lost and not restored within a grace period. Returns the remover. */
export function watchContextLoss(canvas: HTMLCanvasElement, onLost: () => void): () => void {
  let timer = 0;
  const lost = (e: Event): void => {
    e.preventDefault();
    timer = window.setTimeout(onLost, LOST_GRACE_MS);
  };
  const restored = (): void => window.clearTimeout(timer);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    window.clearTimeout(timer);
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}

/** Progress 0..1 of each character's current one-shot pose, counted in frames since it first showed. */
export function createOneShotClock(): (who: object, pose: Pose) => number {
  const seen = new WeakMap<object, { pose: Pose; frames: number }>();
  return (who, pose) => {
    if (!isOneShot(pose)) {
      seen.delete(who);
      return 0;
    }
    const s = seen.get(who);
    if (!s || s.pose !== pose) {
      seen.set(who, { pose, frames: 0 });
      return 0;
    }
    s.frames++;
    return Math.min(1, s.frames / ONE_SHOT_FRAMES);
  };
}

export const PARTICLE_POOL = 48;
interface ParticleKind {
  count: number; life: number; texture: TextureKind; size: number; speed: number; gravity: number;
  /** Sideways speed factor. */
  spread: number;
  /** Launch velocity (y, z) from speed, the spawn angle and the per-particle lift. */
  launch: (speed: number, angle: number, lift: number) => { vy: number; vz: number };
  /** Scale and opacity over the particle life, k in 0..1. */
  fade: (size: number, k: number) => { scale: number; opacity: number };
}
export const PARTICLES: Record<Effect['kind'], ParticleKind> = {
  chunks: { count: 7, life: 30, texture: 'dirt', size: 0.16, speed: 0.07, gravity: 0.006, spread: 0.6, launch: (v, a, lift) => ({ vy: v * (1 + lift), vz: v * 0.3 * Math.sin(a * 2) }), fade: (size) => ({ scale: size, opacity: 1 }) },
  puff: { count: 5, life: 26, texture: 'stone', size: 0.3, speed: 0.025, gravity: -0.0008, spread: 1, launch: (v) => ({ vy: v * 0.5, vz: 0 }), fade: (size, k) => ({ scale: size * (0.6 + k * 1.2), opacity: 0.7 * (1 - k) }) },
  sparkle: { count: 6, life: 22, texture: 'gold', size: 0.1, speed: 0.06, gravity: 0, spread: 1, launch: (v, a) => ({ vy: Math.sin(a) * v, vz: v * 0.3 * Math.sin(a * 2) }), fade: (size, k) => ({ scale: size * (1 - k), opacity: 1 }) },
};
export interface EffectParticle<M extends THREE.Material> {
  mesh: THREE.Mesh<THREE.BufferGeometry, M>; kind: Effect['kind']; age: number; vx: number; vy: number; vz: number; spin: number;
}
export const isFree = <M extends THREE.Material>(p: EffectParticle<M>): boolean => p.age >= PARTICLES[p.kind].life;

/** Start particle i of an effect. Spread by index, not by chance: the same effect looks the same every time. */
export function launchParticle<M extends THREE.Material>(p: EffectParticle<M>, e: Effect, i: number, spawned: number): void {
  const spec = PARTICLES[e.kind];
  const angle = ((i + spawned * 0.37) / spec.count) * TAU;
  const lift = 0.5 + ((i * 5 + spawned) % 4) * 0.25;
  p.kind = e.kind;
  p.age = 0;
  const launch = spec.launch(spec.speed, angle, lift);
  p.vx = Math.cos(angle) * spec.speed * spec.spread;
  p.vy = launch.vy;
  p.vz = launch.vz;
  p.spin = (i % 2 ? 1 : -1) * 0.12;
  p.mesh.position.set(e.x, worldY(e.y), 0.3);
  p.mesh.rotation.set(0, 0, 0);
  p.mesh.scale.setScalar(spec.size);
  p.mesh.visible = true;
}

/** One frame of a live particle. */
export function advanceParticle<M extends THREE.Material>(p: EffectParticle<M>): void {
  const spec = PARTICLES[p.kind];
  p.age++;
  const k = p.age / spec.life;
  const m = p.mesh;
  m.position.x += p.vx;
  m.position.y += p.vy;
  m.position.z += p.vz;
  p.vy -= spec.gravity;
  m.rotation.x += p.spin;
  m.rotation.y += p.spin * 0.7;
  const look = spec.fade(spec.size, k);
  m.scale.setScalar(look.scale);
  m.material.opacity = look.opacity;
  m.visible = p.age < spec.life;
}

/** A DataTexture for 16x16 pixel art: nearest filtering, sRGB. */
export function pixelTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
