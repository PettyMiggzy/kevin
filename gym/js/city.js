// Everything outside the gym that is not the gym.
//
// Three jobs, one file, because they share a horizon: a skyline so the sky
// stops being a flat blue wall, a market so the forecourt has somewhere to
// spend, and the fry house so there is somewhere to earn.
//
// All of it is boxes and painted quads. Nothing here is a downloaded model:
// these are backdrop and furniture, seen from a few metres or forty, and a
// modelled version would cost megabytes to look the same at this distance.
import * as THREE from 'three';
import {
  awningTexture, stallTexture, fryHouseTexture, menuTexture, windowsTexture, leaderTexture,
} from './gear.js';

/**
 * Where the forecourt's furniture sits. Exported because main.js needs the
 * same numbers for collision, for the walk-up prompts, and for deciding where
 * a customer queues — three copies of a coordinate is three chances to drift.
 */
export const MARKET = [
  { id: 'supplements', x: -10.6, z: 15.4, title: 'SUPPS', sub: 'GAINS, BOTTLED', bg: '#0B0B0B', fg: '#FFE500', awning: ['#E8232B', '#FFF6C8'] },
  { id: 'crew', x: -6.6, z: 15.4, title: "KEVIN'S CREW", sub: '32x32, ON CHAIN', bg: '#1B1030', fg: '#9E7BFF', awning: ['#6B4BC4', '#FFF6C8'] },
  { id: 'produce', x: -2.6, z: 15.4, title: 'FRESH', sub: 'MOSTLY', bg: '#123B1F', fg: '#7BE08A', awning: ['#2F8F45', '#FFF6C8'] },
];

/** The fry house, and the counter you clock in at. */
// Turned to face the camera.
//
// It used to sit at the far end of the gym's forecourt with its serving side
// pointing AWAY from the player's side of the street, which was invisible while
// the shift had its own locked-off camera and became the whole view the moment
// McKevin's was its own world: the chase camera sits behind the player, so it
// was looking at the back of a beige box. The building is at low z now with its
// front at high z, exactly like the gym, so you walk up to it and see a shop.
// A restaurant, not a serving hatch.
//
// It was a 9.6 x 5.6 box with a window in it, which was the right size for a
// prop on the gym's street and far too small for what it is now: somewhere
// people work a shift, behind a counter, serving a queue, with a dining room
// they walk through to get there. 24 x 16 is a real one.
export const FRY = { x: 0, z: -1.0, w: 24, d: 16, h: 4.2, counterZ: -0.5 };

/** Where customers stand while they wait. First in the list is being served. */
export const QUEUE = [
  // Inside now, on the customer's side of the counter. A line receding from it
  // rather than a huddle, so the camera can see past whoever is being served to
  // whoever is next.
  { x: -2.0, z: 1.4 }, { x: -3.2, z: 2.6 }, { x: -1.4, z: 3.6 }, { x: -3.0, z: 4.8 },
];

/**
 * @param parts  which of the three pieces to build. They live in one file
 *               because they share a horizon, but they no longer share a world:
 *               the gym takes the skyline and the market, the fry house takes
 *               the skyline and itself. Building all of it everywhere is what
 *               the world split exists to stop.
 */
export function buildCity(scene, { flat, solids, blockers },
                          parts = { skyline: true, market: true }) {
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

  if (parts.skyline) buildSkyline(solid);
  const stalls = parts.market ? MARKET.map((s) => buildStall(s, { solid, quad, solids })) : [];
  // The fry house used to be a unit on this street with a service window. It is
  // McKevin's now — its own world, with an interior you work a shift inside —
  // so buildFryHouse and the `fry` part are gone rather than left switched off.
  // Both callers already passed fry:false; the DEFAULT still said true, so
  // buildCity(scene, ctx) with no parts would have built a second fry house
  // inside the gym. Dead code that was also a trap.
  //
  // The old return carried a `counter` alongside the stalls and neither caller
  // ever read either, so it returns the stalls and nothing else.
  return { stalls };
}

