// Kevin's Crib. Where you start, and where the card room is.
//
// The street already had two venues — the gym you walk into and the fry house
// you work at — and no reason to be on it. The crib gives the map a home end:
// you wake up here, the cards are here, and the other two worlds are a walk or
// a tap away.
//
// Built the same way as city.js: boxes and painted quads, no downloaded models.
// It is furniture seen from a few metres by a chase camera, and a modelled sofa
// would cost megabytes to look the same at this distance.
import * as THREE from 'three';
import { signTexture } from './gear.js';

/**
 * Where the crib sits, and the pieces of it other files need.
 *
 * The left end of the forecourt, mirroring the fry house at the right. It has
 * to clear the market — the crew stall's awning reaches x -12.1 — so the
 * building starts at -13.2 and runs left from there.
 *
 * Exported because main.js needs the same numbers for the spawn point, the
 * walk-up prompts and the fast-travel targets. Three copies of a coordinate is
 * three chances to drift.
 */
export const CRIB = {
  x: -18.0, z: 16.8, w: 9.6, d: 6.8, h: 3.0,
  get front() { return this.z - this.d / 2; },       // z of the front wall
  door: { x0: -19.4, x1: -16.6 },                    // the gap you walk through
  table: { x: -19.6, z: 17.4 },                      // the card table
  tv: { x: -14.8, z: 17.6 },                         // the set, and the world map
  spawn: { x: -17.4, z: 16.4 },                      // in the room, not in the doorway
  /**
   * The crib gets its own shot instead of the chase camera.
   *
   * The chase camera sits behind and above the player and pulls further back
   * the further up the street you are, which is right for a forecourt and
   * wrong for a room six metres deep: from inside the crib it ends up outside
   * the back wall, filling the screen with it. The room is small enough to
   * frame whole, so it is framed whole — a diorama you move around in, which
   * suits a house better than a chase cam anyway. High enough to clear the
   * front wall's parapet on the way in.
   */
  cam: { x: -14.6, y: 8.0, z: 7.6, atY: 1.3 },
};

/** Is this position inside the crib's four walls? */
export function inCrib(x, z) {
  return x > CRIB.x - CRIB.w / 2 && x < CRIB.x + CRIB.w / 2 &&
         z > CRIB.front && z < CRIB.z + CRIB.d / 2;
}

const WOOD = '#6B4A32';
const WALL = '#2E4A63';
const TRIM = '#1C2E3F';

