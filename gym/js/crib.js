// Kevin's Crib. Where you start, where the cards are, and where he actually
// lives — which took three goes to get right and is worth writing down.
//
// V1 was boxes: a room of hand-placed primitives, 89 meshes, and the first
// thing anybody saw of the game.
//
// V2 furnished it from a bought CC0 kit. Real models, correct scale, and it
// looked like an IKEA showroom — pale blue-grey units, peach wood, a salmon
// pink armchair. Better geometry, wronger room. The verdict was "small and fake
// asf" and that was the right verdict: nothing in it said a memecoin's mascot
// lived there. It was a catalogue with a card table in it.
//
// V3, this one, changes three things and none of them is more models:
//
//   COLOUR. The whole kit runs on eleven flat colours, so eleven lookups
//   repaint every piece of furniture at once. See brand.js. The flat is now
//   charcoal, dark wood, brand red and gold, which is what the gym and the fry
//   house already are.
//
//   SIZE. 16 x 11, up from 12.4 x 8.6 and 9.6 x 6.8 before that. A card room,
//   a trading desk, a kitchen, a sofa and a bed cannot share a room you can
//   cross in four steps, and cramming them is exactly what read as fake.
//
//   CONTENT. Anybody can buy a sofa. What makes it his: six monitors of green
//   candles, a neon sign, his own face framed on the walls, the contract
//   address over the bed, McKevin's cups left on the counter, gym trophies on
//   the shelf, and a slot machine by the door. The furniture is the set; this
//   is the character.
import * as THREE from 'three';
import { signTexture, chartTexture, neonTexture } from './gear.js';

/**
 * Where the crib sits, and the pieces of it other files need.
 *
 * Exported because main.js needs the same numbers for the spawn point, the
 * walk-up prompts and the fast-travel targets. Three copies of a coordinate is
 * three chances to drift.
 */
export const CRIB = {
  x: -18.0, z: 16.8, w: 16.0, d: 11.0, h: 3.4,
  get front() { return this.z - this.d / 2; },       // z of the front wall
  door: { x0: -19.2, x1: -16.8 },                    // the gap you walk through
  table: { x: -22.4, z: 18.4 },                      // the card table
  tv: { x: -11.2, z: 17.2 },                         // the set, and the world map
  desk: { x: -22.6, z: 13.4 },                       // where the charts are
  spawn: { x: -18.0, z: 12.6 },                      // inside the door, facing in
  /**
   * The crib is first person, which is why it can be a real room.
   *
   * A chase camera has to see past a near wall and down through a roof, and
   * neither is a thing a house has. Standing in it, both problems stop
   * existing — so the walls go full height and the lid goes on.
   */
  /** Which way you are facing when you wake up: into the room, not at a wall. */
  yaw: 0,
};

/** Is this position inside the crib's four walls? */
export function inCrib(x, z) {
  return x > CRIB.x - CRIB.w / 2 && x < CRIB.x + CRIB.w / 2 &&
         z > CRIB.front && z < CRIB.z + CRIB.d / 2;
}

/**
 * Every model the crib would use, if it has been downloaded.
 *
 * main.js preloads this list, loadProps() shrugs off anything missing, and each
 * fixture below falls back to the boxes it used to be — so the room never
 * half-builds.
 *
 * Deliberately NOT here: Kenney's wall.glb. It stands 2.45 and CRIB.h is 3.4,
 * so it would leave a stripe of daylight round the top of every wall. The shell
 * stays hand-built for exactly that reason.
 */