/**
 * A ring of blocks around the whole scene.
 *
 * Fog runs 44 to 88, so anything past the far edge dissolves into the sky
 * colour on its own — which is why the ring can be this cheap and still read
 * as distance rather than as a wall of boxes.
 */
function buildSkyline(solid) {
  const walls = ['#6E6A78', '#7A6E68', '#5F6B78', '#75707F', '#6A7268'];
  const N = 46;
  for (let i = 0; i < N; i++) {
    // Deterministic: the skyline is the same every visit, so it reads as a
    // place rather than as noise regenerated on each load.
    const t = i / N;
    const a = t * Math.PI * 2 + 0.17;
    const r = 33 + ((i * 7919) % 17);
    const h = 6 + ((i * 6151) % 19);
    const w = 5 + ((i * 3571) % 7);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r + 12;          // the yard sits forward of origin
    solid(w, h, w, '#FFFFFF', x, h / 2, z,
      windowsTexture(walls[i % walls.length], i % 3 ? '#FFE9A8' : '#BFD8FF', i + 1), a);
    // A roof cap, so the tops are not all one flat line.
    if (i % 3 === 0) solid(w * 0.4, 1.6, w * 0.4, '#4A4A54', x, h + 0.8, z, null, a);
  }
}

/** One market stall: counter, striped awning on posts, and a header board. */
function buildStall(s, { solid, quad, solids }) {
  const g = { ...s };
  const W = 3.0;
  // Counter. Waist height, so the player reads as standing at it rather than
  // behind it.
  solid(W, 1.05, 0.9, '#8A6A46', s.x, 0.52, s.z);
  solid(W + 0.2, 0.12, 1.1, '#B98F5F', s.x, 1.11, s.z);
  // Posts and awning.
  solid(0.14, 2.6, 0.14, '#6B5B41', s.x - W / 2, 1.3, s.z + 0.1);
  solid(0.14, 2.6, 0.14, '#6B5B41', s.x + W / 2, 1.3, s.z + 0.1);
  const awn = solid(W + 0.6, 0.12, 1.7, '#FFFFFF', s.x, 2.62, s.z - 0.45,
    awningTexture(s.awning[0], s.awning[1]));
  awn.rotation.x = -0.22;
  // Header board, facing the gym — that is the direction everybody arrives from.
  quad(W + 0.4, 0.86, stallTexture(s.title, s.sub, s.bg, s.fg), s.x, 3.15, s.z - 0.35, Math.PI);
  // Crates, so the stall has stock rather than an empty counter.
  solid(0.6, 0.5, 0.6, '#7A5C3A', s.x - 1.0, 0.25, s.z + 0.85);
  solid(0.55, 0.45, 0.55, '#8A6A46', s.x + 0.9, 0.22, s.z + 0.9);

  // One circle for the whole stall. You walk up to the front of it; the
  // interaction radius in main.js is wider than this, so the prompt appears
  // before you are stopped by the counter.
  solids.push({ x: s.x, z: s.z + 0.1, r: 1.5 });
  return g;
}



/**
 * The board on the gym's back wall.
 *
 * Returns the mesh so main.js can swap its texture when the numbers move —
 * redrawing a canvas is cheap, rebuilding a mesh every set is not.
 */
export function buildLeaderboard(scene, { flat }) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(5.0, 3.33),
    flat('#FFFFFF', leaderTexture([], { note: '' }))
  );
  m.position.set(0, 3.15, -6.86);
  scene.add(m);
  // A frame, so it is mounted rather than floating.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.3, 3.63, 0.12), flat('#2A2A32'));
  frame.position.set(0, 3.15, -6.94);
  scene.add(frame);
  return m;
}

/** Repaint the board. Rows are `{ name, score, you }`. */
export function paintLeaderboard(mesh, rows, opts) {
  mesh.material.map?.dispose();
  mesh.material.map = leaderTexture(rows, opts);
  mesh.material.needsUpdate = true;
}
