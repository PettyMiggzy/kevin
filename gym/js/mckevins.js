// The forecourt at McKevin's.
//
// The fry house itself lives in city.js, because it started life as a prop on
// the gym's street. Now that it is its own world it needs the rest of a fast
// food place around it: somewhere to park, somewhere to sit, a sign you can see
// from the road, and enough litter to look open.
//
// All boxes and painted quads, same as everything else out here. This is set
// dressing seen from a few metres by a chase camera; a modelled version costs
// megabytes to look identical.
import * as THREE from 'three';
import { FRY } from './city.js';
import { signTexture, menuTexture, fryHouseTexture } from './gear.js';

/** How far the lot runs in front of the shop. */
export const LOT = { z0: 8.0, z1: 26.0, x: 20.0 };

/**
 * The restaurant itself: kitchen, counter, dining room.
 *
 * It used to be a box with a service window, which is fine for a prop on
 * somebody else's street and useless for the thing this actually is — a place
 * people work a shift in, behind a counter, serving a queue that walks in
 * through the door and sits down. So it is a building you go inside.
 *
 * Open-topped and cut down at the front for the same reason the gym is: the
 * chase camera looks down over the near wall, and a lid or a full-height front
 * puts you behind your own workplace.
 */
export function buildShop(scene, { flat, solids, blockers }) {
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

  const { x: cx, z: cz, w, d, h, counterZ } = FRY;
  const left = cx - w / 2, right = cx + w / 2;
  const back = cz - d / 2, front = cz + d / 2;
  const FRONT_H = 1.5;                       // dollhouse cut, as in the crib
  const DOOR = { x0: 4.0, x1: 7.5 };         // the way in, on the right of the front

  // --- floor -----------------------------------------------------------------
  paint(w, d, '#C9C3B4', cx, cz, 0.012);                       // tiled floor
  paint(w - 0.6, 7.0, '#8E8578', cx, back + 3.6, 0.016);        // kitchen: darker, non-slip
  for (let i = 0; i < 12; i++) paint(w - 0.6, 0.06, '#B4AC9E', cx, back + 0.4 + i * 0.62, 0.02);
  paint(15.0, 7.6, '#B03A32', cx - 3.0, front - 4.2, 0.016);    // dining: red

  // --- shell -----------------------------------------------------------------
  solid(w, h, 0.3, '#E8DFD0', cx, h / 2, back);
  solid(0.3, h, d, '#E8DFD0', left, h / 2, cz);
  solid(0.3, h, d, '#E8DFD0', right, h / 2, cz);
  const lw = DOOR.x0 - left, rw = right - DOOR.x1;
  solid(lw, FRONT_H, 0.3, '#E8DFD0', left + lw / 2, FRONT_H / 2, front);
  solid(rw, FRONT_H, 0.3, '#E8DFD0', right - rw / 2, FRONT_H / 2, front);
  // Glazing above the low front, so it reads as a shopfront rather than a wall.
  for (let i = 0; i < 7; i++) {
    solid(0.16, 2.2, 0.16, '#8A8F98', left + 1.4 + i * 2.4, FRONT_H + 1.1, front);
  }
  solid(w, 0.3, 0.4, '#C7382F', cx, FRONT_H + 2.35, front);
  solid(w + 0.6, 0.34, d + 0.6, '#C7382F', cx, h + 0.17, cz);   // roof edge

  // --- fascia, outside ------------------------------------------------------
  solid(w * 0.8, 2.4, 0.3, '#E8232B', cx, h + 1.2, front - 0.1);
  quad(w * 0.78, 2.2, fryHouseTexture(), cx, h + 1.2, front + 0.08);

  // --- the counter, which is the whole point --------------------------------
  // Staff behind (low z), customers in front (high z).
  const CL = -10.0, CR = 5.0;
  solid(CR - CL, 1.12, 0.9, '#C7382F', (CL + CR) / 2, 0.56, counterZ);
  solid(CR - CL + 0.2, 0.12, 1.1, '#2A2A2E', (CL + CR) / 2, 1.18, counterZ);
  for (let i = 0; i < 3; i++) {                                 // tills
    solid(0.7, 0.5, 0.5, '#3A3A42', CL + 2.2 + i * 4.4, 1.42, counterZ - 0.1);
    solid(0.62, 0.34, 0.06, '#7BE08A', CL + 2.2 + i * 4.4, 1.5, counterZ + 0.16);
  }
  // Menu boards over the counter, which is where you actually read them.
  for (let i = 0; i < 3; i++) {
    quad(3.4, 1.5, menuTexture(), CL + 2.4 + i * 4.6, 2.9, counterZ - 0.6);
  }
  solid(CR - CL + 0.4, 0.3, 0.3, '#2A2A2E', (CL + CR) / 2, 3.75, counterZ - 0.6);
  blockers.push({ x0: CL - 0.2, x1: CR + 0.2, z0: counterZ - 0.6, z1: counterZ + 0.6 });

  // --- kitchen, behind the counter ------------------------------------------
  const gear = (gx, label, colour) => {
    solid(1.7, 1.0, 1.1, '#B9BEC4', gx, 0.5, back + 1.1);       // unit
    solid(1.75, 0.1, 1.15, colour, gx, 1.05, back + 1.1);       // top
    blockers.push({ x0: gx - 0.95, x1: gx + 0.95, z0: back + 0.5, z1: back + 1.7 });
    return label;
  };
  gear(-9.0, 'grill', '#4A4A52');
  gear(-6.6, 'fryer', '#FFC64A');
  gear(-4.2, 'fryer', '#FFC64A');
  gear(-1.8, 'prep', '#D8D2C4');
  gear(0.6, 'shakes', '#E8E2D4');
  // Fry baskets hanging over the fryers, and a heat lamp over the pass.
  for (const bx of [-6.9, -6.3, -4.5, -3.9]) {
    solid(0.34, 0.5, 0.34, '#8A8F98', bx, 1.4, back + 1.1);
  }
  solid(9.0, 0.16, 0.5, '#C7382F', -4.0, 2.5, counterZ - 1.6);
  solid(8.6, 0.1, 0.4, '#FFC64A', -4.0, 2.4, counterZ - 1.6);
  // Shelving down the back, and a walk-in at the end.
  for (let i = 0; i < 3; i++) solid(6.0, 0.1, 0.5, '#9AA0A6', 6.0, 1.0 + i * 0.7, back + 0.4);
  solid(3.0, 2.4, 1.6, '#B9BEC4', 9.8, 1.2, back + 1.0);
  blockers.push({ x0: 8.3, x1: 11.3, z0: back + 0.2, z1: back + 1.8 });

  // --- dining room ----------------------------------------------------------
  for (const [tx, tz] of [[-8.4, 2.6], [-8.4, 5.4], [-4.2, 2.6], [-4.2, 5.4], [0.2, 5.4]]) {
    solid(1.5, 0.1, 1.5, '#D8D2C4', tx, 0.76, tz);
    solid(0.28, 0.74, 0.28, '#8A8F98', tx, 0.38, tz);
    for (const s of [-1, 1]) {
      solid(1.5, 0.12, 0.42, '#B8342C', tx, 0.46, tz + s * 0.95);
      solid(1.5, 0.7, 0.14, '#B8342C', tx, 0.8, tz + s * 1.15);
    }
    solids.push({ x: tx, z: tz, r: 1.1 });
  }
  // Tray stack, bin, and the sauce station every one of these has.
  solid(0.8, 1.0, 0.7, '#3A3A40', 3.4, 0.5, 4.4);
  solid(1.6, 1.0, 0.7, '#D8D2C4', 3.4, 0.5, 2.2);
  for (let i = 0; i < 4; i++) solid(1.3, 0.06, 0.5, '#C7382F', 3.4, 1.06 + i * 0.07, 2.2);
  blockers.push({ x0: 2.5, x1: 4.3, z0: 1.7, z1: 4.9 });

  // --- drive-thru window on the side wall -----------------------------------
  solid(0.24, 1.4, 2.0, '#1A1A20', right - 0.1, 1.9, -4.0);
  quad(1.6, 0.6, signTexture(['DRIVE THRU'], { bg: '#0B0B0B', fg: '#FFE500', size: 54 }),
    right - 0.24, 3.0, -4.0, -Math.PI / 2);

  return { counterZ, staffZ: counterZ - 1.4 };
}

