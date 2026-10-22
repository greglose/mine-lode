// Modern view of a game state: the same sceneOf() output as Classic, drawn under cave lighting with
// post-processing, bevelled bump-mapped blocks, a deep background and ambient particles. A thin shell:
// decor, ambient spawns, poses and the step-down order are decided and tested in lib.
// Loaded only by dynamic import when the Modern graphics setting is on.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ambientOf, flicker, type AmbientKind, type Spawn } from '../lib/ambient';
import { MAX_LIGHTS, MAX_PER_KIND, type Decor, type Prop, type PropKind } from '../lib/decor';
import { SLOW_FOR_MS, SLOW_FRAME_MS, nextStepDown, type QualityStep } from '../lib/graphics';
import { COLS, ROWS, idx } from '../lib/level';
import {
  POSE_BLEND_TICKS, blendJoints, glanceTurn, jointsFor, limbsFor, type Joints, type LimbJoints, type Pose,
} from '../lib/pose';
import { sceneOf, type BlockKind, type Effect } from '../lib/scene';
import type { GameEvent, GameState } from '../lib/state';
import { HD_SIZE, makeHdTexture, type HdKind } from '../lib/textures-hd';
import { TEXTURE_SIZE, makeTexture, type TextureKind } from '../lib/textures';
import { createCharacter, type Character } from './character';
import {
  CX, CY, FOV, PARTICLES, PARTICLE_POOL, SHAKE_FRAMES, advanceParticle, cameraHome, createBlockMotion, createFrameWatch,
  createOneShotClock, frameCamera, isFree, launchParticle, pixelTexture, shakeCamera, watchContextLoss, worldY,
  type EffectParticle, type Renderer, type RendererOptions,
} from './render-shared';

/**
 * Every lighting number of the Modern view, in one place to tune. The cave is dark: the fill is low, the
 * key light is modest, and the headlamp and lanterns make the pools of light. Ladders, ropes, gold and the
 * exit carry their own emissive glow, so they stay readable in an unlit corner.
 */
export const MODERN_LIGHTING = {
  exposure: 1,
  /** Background and depth haze: a very dark warm brown. */
  cave: 0x0a0807,
  /** The haze runs from the play plane to this many units behind it. */
  hazeDepth: 18,
  ambient: { color: 0x2a2018, intensity: 0.12 },
  hemisphere: { sky: 0x4a3c30, ground: 0x140e0a, intensity: 0.25 },
  key: { color: 0xffd8b0, intensity: 1.2 },
  headlamp: { color: 0xfff1d6, intensity: 70, distance: 16, angle: 0.5, penumbra: 0.5, decay: 1.6 },
  /** Decor light intensity (about 1) times power is the point light's candela. */
  lantern: { power: 9, distance: 9, decay: 1.5 },
  /** Wall planes: texture tint, the nearest layer's glow in its decor tint, and the factor per layer farther back. */
  wall: { color: 0x6a5848, emissive: 0.5, falloff: 0.6 },
  emissive: { ladder: 0.5, rope: 0.5, gold: 0.7, exit: 1.6, crystal: 0.25, flame: 2.2 },
  crystal: { color: 0x8c98c0, emissive: 0x3a50b0 },
} as const;

const CAVE = MODERN_LIGHTING.cave;
/** Ticks of ambient catch-up per frame at most (after a stall the schedule skips ahead). */
const MAX_TICK_STEP = 4;
const AMBIENT_POOL = 48;
/** Decor lights sit at LIGHT_Z behind their lantern; this pulls them in front of the block faces (z = 0.5). */
const LIGHT_FORWARD = 1.4;
/** Height of the lantern body and the headlamp above the cell centre. */
const LANTERN_Y = 0.15;
const HEAD_Y = 0.4;
const DRIFT_RATE = 0.0012;
const DRIFT_CELLS = 0.6;
const MAX_LAYERS = 3;