export const CRIB_PROPS = [
  // the card room
  'card-table', 'card-chair', 'chandelier', 'poker-chips', 'playing-cards',
  'roulette-wheel', 'slot-machine', 'prize-wheel', 'claw-machine', 'arcade-machine',
  // the desk he actually makes the money at
  'desk', 'desk-chair', 'monitor', 'keyboard', 'mouse', 'laptop', 'speaker-hifi',
  // living
  'crib-sofa', 'crib-armchair', 'coffee-table', 'tv', 'tv-stand', 'rug',
  'floor-lamp', 'bookcase', 'books', 'radio', 'potted-plant', 'plant-small',
  // kitchen
  'kitchen-cabinet', 'kitchen-upper', 'kitchen-sink', 'stove', 'fridge',
  'mini-fridge', 'microwave', 'coffee-machine', 'extractor', 'bar-stool',
  // sleeping, clutter and the hallway
  'bed', 'pillow', 'bedside', 'table-lamp', 'side-table', 'soda-cup', 'tray-stack',
  'box-open', 'box-closed', 'doormat', 'coat-rack', 'trashcan', 'picture-frame',
];

const WOOD = '#4A3222';        // darker than v2. A card room is not a sunroom.
const WALL = '#232A33';
const TRIM = '#12161C';
const RED = '#C7382F';
const GOLD = '#FFE07A';

