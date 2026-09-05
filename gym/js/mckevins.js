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
import { signTexture } from './gear.js';

/** How far the lot runs in front of the shop. */
export const LOT = { z0: 1.6, z1: 17.0, x: 17.0 };

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

  // --- the tarmac and its markings ------------------------------------------
  // The lot is the biggest thing in this world, so it is the thing that decides
  // whether it reads as a car park or as concrete with a shed on it. Bays.
  paint(36, 15.0, '#3A3A40', 0, 9.4);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = side * (7.0 + i * 2.6);
      paint(0.12, 4.8, '#E8E2D4', x, 6.6);
      paint(0.12, 4.8, '#E8E2D4', x, 12.6);
    }
    paint(11.4, 0.12, '#E8E2D4', side * 12.0, 4.2);
    paint(11.4, 0.12, '#E8E2D4', side * 12.0, 9.0);
    paint(11.4, 0.12, '#E8E2D4', side * 12.0, 15.0);
  }
  // The drive-thru lane, down the right and round the back.
  paint(3.4, 15.0, '#4A4A52', 14.6, 8.0);
  for (let i = 0; i < 8; i++) paint(0.16, 0.9, '#FFE500', 14.6, 1.8 + i * 1.9);
  quad(2.6, 1.0, signTexture(['DRIVE THRU', 'ONE WAY'], { bg: '#0B0B0B', fg: '#FFE500', size: 62 }),
    14.6, 2.3, 4.0, Math.PI);
  solid(0.16, 2.3, 0.16, '#5A5A62', 14.6, 1.15, 4.0);

  // --- the pylon sign -------------------------------------------------------
  // Every one of these has one and it is visible before the building is.
  solid(0.7, 8.0, 0.7, '#8A8F98', -13.0, 4.0, 12.0);
  solid(4.6, 3.0, 0.5, '#E8232B', -13.0, 8.6, 12.0);
  quad(4.2, 2.6, signTexture(["McKEVIN'S", 'OPEN LATE'], { bg: '#E8232B', fg: '#FFE500', size: 80 }),
    -13.0, 8.6, 12.27);
  quad(4.2, 2.6, signTexture(["McKEVIN'S", 'OPEN LATE'], { bg: '#E8232B', fg: '#FFE500', size: 80 }),
    -13.0, 8.6, 11.73, Math.PI);
  solid(4.2, 1.1, 0.4, '#FFE500', -13.0, 6.6, 12.0);
  quad(3.9, 0.85, signTexture(['2 FOR 1 FRIES'], { bg: '#FFE500', fg: '#0B0B0B', size: 58 }),
    -13.0, 6.6, 12.22);
  solids.push({ x: -13.0, z: 12.0, r: 0.9 });

  // --- somewhere to sit -----------------------------------------------------
  for (const [tx, tz, ry] of [[-7.4, 3.2, 0.2], [-4.2, 4.4, -0.3], [7.6, 3.4, 0.4]]) {
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
  for (const [lx, lz] of [[-16.0, 6.0], [-16.0, 14.0], [16.5, 14.0], [0, 16.2]]) {
    solid(0.26, 6.0, 0.26, '#4A4A52', lx, 3.0, lz);
    solid(1.4, 0.2, 0.5, '#4A4A52', lx, 5.9, lz);
    solid(1.1, 0.26, 0.42, '#FFF0B8', lx, 5.74, lz);
    solids.push({ x: lx, z: lz, r: 0.45 });
  }
  for (const [bx, bz] of [[-5.6, 1.9], [6.0, 1.9], [-11.0, 5.0]]) {
    solid(0.8, 1.1, 0.8, '#3A3A40', bx, 0.55, bz);
    solid(0.9, 0.14, 0.9, '#E8232B', bx, 1.17, bz);
    solids.push({ x: bx, z: bz, r: 0.5 });
  }
  for (const [cx, cz, r] of [[-2.4, 2.6, 0.5], [3.1, 2.2, -0.8], [-8.8, 6.4, 1.2],
                             [9.4, 7.0, 0.3], [-1.2, 8.8, 2.0]]) {
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
  car(-8.3, 6.6, '#2F6FB0');
  car(-13.5, 12.6, '#D8D2C4');
  car(9.6, 12.6, '#7A3F9E');
  car(12.2, 6.6, '#2F8F45');

  // --- the edge of the world ------------------------------------------------
  solid(40, 0.3, 0.7, '#B4B0A8', 0, 0.15, LOT.z1 + 0.9);            // kerb
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), flat('#4E8A3C'));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0.02, LOT.z1 + 11);
  scene.add(grass);
  blockers.push({ x0: -20, x1: 20, z0: LOT.z1 + 0.6, z1: LOT.z1 + 1.4 });
}