export function buildCrib(scene, { flat, solids, blockers }) {
  const solid = (w, h, d, colour, x, y, z, map = null, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(colour, map));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  };
  const quad = (w, h, map, x, y, z, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat('#FFFFFF', map));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  };

  const { x, z, w, d, h } = CRIB;
  const front = CRIB.front;
  const back = z + d / 2;
  const left = x - w / 2;
  const right = x + w / 2;

  // Floor, lifted like the gym's is. The forecourt plane passes underneath the
  // whole building, and two surfaces at exactly y=0 tear as the camera moves.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat(WOOD));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0.01, z);
  scene.add(floor);

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.0), flat('#8E2C36'));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(x - 1.0, 0.026, z + 0.4);
  scene.add(rug);

  // Shell: full-height back and sides, and a LOW front.
  //
  // The front is cut down to waist height on purpose. The camera looks into
  // this room over that wall, and at full height it stands between the shot and
  // the player — you walk in and vanish behind your own house. Cutting the
  // near wall down is the dollhouse trick every isometric game uses, and it
  // costs nothing: the building still reads from the street off its sides,
  // its parapet and its sign.
  const FRONT_H = 1.7;
  solid(w, h, 0.3, WALL, x, h / 2, back);
  solid(0.3, h, d, WALL, left, h / 2, z);
  solid(0.3, h, d, WALL, right, h / 2, z);
  const leftW = CRIB.door.x0 - left;
  const rightW = right - CRIB.door.x1;
  solid(leftW, FRONT_H, 0.3, WALL, left + leftW / 2, FRONT_H / 2, front);
  solid(rightW, FRONT_H, 0.3, WALL, right - rightW / 2, FRONT_H / 2, front);

  // A parapet, NOT a roof. The chase camera sits behind and above the player
  // and looks down over the back wall into the room — the same way it reads the
  // gym, which is also open-topped. A slab across the footprint here is a lid:
  // stand inside and the whole screen is the underside of your own house. Four
  // thin edge beams give the building a top edge from the street and leave the
  // sight line in.
  const beam = 0.22;
  solid(w + 0.4, beam, 0.34, TRIM, x, h + beam / 2, back);
  solid(0.34, beam, d + 0.4, TRIM, left, h + beam / 2, z);
  solid(0.34, beam, d + 0.4, TRIM, right, h + beam / 2, z);
  // The front's cap sits on the low wall, not up at roof height, or it is the
  // full-height wall again with a hole in it.
  solid(leftW + 0.2, beam, 0.34, TRIM, left + leftW / 2, FRONT_H + beam / 2, front);
  solid(rightW + 0.2, beam, 0.34, TRIM, right - rightW / 2, FRONT_H + beam / 2, front);
  // The sign goes on the street face of the low wall, where it is a sign on a
  // house rather than a hoarding across the room.
  quad(3.6, 0.72, signTexture(["KEVIN'S CRIB", 'no shoes inside'],
    { bg: '#1C2E3F', fg: '#FFE500' }), x + 2.4, 1.0, front - 0.17, Math.PI);

  // --- the card table ------------------------------------------------------
  // Round, green, and lit, because it is the reason the room exists. The felt
  // is a cylinder rather than a box: every other surface in here is square and
  // the table has to read as the odd one out from across the street.
  const t = CRIB.table;
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 24), flat('#1F6B44'));
  felt.position.set(t.x, 0.78, t.z);
  scene.add(felt);
  solid(0.9, 0.72, 0.9, '#3A2A1C', t.x, 0.38, t.z);         // pedestal
  solid(1.5, 0.12, 1.5, '#3A2A1C', t.x, 0.06, t.z);         // foot
  // Chips and two cards, so it is obviously mid-game rather than furniture.
  for (const [cx, cz, c] of [[-0.5, -0.4, '#E8232B'], [-0.3, -0.55, '#FFE500'], [0.45, 0.3, '#F2F2F2']]) {
    solid(0.26, 0.1, 0.26, c, t.x + cx, 0.91, t.z + cz);
  }
  solid(0.3, 0.02, 0.42, '#FFFFFF', t.x + 0.2, 0.87, t.z + 0.55, null, 0.3);
  solid(0.3, 0.02, 0.42, '#FFFFFF', t.x + 0.55, 0.87, t.z + 0.5, null, 0.5);
  // A low shade over it. One warm pool of light is the whole mood of a card room.
  solid(1.5, 0.30, 1.5, '#C7382F', t.x, 2.15, t.z);
  solid(0.06, 0.8, 0.06, '#1A1A1A', t.x, 2.65, t.z);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), flat('#FFE07A'));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(t.x, 0.95, t.z);
  glow.material.transparent = true;
  glow.material.opacity = 0.16;
  scene.add(glow);

  // --- the sofa, the set, and the map --------------------------------------
  // Clear of the doorway — a sofa across the door is a sofa you climb over.
  const s = { x: x + 2.8, z: z - 1.4 };
  solid(2.8, 0.5, 1.1, '#C7382F', s.x, 0.32, s.z);              // seat
  solid(2.8, 0.8, 0.35, '#C7382F', s.x, 0.68, s.z + 0.5);       // back
  solid(0.34, 0.75, 1.1, '#A82B24', s.x - 1.35, 0.5, s.z);      // arms
  solid(0.34, 0.75, 1.1, '#A82B24', s.x + 1.35, 0.5, s.z);

  const tv = CRIB.tv;
  solid(0.5, 0.06, 1.6, '#2A2A2A', tv.x, 0.62, tv.z);           // stand
  solid(0.22, 1.2, 1.9, '#101014', tv.x, 1.32, tv.z);           // the set
  // The screen shows the map, which is also the thing you press E at. Facing
  // into the room, so you read it from the sofa and not from the street.
  quad(1.7, 1.0, signTexture(['WORLDS', 'gym · fry house'],
    { bg: '#101014', fg: '#7BE08A' }), tv.x - 0.13, 1.32, tv.z, -Math.PI / 2);

  // --- odds and ends -------------------------------------------------------
  solid(0.9, 1.8, 0.8, '#D8D2C4', left + 0.9, 0.9, back - 0.9);         // fridge
  solid(0.06, 0.5, 0.06, '#8A8F98', left + 1.32, 1.35, back - 0.9);     // its handle
  solid(1.4, 0.06, 0.5, '#4A3524', x + 2.6, 1.7, back - 0.2);           // shelf
  for (let i = 0; i < 4; i++) {
    solid(0.14, 0.42, 0.32, ['#E8232B', '#FFE500', '#2F8F45', '#6B4BC4'][i],
      x + 2.1 + i * 0.22, 1.94, back - 0.2);                            // trophies
  }
  quad(1.5, 1.0, signTexture(['NO PAIN', 'ONLY KEVIN'],
    { bg: '#E8232B', fg: '#FFE500' }), left + 0.18, 2.1, z - 1.2, Math.PI / 2);

  // --- collision -----------------------------------------------------------
  // The shell is four boxes rather than a ring, so the doorway is a real gap.
  blockers.push(
    { x0: left - 0.3, x1: right + 0.3, z0: back - 0.25, z1: back + 0.3 },
    { x0: left - 0.3, x1: left + 0.25, z0: front - 0.3, z1: back + 0.3 },
    { x0: right - 0.25, x1: right + 0.3, z0: front - 0.3, z1: back + 0.3 },
    { x0: left - 0.3, x1: CRIB.door.x0, z0: front - 0.25, z1: front + 0.25 },
    { x0: CRIB.door.x1, x1: right + 0.3, z0: front - 0.25, z1: front + 0.25 },
  );
  // Furniture. Circles for the round things, boxes for the square ones, because
  // a circle at sofa width leaves corners you can walk through into the wall.
  solids.push({ x: t.x, z: t.z, r: 1.35 });
  blockers.push(
    { x0: s.x - 1.5, x1: s.x + 1.5, z0: s.z - 0.6, z1: s.z + 0.75 },
    { x0: tv.x - 0.3, x1: tv.x + 0.3, z0: tv.z - 0.9, z1: tv.z + 0.9 },
    { x0: left + 0.4, x1: left + 1.4, z0: back - 1.35, z1: back - 0.45 },
  );

  return { table: t, tv };
}
