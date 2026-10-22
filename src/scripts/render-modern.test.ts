// Smoke test for the Modern renderer against a small, strict stand-in for three. Every stand-in object
// throws on any member it does not define (read or write), and vitest throws on any missing module export,
// so a misspelt three member fails here instead of passing silently.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const created: object[] = [];
  const PASS_THROUGH = new Set(['then', 'toJSON', 'asymmetricMatch', '$$typeof', 'nodeType', 'constructor']);
  const strict = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, p, r) {
        if (typeof p === 'symbol' || p in t || PASS_THROUGH.has(p)) return Reflect.get(t, p, r);
        throw new Error(`three mock: ${t.constructor.name} has no member "${p}"`);
      },
      set(t, p, v, r) {
        if (typeof p === 'symbol' || p in t) return Reflect.set(t, p, v, r);
        throw new Error(`three mock: ${t.constructor.name} has no member "${p}" to set`);
      },
    });
  /** Instances come back strict and are recorded, so the test can count what was created and disposed. */
  const S = <C extends new (...args: never[]) => object>(c: C): C =>
    new Proxy(c, {
      construct(t, args, nt) {
        const o = Reflect.construct(t, args, nt) as object;
        created.push(o);
        return strict(o);
      },
    });
  const assign = (o: object, params: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(params)) {
      if (!(k in o)) throw new Error(`three mock: ${o.constructor.name} has no parameter "${k}"`);
      (o as Record<string, unknown>)[k] = v;
    }
  };

  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z = 0): this { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(v: number): this { this.x = this.y = this.z = v; return this; }
    copy(v: { x: number; y: number; z: number }): this { return this.set(v.x, v.y, v.z); }
  }
  class Vector2 {
    constructor(public x = 0, public y = 0) {}
    set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  }
  class Color {
    constructor(public hex = 0) {}
    setHex(h: number): this { this.hex = h; return this; }
    multiplyScalar(): this { return this; }
  }
  const V3 = S(Vector3);
  const V2 = S(Vector2);
  const Col = S(Color);

  class Object3D {
    name = '';
    position = new V3();
    rotation = new V3();
    scale = new V3(1, 1, 1);
    children: Object3D[] = [];
    visible = true;
    castShadow = false;
    receiveShadow = false;
    frustumCulled = true;
    matrix = {};
    add(...o: Object3D[]): this { this.children.push(...o); return this; }
    remove(...o: Object3D[]): this { this.children = this.children.filter((c) => !o.includes(c)); return this; }
    traverse(fn: (o: Object3D) => void): void { fn(this); for (const c of this.children) c.traverse(fn); }
    updateMatrix(): void {}
    lookAt(): void {}
  }
  class Group extends Object3D {}
  class Scene extends Object3D { background: unknown = null; fog: unknown = null; }
  class Mesh extends Object3D { constructor(public geometry: unknown, public material: unknown) { super(); } }
  class InstancedMesh extends Mesh {
    count: number;
    instanceMatrix = strict({ needsUpdate: false });
    disposed = 0;
    constructor(geometry: unknown, material: unknown, public max: number) { super(geometry, material); this.count = max; }
    setMatrixAt(i: number): void { if (i >= this.max) throw new Error(`instance ${i} past ${this.max}`); }
    dispose(): void { this.disposed++; }
  }
  class PerspectiveCamera extends Object3D {
    constructor(public fov = 50, public aspect = 1, public near = 0.1, public far = 2000) { super(); }
    updateProjectionMatrix(): void {}
  }
  class LightShadow {
    mapSize = new V2();
    camera = strict({ left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 });
    bias = 0;
    normalBias = 0;
    radius = 1;
  }
  const Shadow = S(LightShadow);
  class Light extends Object3D {
    color: Color;
    disposed = 0;
    constructor(color = 0xffffff, public intensity = 1) { super(); this.color = new Col(color); }
    dispose(): void { this.disposed++; }
  }
  class AmbientLight extends Light {}
  class HemisphereLight extends Light { constructor(sky = 0, ground = 0, intensity = 1) { super(sky, intensity); void ground; } }
  class DirectionalLight extends Light { target = new (S(Object3D))(); shadow = new Shadow(); }
  class SpotLight extends Light {
    target = new (S(Object3D))();
    shadow = new Shadow();
    constructor(color = 0xffffff, intensity = 1, public distance = 0, public angle = 1, public penumbra = 0, public decay = 2) { super(color, intensity); }
  }
  class PointLight extends Light {
    constructor(color = 0xffffff, intensity = 1, public distance = 0, public decay = 2) { super(color, intensity); }
  }
  class Geometry {
    disposed = 0;
    constructor(...args: unknown[]) { void args; }
    dispose(): void { this.disposed++; }
    rotateX(): this { return this; }
    rotateZ(): this { return this; }
    translate(): this { return this; }
  }
  class BoxGeometry extends Geometry {}
  class PlaneGeometry extends Geometry {}
  class ConeGeometry extends Geometry {}
  class CylinderGeometry extends Geometry {}
  class OctahedronGeometry extends Geometry {}
  class IcosahedronGeometry extends Geometry {}
  class RoundedBoxGeometry extends Geometry {}
  class Material {
    map: unknown = null;
    color = new Col();
    opacity = 1;
    transparent = false;
    alphaTest = 0;
    depthWrite = true;
    needsUpdate = false;
    disposed = 0;
    dispose(): void { this.disposed++; }
  }
  class MeshBasicMaterial extends Material { constructor(p: Record<string, unknown> = {}) { super(); assign(this, p); } }
  class MeshLambertMaterial extends Material {
    emissive = new Col(); emissiveMap: unknown = null; emissiveIntensity = 1;
    constructor(p: Record<string, unknown> = {}) { super(); assign(this, p); }
  }
  class MeshStandardMaterial extends Material {
    emissive = new Col(); emissiveMap: unknown = null; emissiveIntensity = 1;
    roughness = 1; metalness = 0; bumpMap: unknown = null; bumpScale = 1;
    constructor(p: Record<string, unknown> = {}) { super(); assign(this, p); }
  }
  class DataTexture {
    magFilter = 0; minFilter = 0; colorSpace = ''; needsUpdate = false; wrapS = 0; wrapT = 0;
    repeat = new V2(); offset = new V2(); disposed = 0;
    constructor(public data: Uint8Array, public width: number, public height: number, public format: number) {}
    dispose(): void { this.disposed++; }
  }
  class WebGLRenderer {
    shadowMap = strict({ enabled: false, type: 0 });
    toneMapping = 0;
    toneMappingExposure = 1;
    renders = 0;
    disposed = 0;
    constructor(public params: Record<string, unknown>) {}
    setPixelRatio(): void {}
    getPixelRatio(): number { return 1; }
    setSize(): void {}
    render(): void { this.renders++; }
    dispose(): void { this.disposed++; }
  }
  class Fog { constructor(public color: number, public near: number, public far: number) {} }

  class Pass { enabled = true; disposed = 0; dispose(): void { this.disposed++; } setSize(): void {} }
  class RenderPass extends Pass { constructor(...args: unknown[]) { super(); void args; } }
  class GTAOPass extends Pass { blendIntensity = 1; constructor(...args: unknown[]) { super(); void args; } }
  class UnrealBloomPass extends Pass {
    constructor(public resolution: unknown, public strength = 1, public radius = 0, public threshold = 0) { super(); }
  }
  class OutputPass extends Pass {}
  class EffectComposer {
    passes: Pass[] = [];
    renders = 0;
    disposed = 0;
    constructor(public renderer: unknown) {}
    addPass(p: Pass): void { this.passes.push(p); }
    render(): void { this.renders++; }
    setSize(): void {}
    setPixelRatio(): void {}
    dispose(): void { this.disposed++; }
  }

  const three = {
    WebGLRenderer: S(WebGLRenderer), Scene: S(Scene), Color: Col, Vector2: V2, Vector3: V3, Fog: S(Fog),
    PerspectiveCamera: S(PerspectiveCamera), Object3D: S(Object3D), Group: S(Group), Mesh: S(Mesh), InstancedMesh: S(InstancedMesh),
    AmbientLight: S(AmbientLight), HemisphereLight: S(HemisphereLight), DirectionalLight: S(DirectionalLight), SpotLight: S(SpotLight), PointLight: S(PointLight),
    BoxGeometry: S(BoxGeometry), PlaneGeometry: S(PlaneGeometry), ConeGeometry: S(ConeGeometry), CylinderGeometry: S(CylinderGeometry),
    OctahedronGeometry: S(OctahedronGeometry), IcosahedronGeometry: S(IcosahedronGeometry),
    MeshBasicMaterial: S(MeshBasicMaterial), MeshLambertMaterial: S(MeshLambertMaterial), MeshStandardMaterial: S(MeshStandardMaterial),
    DataTexture: S(DataTexture),
    MathUtils: strict({ degToRad: (d: number): number => (d * Math.PI) / 180 }),
    RGBAFormat: 1023, RedFormat: 1028, NearestFilter: 1003, LinearFilter: 1006, RepeatWrapping: 1000,
    SRGBColorSpace: 'srgb', ACESFilmicToneMapping: 4, PCFShadowMap: 1,
  };
  const addons = {
    RoundedBoxGeometry: S(RoundedBoxGeometry), EffectComposer: S(EffectComposer), RenderPass: S(RenderPass),
    GTAOPass: S(GTAOPass), UnrealBloomPass: S(UnrealBloomPass), OutputPass: S(OutputPass),
  };
  return { three, addons, created };
});