type DrawKind = BlockKind | 'exit';
const DRAW_KINDS: DrawKind[] = ['dirt', 'stone', 'ladder', 'rope', 'gold', 'exit'];
const AMBIENT_LOOK: Record<AmbientKind, { color: number; glow: number; size: number; stretch: number; opacity: number }> = {
  dust: { color: 0xd8ccb4, glow: 1, size: 0.035, stretch: 1, opacity: 0.55 },
  drip: { color: 0x9cc8ff, glow: 1.5, size: 0.04, stretch: 2.2, opacity: 0.85 },
  spark: { color: 0xffc46a, glow: 4, size: 0.05, stretch: 1, opacity: 1 },
};
const EFFECT_SURFACE: Record<Effect['kind'], HdKind> = { chunks: 'dirt', puff: 'stone', sparkle: 'gold' };
const NO_EVENTS: readonly GameEvent[] = [];
const DIG_EVENTS: readonly GameEvent[] = ['dig'];

type Surface = 'metal' | 'flame' | 'timber' | 'rock' | 'crystal' | 'rail' | 'moss' | 'pebble';
/** One instanced piece of a prop kind: its shape, its surface, and where it sits for a given prop. */
interface Part { kind: PropKind; shape: () => THREE.BufferGeometry; surface: Surface; place: (p: Prop, o: THREE.Object3D) => void }
const put = (o: THREE.Object3D, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rz = 0, ry = 0): void => {
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.rotation.set(0, ry, rz);
};
const box = (w: number, h: number, d: number) => (): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const PARTS: Part[] = [
  { kind: 'lantern', shape: box(0.2, 0.28, 0.2), surface: 'metal', place: (p, o) => put(o, p.x, worldY(p.y) + LANTERN_Y, p.z, 1) },
  { kind: 'lantern', shape: box(0.13, 0.17, 0.22), surface: 'flame', place: (p, o) => put(o, p.x, worldY(p.y) + LANTERN_Y, p.z, 1) },
  { kind: 'timber', shape: box(0.14, 1, 0.14), surface: 'timber', place: (p, o) => put(o, p.x - 0.52, worldY(p.y), p.z, 1, p.scale, 1) },
  { kind: 'timber', shape: box(0.14, 1, 0.14), surface: 'timber', place: (p, o) => put(o, p.x + 0.52, worldY(p.y), p.z, 1, p.scale, 1) },
  { kind: 'timber', shape: box(1.2, 0.14, 0.16), surface: 'timber', place: (p, o) => put(o, p.x, worldY(p.y) + p.scale / 2 - 0.07, p.z, 1) },
  {
    kind: 'stalactite', surface: 'rock',
    shape: () => new THREE.ConeGeometry(0.16, 0.7, 6).rotateX(Math.PI).translate(0, -0.35, 0),
    place: (p, o) => put(o, p.x, worldY(p.y) + 0.5, p.z, p.scale, p.scale, p.scale, p.rot),
  },
  {
    kind: 'crystal', surface: 'crystal', shape: () => new THREE.OctahedronGeometry(0.22),
    place: (p, o) => put(o, p.x, worldY(p.y), p.z, p.scale * 0.8, p.scale * 1.5, p.scale * 0.8, p.rot),
  },
  { kind: 'rail', shape: box(1, 0.05, 0.06), surface: 'rail', place: (p, o) => put(o, p.x, worldY(p.y) - 0.47, p.z - 0.12, p.scale, 1, 1) },
  { kind: 'rail', shape: box(1, 0.05, 0.06), surface: 'rail', place: (p, o) => put(o, p.x, worldY(p.y) - 0.47, p.z + 0.12, p.scale, 1, 1) },
  { kind: 'cart', shape: box(0.8, 0.42, 0.5), surface: 'metal', place: (p, o) => put(o, p.x, worldY(p.y) - 0.15, p.z, 1) },
  ...[-0.25, 0.25].map((dx): Part => ({
    kind: 'cart', surface: 'rail', shape: () => new THREE.CylinderGeometry(0.12, 0.12, 0.58, 10).rotateX(Math.PI / 2),
    place: (p, o) => put(o, p.x + dx, worldY(p.y) - 0.38, p.z, 1),
  })),
  // Moss and pebbles sit on the top face of the block under the prop's (empty) cell.
  {
    kind: 'moss', surface: 'moss', shape: () => new THREE.IcosahedronGeometry(0.5, 1),
    place: (p, o) => put(o, p.x + (p.variant - 1) * 0.15, worldY(p.y) - 0.5, 0, p.scale * 1.6, 0.12, 0.7),
  },
  {
    kind: 'pebble', surface: 'pebble', shape: () => new THREE.IcosahedronGeometry(0.5, 0),
    place: (p, o) => put(o, p.x + (p.variant - 1) * 0.25, worldY(p.y) - 0.5 + p.scale * 0.15, 0.25, p.scale * 0.6, p.scale * 0.4, p.scale * 0.6, 0, p.rot),
  },
];

