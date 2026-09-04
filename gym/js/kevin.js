// KEVIN himself, modelled.
//
// The crew are extruded from their 32x32 tokens; Kevin is not. He predates the
// collection, he is the face on the poster, and a 32-pixel version of him loses
// the two things that make him recognisable — the curve of the skull and the
// dreadlocks coming off it.
//
// Built from primitives on purpose. There is no rig, no skin weights and no
// morph targets here, which is the same reason the voxel bodies work: muscle is
// group.scale, and glTF's rule that every morph target must share vertex count
// AND ordering with its base mesh never gets a chance to bite.
//
// The costume is doing more work than the geometry. In the poster Kevin is not
// red all over — the arms and legs are tan muscle and the RED is the kit. Get
// that split wrong and a perfectly good model reads as a generic mascot.
import * as THREE from 'three';

const RED = '#E02128';
const RED_DK = '#B0141B';
const CREAM = '#F2E4C4';
const TAN = '#E8C9A0';
const TAN_DK = '#CBA87C';
const BELT = '#1A1A1E';
const WHITE = '#FFFFFF';
const INK = '#0B0B0B';

/** The wordmark, painted once. Transparent, or its card floats over the vest. */
function wordmark() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 96);
  x.fillStyle = WHITE;
  x.font = '700 62px "Arial Black", Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('KEVIN', 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {(color: string) => THREE.Material} toon  the game's toon material factory,
 *   passed in rather than rebuilt so Kevin shares the room's gradient ramp.
 *
 * Returns the same shape buildCrewBody does — group, rig, torso, head, arms,
 * legs, torsoH — because main.js drives all four bodies through one code path.
 * No `unit` field: that is what tells applyMuscle this is a built body rather
 * than a voxel one.
 */