vi.mock('three', () => fake.three);
vi.mock('three/examples/jsm/geometries/RoundedBoxGeometry.js', () => ({ RoundedBoxGeometry: fake.addons.RoundedBoxGeometry }));
vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({ EffectComposer: fake.addons.EffectComposer }));
vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({ RenderPass: fake.addons.RenderPass }));
vi.mock('three/examples/jsm/postprocessing/GTAOPass.js', () => ({ GTAOPass: fake.addons.GTAOPass }));
vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({ UnrealBloomPass: fake.addons.UnrealBloomPass }));
vi.mock('three/examples/jsm/postprocessing/OutputPass.js', () => ({ OutputPass: fake.addons.OutputPass }));

import * as THREE from 'three';
import { LIGHT_Z, decorOf, type Decor, type PropKind } from '../lib/decor';
import { parseLevel } from '../lib/level';
import type { Effect } from '../lib/scene';
import { initState, type GameState } from '../lib/state';
import { MODERN_LIGHTING, createModernRenderer } from './render-modern';

const { three, created } = fake;
type Made<K extends keyof typeof three> = (typeof three)[K] extends new (...args: never[]) => infer I ? I : never;
const all = <K extends keyof typeof three>(k: K): Made<K>[] =>
  created.filter((o) => o instanceof (three[k] as unknown as new () => object)) as Made<K>[];