interface Blend { pose: Pose; since: number; from: Joints; fromLimbs: LimbJoints; last: Joints; lastLimbs: LimbJoints }
interface Speck { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; kind: AmbientKind; age: number; life: number; vx: number; vy: number }
interface Lantern { light: THREE.PointLight; power: number; seed: number }

/** Modern adds a step-down the renderer drives itself; it is exposed for tests only. */
export interface ModernRenderer extends Renderer { stepDown(): QualityStep | null }

export function createModernRenderer(canvas: HTMLCanvasElement, opts: RendererOptions): ModernRenderer {
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!context) throw new Error('WebGL 2 is not available');

  /** Everything with GPU resources this renderer made; dispose() frees the lot. */
  const owned = new Set<{ dispose(): void }>();
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.add(x);
    return x;
  };

  const gl = new THREE.WebGLRenderer({ canvas, context });
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = MODERN_LIGHTING.exposure;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CAVE);
  const fog = new THREE.Fog(CAVE, 40, 70);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  const home = cameraHome();

  // Textures: 32x32 colour plus a bump map from the height data for blocks and props; 16x16 for the people.
  const hdCache = new Map<HdKind, { map: THREE.DataTexture; bump: THREE.DataTexture }>();
  const hd = (kind: HdKind): { map: THREE.DataTexture; bump: THREE.DataTexture } => {
    const cached = hdCache.get(kind);
    if (cached) return cached;
    const { color, height } = makeHdTexture(kind);
    const map = own(new THREE.DataTexture(color, HD_SIZE, HD_SIZE, THREE.RGBAFormat));
    map.colorSpace = THREE.SRGBColorSpace;
    const bump = own(new THREE.DataTexture(height, HD_SIZE, HD_SIZE, THREE.RedFormat));
    for (const t of [map, bump]) {
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    }
    const made = { map, bump };
    hdCache.set(kind, made);
    return made;
  };
  const pixelCache = new Map<TextureKind, THREE.DataTexture>();
  const pixels = (kind: TextureKind): THREE.DataTexture => {
    const cached = pixelCache.get(kind);
    if (cached) return cached;
    const t = own(pixelTexture(makeTexture(kind), TEXTURE_SIZE));
    pixelCache.set(kind, t);
    return t;
  };
  const standard = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => own(new THREE.MeshStandardMaterial(p));
  const shape = <T extends THREE.BufferGeometry>(g: T): T => own(g);
  const dummy = new THREE.Object3D();

  // Lighting: a dark cave with a low warm fill, one modest key light, the miner's headlamp and the lanterns.
  const L = MODERN_LIGHTING;
  scene.add(own(new THREE.AmbientLight(L.ambient.color, L.ambient.intensity)));
  scene.add(own(new THREE.HemisphereLight(L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity)));
  const key = own(new THREE.DirectionalLight(L.key.color, L.key.intensity));
  key.position.set(CX - 10, CY + 16, 14);
  key.target.position.set(CX, CY, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12, near: 1, far: 60 });
  scene.add(key, key.target);

  // Blocks. Ladders, ropes, gold and the open exit carry their own light, so they read brighter than in Classic.
  const ladder = hd('ladder');
  const stone = hd('stone');
  const bevel = shape(new RoundedBoxGeometry(1, 1, 1, 2, 0.08));
  const ladderShape = shape(new THREE.BoxGeometry(0.8, 1, 0.12));
  const blockParts: Record<DrawKind, [THREE.BufferGeometry, THREE.Material]> = {
    dirt: [bevel, standard({ map: hd('dirt').map, bumpMap: hd('dirt').bump, bumpScale: 1.5, roughness: 0.95 })],
    stone: [bevel, standard({ map: stone.map, bumpMap: stone.bump, bumpScale: 1.5, roughness: 0.8 })],
    ladder: [ladderShape, standard({ map: ladder.map, bumpMap: ladder.bump, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: ladder.map, emissiveIntensity: L.emissive.ladder, roughness: 0.8 })],
    rope: [shape(new THREE.BoxGeometry(1, 0.08, 0.08)), standard({ color: 0xc8a15a, emissive: 0xc8a15a, emissiveIntensity: L.emissive.rope, roughness: 0.9 })],
    gold: [shape(new RoundedBoxGeometry(0.45, 0.45, 0.45, 2, 0.05)), standard({ map: hd('gold').map, bumpMap: hd('gold').bump, metalness: 0.6, roughness: 0.35, emissive: 0xffb020, emissiveIntensity: L.emissive.gold })],
    exit: [ladderShape, standard({ map: ladder.map, alphaTest: 0.5, emissive: 0xfff0a0, emissiveMap: ladder.map, emissiveIntensity: L.emissive.exit, roughness: 0.6 })],
  };
  const blocks = {} as Record<DrawKind, THREE.InstancedMesh>;
  for (const kind of DRAW_KINDS) {
    const mesh = own(new THREE.InstancedMesh(blockParts[kind][0], blockParts[kind][1], COLS * ROWS * 2));
    mesh.name = `block:${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    blocks[kind] = mesh;
    scene.add(mesh);
  }
  const used = {} as Record<DrawKind, number>;

  // Props, instanced per piece of each kind; setLevel fills them.
  const surfaces: Record<Surface, THREE.Material> = {
    metal: standard({ color: 0x3b3f47, roughness: 0.5, metalness: 0.7 }),
    flame: standard({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: L.emissive.flame }),
    timber: standard({ map: hd('timber').map, bumpMap: hd('timber').bump, roughness: 0.9 }),
    rock: standard({ map: stone.map, bumpMap: stone.bump, color: 0x9a9488, roughness: 0.85 }),
    crystal: standard({ map: hd('crystal').map, color: L.crystal.color, emissive: L.crystal.emissive, emissiveIntensity: L.emissive.crystal, roughness: 0.2, metalness: 0.1 }),
    rail: standard({ color: 0x6d6a66, roughness: 0.4, metalness: 0.8 }),
    moss: standard({ color: 0x4f7a32, roughness: 1 }),
    pebble: standard({ color: 0x8a8580, roughness: 0.9 }),
  };
  const propMeshes = PARTS.map((part) => {
    const mesh = own(new THREE.InstancedMesh(shape(part.shape()), surfaces[part.surface], MAX_PER_KIND[part.kind]));
    mesh.name = `prop:${part.kind}`;
    mesh.count = 0;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { part, mesh };
  });

  // Background: cave-wall planes at the decor's layer depths, glowing faintly in their tint, hazed by the fog.
  const wall = hd('wall');
  for (const t of [wall.map, wall.bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 8);
  }
  const background = new THREE.Group();
  scene.add(background);
  const layerShape = shape(new THREE.PlaneGeometry(1, 1));
  const layers = Array.from({ length: MAX_LAYERS }, () => {
    const mesh = new THREE.Mesh(layerShape, standard({ map: wall.map, bumpMap: wall.bump, bumpScale: 2, roughness: 1, color: L.wall.color, emissiveIntensity: L.wall.emissive }));
    mesh.name = 'layer';
    mesh.visible = false;
    background.add(mesh);
    return mesh;
  });

  // People, with elbows and knees; the headlamp rides on the miner and points the way he faces.
  const hero = createCharacter('miner', pixels, { joints: true });
  scene.add(hero.group);
  const lamp = own(new THREE.SpotLight(L.headlamp.color, L.headlamp.intensity, L.headlamp.distance, L.headlamp.angle, L.headlamp.penumbra, L.headlamp.decay));
  lamp.position.set(0, HEAD_Y, 0.3);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  lamp.shadow.radius = 3;
  lamp.shadow.bias = -0.001;
  Object.assign(lamp.shadow.camera, { near: 0.2, far: 12 });
  hero.group.add(lamp, lamp.target);
  const guards: Character[] = [];
  const progressOf = createOneShotClock();
  const blends = new WeakMap<Character, Blend>();
  /** Ease from the last drawn joints into a new pose over POSE_BLEND_TICKS. */
  const blend = (who: Character, pose: Pose, tick: number, joints: Joints, limbs: LimbJoints): [Joints, LimbJoints] => {
    let b = blends.get(who);
    if (!b || tick < b.since) {
      b = { pose, since: tick - POSE_BLEND_TICKS, from: joints, fromLimbs: limbs, last: joints, lastLimbs: limbs };
      blends.set(who, b);
    } else if (b.pose !== pose) {
      b.pose = pose;
      b.since = tick;
      b.from = b.last;
      b.fromLimbs = b.lastLimbs;
    }
    const t = (tick - b.since) / POSE_BLEND_TICKS;
    b.last = blendJoints(b.from, joints, t);
    b.lastLimbs = blendJoints(b.fromLimbs, limbs, t);
    return [b.last, b.lastLimbs];
  };

  // Particles: the effect bursts (as Classic) and the ambient specks, both pooled.
  const particleShape = shape(new THREE.BoxGeometry(1, 1, 1));
  const effectPool: EffectParticle<THREE.MeshStandardMaterial>[] = [];
  for (let i = 0; i < PARTICLE_POOL; i++) {
    const mesh = new THREE.Mesh(particleShape, standard({ map: hd('dirt').map, transparent: true, roughness: 0.9, emissive: 0xffc040, emissiveIntensity: 0 }));
    mesh.name = 'particle:effect';
    mesh.visible = false;
    scene.add(mesh);
    effectPool.push({ mesh, kind: 'chunks', age: PARTICLES.chunks.life, vx: 0, vy: 0, vz: 0, spin: 0 });
  }
  const specks: Speck[] = [];
  for (let i = 0; i < AMBIENT_POOL; i++) {
    const mesh = new THREE.Mesh(particleShape, own(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })));
    mesh.name = 'particle:ambient';
    mesh.visible = false;
    scene.add(mesh);
    specks.push({ mesh, kind: 'dust', age: 0, life: 0, vx: 0, vy: 0 });
  }
  const spawnSpeck = (s: Spawn): void => {
    const k = specks.find((p) => p.age >= p.life);
    if (!k) return;
    const look = AMBIENT_LOOK[s.kind];
    k.kind = s.kind;
    k.age = 0;
    k.life = s.life;
    k.vx = s.vx;
    k.vy = -s.vy;
    k.mesh.position.set(s.x, worldY(s.y), s.z);
    k.mesh.scale.set(look.size, look.size * look.stretch, look.size);
    k.mesh.material.color.setHex(look.color).multiplyScalar(look.glow);
    k.mesh.material.opacity = look.opacity;
    k.mesh.visible = true;
  };
  const advanceSpecks = (): void => {
    for (const k of specks) {
      if (k.age >= k.life) continue;
      k.age++;
      k.mesh.position.x += k.vx;
      k.mesh.position.y += k.vy;
      k.mesh.material.opacity = AMBIENT_LOOK[k.kind].opacity * Math.min(1, (1 - k.age / k.life) * 4);
      k.mesh.visible = k.age < k.life;
    }
  };

  // Post-processing: scene, ambient occlusion, bloom on the bright and emissive parts, then tone mapping.
  const composer = own(new EffectComposer(gl));
  const ao = own(new GTAOPass(scene, camera, 512, 512));
  ao.blendIntensity = 0.7;
  const bloom = own(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.4, 0.7));
  for (const pass of [own(new RenderPass(scene, camera)), ao, bloom, own(new OutputPass())]) composer.addPass(pass);

  let decor: Decor = { props: [], lights: [], layers: [] };
  let seed = '';
  let lanterns: Lantern[] = [];
  let lastTick = -1;
  let digPending = false;
  let spawned = 0;
  let frames = 0;
  let shakeLeft = 0;
  let usePost = true;
  let particlesOn = !opts.reducedMotion;
  const motion = createBlockMotion(opts.reducedMotion);
  const stopWatchingLoss = watchContextLoss(canvas, opts.onLost);
  const slow = createFrameWatch(SLOW_FRAME_MS, SLOW_FOR_MS);

  const disabled: QualityStep[] = [];
  const steps: Record<QualityStep, () => void> = {
    post: () => {
      usePost = false;
    },
    shadows: () => {
      gl.shadowMap.enabled = false;
      key.castShadow = false;
      lamp.castShadow = false;
    },
    particles: () => {
      particlesOn = false;
      for (const p of effectPool) {
        p.age = PARTICLES[p.kind].life;
        p.mesh.visible = false;
      }
      for (const k of specks) {
        k.age = k.life;
        k.mesh.visible = false;
      }
    },
  };
  const stepDown = (): QualityStep | null => {
    const step = nextStepDown(disabled);
    if (step) {
      disabled.push(step);
      steps[step]();
    }
    return step;
  };

  /** Run the ambient schedule for the ticks since the last frame. */
  const stepAmbient = (tick: number, hero: { x: number; y: number; facing: -1 | 1 }): void => {
    if (lastTick < 0 || tick < lastTick) lastTick = tick - 1;
    for (let t = Math.max(lastTick + 1, tick - MAX_TICK_STEP + 1); t <= tick; t++) {
      advanceSpecks();
      if (particlesOn) for (const s of ambientOf(t, seed, decor, digPending ? DIG_EVENTS : NO_EVENTS, hero)) spawnSpeck(s);
      digPending = false;
    }
    lastTick = tick;
  };

  return {
    setLevel(next, nextSeed) {
      decor = next;
      seed = nextSeed;
      lastTick = -1;
      for (const { part, mesh } of propMeshes) {
        let n = 0;
        for (const p of next.props) {
          if (p.kind !== part.kind || n >= MAX_PER_KIND[part.kind]) continue;
          part.place(p, dummy);
          dummy.updateMatrix();
          mesh.setMatrixAt(n++, dummy.matrix);
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
      for (const l of lanterns) {
        scene.remove(l.light);
        owned.delete(l.light);
        l.light.dispose();
      }
      lanterns = next.lights.slice(0, MAX_LIGHTS).map((d) => {
        const power = d.intensity * L.lantern.power;
        const light = own(new THREE.PointLight(d.color, power, L.lantern.distance, L.lantern.decay));
        light.name = 'lantern';
        light.position.set(d.x, worldY(d.y) + LANTERN_Y, d.z + LIGHT_FORWARD);
        scene.add(light);
        return { light, power, seed: d.flickerSeed };
      });
      layers.forEach((mesh, i) => {
        const layer = next.layers[i];
        mesh.visible = Boolean(layer);
        if (!layer) return;
        // Farther layers are larger so they still fill the view behind the grid.
        const grow = 1 - layer.depth / 25;
        mesh.position.set(CX, CY, layer.depth);
        mesh.scale.set((COLS + 24) * grow, (ROWS + 16) * grow, 1);
        mesh.material.emissive.setHex(layer.tint);
        mesh.material.emissiveIntensity = L.wall.emissive * L.wall.falloff ** i;
      });
    },
    draw(state) {
      const { blocks: list, actors } = sceneOf(state);
      frames++;
      motion.begin(state);
      for (const kind of DRAW_KINDS) used[kind] = 0;
      for (const b of list) {
        motion.place(dummy, b, state);
        const kind: DrawKind = b.kind === 'ladder' && state.tiles[idx(b.x, b.y)] === 'exit' ? 'exit' : b.kind;
        blocks[kind].setMatrixAt(used[kind]++, dummy.matrix);
      }
      for (const kind of DRAW_KINDS) {
        blocks[kind].count = used[kind];
        blocks[kind].instanceMatrix.needsUpdate = true;
      }

      while (guards.length < actors.length - 1) {
        const g = createCharacter('guard', pixels, { joints: true });
        guards.push(g);
        scene.add(g.group);
      }
      const others = actors.slice(1);
      actors.forEach((a, i) => {
        const who = i === 0 ? hero : guards[i - 1];
        who.group.visible = true;
        who.group.position.set(a.x, worldY(a.y), 0.1);
        const progress = progressOf(who, a.pose);
        const joints = jointsFor(a.pose, a.phase, a.facing, progress);
        if (i === 0 && a.pose === 'idle') joints.turn = glanceTurn(a, others);
        const [j, l] = blend(who, a.pose, state.tick, joints, limbsFor(a.pose, a.phase, a.facing, progress));
        who.apply(j, a.carrying, l);
      });
      guards.forEach((g, i) => {
        if (i >= actors.length - 1) g.group.visible = false;
      });
      lamp.target.position.set(actors[0].facing * 4, HEAD_Y - 1.2, 0.3);

      for (const l of lanterns) l.light.intensity = opts.reducedMotion ? l.power : l.power * flicker(l.seed, state.tick);
      if (!opts.reducedMotion) {
        layers.forEach((mesh, i) => {
          mesh.position.x = CX + Math.sin(frames * DRIFT_RATE + i) * DRIFT_CELLS * (1 - i * 0.3);
        });
      }

      stepAmbient(state.tick, actors[0]);
      for (const p of effectPool) if (!isFree(p)) advanceParticle(p);

      shakeLeft = shakeCamera(camera, home, shakeLeft);
      if (usePost) composer.render();
      else gl.render(scene, camera);
      if (slow(performance.now())) stepDown();
    },
    effects(list) {
      if (list.some((e) => e.kind === 'chunks')) digPending = true;
      if (!particlesOn) return;
      for (const e of list) {
        const spec = PARTICLES[e.kind];
        for (let i = 0; i < spec.count; i++) {
          const p = effectPool.find(isFree);
          if (!p) return;
          launchParticle(p, e, i, spawned++);
          p.mesh.material.map = hd(EFFECT_SURFACE[e.kind]).map;
          p.mesh.material.emissiveIntensity = e.kind === 'sparkle' ? 1.5 : 0;
        }
      }
    },
    resize(width, height) {
      if (!width || !height) return;
      gl.setSize(width, height, false);
      composer.setSize(width, height);
      frameCamera(camera, home, width, height);
      // Haze starts at the play plane, so the grid stays clear and the deep layers fade.
      fog.near = home.z;
      fog.far = home.z + L.hazeDepth;
    },
    shake() {
      if (!opts.reducedMotion) shakeLeft = SHAKE_FRAMES;
    },
    stepDown,
    dispose() {
      stopWatchingLoss();
      for (const who of [hero, ...guards]) {
        who.group.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          owned.add(o.geometry);
          for (const m of [o.material].flat()) owned.add(m);
        });
      }
      for (const o of owned) o.dispose();
      owned.clear();
      gl.dispose();
    },
  };
}