export function buildCrib(scene, { flat, solids, blockers, spawn = null }) {
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
  const paint = (w, d, colour, x, z, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat(colour));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  /**
   * Model if the pack has one, the boxes we drew by hand if not.
   *
   * Collision is not part of the swap — blockers and solids are pushed by the
   * caller either way, because whether you can walk through the sofa must not
   * depend on whether a download finished.
   */
  const fixture = (name, opts, box = () => {}) =>
    spawn?.(name, { solid: false, ...opts }) ?? box();

  const { x, z, w, d, h } = CRIB;
  const front = CRIB.front;
  const back = z + d / 2;
  const left = x - w / 2;
  const right = x + w / 2;

  // --- floor and shell -----------------------------------------------------
  // Lifted off y=0: the forecourt plane passes under the whole building, and
  // two surfaces at exactly zero tear as the camera moves.
  paint(w, d, WOOD, x, z, 0.01);
  // A dark rug under the card table, so the felt is not the only island of
  // colour on a plain floor.
  paint(6.0, 6.0, '#2A1A20', CRIB.table.x, CRIB.table.z, 0.018);

  solid(w, h, 0.3, WALL, x, h / 2, back);
  solid(0.3, h, d, WALL, left, h / 2, z);
  solid(0.3, h, d, WALL, right, h / 2, z);
  const leftW = CRIB.door.x0 - left;
  const rightW = right - CRIB.door.x1;
  solid(leftW, h, 0.3, WALL, left + leftW / 2, h / 2, front);
  solid(rightW, h, 0.3, WALL, right - rightW / 2, h / 2, front);
  solid(CRIB.door.x1 - CRIB.door.x0, h - 2.2, 0.3, WALL,
    (CRIB.door.x0 + CRIB.door.x1) / 2, h - (h - 2.2) / 2, front);      // over the door
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat('#2E353F'));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(x, h - 0.02, z);
  scene.add(ceil);
  const beam = 0.22;
  solid(w + 0.4, beam, d + 0.4, TRIM, x, h + beam / 2, z);

  // Skirting and a picture rail. Two cheap bands are what stop a flat-shaded
  // wall reading as a backdrop, and the rail gives the art a line to hang on.
  for (const bz of [back - 0.16, front + 0.16]) solid(w, 0.18, 0.06, TRIM, x, 0.09, bz);
  for (const sx of [left + 0.16, right - 0.16]) solid(0.06, 0.18, d, TRIM, sx, 0.09, z);
  for (const bz of [back - 0.16, front + 0.16]) solid(w, 0.06, 0.05, '#3A2A20', x, 2.35, bz);
  for (const sx of [left + 0.16, right - 0.16]) solid(0.05, 0.06, d, '#3A2A20', sx, 2.35, z);

  // --- the neon, which is the first thing you see ---------------------------
  // Over the door on the inside, facing the room. A sign facing the street
  // would be a shop; facing in, it is somebody's front room.
  quad(3.4, 1.06, neonTexture('KEVIN', { fg: '#FF3B4E' }), x, 2.72, front + 0.17);
  quad(2.2, 0.69, neonTexture('KEK', { fg: '#3FD07A' }), left + 0.18, 2.6, 20.4, Math.PI / 2);

  // --- the card room, left end ---------------------------------------------
  const t = CRIB.table;
  fixture('card-table', { x: t.x, z: t.z, width: 1.9 }, () => {
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 24), flat('#1F6B44'));
    felt.position.set(t.x, 0.78, t.z);
    scene.add(felt);
    solid(0.9, 0.72, 0.9, '#3A2A1C', t.x, 0.38, t.z);
    solid(1.5, 0.12, 1.5, '#3A2A1C', t.x, 0.06, t.z);
  });
  fixture('poker-chips', { x: t.x - 0.46, z: t.z - 0.36, width: 0.32, y: 0.78 });
  fixture('poker-chips', { x: t.x + 0.5, z: t.z + 0.2, width: 0.26, y: 0.78, rotY: 0.7 });
  fixture('playing-cards', { x: t.x + 0.36, z: t.z + 0.44, width: 0.36, y: 0.78, rotY: 0.4 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = t.x + Math.sin(a) * 1.5, cz = t.z + Math.cos(a) * 1.5;
    fixture('card-chair', { x: cx, z: cz, width: 0.54, rotY: a + Math.PI }, () => {
      solid(0.42, 0.1, 0.42, '#5A3A24', cx, 0.44, cz, null, a);
      solid(0.42, 0.5, 0.1, '#5A3A24', cx - Math.sin(a) * 0.2, 0.7, cz - Math.cos(a) * 0.2, null, a);
    });
    solids.push({ x: cx, z: cz, r: 0.32 });
  }
  fixture('chandelier', { x: t.x, z: t.z, width: 1.0, y: 2.25 }, () => {
    solid(1.5, 0.30, 1.5, RED, t.x, 2.15, t.z);
    solid(0.06, 0.8, 0.06, '#1A1A1A', t.x, 2.65, t.z);
  });
  // One warm pool of light is the whole mood of a card room, and it survives
  // whether or not the chandelier model loaded.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), flat(GOLD));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(t.x, 0.95, t.z);
  glow.material.transparent = true;
  glow.material.opacity = 0.15;
  scene.add(glow);
  solids.push({ x: t.x, z: t.z, r: 1.25 });

  // The machines along the left wall. A slot machine in a memecoin's flat is
  // the joke telling itself, so it stands where you pass it on the way in.
  for (const [name, mx, mz, mw] of [
    ['slot-machine', left + 0.8, 15.0, 0.95],
    ['prize-wheel', left + 0.8, 16.4, 0.95],
    ['claw-machine', left + 0.8, 17.9, 0.95],
    ['arcade-machine', left + 0.8, 21.2, 0.9],
  ]) {
    fixture(name, { x: mx, z: mz, width: mw, rotY: Math.PI / 2 }, () => {
      solid(0.7, 1.7, mw, '#3A3A48', mx, 0.85, mz);
      solid(0.1, 0.5, mw * 0.7, '#101018', mx + 0.35, 1.25, mz);
    });
    solids.push({ x: mx, z: mz, r: 0.55 });
  }
  fixture('side-table', { x: -21.0, z: 21.4, width: 0.66 }, () => {
    solid(0.6, 0.1, 0.6, '#5A3A24', -21.0, 0.62, 21.4);
  });
  fixture('roulette-wheel', { x: -21.0, z: 21.4, width: 0.7, y: 0.66 });
  solids.push({ x: -21.0, z: 21.4, r: 0.45 });

  // --- the desk, which is where the money actually comes from ---------------
  // Six monitors of green candles. Three seeds, so three different markets:
  // the same chart repeated is the tell that makes set dressing look fake.
  const dk = CRIB.desk;
  fixture('desk', { x: dk.x, z: dk.z, width: 1.9, rotY: -Math.PI / 2 }, () => {
    solid(0.8, 0.08, 1.9, '#4A3524', dk.x, 0.74, dk.z);
    solid(0.08, 0.72, 1.8, '#3A2A1C', dk.x + 0.34, 0.37, dk.z);
  });
  for (let i = 0; i < 3; i++) {
    const mz = dk.z - 0.62 + i * 0.62;
    // Facing +x, toward the chair. A plane's normal is +z, so -PI/2 turns it to
    // face -x — into the wall — and the whole desk reads as six grey backs.
    fixture('monitor', { x: dk.x + 0.18, z: mz, width: 0.5, y: 0.76, rotY: Math.PI / 2 }, () => {
      solid(0.06, 0.36, 0.5, '#26262C', dk.x + 0.18, 1.0, mz);
    });
    quad(0.46, 0.29, chartTexture(i + 1, { up: i !== 1 }), dk.x + 0.30, 1.06, mz, Math.PI / 2);
    // A second row above, on a shelf. Six screens is a person with a problem,
    // which is the correct number for this character.
    fixture('monitor', { x: dk.x + 0.18, z: mz, width: 0.5, y: 1.28, rotY: Math.PI / 2 });
    quad(0.46, 0.29, chartTexture(i + 7, { up: i === 1 }), dk.x + 0.30, 1.58, mz, Math.PI / 2);
  }
  fixture('keyboard', { x: dk.x + 0.62, z: dk.z, width: 0.42, y: 0.76, rotY: Math.PI / 2 });
  fixture('mouse', { x: dk.x + 0.62, z: dk.z + 0.4, width: 0.1, y: 0.76, rotY: -Math.PI / 2 });
  fixture('desk-chair', { x: dk.x + 1.1, z: dk.z, width: 0.6, rotY: Math.PI / 2 }, () => {
    solid(0.5, 0.1, 0.5, '#26262C', dk.x + 1.1, 0.46, dk.z);
  });
  fixture('speaker-hifi', { x: dk.x + 0.3, z: dk.z - 1.15, width: 0.3 });
  fixture('laptop', { x: dk.x + 0.55, z: dk.z + 1.1, width: 0.38, y: 0.76, rotY: Math.PI / 2 });
  fixture('soda-cup', { x: dk.x + 0.9, z: dk.z - 0.5, width: 0.14, y: 0.76 });
  blockers.push({ x0: dk.x - 0.4, x1: dk.x + 0.9, z0: dk.z - 1.3, z1: dk.z + 1.3 });

  // --- living, right of the door -------------------------------------------
  fixture('rug', { x: -14.4, z: 17.6, width: 4.0 }, () => {
    paint(4.0, 2.8, '#6B1F24', -14.4, 17.6, 0.026);
  });
  const s = { x: -16.2, z: 17.6 };
  fixture('crib-sofa', { x: s.x, z: s.z, width: 2.3, rotY: Math.PI / 2 }, () => {
    solid(1.1, 0.5, 2.4, RED, s.x, 0.32, s.z);
    solid(0.35, 0.8, 2.4, RED, s.x - 0.5, 0.68, s.z);
    solid(1.1, 0.75, 0.34, '#A82B24', s.x, 0.5, s.z - 1.15);
    solid(1.1, 0.75, 0.34, '#A82B24', s.x, 0.5, s.z + 1.15);
  });
  blockers.push({ x0: s.x - 0.65, x1: s.x + 0.65, z0: s.z - 1.4, z1: s.z + 1.4 });

  fixture('crib-armchair', { x: -14.0, z: 20.0, width: 0.95, rotY: -2.4 }, () => {
    solid(0.85, 0.6, 0.85, '#A82B24', -14.0, 0.34, 20.0);
  });
  solids.push({ x: -14.0, z: 20.0, r: 0.52 });

  fixture('coffee-table', { x: -14.4, z: 17.6, width: 1.15 }, () => {
    solid(1.0, 0.1, 0.7, '#4A3524', -14.4, 0.42, 17.6);
  });
  // What is actually on his coffee table.
  fixture('soda-cup', { x: -14.1, z: 17.35, width: 0.15, y: 0.46 });
  fixture('box-open', { x: -14.7, z: 17.85, width: 0.42, y: 0.46, rotY: 0.5 });
  solids.push({ x: -14.4, z: 17.6, r: 0.62 });

  const tv = CRIB.tv;
  fixture('tv-stand', { x: tv.x, z: tv.z, width: 1.6, rotY: -Math.PI / 2 }, () => {
    solid(0.5, 0.06, 1.6, '#26262C', tv.x, 0.62, tv.z);
  });
  fixture('tv', { x: tv.x, z: tv.z, width: 1.35, rotY: -Math.PI / 2, y: 0.62 }, () => {
    solid(0.22, 1.2, 1.9, '#101014', tv.x, 1.32, tv.z);
  });
  quad(1.6, 0.95, signTexture(['WORLDS', 'gym · fry house'],
    { bg: '#101014', fg: '#7BE08A' }), tv.x - 0.34, 1.3, tv.z, -Math.PI / 2);
  blockers.push({ x0: tv.x - 0.4, x1: tv.x + 0.4, z0: tv.z - 1.0, z1: tv.z + 1.0 });

  fixture('floor-lamp', { x: -16.6, z: 20.2, width: 0.44 }, () => {
    solid(0.1, 1.5, 0.1, '#8A8F98', -16.6, 0.75, 20.2);
    solid(0.5, 0.34, 0.5, GOLD, -16.6, 1.65, 20.2);
  });
  solids.push({ x: -16.6, z: 20.2, r: 0.3 });

  // The shelf, and the trophies that say what he does all day.
  fixture('bookcase', { x: -11.6, z: 20.9, width: 1.2, rotY: Math.PI }, () => {
    solid(1.1, 1.8, 0.36, '#4A3524', -11.6, 0.9, 20.9);
  });
  fixture('books', { x: -11.6, z: 20.9, width: 0.85, y: 1.18, rotY: Math.PI });
  // The radio used to sit at y 1.84 "on" the bookcase and measured as fully
  // inside it — the fallback box is 1.8 tall but the MODEL is not, and an
  // author-time y cannot know that. It lives on the desk now, where a radio
  // belongs anyway and the surface height is one we set ourselves.
  fixture('radio', { x: dk.x + 0.72, z: dk.z - 0.95, width: 0.34, y: 0.76, rotY: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    solid(0.13, 0.34, 0.13, ['#FFE500', '#E8232B', '#D8D2C4', '#FFE500'][i],
      -12.0 + i * 0.22, 1.55, 20.85);
  }
  blockers.push({ x0: -12.3, x1: -10.9, z0: 20.5, z1: 21.2 });

  for (const [px, pz, name, pw] of [[-11.4, 18.9, 'potted-plant', 0.62],
                                    [-20.2, 12.4, 'plant-small', 0.38]]) {
    fixture(name, { x: px, z: pz, width: pw }, () => {
      solid(pw * 0.7, 0.3, pw * 0.7, '#B06A3A', px, 0.15, pz);
      solid(pw * 0.9, 0.7, pw * 0.9, '#2F8F45', px, 0.62, pz);
    });
    solids.push({ x: px, z: pz, r: pw * 0.4 });
  }

  // --- the kitchen along the back wall -------------------------------------
  const KZ = back - 0.55;
  // Splashback and worktop first, and in a colour the wall is not. Units in the
  // kit's neutral sit at the same value as the wall behind them, so without
  // these two bands the whole kitchen disappears and the microwave looks like
  // it is floating — which is exactly what it did.
  quad(6.6, 1.1, signTexture([''], { bg: '#8E1F1A', fg: '#8E1F1A' }), -16.1, 1.42, back - 0.17);
  solid(6.8, 0.09, 0.72, '#CFC6B0', -16.1, 0.92, KZ);              // worktop
  solid(6.8, 0.1, 0.06, '#8A8272', -16.1, 0.86, KZ - 0.36);        // its front edge
  for (const [name, ux] of [['kitchen-cabinet', -17.6], ['kitchen-sink', -16.6],
                            ['kitchen-cabinet', -15.6], ['stove', -14.6]]) {
    fixture(name, { x: ux, z: KZ, width: 0.95, rotY: Math.PI }, () => {
      solid(0.95, 0.86, 0.62, '#4A4A55', ux, 0.43, KZ);
    });
  }
  fixture('fridge', { x: -13.3, z: KZ, width: 0.76, rotY: Math.PI }, () => {
    solid(0.75, 1.8, 0.68, '#4A4A55', -13.3, 0.9, KZ);
  });
  fixture('microwave', { x: -15.6, z: KZ, width: 0.52, y: 0.92, rotY: Math.PI });
  fixture('coffee-machine', { x: -18.1, z: KZ, width: 0.32, y: 0.92, rotY: Math.PI });
  fixture('extractor', { x: -14.6, z: KZ, width: 0.85, y: 1.6, rotY: Math.PI });
  for (const ux of [-17.6, -16.6]) {
    fixture('kitchen-upper', { x: ux, z: back - 0.32, width: 0.92, y: 1.55, rotY: Math.PI });
  }
  // What is left on the counter, which is more characterful than the counter.
  fixture('tray-stack', { x: -18.6, z: KZ, width: 0.4, y: 0.92, rotY: Math.PI });
  fixture('soda-cup', { x: -18.0, z: KZ - 0.1, width: 0.15, y: 0.92 });
  fixture('soda-cup', { x: -16.9, z: KZ + 0.06, width: 0.15, y: 0.92, rotY: 0.8 });
  fixture('box-closed', { x: -19.3, z: KZ, width: 0.5, y: 0.92, rotY: 0.2 });
  blockers.push({ x0: -19.6, x1: -12.9, z0: KZ - 0.42, z1: back });

  // A stool at the counter end, and the mini fridge that is the actual diet.
  fixture('bar-stool', { x: -19.4, z: 20.1, width: 0.42 }, () => {
    solid(0.36, 0.1, 0.36, '#33333B', -19.4, 0.68, 20.1);
  });
  solids.push({ x: -19.4, z: 20.1, r: 0.3 });
  fixture('mini-fridge', { x: -20.6, z: 12.5, width: 0.55 }, () => {
    solid(0.55, 0.85, 0.55, '#33333B', -20.6, 0.42, 12.5);
  });
  solids.push({ x: -20.6, z: 12.5, r: 0.38 });

  // --- where he sleeps, front right ----------------------------------------
  const bed = { x: -12.6, z: 13.6 };
  fixture('bed', { x: bed.x, z: bed.z, width: 2.05, rotY: Math.PI / 2 }, () => {
    solid(1.5, 0.45, 2.0, '#4A3524', bed.x, 0.22, bed.z);
    solid(1.4, 0.22, 1.9, '#33333B', bed.x, 0.55, bed.z);
  });
  fixture('pillow', { x: bed.x, z: bed.z - 0.74, width: 0.64, y: 0.5, rotY: Math.PI / 2 });
  blockers.push({ x0: bed.x - 1.15, x1: bed.x + 1.15, z0: bed.z - 0.9, z1: bed.z + 0.9 });
  fixture('bedside', { x: -12.6, z: 15.2, width: 0.52 }, () => {
    solid(0.48, 0.55, 0.42, '#4A3524', -12.6, 0.28, 15.2);
  });
  fixture('table-lamp', { x: -12.6, z: 15.2, width: 0.3, y: 0.58 });
  solids.push({ x: -12.6, z: 15.2, r: 0.35 });
  // Clothes and cardboard where nobody has tidied. A perfectly clean flat is
  // the other way to look fake.
  fixture('box-open', { x: -14.4, z: 12.6, width: 0.5, rotY: 0.6 });
  fixture('box-closed', { x: -13.7, z: 12.5, width: 0.45, rotY: -0.4 });
  solids.push({ x: -14.1, z: 12.55, r: 0.5 });

  // --- the hallway end ------------------------------------------------------
  fixture('doormat', { x: x, z: front + 0.8, width: 1.0 }, () => {
    paint(1.0, 0.66, '#3A2A20', x, front + 0.8, 0.03);
  });
  fixture('coat-rack', { x: -16.6, z: 12.5, width: 0.48 }, () => {
    solid(0.1, 1.7, 0.1, '#4A3524', -16.6, 0.85, 12.5);
    solid(0.5, 0.08, 0.08, '#4A3524', -16.6, 1.6, 12.5);
  });
  solids.push({ x: -16.6, z: 12.5, r: 0.3 });
  fixture('trashcan', { x: -19.9, z: 21.4, width: 0.45 }, () => {
    solid(0.4, 0.6, 0.4, '#26262C', -19.9, 0.3, 21.4);
  });
  solids.push({ x: -19.9, z: 21.4, r: 0.3 });

  /**
   * His own face on the walls, and the contract address over the bed.
   *
   * The frame model is one mesh with one material, so its canvas cannot be
   * textured through the loader — the art is a quad hung proud of it instead,
   * which is how the gym's banners and McKevin's menu boards already work.
   * Stock paintings would be the wrong answer in this room regardless: the
   * whole point of the rebuild is that a stranger's furniture is not a
   * character.
   */
  const art = [
    [-15.0, 1.9, front + 0.17, 0, ['GM', 'no thoughts'], '#1C2E3F'],
    [-12.6, 1.95, front + 0.17, 0, ['0x63D7fa…', '9e284A'], '#0B0B0B'],
    [-13.6, 1.9, back - 0.17, Math.PI, ['WAGMI', 'probably'], '#1C2E3F'],
    [right - 0.17, 1.95, 15.6, -Math.PI / 2, ['NO PAIN', 'ONLY KEVIN'], '#8E1F1A'],
    [right - 0.17, 1.95, 19.4, -Math.PI / 2, ["McKEVIN'S", 'employee of the month'], '#8E1F1A'],
    [left + 0.18, 1.95, 13.2, Math.PI / 2, ['KEK', 'to the moon'], '#1C2E3F'],
  ];
  for (const [ax, ay, az, ry, lines, bg] of art) {
    const nx = Math.abs(ry) === Math.PI / 2 ? (ry > 0 ? 0.03 : -0.03) : 0;
    const nz = ry === 0 ? 0.03 : ry === Math.PI ? -0.03 : 0;
    fixture('picture-frame', { x: ax + nx, z: az + nz, width: 0.98, y: ay, rotY: ry });
    quad(0.82, 0.58, signTexture(lines, { bg, fg: '#FFE500', size: 62 }),
      ax + nx * 2.6, ay, az + nz * 2.6, ry);
  }

  // --- collision -----------------------------------------------------------
  // The shell is four boxes rather than a ring, so the doorway is a real gap.
  blockers.push(
    { x0: left - 0.3, x1: right + 0.3, z0: back - 0.25, z1: back + 0.3 },
    { x0: left - 0.3, x1: left + 0.25, z0: front - 0.3, z1: back + 0.3 },
    { x0: right - 0.25, x1: right + 0.3, z0: front - 0.3, z1: back + 0.3 },
    { x0: left - 0.3, x1: CRIB.door.x0, z0: front - 0.25, z1: front + 0.25 },
    { x0: CRIB.door.x1, x1: right + 0.3, z0: front - 0.25, z1: front + 0.25 },
  );

  return { table: t, tv, desk: dk };
}