export function buildMcKevins(scene, { flat, solids, blockers }) {
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

  // --- the shell ------------------------------------------------------------
  // A real restaurant's geometry, stripped of every texture it came with. The
  // shape of a fast-food building is not anybody's; the paint on it is, and all
  // of the paint here is ours.
  //
  // Placed by main.js as a prop so it goes through the same normalise() as the
  // gym equipment.

  // --- the tarmac and its markings ------------------------------------------
  // The lot is the biggest thing in this world, so it is the thing that decides
  // whether it reads as a car park or as concrete with a shed on it. Bays.
  paint(44, 17.0, '#3A3A40', 0, 16.5);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = side * (8.0 + i * 2.6);
      paint(0.12, 4.8, '#E8E2D4', x, 12.4);
      paint(0.12, 4.8, '#E8E2D4', x, 20.4);
    }
    paint(11.4, 0.12, '#E8E2D4', side * 13.0, 10.0);
    paint(11.4, 0.12, '#E8E2D4', side * 13.0, 14.8);
    paint(11.4, 0.12, '#E8E2D4', side * 13.0, 22.8);
  }
  // The drive-thru lane, down the right and round the back.
  paint(3.4, 24.0, '#4A4A52', 17.5, 4.0);
  for (let i = 0; i < 12; i++) paint(0.16, 0.9, '#FFE500', 17.5, -6.0 + i * 1.9);
  quad(2.6, 1.0, signTexture(['DRIVE THRU', 'ONE WAY'], { bg: '#0B0B0B', fg: '#FFE500', size: 62 }),
    17.5, 2.3, 14.0, Math.PI);
  solid(0.16, 2.3, 0.16, '#5A5A62', 17.5, 1.15, 14.0);

  // --- the pylon sign -------------------------------------------------------
  // Every one of these has one and it is visible before the building is.
  solid(0.7, 8.0, 0.7, '#8A8F98', -16.5, 4.0, 19.0);
  solid(4.6, 3.0, 0.5, '#E8232B', -16.5, 8.6, 19.0);
  quad(4.2, 2.6, signTexture(["McKEVIN'S", 'OPEN LATE'], { bg: '#E8232B', fg: '#FFE500', size: 80 }),
    -16.5, 8.6, 19.27);
  quad(4.2, 2.6, signTexture(["McKEVIN'S", 'OPEN LATE'], { bg: '#E8232B', fg: '#FFE500', size: 80 }),
    -16.5, 8.6, 18.73, Math.PI);
  solid(4.2, 1.1, 0.4, '#FFE500', -16.5, 6.6, 19.0);
  quad(3.9, 0.85, signTexture(['2 FOR 1 FRIES'], { bg: '#FFE500', fg: '#0B0B0B', size: 58 }),
    -16.5, 6.6, 19.22);
  solids.push({ x: -16.5, z: 19.0, r: 0.9 });

  // --- somewhere to sit -----------------------------------------------------
  for (const [tx, tz, ry] of [[-11.0, 10.4, 0.2], [11.0, 10.4, -0.3], [0.0, 24.0, 0.4]]) {
    solid(2.2, 0.14, 1.1, '#C7382F', tx, 0.74, tz, null, ry);       // table top
    solid(0.16, 0.72, 0.9, '#8A8F98', tx - 0.9, 0.36, tz, null, ry);
    solid(0.16, 0.72, 0.9, '#8A8F98', tx + 0.9, 0.36, tz, null, ry);
    for (const s of [-1, 1]) {                                       // benches
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.4), flat('#B8342C'));
      b.position.set(tx + Math.sin(ry) * s * 0.85, 0.44, tz + Math.cos(ry) * s * 0.85);
      b.rotation.y = ry;
      scene.add(b);
    }
    // A parasol, because the tables are the only tall thing on this side.
    solid(0.12, 2.2, 0.12, '#8A8F98', tx, 1.1, tz);
    solid(2.6, 0.16, 2.6, '#FFE500', tx, 2.25, tz, null, ry);
    solids.push({ x: tx, z: tz, r: 1.4 });
  }

  // --- lamp posts, bins, and the litter that says it is open ----------------
  for (const [lx, lz] of [[-19.5, 12.0], [-19.5, 22.0], [20.0, 22.0], [0, 25.4]]) {
    solid(0.26, 6.0, 0.26, '#4A4A52', lx, 3.0, lz);
    solid(1.4, 0.2, 0.5, '#4A4A52', lx, 5.9, lz);
    solid(1.1, 0.26, 0.42, '#FFF0B8', lx, 5.74, lz);
    solids.push({ x: lx, z: lz, r: 0.45 });
  }
  for (const [bx, bz] of [[-9.0, 9.2], [9.0, 9.2], [-14.0, 15.0]]) {
    solid(0.8, 1.1, 0.8, '#3A3A40', bx, 0.55, bz);
    solid(0.9, 0.14, 0.9, '#E8232B', bx, 1.17, bz);
    solids.push({ x: bx, z: bz, r: 0.5 });
  }
  for (const [cx, cz, r] of [[-2.4, 10.6, 0.5], [3.1, 11.2, -0.8], [-8.8, 15.4, 1.2],
                             [9.4, 16.0, 0.3], [-1.2, 20.8, 2.0]]) {
    solid(0.34, 0.06, 0.3, '#F2EAD8', cx, 0.04, cz, null, r);        // dropped carton
  }

  // --- parked cars ----------------------------------------------------------
  // Two boxes and a roof each. At this distance a modelled car is a modelled
  // car nobody looks at; what matters is that the bays are not all empty.
  const car = (cx, cz, colour, ry = 0) => {
    solid(2.0, 0.75, 4.2, colour, cx, 0.5, cz, null, ry);
    solid(1.8, 0.66, 2.2, '#2A2E38', cx, 1.16, cz - 0.2, null, ry);
    for (const [wx, wz] of [[-0.95, -1.4], [0.95, -1.4], [-0.95, 1.4], [0.95, 1.4]]) {
      solid(0.24, 0.56, 0.56, '#1A1A1E', cx + wx, 0.28, cz + wz, null, ry);
    }
    blockers.push({ x0: cx - 1.2, x1: cx + 1.2, z0: cz - 2.3, z1: cz + 2.3 });
  };
  car(-9.3, 12.4, '#2F6FB0');
  car(-14.5, 20.4, '#D8D2C4');
  car(10.6, 20.4, '#7A3F9E');
  car(13.2, 12.4, '#2F8F45');

  // --- the edge of the world ------------------------------------------------
  solid(48, 0.3, 0.7, '#B4B0A8', 0, 0.15, LOT.z1 + 0.9);            // kerb
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(48, 20), flat('#4E8A3C'));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0.02, LOT.z1 + 11);
  scene.add(grass);
  blockers.push({ x0: -24, x1: 24, z0: LOT.z1 + 0.6, z1: LOT.z1 + 1.4 });
}