const one = <K extends keyof typeof three>(k: K): Made<K> => {
  const list = all(k);
  expect(list).toHaveLength(1);
  return list[0];
};
const composer = (): InstanceType<typeof fake.addons.EffectComposer> => {
  const list = created.filter((o) => o instanceof fake.addons.EffectComposer) as InstanceType<typeof fake.addons.EffectComposer>[];
  expect(list).toHaveLength(1);
  return list[0];
};
const named = (prefix: string): Made<'InstancedMesh'>[] => all('InstancedMesh').filter((m) => m.name.startsWith(prefix));
const visibleParticles = (): number => all('Mesh').filter((m) => m.name.startsWith('particle:') && m.visible).length;
const lanterns = (): Made<'PointLight'>[] => all('PointLight').filter((l) => l.name === 'lantern' && l.disposed === 0);

const row = (s: string): string => s.padEnd(28, '.');
const LEVEL = parseLevel([
  ...Array.from({ length: 10 }, () => row('')),
  row('....H'),
  row('....H.......------'),
  row('....H'),
  row('..&.H..$....0.....S...$'),
  row('####H#####X####@@@@@@@').replace(/\./g, '#'),
  '@'.repeat(28),
].join('\n'));

const KINDS: PropKind[] = ['lantern', 'timber', 'stalactite', 'crystal', 'rail', 'cart', 'moss', 'pebble'];
const EVERY_KIND: Decor = {
  props: KINDS.map((kind, i) => ({ kind, x: 2 + i * 3, y: 12, z: kind === 'moss' || kind === 'pebble' ? 0 : -0.5, scale: kind === 'rail' ? 4 : 1, rot: 0, variant: i % 3 })),
  lights: [
    { x: 3, y: 12, z: LIGHT_Z, color: 0xffb347, intensity: 1, flickerSeed: 7 },
    { x: 20, y: 12, z: LIGHT_Z, color: 0xff9d3c, intensity: 1.2, flickerSeed: 99 },
  ],
  layers: [{ depth: -3, tint: 0x3a4252, seed: 1 }, { depth: -12, tint: 0x1f2430, seed: 2 }],
};
const EFFECTS: Effect[] = [{ kind: 'chunks', x: 5, y: 13 }, { kind: 'puff', x: 6, y: 13 }, { kind: 'sparkle', x: 7, y: 13 }];

