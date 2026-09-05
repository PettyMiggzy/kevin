// Kevin's Crib. Where you start, and where the card room is.
//
// The street already had two venues — the gym you walk into and the fry house
// you work at — and no reason to be on it. The crib gives the map a home end:
// you wake up here, the cards are here, and the other two worlds are a walk or
// a tap away.
//
// It used to be built the way city.js is — boxes and painted quads, on the
// argument that a modelled sofa costs megabytes to look the same from a chase
// camera a few metres away. That argument died twice over. The camera is first
// person now, so you stand a metre from the furniture rather than looking down
// at it; and 100 props cost 5.2MB between them, which is less than the walk
// atlas. A room of boxes was the first thing anybody saw of this game.
//
// So the fixtures ask for models and keep their boxes as a fallback, exactly as
// McKevin's does. See SHOP_PROPS there and CRIB_PROPS here.
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
 *
 * GREW from 9.6 x 6.8 to 12.4 x 8.6. Not for its own sake: at the old size the
 * card table, a sofa and a kitchen could not all be in it without touching, so
 * the room only ever held the card table and read as a corridor with a telly.
 * A flat you live in needs four things you can walk between.
 */
export const CRIB = {
  x: -18.0, z: 16.8, w: 12.4, d: 8.6, h: 3.0,
  get front() { return this.z - this.d / 2; },       // z of the front wall
  door: { x0: -19.4, x1: -16.6 },                    // the gap you walk through
  table: { x: -21.6, z: 17.6 },                      // the card table
  tv: { x: -12.3, z: 17.4 },                         // the set, and the world map
  spawn: { x: -18.0, z: 13.7 },                      // inside the door, facing the room
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
 * Two CC0 Kenney kits plus six pieces authored to fit — the card table,
 * chandelier, roulette wheel, chips, cards and picture frame, none of which a
 * furniture kit ships. main.js preloads this list, loadProps() shrugs off
 * anything missing, and each fixture below falls back to the boxes it was.
 *
 * Deliberately NOT here: Kenney's wall.glb. It stands 2.45 and CRIB.h is 3.0,
 * so it would leave a stripe of daylight round the top of every wall. The
 * shell stays hand-built for exactly that reason.
 */
export const CRIB_PROPS = [
  // the card room
  'card-table', 'card-chair', 'chandelier', 'poker-chips', 'playing-cards',
  'roulette-wheel', 'slot-machine', 'prize-wheel', 'claw-machine', 'arcade-machine',
  // living
  'crib-sofa', 'crib-armchair', 'coffee-table', 'tv', 'tv-stand', 'rug',
  'floor-lamp', 'bookcase', 'books', 'radio', 'potted-plant', 'plant-small',
  // kitchen
  'kitchen-cabinet', 'kitchen-upper', 'kitchen-sink', 'stove', 'fridge',
  'microwave', 'coffee-machine', 'extractor',
  // sleeping and the hallway
  'bed', 'pillow', 'bedside', 'table-lamp', 'side-table',
  'doormat', 'coat-rack', 'trashcan', 'picture-frame', 'ceiling-fan',
];

const WOOD = '#6B4A32';
const WALL = '#2E4A63';
const TRIM = '#1C2E3F';

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
  /**
   * Model if the pack has one, the boxes we drew by hand if not.
   *
   * Collision is not part of the swap — the blockers and solids are pushed by
   * the caller either way, because whether you can walk through the sofa must
   * not depend on whether a download finished.
   */
  const fixture = (name, opts, box) => spawn?.(name, { solid: false, ...opts }) ?? box();

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

  // Shell: four full-height walls and a ceiling.
  //
  // This room was briefly a dollhouse — near wall cut to waist height so an
  // outside camera could see over it. In first person you are standing in it,
  // so it gets to be a room: a real front wall with a real doorway, and a lid
  // on top. Without the lid you are indoors looking at open sky, which reads
  // as a film set rather than a house.
  solid(w, h, 0.3, WALL, x, h / 2, back);
  solid(0.3, h, d, WALL, left, h / 2, z);
  solid(0.3, h, d, WALL, right, h / 2, z);
  const leftW = CRIB.door.x0 - left;
  const rightW = right - CRIB.door.x1;
  solid(leftW, h, 0.3, WALL, left + leftW / 2, h / 2, front);
  solid(rightW, h, 0.3, WALL, right - rightW / 2, h / 2, front);
  solid(CRIB.door.x1 - CRIB.door.x0, h - 2.2, 0.3, WALL,
    (CRIB.door.x0 + CRIB.door.x1) / 2, h - (h - 2.2) / 2, front);      // over the door
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat('#E4DED2'));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(x, h - 0.02, z);
  scene.add(ceil);

  // A parapet, NOT a roof. The chase camera sits behind and above the player
  // and looks down over the back wall into the room — the same way it reads the
  // gym, which is also open-topped. A slab across the footprint here is a lid:
  // stand inside and the whole screen is the underside of your own house. Four
  // thin edge beams give the building a top edge from the street and leave the
  // sight line in.
  const beam = 0.22;
  solid(w + 0.4, beam, d + 0.4, TRIM, x, h + beam / 2, z);
  // Inside the door, where you read it on the way out.
  quad(2.4, 0.5, signTexture(["KEVIN'S CRIB", 'no shoes inside'],
    { bg: '#1C2E3F', fg: '#FFE500' }), x, h - 0.5, front + 0.17);

  // A skirting line all the way round. One cheap band at ankle height is what
  // stops a flat-shaded wall reading as a backdrop.
  for (const [bw, bx, bz] of [[w, x, back - 0.16], [w, x, front + 0.16]]) {
    solid(bw, 0.16, 0.06, TRIM, bx, 0.08, bz);
  }
  for (const sx of [left + 0.16, right - 0.16]) solid(0.06, 0.16, d, TRIM, sx, 0.08, z);

  // --- the card room, left end ---------------------------------------------
  // Round, green and lit, because it is the reason the room exists. Everything
  // else in here is square, so the table has to read as the odd one out.
  const t = CRIB.table;
  fixture('card-table', { x: t.x, z: t.z, width: 1.7 }, () => {
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 24), flat('#1F6B44'));
    felt.position.set(t.x, 0.78, t.z);
    scene.add(felt);
    solid(0.9, 0.72, 0.9, '#3A2A1C', t.x, 0.38, t.z);       // pedestal
    solid(1.5, 0.12, 1.5, '#3A2A1C', t.x, 0.06, t.z);       // foot
  });
  // Mid-game, not furniture: chips and a hand sitting on the felt.
  fixture('poker-chips', { x: t.x - 0.42, z: t.z - 0.34, width: 0.3, y: 0.78 }, () => {
    for (const [cx, cz, c] of [[-0.5, -0.4, '#E8232B'], [-0.3, -0.55, '#FFE500'], [0.45, 0.3, '#F2F2F2']]) {
      solid(0.26, 0.1, 0.26, c, t.x + cx, 0.91, t.z + cz);
    }
  });
  fixture('playing-cards', { x: t.x + 0.34, z: t.z + 0.4, width: 0.34, y: 0.78, rotY: 0.4 }, () => {
    solid(0.3, 0.02, 0.42, '#FFFFFF', t.x + 0.2, 0.87, t.z + 0.55, null, 0.3);
    solid(0.3, 0.02, 0.42, '#FFFFFF', t.x + 0.55, 0.87, t.z + 0.5, null, 0.5);
  });
  // Four chairs, facing in. rotY points each one's back outward from the table.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = t.x + Math.sin(a) * 1.4, cz = t.z + Math.cos(a) * 1.4;
    fixture('card-chair', { x: cx, z: cz, width: 0.52, rotY: a + Math.PI }, () => {
      solid(0.42, 0.1, 0.42, '#5A3A24', cx, 0.44, cz, null, a);
      solid(0.42, 0.5, 0.1, '#5A3A24', cx - Math.sin(a) * 0.2, 0.7, cz - Math.cos(a) * 0.2, null, a);
    });
    solids.push({ x: cx, z: cz, r: 0.3 });
  }
  // The shade over the table. One warm pool of light is the whole mood of a
  // card room, so the glow quad stays whether or not the model loaded.
  fixture('chandelier', { x: t.x, z: t.z, width: 0.9, y: 1.95 }, () => {
    solid(1.5, 0.30, 1.5, '#C7382F', t.x, 2.15, t.z);
    solid(0.06, 0.8, 0.06, '#1A1A1A', t.x, 2.65, t.z);
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), flat('#FFE07A'));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(t.x, 0.95, t.z);
  glow.material.transparent = true;
  glow.material.opacity = 0.16;
  scene.add(glow);

  // The machines down the left wall. A slot machine in a memecoin's flat is
  // the joke telling itself, so it goes where you cannot miss it on the way in.
  const machines = [
    ['slot-machine', -23.4, 19.9, 0.9, Math.PI / 2, '#B8342C'],
    ['prize-wheel', -23.4, 14.6, 0.9, Math.PI / 2, '#E8A020'],
    ['claw-machine', -23.4, 17.3, 0.9, Math.PI / 2, '#2F6FB0'],
    ['arcade-machine', -20.4, 20.5, 0.85, Math.PI, '#3A3A48'],
  ];
  for (const [name, mx, mz, mw, ry, colour] of machines) {
    fixture(name, { x: mx, z: mz, width: mw, rotY: ry }, () => {
      solid(mw, 1.7, 0.7, colour, mx, 0.85, mz, null, ry);
      solid(mw * 0.7, 0.5, 0.1, '#101018', mx, 1.25, mz + 0.3, null, ry);
    });
    solids.push({ x: mx, z: mz, r: 0.55 });
  }
  fixture('side-table', { x: -22.2, z: 20.5, width: 0.62 }, () => {
    solid(0.6, 0.1, 0.6, '#5A3A24', -22.2, 0.62, 20.5);
    solid(0.1, 0.6, 0.1, '#5A3A24', -22.2, 0.3, 20.5);
  });
  fixture('roulette-wheel', { x: -22.2, z: 20.5, width: 0.66, y: 0.66 }, () => {
    solid(0.66, 0.12, 0.66, '#2A1A12', -22.2, 0.73, 20.5);
  });
  solids.push({ x: -22.2, z: 20.5, r: 0.45 });

  // --- living, right of the door -------------------------------------------
  fixture('rug', { x: -14.9, z: 17.4, width: 3.6, solid: false }, () => {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.6), flat('#8E2C36'));
    r.rotation.x = -Math.PI / 2;
    r.position.set(-14.9, 0.026, 17.4);
    scene.add(r);
  });
  const s = { x: -16.4, z: 17.4 };
  fixture('crib-sofa', { x: s.x, z: s.z, width: 2.1, rotY: Math.PI / 2 }, () => {
    solid(1.1, 0.5, 2.4, '#C7382F', s.x, 0.32, s.z);
    solid(0.35, 0.8, 2.4, '#C7382F', s.x - 0.5, 0.68, s.z);
    solid(1.1, 0.75, 0.34, '#A82B24', s.x, 0.5, s.z - 1.15);
    solid(1.1, 0.75, 0.34, '#A82B24', s.x, 0.5, s.z + 1.15);
  });
  blockers.push({ x0: s.x - 0.6, x1: s.x + 0.6, z0: s.z - 1.35, z1: s.z + 1.35 });

  fixture('crib-armchair', { x: -14.6, z: 19.4, width: 0.9, rotY: -2.3 }, () => {
    solid(0.85, 0.6, 0.85, '#A82B24', -14.6, 0.34, 19.4);
  });
  solids.push({ x: -14.6, z: 19.4, r: 0.5 });

  fixture('coffee-table', { x: -14.6, z: 17.4, width: 1.05 }, () => {
    solid(1.0, 0.1, 0.7, '#4A3524', -14.6, 0.42, 17.4);
  });
  solids.push({ x: -14.6, z: 17.4, r: 0.6 });

  // The telly, which is also the map you press E at. Facing into the room so
  // you read it from the sofa and not from the street.
  const tv = CRIB.tv;
  fixture('tv-stand', { x: tv.x, z: tv.z, width: 1.5, rotY: -Math.PI / 2 }, () => {
    solid(0.5, 0.06, 1.6, '#2A2A2A', tv.x, 0.62, tv.z);
  });
  fixture('tv', { x: tv.x, z: tv.z, width: 1.25, rotY: -Math.PI / 2, y: 0.62 }, () => {
    solid(0.22, 1.2, 1.9, '#101014', tv.x, 1.32, tv.z);
  });
  quad(1.5, 0.9, signTexture(['WORLDS', 'gym · fry house'],
    { bg: '#101014', fg: '#7BE08A' }), tv.x - 0.32, 1.28, tv.z, -Math.PI / 2);
  blockers.push({ x0: tv.x - 0.35, x1: tv.x + 0.35, z0: tv.z - 0.9, z1: tv.z + 0.9 });

  fixture('floor-lamp', { x: -16.6, z: 19.5, width: 0.42 }, () => {
    solid(0.1, 1.5, 0.1, '#8A8F98', -16.6, 0.75, 19.5);
    solid(0.5, 0.34, 0.5, '#F2E4C0', -16.6, 1.65, 19.5);
  });
  solids.push({ x: -16.6, z: 19.5, r: 0.3 });

  fixture('bookcase', { x: -12.6, z: 20.4, width: 1.1, rotY: Math.PI }, () => {
    solid(1.1, 1.8, 0.36, '#4A3524', -12.6, 0.9, 20.4);
  });
  fixture('books', { x: -12.6, z: 20.4, width: 0.8, y: 1.15, rotY: Math.PI }, () => {
    for (let i = 0; i < 4; i++) {
      solid(0.14, 0.42, 0.3, ['#E8232B', '#FFE500', '#2F8F45', '#6B4BC4'][i],
        -13.0 + i * 0.2, 1.36, 20.4);
    }
  });
  fixture('radio', { x: -12.6, z: 20.3, width: 0.34, y: 1.82, rotY: Math.PI }, () => {
    solid(0.34, 0.2, 0.2, '#3A3A40', -12.6, 1.9, 20.3);
  });
  blockers.push({ x0: -13.2, x1: -12.0, z0: 20.1, z1: 20.7 });

  for (const [px, pz, name, pw] of [[-12.4, 18.8, 'potted-plant', 0.6],
                                    [-19.9, 13.1, 'plant-small', 0.36]]) {
    fixture(name, { x: px, z: pz, width: pw }, () => {
      solid(pw * 0.7, 0.3, pw * 0.7, '#B06A3A', px, 0.15, pz);
      solid(pw * 0.9, 0.7, pw * 0.9, '#2F8F45', px, 0.62, pz);
    });
    solids.push({ x: px, z: pz, r: pw * 0.4 });
  }

  // --- the kitchen along the back wall -------------------------------------
  // A run of units, then the tall things at the end. Worktop height is 0.9,
  // which is what the wall cupboards and the extractor hang off.
  const KZ = back - 0.55;
  const units = [
    ['kitchen-cabinet', -19.2, 0.9], ['kitchen-sink', -18.2, 0.9],
    ['kitchen-cabinet', -17.2, 0.9], ['stove', -16.2, 0.9],
  ];
  for (const [name, ux, uw] of units) {
    fixture(name, { x: ux, z: KZ, width: uw, rotY: Math.PI }, () => {
      solid(0.95, 0.86, 0.62, '#C9C3B4', ux, 0.43, KZ);
      solid(1.0, 0.06, 0.66, '#8E8578', ux, 0.89, KZ);
    });
  }
  fixture('fridge', { x: -15.0, z: KZ, width: 0.72, rotY: Math.PI }, () => {
    solid(0.75, 1.8, 0.68, '#D8D2C4', -15.0, 0.9, KZ);
    solid(0.05, 0.5, 0.05, '#8A8F98', -15.35, 1.35, KZ - 0.34);
  });
  fixture('microwave', { x: -17.2, z: KZ, width: 0.5, y: 0.92, rotY: Math.PI }, () => {
    solid(0.5, 0.28, 0.36, '#3A3A40', -17.2, 1.06, KZ);
  });
  fixture('coffee-machine', { x: -19.5, z: KZ, width: 0.3, y: 0.92, rotY: Math.PI }, () => {
    solid(0.26, 0.34, 0.26, '#2A2A2E', -19.5, 1.09, KZ);
  });
  fixture('extractor', { x: -16.2, z: KZ, width: 0.8, y: 1.55, rotY: Math.PI }, () => {
    solid(0.85, 0.3, 0.5, '#B9BEC4', -16.2, 1.7, KZ);
  });
  for (const ux of [-19.2, -18.2]) {
    fixture('kitchen-upper', { x: ux, z: back - 0.32, width: 0.9, y: 1.5, rotY: Math.PI }, () => {
      solid(0.95, 0.65, 0.34, '#C9C3B4', ux, 1.82, back - 0.32);
    });
  }
  blockers.push({ x0: -19.8, x1: -14.6, z0: KZ - 0.4, z1: back });

  // --- where he sleeps, front right ----------------------------------------
  const bed = { x: -13.4, z: 14.4 };
  fixture('bed', { x: bed.x, z: bed.z, width: 2.0, rotY: Math.PI / 2 }, () => {
    solid(1.5, 0.45, 2.0, '#4A3524', bed.x, 0.22, bed.z);
    solid(1.4, 0.22, 1.9, '#D8D2C4', bed.x, 0.55, bed.z);
  });
  fixture('pillow', { x: bed.x, z: bed.z - 0.72, width: 0.62, y: 0.5, rotY: Math.PI / 2 }, () => {
    solid(0.9, 0.16, 0.4, '#F2EAD8', bed.x, 0.72, bed.z - 0.72);
  });
  blockers.push({ x0: bed.x - 1.1, x1: bed.x + 1.1, z0: bed.z - 0.85, z1: bed.z + 0.85 });

  fixture('bedside', { x: -13.4, z: 15.9, width: 0.5 }, () => {
    solid(0.48, 0.55, 0.42, '#5A3A24', -13.4, 0.28, 15.9);
  });
  fixture('table-lamp', { x: -13.4, z: 15.9, width: 0.28, y: 0.56 }, () => {
    solid(0.26, 0.34, 0.26, '#F2E4C0', -13.4, 0.73, 15.9);
  });
  solids.push({ x: -13.4, z: 15.9, r: 0.35 });

  // --- the hallway end, and the walls --------------------------------------
  fixture('doormat', { x: x, z: front + 0.7, width: 0.9, solid: false }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), flat('#5A4A3A'));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, front + 0.7);
    scene.add(m);
  });
  fixture('coat-rack', { x: -16.9, z: 13.1, width: 0.45 }, () => {
    solid(0.1, 1.7, 0.1, '#4A3524', -16.9, 0.85, 13.1);
    solid(0.5, 0.08, 0.08, '#4A3524', -16.9, 1.6, 13.1);
  });
  solids.push({ x: -16.9, z: 13.1, r: 0.3 });
  fixture('trashcan', { x: -20.2, z: 20.6, width: 0.42 }, () => {
    solid(0.4, 0.6, 0.4, '#3A3A40', -20.2, 0.3, 20.6);
  });
  solids.push({ x: -20.2, z: 20.6, r: 0.3 });
  fixture('ceiling-fan', { x: -16.0, z: 16.6, width: 1.1, y: h - 0.45, solid: false }, () => {});

  /**
   * KEVIN art on the walls, in frames.
   *
   * The frame model is one mesh with one material, so its canvas cannot be
   * textured through the loader — the art is a quad hung a centimetre proud of
   * it instead, which is how the gym's banners and McKevin's menu boards
   * already work. Off-the-shelf paintings would be the wrong answer in this
   * room anyway; the walls should have his own face on them.
   */
  const art = [
    [-13.0, 1.85, front + 0.17, 0, ['GM', 'no thoughts']],
    [-21.0, 1.85, back - 0.17, Math.PI, ['WAGMI', 'probably']],
    [left + 0.17, 1.9, 15.4, Math.PI / 2, ['NO PAIN', 'ONLY KEVIN']],
    [right - 0.17, 1.9, 19.6, -Math.PI / 2, ['CA', '0x63D7fa…9e284A']],
  ];
  for (const [ax, ay, az, ry, lines] of art) {
    const inward = ry === 0 ? 0.02 : ry === Math.PI ? -0.02 : 0;
    const inwardX = Math.abs(ry) === Math.PI / 2 ? (ry > 0 ? 0.02 : -0.02) : 0;
    fixture('picture-frame', { x: ax + inwardX, z: az + inward, width: 0.92, y: ay, rotY: ry },
      () => {});
    quad(0.78, 0.56, signTexture(lines, { bg: '#1C2E3F', fg: '#FFE500', size: 64 }),
      ax + inwardX * 2.5, ay, az + inward * 2.5, ry);
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
  // The card table is round, so it gets a circle. Everything square got a
  // rectangle above: a circle at sofa width leaves corners you walk through.
  solids.push({ x: t.x, z: t.z, r: 1.15 });

  return { table: t, tv };
}
