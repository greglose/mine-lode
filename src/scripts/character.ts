// A person built from boxes. Poses are decided in lib/pose.ts; this only moves the parts.
import * as THREE from 'three';
import type { Joints, LimbJoints } from '../lib/pose';
import type { TextureKind } from '../lib/textures';

export type TextureSource = (kind: TextureKind) => THREE.Texture;
export interface Character { group: THREE.Group; apply(joints: Joints, carrying: boolean, limbs?: LimbJoints): void }
/** `joints`: lower arms and legs hang from elbow and knee pivots (Modern). Without it the limbs are single boxes (Classic). */
export interface CharacterOptions { joints?: boolean }

const FEET_Y = -0.5;
const LEG = 0.32;
const TORSO = 0.34;
const HEAD = 0.26;
const SHOULDER_Y = LEG + TORSO - 0.04;
const ARM = 0.3;
const HAND_Y = -ARM + 0.02;

interface Look { body: TextureKind; legs: TextureKind; arms: TextureKind; face: TextureKind; hat: TextureKind }
const LOOKS: Record<'miner' | 'guard', Look> = {
  miner: { body: 'overalls', legs: 'overalls', arms: 'skin', face: 'face', hat: 'hardhat' },
  guard: { body: 'uniform', legs: 'cap', arms: 'uniform', face: 'guardface', hat: 'cap' },
};

export function createCharacter(kind: 'miner' | 'guard', textures: TextureSource, options: CharacterOptions = {}): Character {
  const look = LOOKS[kind];
  const materials = new Map<TextureKind, THREE.MeshLambertMaterial>();
  const material = (k: TextureKind): THREE.MeshLambertMaterial => {
    let m = materials.get(k);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ map: textures(k) });
      materials.set(k, m);
    }
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };
  /** A limb from its shoulder or hip pivot. `lower` is the elbow or knee pivot when jointed; `hand` holds what the limb carries. */
  const limb = (x: number, y: number, w: number, len: number, mat: THREE.Material): { pivot: THREE.Group; lower: THREE.Group | null; hand: THREE.Group } => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    if (!options.joints) {
      pivot.add(box(w, len, w + 0.02, mat, 0, -len / 2));
      return { pivot, lower: null, hand: pivot };
    }
    const half = len / 2;
    pivot.add(box(w, half, w + 0.02, mat, 0, -half / 2));
    const lower = new THREE.Group();
    lower.position.y = -half;
    lower.add(box(w * 0.9, half, w * 0.9 + 0.02, mat, 0, -half / 2));
    pivot.add(lower);
    return { pivot, lower, hand: lower };
  };

  const group = new THREE.Group();
  const lean = new THREE.Group();
  lean.position.y = FEET_Y;
  const mirror = new THREE.Group();
  const body = new THREE.Group();
  group.add(lean);
  lean.add(mirror);
  mirror.add(body);

  const legL = limb(0.09, LEG, 0.15, LEG, material(look.legs));
  const legR = limb(-0.09, LEG, 0.15, LEG, material(look.legs));
  const armL = limb(0.23, SHOULDER_Y, 0.11, ARM, material(look.arms));
  const armR = limb(-0.23, SHOULDER_Y, 0.11, ARM, material(look.arms));
  const torso = box(0.34, TORSO, 0.2, material(look.body), 0, LEG + TORSO / 2);

  const skin = material('skin');
  const face = material(look.face);
  const headY = LEG + TORSO + HEAD / 2;
  const head = box(HEAD, HEAD, HEAD, [skin, skin, skin, skin, face, skin], 0, headY);
  const hat = material(look.hat);
  const hatTop = box(HEAD + 0.04, 0.08, HEAD + 0.04, hat, 0, headY + HEAD / 2 + 0.02);
  const brim = box(HEAD + 0.04, 0.025, 0.1, hat, 0, headY + HEAD / 2 - 0.02, HEAD / 2 + 0.05);
  body.add(legL.pivot, legR.pivot, armL.pivot, armR.pivot, torso, head, hatTop, brim);

  if (kind === 'miner') {
    body.add(box(0.07, 0.06, 0.05, material('pickhead'), 0, headY + HEAD / 2 + 0.03, HEAD / 2 + 0.04));
    // Pickaxe in the tool hand (armR): handle held forward, head across the far end.
    const handY = armR.lower ? HAND_Y + ARM / 2 : HAND_Y;
    armR.hand.add(box(0.04, 0.04, 0.36, material('handle'), 0, handY, 0.1));
    armR.hand.add(box(0.05, 0.2, 0.05, material('pickhead'), 0, handY, 0.28));
  }

  const nugget = box(0.16, 0.16, 0.16, material('gold'), 0, headY + HEAD / 2 + 0.2);
  nugget.visible = false;
  body.add(nugget);

  return {
    group,
    apply(joints, carrying, limbs) {
      mirror.scale.x = joints.turn < 0 ? -1 : 1;
      body.rotation.y = Math.abs(joints.turn);
      lean.rotation.z = joints.lean;
      lean.position.y = FEET_Y + joints.bob;
      armL.pivot.rotation.x = -joints.armL;
      armR.pivot.rotation.x = -joints.armR;
      legL.pivot.rotation.x = -joints.legL;
      legR.pivot.rotation.x = -joints.legR;
      if (limbs) {
        // Elbows bend the forearm forward, knees bend the shin back.
        if (armL.lower) armL.lower.rotation.x = -limbs.elbowL;
        if (armR.lower) armR.lower.rotation.x = -limbs.elbowR;
        if (legL.lower) legL.lower.rotation.x = limbs.kneeL;
        if (legR.lower) legR.lower.rotation.x = limbs.kneeR;
      }
      nugget.visible = carrying;
    },
  };
}