function makeCanvas(context: object | null): { canvas: HTMLCanvasElement; listeners: { added: number; removed: number } } {
  const listeners = { added: 0, removed: 0 };
  const canvas = {
    getContext: (kind: string): object | null => (kind === 'webgl2' ? context : null),
    addEventListener: (): void => void listeners.added++,
    removeEventListener: (): void => void listeners.removed++,
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, listeners };
}
const make = (reducedMotion = false) => {
  const { canvas, listeners } = makeCanvas({});
  const r = createModernRenderer(canvas, { background: 0x101010, reducedMotion, onLost: () => {} });
  r.resize(1440, 810);
  return { r, listeners };
};
const at = (s: GameState, tick: number): GameState => ({ ...s, tick });
/** Draw ticks from..to, feeding a dig every 25 ticks. */
const run = (r: ReturnType<typeof make>['r'], s: GameState, from: number, to: number): void => {
  for (let t = from; t <= to; t++) {
    if (t % 25 === 0) r.effects(EFFECTS);
    r.draw(at(s, t));
  }
};

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the three stand-in', () => {
  it('throws on members it does not provide, so a typo cannot pass', () => {
    expect(() => (THREE as unknown as Record<string, unknown>).NotAMember).toThrow();
    const g = new three.Group() as unknown as Record<string, unknown>;
    expect(() => g.notAMember).toThrow();
    expect(() => { g.notAMember = 1; }).toThrow();
    expect(() => new three.MeshLambertMaterial({ roughness: 1 })).toThrow();
  });
});

describe('MODERN_LIGHTING', () => {
  it('keeps the cave dark: the ambient and hemisphere fill sit below the key light', () => {
    expect(MODERN_LIGHTING.ambient.intensity).toBeLessThan(MODERN_LIGHTING.key.intensity);
    expect(MODERN_LIGHTING.hemisphere.intensity).toBeLessThan(MODERN_LIGHTING.key.intensity);
  });
  it('is what the renderer lights the scene with', () => {
    make();
    expect(one('AmbientLight').intensity).toBe(MODERN_LIGHTING.ambient.intensity);
    expect(one('HemisphereLight').intensity).toBe(MODERN_LIGHTING.hemisphere.intensity);
    expect(one('DirectionalLight').intensity).toBe(MODERN_LIGHTING.key.intensity);
    expect(one('SpotLight').intensity).toBe(MODERN_LIGHTING.headlamp.intensity);
  });
});