export function buildKitKevin({ toon }) {
  const outline = { thickness: 0.009, color: [0, 0, 0], alpha: 1 };
  const mat = (c) => {
    const m = toon(c);
    m.userData.outlineParameters = outline;
    return m;
  };
  const red = mat(RED);
  const dark = mat(RED_DK);
  const tan = mat(TAN);
  const tanDk = mat(TAN_DK);
  const cream = mat(CREAM);
  const ink = mat(INK);
  const white = mat(WHITE);
  const belt = mat(BELT);

  // These have to match buildCrewBody's skeleton, not merely look right on their
  // own. Every station mount, seat height and camera offset in the game was
  // tuned against the voxel body — a hip 18cm lower sits Kevin inside the bench
  // rather than on it. Voxel at unit 0.027 gives legH 0.635 and torsoH 0.518.
  const legH = 0.635;
  const torsoH = 0.52;
  const headR = 0.335;
  const shoulderY = legH + torsoH * 0.88;

  const group = new THREE.Group();
  // Inner rig, so a pose tilts him in his own frame while the outer group keeps
  // owning world position and facing. Rotating one group for both fights itself.
  const rig = new THREE.Group();
  group.add(rig);

  // --- the part that grows ---------------------------------------------------
  // Everything muscle should swell lives here and nothing else does. The belt,
  // the shorts and the head sit outside it: a waist that grows with the chest
  // is a barrel, and the V is the whole silhouette.
  const torso = new THREE.Group();
  torso.position.y = legH + torsoH * 0.5;
  rig.add(torso);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.215, torsoH, 18), tan);
  trunk.scale.z = 0.80;
  torso.add(trunk);
  // Kept inside the vest. Any bigger and it breaks the neckline and reads as a
  // torn shirt rather than a chest under one.
  const pecs = new THREE.Mesh(new THREE.SphereGeometry(0.262, 18, 14), tan);
  pecs.position.set(0, torsoH * 0.32, 0.018);
  pecs.scale.set(1, 0.56, 0.70);
  torso.add(pecs);

  // Closed cylinder, not an open tube: an open one shows its own inside wall
  // over the shoulders and reads as a tear.
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.278, 0.232, torsoH * 0.72, 18), red);
  vest.position.y = torsoH * 0.02;
  vest.scale.z = 0.86;
  torso.add(vest);
  for (const sx of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.16, 4, 10), red);
    strap.position.set(sx * 0.148, torsoH * 0.38, 0.022);
    strap.rotation.z = sx * 0.22;
    torso.add(strap);
  }
  const word = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.118),
    new THREE.MeshBasicMaterial({ map: wordmark(), transparent: true })
  );
  word.material.userData = { outlineParameters: { visible: false } };
  word.position.set(0, torsoH * -0.04, 0.246);
  torso.add(word);

  // --- the part that does not -------------------------------------------------
  const beltMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.232, 0.228, 0.066, 18), belt);
  beltMesh.position.y = legH + torsoH * 0.05;
  beltMesh.scale.z = 0.88;
  rig.add(beltMesh);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.058, 0.032), mat('#C9C4B4'));
  buckle.position.set(0, legH + torsoH * 0.05, 0.205);
  rig.add(buckle);
  const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.234, 0.256, 0.22, 18), red);
  shorts.position.y = legH - 0.07;
  shorts.scale.z = 0.88;
  rig.add(shorts);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.114, 0.11, 14), tan);
  neck.position.y = legH + torsoH * 0.98;
  rig.add(neck);

  // --- head -------------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = legH + torsoH + headR * 0.52;
  rig.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, 22, 18), red);
  skull.scale.set(1.06, 1.0, 0.98);
  head.add(skull);

  // Dreadlocks: out to the side as much as back. Tucked in behind the skull
  // they vanish at the angle the game is actually played from. Yaw then pitch,
  // in that order, or the second rotation happens in a frame the first moved.
  for (const sx of [-1, 1]) {
    const locks = [[0.08, 0.48, 1.05, 0.30], [-0.11, 0.40, 0.80, 0.55]];
    for (let i = 0; i < locks.length; i++) {
      const [ay, len, splay, droop] = locks[i];
      const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.068 - i * 0.009, len, 4, 12), dark);
      d.rotation.order = 'YXZ';
      d.position.set(sx * headR * 0.84, ay, -headR * 0.22);
      d.rotation.y = sx * splay;
      d.rotation.x = -Math.PI / 2 + droop;
      head.add(d);
    }
  }

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.168, 18, 14), cream);
  muzzle.position.set(0, -0.128, headR * 0.86);
  muzzle.scale.set(1.20, 0.74, 0.84);
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.056, 3), ink);
  nose.position.set(0, -0.022, headR * 0.86 + 0.128);
  nose.rotation.x = Math.PI;
  head.add(nose);

  // The eyes carry the likeness. Sat proud of the skull — sunk in, only the top
  // of each one clears the brow and he stops being recognisable.
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.150, 18, 14), white);
    eye.position.set(sx * 0.104, 0.082, headR * 0.86);
    eye.scale.set(0.66, 1.10, 0.52);
    eye.rotation.z = sx * 0.20;
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 10), ink);
    pupil.position.set(sx * 0.100, 0.040, headR * 0.86 + 0.064);
    pupil.scale.set(0.60, 1.30, 0.28);
    pupil.material.userData = { outlineParameters: { visible: false } };
    head.add(pupil);
  }

  // --- limbs -------------------------------------------------------------------
  // Groups pivoted at the shoulder and hip with everything hanging below, so the
  // walk cycle and the poses can rotate them like joints. Meshes at absolute
  // positions would spin about their own middles instead.
  const arms = [];
  const legs = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.285, shoulderY, 0);
    const delt = new THREE.Mesh(new THREE.SphereGeometry(0.142, 16, 12), tan);
    arm.add(delt);
    const bicep = new THREE.Mesh(new THREE.CapsuleGeometry(0.094, 0.16, 4, 12), tan);
    bicep.position.y = -0.165;
    arm.add(bicep);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.077, 0.15, 4, 12), tan);
    fore.position.y = -0.362;
    arm.add(fore);
    // Wristband: the small red note that ties the hand back to the kit.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.056, 14), red);
    band.position.y = -0.446;
    arm.add(band);
    // The fist lands on -torsoH * 0.95, which is where a dumbbell gets hung.
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.104, 16, 12), tan);
    fist.position.y = -0.500;
    arm.add(fist);
    rig.add(arm);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(sx * 0.118, legH, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.106, 0.20, 4, 12), tan);
    thigh.position.y = -0.180;
    leg.add(thigh);
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.084, 0.18, 4, 12), tanDk);
    calf.position.y = -0.420;
    leg.add(calf);
    // Red high-tops on a white sole, straight off the poster. The sole bottom
    // sits on -legH, so he stands on the floor instead of above or through it.
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.166, 0.096, 0.252), red);
    shoe.position.set(0, -0.552, 0.044);
    leg.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.180, 0.056, 0.266), mat('#F4F1E6'));
    sole.position.set(0, -0.606, 0.044);
    leg.add(sole);
    rig.add(leg);
    legs.push(leg);
  }

  // torsoH is what main.js measures a dumbbell's drop by (-torsoH * 0.95 lands
  // in the hand), so it has to describe the arm, not the chest.
  return { group, rig, torso, head, arms, legs, torsoH };
}
