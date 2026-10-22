// Three.js view of a game state. A thin shell over sceneOf(): no game decisions here.
import * as THREE from 'three';
import { SLOW_FRAME_MS } from '../lib/graphics';
import { COLS, ROWS } from '../lib/level';
import { jointsFor } from '../lib/pose';
import { sceneOf, type BlockKind, type Effect } from '../lib/scene';
import type { GameState } from '../lib/state';
import { TEXTURE_SIZE, makeTexture, type TextureKind } from '../lib/textures';
import { createCharacter, type Character } from './character';
import {
  CX, CY, FOV, PARTICLES, PARTICLE_POOL, SHAKE_FRAMES, advanceParticle, cameraHome, createBlockMotion, createFrameWatch,
  createOneShotClock, frameCamera, isFree, launchParticle, pixelTexture, shakeCamera, watchContextLoss, worldY,
  type EffectParticle, type Renderer, type RendererOptions,
} from './render-shared';

/** Classic has one cheap step (shadows), so it takes it sooner than Modern's step-down. */
const SHADOWS_OFF_AFTER_MS = 2000;
type Particle = EffectParticle<THREE.MeshLambertMaterial>;
const BLOCK_KINDS: BlockKind[] = ['dirt', 'stone', 'ladder', 'rope', 'gold'];

const textureCache = new Map<TextureKind, THREE.DataTexture>();
function texture(kind: TextureKind): THREE.DataTexture {
  const cached = textureCache.get(kind);
  if (cached) return cached;
  const t = pixelTexture(makeTexture(kind), TEXTURE_SIZE);
  textureCache.set(kind, t);
  return t;
}

export function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions): Renderer {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  gl.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background);
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  const home = cameraHome();

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(CX - 10, CY + 16, 14);
  sun.target.position.set(CX, CY, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12, near: 1, far: 60 });
  scene.add(sun, sun.target);

  const wallTexture = texture('wall');
  wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
  wallTexture.repeat.set(COLS + 6, ROWS + 6);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(COLS + 6, ROWS + 6), new THREE.MeshLambertMaterial({ map: wallTexture }));
  wall.position.set(CX, CY, -0.5);
  wall.receiveShadow = true;
  scene.add(wall);

  const goldMaterial = new THREE.MeshLambertMaterial({ map: texture('gold') });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const parts: Record<BlockKind, [THREE.BufferGeometry, THREE.Material]> = {
    dirt: [cube, new THREE.MeshLambertMaterial({ map: texture('dirt') })],
    stone: [cube, new THREE.MeshLambertMaterial({ map: texture('stone') })],
    ladder: [new THREE.BoxGeometry(0.8, 1, 0.12), new THREE.MeshLambertMaterial({ map: texture('ladder'), alphaTest: 0.5 })],
    rope: [new THREE.BoxGeometry(1, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0xc8a15a })],
    gold: [new THREE.BoxGeometry(0.45, 0.45, 0.45), goldMaterial],
  };
  const meshes = {} as Record<BlockKind, THREE.InstancedMesh>;
  for (const kind of BLOCK_KINDS) {
    const mesh = new THREE.InstancedMesh(parts[kind][0], parts[kind][1], COLS * ROWS * 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    meshes[kind] = mesh;
    scene.add(mesh);
  }

  const hero = createCharacter('miner', texture);
  scene.add(hero.group);
  const guards: Character[] = [];
  const progressOf = createOneShotClock();

  const pool: Particle[] = [];
  const particleGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < PARTICLE_POOL; i++) {
    const mesh = new THREE.Mesh(particleGeometry, new THREE.MeshLambertMaterial({ map: texture('dirt'), transparent: true }));
    mesh.visible = false;
    mesh.castShadow = false;
    scene.add(mesh);
    pool.push({ mesh, kind: 'chunks', age: PARTICLES.chunks.life, vx: 0, vy: 0, vz: 0, spin: 0 });
  }
  let spawned = 0;
  const motion = createBlockMotion(opts.reducedMotion);
  const dummy = new THREE.Object3D();
  let shakeLeft = 0;
  const stopWatchingLoss = watchContextLoss(canvas, opts.onLost);
  const slow = createFrameWatch(SLOW_FRAME_MS, SHADOWS_OFF_AFTER_MS);

  /** Turn shadows off for the session if frames stay slow. */
  const watchFrameTime = (): void => {
    if (slow(performance.now()) && gl.shadowMap.enabled) {
      gl.shadowMap.enabled = false;
      sun.castShadow = false;
    }
  };

  return {
    draw(state) {
      const { blocks, actors } = sceneOf(state);
      motion.begin(state);
      const used: Record<BlockKind, number> = { dirt: 0, stone: 0, ladder: 0, rope: 0, gold: 0 };
      for (const b of blocks) {
        motion.place(dummy, b, state);
        meshes[b.kind].setMatrixAt(used[b.kind]++, dummy.matrix);
      }
      for (const kind of BLOCK_KINDS) {
        meshes[kind].count = used[kind];
        meshes[kind].instanceMatrix.needsUpdate = true;
      }

      while (guards.length < actors.length - 1) {
        const g = createCharacter('guard', texture);
        guards.push(g);
        scene.add(g.group);
      }
      actors.forEach((a, i) => {
        const who = i === 0 ? hero : guards[i - 1];
        who.group.visible = true;
        who.group.position.set(a.x, worldY(a.y), 0.1);
        who.apply(jointsFor(a.pose, a.phase, a.facing, progressOf(who, a.pose)), a.carrying);
      });
      guards.forEach((g, i) => {
        if (i >= actors.length - 1) g.group.visible = false;
      });

      for (const p of pool) if (!isFree(p)) advanceParticle(p);

      shakeLeft = shakeCamera(camera, home, shakeLeft);
      gl.render(scene, camera);
      watchFrameTime();
    },
    effects(list) {
      if (opts.reducedMotion) return;
      for (const e of list) {
        const spec = PARTICLES[e.kind];
        for (let i = 0; i < spec.count; i++) {
          const p = pool.find(isFree);
          if (!p) return;
          launchParticle(p, e, i, spawned++);
          p.mesh.material.map = texture(spec.texture);
        }
      }
    },
    resize(width, height) {
      if (!width || !height) return;
      gl.setSize(width, height, false);
      frameCamera(camera, home, width, height);
    },
    shake() {
      if (!opts.reducedMotion) shakeLeft = SHAKE_FRAMES;
    },
    dispose() {
      stopWatchingLoss();
      gl.dispose();
    },
  };
}