describe('createModernRenderer', () => {
  it('throws when WebGL 2 is unavailable, before creating anything', () => {
    const { canvas } = makeCanvas(null);
    expect(() => createModernRenderer(canvas, { background: 0, reducedMotion: false, onLost: () => {} })).toThrow(/WebGL 2/);
    expect(all('WebGLRenderer')).toHaveLength(0);
  });

  it('setLevel adds one point light per decor light and instances every prop kind present', () => {
    const { r } = make();
    const decor = decorOf(LEVEL, 'level-seed');
    r.setLevel?.(decor, 'level-seed');
    expect(decor.lights.length).toBeGreaterThan(0);
    expect(lanterns()).toHaveLength(decor.lights.length);

    r.setLevel?.(EVERY_KIND, 'other');
    expect(lanterns()).toHaveLength(EVERY_KIND.lights.length);
    for (const kind of KINDS) {
      const meshes = named(`prop:${kind}`);
      expect(meshes.length, kind).toBeGreaterThan(0);
      for (const m of meshes) expect(m.count, kind).toBe(1);
    }
    expect(all('Mesh').filter((m) => m.name === 'layer' && m.visible)).toHaveLength(EVERY_KIND.layers.length);
  });

  it('draws gold, ladders, a guard and effects through the composer', () => {
    const { r } = make();
    r.setLevel?.(EVERY_KIND, 'seed');
    const s = { ...initState(LEVEL), exitOpen: true };
    r.effects(EFFECTS);
    expect(() => r.draw(s)).not.toThrow();
    expect(composer().renders).toBe(1);
    expect(named('block:gold')[0].count).toBe(2);
    expect(named('block:ladder')[0].count).toBe(5);
    expect(named('block:exit')[0].count).toBe(1);
    expect(visibleParticles()).toBeGreaterThan(0);
  });

  it('steps down post, then shadows, then particles, then nothing', () => {
    const { r } = make();
    r.setLevel?.(EVERY_KIND, 'seed');
    const s = initState(LEVEL);
    const gl = one('WebGLRenderer');
    run(r, s, 1, 200);
    const composed = composer().renders;
    expect(composed).toBe(200);
    expect(gl.renders).toBe(0);

    expect(r.stepDown()).toBe('post');
    r.draw(at(s, 201));
    expect(composer().renders).toBe(composed);
    expect(gl.renders).toBe(1);

    expect(gl.shadowMap.enabled).toBe(true);
    expect(r.stepDown()).toBe('shadows');
    expect(gl.shadowMap.enabled).toBe(false);
    for (const l of [...all('DirectionalLight'), ...all('SpotLight')]) expect(l.castShadow).toBe(false);

    expect(visibleParticles()).toBeGreaterThan(0);
    expect(r.stepDown()).toBe('particles');
    expect(visibleParticles()).toBe(0);
    run(r, s, 202, 300);
    expect(visibleParticles()).toBe(0);

    expect(r.stepDown()).toBeNull();
  });

  it('steps down by itself when frames stay slow', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 40));
    const { r } = make();
    const s = initState(LEVEL);
    for (let t = 1; t <= 100; t++) r.draw(at(s, t));
    const gl = one('WebGLRenderer');
    expect(gl.renders).toBeGreaterThan(0);
    expect(gl.shadowMap.enabled).toBe(true);
  });

  it('dispose frees everything it created and removes its listeners', () => {
    const { r, listeners } = make();
    r.setLevel?.(decorOf(LEVEL, 'a'), 'a');
    r.setLevel?.(EVERY_KIND, 'b');
    run(r, initState(LEVEL), 1, 30);
    r.dispose();
    const disposable = created.filter((o): o is { disposed: number } => 'dispose' in o);
    expect(disposable.length).toBeGreaterThan(20);
    const left = disposable.filter((o) => o.disposed === 0).map((o) => o.constructor.name);
    expect(left).toEqual([]);
    expect(listeners.added).toBeGreaterThan(0);
    expect(listeners.removed).toBe(listeners.added);
  });

  it('flickers lanterns and spawns ambient particles, except under reduced motion', () => {
    const intensities = (reduced: boolean): { a: number[]; b: number[]; particles: number } => {
      created.length = 0;
      const { r } = make(reduced);
      r.setLevel?.(EVERY_KIND, 'seed');
      const s = initState(LEVEL);
      run(r, s, 1, 5);
      const a = lanterns().map((l) => l.intensity);
      run(r, s, 6, 300);
      return { a, b: lanterns().map((l) => l.intensity), particles: visibleParticles() };
    };
    const moving = intensities(false);
    expect(moving.a).not.toEqual(moving.b);
    expect(moving.particles).toBeGreaterThan(0);
    const still = intensities(true);
    expect(still.a).toEqual(still.b);
    expect(still.particles).toBe(0);
  });
});
