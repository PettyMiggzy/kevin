// KEVIN'S GYM — one room, three stations, and a body that shrinks if you stop.
//
// three.js, pinned and vendored. No React, no physics engine, no WASM. For one
// room that is all overhead, and WASM threading needs COOP/COEP headers that
// would block Telegram's own SDK later.
//
// The look is two techniques, both shipping in three.js already:
//   * flat colour  — MeshToonMaterial with an explicit 3-step gradientMap on
//                    NearestFilter. Leave gradientMap null and three falls back
//                    to a soft 70%-100% ramp, which is washed out and is the
//                    single most common reason people decide toon shading in
//                    three.js looks bad.
//   * black line   — OutlineEffect, an inverted hull with constant screen-space
//                    thickness, so the line reads the same weight near and far.
// No post-processing: any pass silently disables free hardware AA on mobile.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { load, save, settle, workout, projectedLoss, payShift, leaderboard,
  DECAY_PER_DAY, DAILY_GOAL } from './save.js';
import { buildCrewBody, applyCrewMuscle } from './voxel.js';
import { buildKitKevin } from './kevin.js';
import { buildSpriteKevin } from './sprite.js';
import { skinTexture, SKINS, DEFAULT_SKIN, CONTRACT, CONTRACT_SKINS } from './skins.js';
import { rebrand } from './brand.js';
import { Set as RepSet, REPS_PER_SET, rankOf } from './reps.js';
import { makeBarbell, makeDumbbell, floorTexture, platformTexture, signTexture, mirrorPanel, stripLight,
  skyTexture, concreteTexture, facadeTexture, bannerTexture, billboardTexture, boardTexture } from './gear.js';
import { play, setMuted, isMuted } from './audio.js';
import { buildCity, buildLeaderboard, paintLeaderboard, MARKET, FRY, QUEUE } from './city.js';
import { buildCrib, CRIB, CRIB_PROPS } from './crib.js';
import { buildMcKevins, buildShop, LOT, SHOP_PROPS } from './mckevins.js';
import { disposeWorld, captureInto } from './worlds.js';
import { Shift, ITEMS, SHIFT_LENGTH } from './job.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// --- the look ---------------------------------------------------------------

/** Three hard bands. Two or three pixels, nearest-sampled — that is the whole trick. */
function toonRamp() {
  const t = new THREE.DataTexture(
    new Uint8Array([90, 90, 90, 255, 200, 200, 200, 255, 255, 255, 255, 255]),
    3, 1, THREE.RGBAFormat
  );
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
const RAMP = toonRamp();

const PALETTE = {
  floor: '#C9BFAE',
  wall: '#EBD9A8',
  trim: '#E8232B',
  mat: '#2F6F4A',
  skin: '#E8232B',
  cream: '#FFF6C8',
  ink: '#0B0B0B',
};

const toon = (color, opts = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...opts });

/**
 * Scenery material: toon-shaded but with no outline.
 *
 * Buildings and backdrop get no black line — an inverted hull on a forty-metre
 * box draws a stripe you can see from across the yard. buildRoom and
 * buildExterior each kept a private copy of this; city.js needs the same one,
 * so there is one.
 */
const flatMat = (color, map = null) => {
  const m = toon(color, map ? { map } : {});
  m.userData.outlineParameters = { visible: false };
  return m;
};

/**
 * Tripo hands back photoreal PBR. Left alone, twelve models from twelve prompts
 * read as an asset flip — this is the pass that makes them read as one hand.
 * Keep each material's base colour, throw away everything else that says
 * "renderer": metalness, roughness, normal and env maps, and the map itself.
 */
function normalise(root, { outline = true, palette = null } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    // A prop authored rather than downloaded may carry its whole palette in
    // COLOR_0 with no material at all — which is how the card table, the
    // chandelier and the roulette wheel are built. Flattening those to one base
    // colour throws the entire model away: they came out uniformly black,
    // because with no material there is no colour to read and the ramp floors
    // at its darkest band. Painted geometry keeps a white base and lets the
    // vertex colours through, exactly as the crew bodies already do.
    // Geometry authored by hand can arrive with POSITION and COLOR_0 and
    // nothing else. Missing normals are not a cosmetic problem here: the toon
    // ramp has no surface direction to sample so it floors at its darkest
    // band, and OutlineEffect cannot push its hull outward so the hull lands
    // exactly on the surface. Between them the prop renders as a black
    // silhouette — which is what the card table, chandelier and roulette wheel
    // all did until this line existed.
    if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    const painted = !!o.geometry?.attributes?.color;
    let base = painted ? new THREE.Color('#FFFFFF')
      : src?.color ? src.color.clone() : new THREE.Color('#B9B2A6');
    // A world can ask for a bought kit in its own colours. Only the crib does,
    // because the gym and the fry house were furnished from a pack whose look
    // already suits them — see brand.js for why eleven colours is the whole job.
    if (palette && !painted) base = palette(base) ?? base;
    // Tripo's albedo often bakes in lighting, which fights a flat ramp. Push
    // the colour up and desaturate slightly so the bands stay readable.
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    base.setHSL(hsl.h, Math.min(0.85, hsl.s * 0.9), clamp(hsl.l * 1.15 + 0.06, 0.16, 0.92));
    const m = toon(base, painted ? { vertexColors: true } : undefined);
    m.map = src?.map ?? null;                       // keep the texture, drop the shading
    m.userData.outlineParameters = outline
      ? { thickness: 0.008, color: [0, 0, 0], alpha: 1 }
      : { visible: false };
    o.material = m;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return root;
}

/** Drop a loaded model onto the floor at a given footprint width, facing a way. */
/**
 * Stand a prop on the floor at x,z.
 *
 * `width` rescales it so its footprint is that many metres, which is right for
 * generated props: Tripo hands back a bench and a kettlebell at the same size
 * and something has to decide which is which.
 *
 * `natural` skips that. A modelled kit is authored in metres and internally
 * consistent — this pack's fridge is 1.95m, its counter 0.80m, its lamp post
 * 3.61m — and rescaling each prop to a footprint throws that away: a cooker
 * hob and a fridge both become 1.7m wide, so the hob turns into furniture and
 * the kitchen ends up knee-high. When the kit already knows how big its things
 * are, believe it.
 */
function place(obj, { x = 0, z = 0, width = 1, rotY = 0, natural = false }) {
  if (!natural) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    obj.scale.setScalar(width / Math.max(size.x, size.z));
  }
  // ROTATE BEFORE MEASURING. rotation.y turns the object about its own origin,
  // and a model whose origin is not its bounding-box centre swings a long way
  // when it does — so centring first and rotating after leaves the prop
  // somewhere else entirely. That is how the crib's kitchen units landed at
  // z 21.06 and 22.70 instead of 21.75, one of them inside the back wall, under
  // a worktop left hanging over nothing.
  //
  // Measuring after the turn also makes `width` the footprint of the prop AS
  // PLACED, which is the only reading of it that survives a ninety-degree turn.
  obj.rotation.y = rotY;
  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c = box2.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, -box2.min.y, z - c.z);
  return obj;
}

// --- the room ---------------------------------------------------------------

// A real gym, not a single room. Now that it is its own world and pays for
// nothing else, it can afford the floor: roughly three times the area it had,
// which is what makes room for a reception, a supplement counter, a water
// station and a proper free-weights end instead of everything in one huddle.
const ROOM = { w: 32, d: 24, h: 5.0 };

function buildRoom(scene) {
  const flat = (color, map = null) => {
    const m = toon(color, map ? { map } : {});
    m.userData.outlineParameters = { visible: false };  // outlining the room makes a cage
    return m;
  };
  const plain = (color) => {
    const m = toon(color);
    m.userData.outlineParameters = { visible: false };
    return m;
  };
  const box = (w, h, d, colour, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plain(colour));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
    return m;
  };
  /** A flat panel lying on the floor. Zones are painted, not modelled. */
  const zone = (w, d, colour, x, z, y = 0.02, map = null) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat(colour, map));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // Rubber tile rather than a flat fill. A painted floor does more for "this is
  // a gym" than another rack would, for one texture instead of a draw call.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    flat('#FFFFFF', floorTexture())
  );
  floor.rotation.x = -Math.PI / 2;
  // Lifted off zero. The forecourt out front is a big plane that passes
  // underneath this entire room, and two surfaces at exactly y=0 fight for the
  // depth buffer and tear as the camera moves. A few millimetres settles it.
  floor.position.y = 0.008;
  scene.add(floor);

  // --- zones ----------------------------------------------------------------
  // The single biggest thing that makes a gym read as a gym rather than a shed
  // with equipment in it: the floor tells you what happens where. All of it is
  // painted quads a few millimetres apart, which costs a handful of draw calls
  // and does more than any number of extra props.
  // A lifting platform is wood between rubber bumpers, which is also the only
  // warm surface in the room and the reason the weights end reads as the
  // weights end from across the floor.
  zone(11.4, 7.4, '#241C16', -8.0, -8.0, 0.018);                      // rubber surround
  zone(9.4, 5.6, '#9A6A38', -8.0, -8.0, 0.022);                       // the wood
  for (let i = 0; i < 9; i++) {                                        // planks
    zone(9.4, 0.05, '#7A5028', -8.0, -10.6 + i * 0.62, 0.026);
  }
  zone(7.0, 12.0, PALETTE.mat, 3.4, 1.0, 0.022);                      // turf lane
  for (let i = 0; i < 11; i++) {                                       // its metre marks
    zone(0.5, 0.09, '#DCEFD8', 3.4, -4.6 + i * 1.1, 0.026);
  }
  zone(8.0, 6.0, '#2A2A32', 12.0, -4.0, 0.02);                        // cardio deck
  zone(7.2, 5.2, '#3A3A46', -12.4, 4.8, 0.02);                        // changing end
  // Lane edging in brand yellow, so the zones have an outline like everything
  // else in this world does.
  for (const [w, d, x, z] of [[11.4, 0.14, -8.0, -11.75], [11.4, 0.14, -8.0, -4.25],
                              [0.14, 12.0, -0.1, 1.0], [0.14, 12.0, 6.9, 1.0]]) {
    zone(w, d, PALETTE.trim, x, z, 0.028);
  }

  // --- walls ----------------------------------------------------------------
  // Two-tone, not one flat colour. A dado rail's worth of dark below the brand
  // band gives every wall a horizon, which is what stops a big room reading as
  // a big empty room.
  const DADO = 1.9;
  const wall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plain(PALETTE.wall));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
    const lower = new THREE.Mesh(new THREE.PlaneGeometry(w, DADO), plain('#4A4550'));
    lower.position.set(x, DADO / 2, z);
    lower.rotation.y = ry;
    lower.translateZ(0.015);
    scene.add(lower);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.34), plain(PALETTE.trim));
    band.position.set(x, DADO + 0.17, z);
    band.rotation.y = ry;
    band.translateZ(0.03);
    scene.add(band);
    // Skirting, so the wall meets the floor instead of just ending.
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.22), plain('#26262C'));
    skirt.position.set(x, 0.11, z);
    skirt.rotation.y = ry;
    skirt.translateZ(0.04);
    scene.add(skirt);
  };
  wall(ROOM.w, ROOM.h, 0, ROOM.h / 2, -ROOM.d / 2, 0);
  wall(ROOM.d, ROOM.h, -ROOM.w / 2, ROOM.h / 2, 0, Math.PI / 2);
  wall(ROOM.d, ROOM.h, ROOM.w / 2, ROOM.h / 2, 0, -Math.PI / 2);

  // --- ceiling and the truss ------------------------------------------------
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), plain('#2B2B33'));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  scene.add(ceil);

  // Exposed steel. A dark ceiling with structure in it reads as an industrial
  // unit; a flat pale lid reads as an office, which is what this was.
  for (let i = 0; i < 5; i++) {
    const z = -9.6 + i * 4.8;
    box(ROOM.w - 0.4, 0.26, 0.26, '#5A5A66', 0, ROOM.h - 0.42, z);
    box(0.2, 0.5, 0.2, '#5A5A66', -ROOM.w / 2 + 1.4, ROOM.h - 0.72, z);
    box(0.2, 0.5, 0.2, '#5A5A66', ROOM.w / 2 - 1.4, ROOM.h - 0.72, z);
  }
  box(0.24, 0.24, ROOM.d - 0.4, '#4A4A55', -6.0, ROOM.h - 0.62, 0);
  box(0.24, 0.24, ROOM.d - 0.4, '#4A4A55', 6.0, ROOM.h - 0.62, 0);

  const lightMat = toon('#FFFFFF', { vertexColors: true });
  lightMat.userData.outlineParameters = { visible: false };
  // Enough lights for the floor they have to cover. Three strips in a room this
  // size left two thirds of it in the dark.
  for (const z of [-9.6, -4.8, 0, 4.8, 9.6]) {
    for (const x of [-9.5, 0, 9.5]) {
      const strip = stripLight(lightMat, 8);
      strip.position.set(x, ROOM.h - 0.7, z);
      scene.add(strip);
    }
  }

  // --- the mirror wall ------------------------------------------------------
  // Runs the whole left side now instead of three panels in the middle of it.
  const mirrors = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const p = mirrorPanel(lightMat, 3.6, 2.6);
    p.position.set(-ROOM.w / 2 + 0.09, 1.85, -9.3 + i * 3.8);
    p.rotation.y = Math.PI / 2;
    mirrors.add(p);
    box(0.1, 2.8, 0.14, '#1A1A20', -ROOM.w / 2 + 0.12, 1.85, -11.2 + i * 3.8);
  }
  scene.add(mirrors);

  // --- clutter that reads as use -------------------------------------------
  // Wall-mounted plate storage down the back, a chalk bowl, and a bin. A gym
  // looks used because of the things round the edges, not the machines.
  for (let i = 0; i < 6; i++) {
    const x = -13.0 + i * 1.5;
    box(0.14, 0.14, 0.9, '#6A6A76', x, 1.5, -ROOM.d / 2 + 0.5);
    for (let j = 0; j < 3; j++) {
      box(0.5, 0.5, 0.12, ['#1A1A1A', '#C7382F', '#2A2A2A'][j], x, 1.5, -ROOM.d / 2 + 0.28 + j * 0.16);
    }
  }
  box(0.6, 0.5, 0.6, '#D8D2C4', -14.6, 0.25, -11.0);      // chalk bowl
  box(0.5, 0.06, 0.5, '#F2F2F2', -14.6, 0.53, -11.0);

  // --- signage --------------------------------------------------------------
  const sign = (lines, w, h, x, y, z, ry, opts) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat('#FFFFFF', signTexture(lines, opts)));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  };
  sign(["KEVIN'S GYM", 'NO PAIN, ONLY KEVIN'], 10.0, 2.5, 0, 3.7, -ROOM.d / 2 + 0.06, 0);
  sign(['TRAIN LIKE KEVIN', 'OR CRY LATER'], 5.2, 1.3, ROOM.w / 2 - 0.07, 3.6, -6.0, -Math.PI / 2,
    { bg: '#0B0B0B', fg: '#FFE500', size: 74 });
  sign(['NO EXCUSES', 'ONLY SHIFTS'], 5.2, 1.3, ROOM.w / 2 - 0.07, 3.6, 2.0, -Math.PI / 2,
    { bg: '#FFE500', fg: '#0B0B0B', size: 74 });
  sign(['FREE WEIGHTS'], 4.0, 0.7, -8.0, 3.9, -ROOM.d / 2 + 0.06, 0,
    { bg: '#1C2E3F', fg: '#FFE500', size: 64 });
  sign(['CARDIO'], 3.0, 0.7, 12.0, 3.9, -ROOM.d / 2 + 0.06, 0,
    { bg: '#1C2E3F', fg: '#7BE08A', size: 64 });
  // Banners hung off the truss, which is what the truss is for.
  for (const [x, lines, bg, fg] of [
    [-8.0, ['LIFT'], '#E8232B', '#FFE500'],
    [3.4, ['RUN'], '#2F8F45', '#FFF6C8'],
    [12.0, ['REPEAT'], '#1C2E3F', '#FFE500'],
  ]) {
    sign(lines, 3.0, 1.6, x, ROOM.h - 1.5, -4.8, 0, { bg, fg, size: 92 });
  }

  return { floor };
}

/**
 * Outside: the forecourt, the front of the unit, and the signage.
 *
 * The gym was a sealed box you woke up inside, which gave it no sense of place
 * and no arrival. Now you start on the concrete, read the sign, and walk in
 * through the roller door.
 */
/**
 * @param unit  build the gym's own frontage — its doorway, facade, banner and
 *              side walls. Off for any world that is not the gym: McKevin's was
 *              showing a KEVIN'S GYM sign across the back of its own forecourt,
 *              which is the sort of thing splitting the worlds was meant to
 *              stop and did not, because only the ground and the sky are
 *              actually shared.
 */
function buildExterior(scene, { unit = true, ground = true } = {}) {
  const flat = (color, map = null) => {
    const m = toon(color, map ? { map } : {});
    m.userData.outlineParameters = { visible: false };
    return m;
  };
  const solid = (w, h, d, color, x, y, z, map = null) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(color, map));
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // Sky. A box around everything rather than a dome — cheaper, and at this
  // scale nobody can tell.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false })
  );
  sky.material.userData = { outlineParameters: { visible: false } };
  scene.add(sky);

  // The yard.
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), flat('#FFFFFF', concreteTexture()));
  yard.rotation.x = -Math.PI / 2;
  yard.position.z = 20;
  scene.add(yard);

  const FZ = ROOM.d / 2;             // the front plane of the building
  const LINTEL = 3.3;                // top of the doorway
  const EAVES = ROOM.h;

  // Front wall, in two pieces with the doorway between them.
  const leftW = (ROOM.w / 2) + DOOR.x0;
  const rightW = (ROOM.w / 2) - DOOR.x1;
  if (unit) {
  solid(leftW, EAVES, 0.5, '#C9C4BA', DOOR.x0 - leftW / 2, EAVES / 2, FZ);
  solid(rightW, EAVES, 0.5, '#C9C4BA', DOOR.x1 + rightW / 2, EAVES / 2, FZ);
  solid(DOOR.x1 - DOOR.x0, EAVES - LINTEL, 0.5, '#C9C4BA', 0, LINTEL + (EAVES - LINTEL) / 2, FZ);
  blockers.push(
    { x0: -ROOM.w / 2 - 0.4, x1: DOOR.x0, z0: FZ - 0.4, z1: FZ + 0.4 },
    { x0: DOOR.x1, x1: ROOM.w / 2 + 0.4, z0: FZ - 0.4, z1: FZ + 0.4 }
  );
  // The roller shutter, rolled up above the door.
  solid(DOOR.x1 - DOOR.x0 + 0.3, 0.42, 0.42, '#8A8F98', 0, LINTEL + 0.24, FZ + 0.2);

  // The parapet the sign is painted on, standing proud of the roof.
  const facade = solid(ROOM.w + 2.2, 3.0, 0.36, '#FFFFFF', 0, EAVES + 1.5, FZ + 0.12, facadeTexture());
  facade.material.map.center.set(0.5, 0.5);

  // Banner strung under it.
  solid(ROOM.w - 2.4, 1.0, 0.1, '#FFFFFF', 0, EAVES - 0.05, FZ + 0.34, bannerTexture());
  }

  // Billboard, out on the grass past the kerb. It used to stand at x 7-10,
  // which is where the fry house now is; out here it is scenery you read
  // across the yard rather than something you walk into.
  if (unit) {
  solid(0.34, 6.4, 0.34, '#5A5A62', -9.6, 3.2, 27.0);
  solid(0.34, 6.4, 0.34, '#5A5A62', -6.0, 3.2, 27.0);
  solid(5.2, 3.5, 0.24, '#FFFFFF', -7.8, 6.6, 27.0, billboardTexture());
  }

  // Hand-painted board by the door.
  if (unit) {
    solid(0.22, 2.4, 0.22, '#6B5B41', -6.2, 1.2, 10.2);
    solid(3.0, 2.25, 0.16, '#FFFFFF', -6.2, 2.9, 10.2, boardTexture());
  }

  // A kerb and a strip of grass, so the concrete has an edge instead of
  // running to the horizon. The gym's, not everyone's — McKevin's lays a car
  // park over the same ground and two surfaces at one height tear.
  if (ground) {
  solid(60, 0.28, 0.6, '#B4B0A8', 0, 0.14, YARD.z + 1.2);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, 26), flat('#4E8A3C'));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0.02, YARD.z + 14);
  scene.add(grass);
  blockers.push({ x0: -30, x1: 30, z0: YARD.z + 0.9, z1: YARD.z + 1.5 });
  }

  // Side walls of the unit, seen from outside.
  if (unit) {
    solid(0.5, EAVES, 3.0, '#BDB8AE', -ROOM.w / 2, EAVES / 2, FZ + 1.4);
    solid(0.5, EAVES, 3.0, '#BDB8AE', ROOM.w / 2, EAVES / 2, FZ + 1.4);
  }

  return { sky };
}

// --- stations ---------------------------------------------------------------
// Two code paths, three things to walk up to: bench and dumbbells both feed
// strength, the treadmill feeds stamina. Deliberately no minigame — v1 tests
// whether people come back, and a timing bar would confound that with whether
// the minigame is fun.

const STATIONS = [
  {
    id: 'bench', prop: 'bench', label: 'Seated press',
    x: -7.6, z: -1.0, width: 2.2, rotY: Math.PI / 2,
    stat: 'muscle', gain: 3.0, coin: 10,
    sweep: 0.80, window: 0.115,          // slow sweep, tight band — heavy and precise
    // Seated on the end, not supine along it. A lying press clips into the pad
    // from every angle a camera can reach and hides half the figure behind it;
    // sitting puts the whole of him and the bar in clear air.
    mount: { pose: 'seated', dx: 0, dz: 0, ry: Math.PI, seatY: -0.02 },
    cam: { x: 2.6, y: 2.2, z: -3.0, at: 1.15 },
    lines: ['That is a set.', 'Chest day. Every day is chest day.', 'Two more than last time.'],
  },
  {
    id: 'rack', prop: 'dumbbell-rack', label: 'Dumbbells',
    x: -13.0, z: -7.4, width: 3.0, rotY: 0,
    stat: 'muscle', gain: 2.0, coin: 7,
    sweep: 1.35, window: 0.175,          // quick and forgiving — the warm-up
    mount: { pose: 'curl', dx: 0, dz: 1.30, ry: Math.PI, seatY: 0 },
    cam: { x: 1.6, y: 2.3, z: 4.0, at: 1.2 },
    lines: ['Curls. For the girls. And for me.', 'Light weight.', 'I do this on my break as well.'],
  },
  {
    id: 'treadmill', prop: 'treadmill', label: 'Treadmill',
    x: 12.4, z: -5.0, width: 2.6, rotY: -Math.PI / 2,
    stat: 'stamina', gain: 3.6, coin: 9,
    sweep: 1.75, window: 0.155,          // fastest sweep in the room
    mount: { pose: 'run', dx: 0.30, dz: 0, ry: -Math.PI / 2, seatY: 0.16 },
    cam: { x: 3.4, y: 2.5, z: 2.6, at: 1.3 },
    lines: ['Cardio. Reluctantly.', 'I walk to work anyway.', 'This is my third shift today.'],
  },
];

// The room, laid out in zones the way a real gym is: free weights on the mat,
// machines along the back wall, cardio to one side, everything else against the
// walls. Scattering equipment evenly across a floor is what made it read as a
// showroom rather than somewhere people train.
const SCENERY = [
  // --- free weights, back left on the platform -----------------------------
  ['squat-rack', { x: -9.0, z: -10.0, width: 2.6, rotY: 0 }],
  ['squat-rack', { x: -4.4, z: -10.0, width: 2.6, rotY: 0 }],
  ['plate-tree', { x: -6.7, z: -10.2, width: 1.1, rotY: 0 }],
  ['plate-tree', { x: -11.4, z: -10.2, width: 1.1, rotY: 0 }],
  ['pullup-rig', { x: -14.6, z: -2.4, width: 2.6, rotY: Math.PI / 2 }],
  ['bench', { x: -11.0, z: -4.2, width: 1.8, rotY: 0.2, solid: true }],
  ['kettlebell', { x: -8.2, z: -6.4, width: 0.45, rotY: 0.8, solid: false }],
  ['kettlebell', { x: -7.6, z: -5.9, width: 0.4, rotY: -0.5, solid: false }],
  ['kettlebell', { x: -9.1, z: -5.6, width: 0.42, rotY: 1.7, solid: false }],
  ['dumbbell', { x: -10.0, z: -6.0, width: 0.55, rotY: 0.3, solid: false }],
  ['dumbbell', { x: -5.6, z: -6.6, width: 0.5, rotY: 1.2, solid: false }],
  ['medicine-ball', { x: -13.4, z: -0.6, width: 0.5, rotY: 0, solid: false }],
  ['medicine-ball', { x: -12.8, z: -0.1, width: 0.42, rotY: 1.1, solid: false }],

  // --- machines, along the back wall ---------------------------------------
  ['lat-pulldown', { x: -0.6, z: -10.4, width: 2.0, rotY: 0 }],
  ['cable-machine', { x: 2.6, z: -10.4, width: 2.6, rotY: 0 }],
  ['leg-press', { x: 6.6, z: -10.0, width: 2.8, rotY: -0.3 }],
  ['lat-pulldown', { x: 10.8, z: -10.4, width: 2.0, rotY: 0.1 }],
  ['cable-machine', { x: 14.0, z: -7.4, width: 2.6, rotY: -Math.PI / 2 }],

  // --- cardio, right side --------------------------------------------------
  ['treadmill', { x: 12.4, z: -1.6, width: 2.4, rotY: -Math.PI / 2 }],
  ['treadmill', { x: 12.4, z: 1.6, width: 2.4, rotY: -Math.PI / 2 }],
  ['rowing-machine', { x: 8.6, z: -2.6, width: 2.4, rotY: -Math.PI / 2 }],
  ['rowing-machine', { x: 8.6, z: 0.4, width: 2.4, rotY: -Math.PI / 2 }],
  ['punching-bag', { x: 14.2, z: 4.6, width: 1.2, rotY: 0 }],
  ['punching-bag', { x: 14.2, z: 6.6, width: 1.2, rotY: 0 }],

  // --- changing end, left wall ---------------------------------------------
  ['locker', { x: -15.2, z: 2.0, width: 1.0, rotY: Math.PI / 2 }],
  ['locker', { x: -15.2, z: 3.1, width: 1.0, rotY: Math.PI / 2 }],
  ['locker', { x: -15.2, z: 4.2, width: 1.0, rotY: Math.PI / 2 }],
  ['locker', { x: -15.2, z: 5.3, width: 1.0, rotY: Math.PI / 2 }],
  ['locker', { x: -15.2, z: 6.4, width: 1.0, rotY: Math.PI / 2 }],
  ['locker', { x: -15.2, z: 7.5, width: 1.0, rotY: Math.PI / 2 }],
  ['bench', { x: -12.6, z: 4.8, width: 1.8, rotY: Math.PI / 2 }],
  ['towel-bin', { x: -13.4, z: 8.6, width: 0.9, rotY: -0.3 }],
  ['bucket', { x: -14.6, z: 9.6, width: 0.6, rotY: -0.3, solid: false }],

  // --- the water station, by the door --------------------------------------
  ['water-cooler', { x: -6.6, z: 8.8, width: 0.85, rotY: 0 }],
  ['water-cooler', { x: -5.4, z: 8.8, width: 0.85, rotY: 0 }],
  ['bucket', { x: -7.8, z: 9.2, width: 0.55, rotY: 0.4, solid: false }],

  // --- reception and the supplement counter, right of the door -------------
  ['protein-tub', { x: 7.4, z: 8.5, width: 0.55, rotY: 0.4, solid: false }],
  ['protein-tub', { x: 8.1, z: 8.6, width: 0.5, rotY: -0.3, solid: false }],
  ['protein-tub', { x: 8.8, z: 8.4, width: 0.52, rotY: 0.9, solid: false }],
  ['speaker', { x: 15.0, z: 9.4, width: 0.7, rotY: 0.7 }],
  ['speaker', { x: -15.2, z: -10.6, width: 0.7, rotY: -0.6 }],
  ['gym-clock', { x: -15.85, z: -6.0, width: 1.2, rotY: Math.PI / 2, y: 3.4, solid: false }],
  ['gym-mirror', { x: 15.85, z: -3.0, width: 3.0, rotY: -Math.PI / 2, solid: false }],

  // --- the boxing corner and the rest of the pack ---------------------------
  // Came with the Sketchfab pack, which is heavy on free weights and boxing and
  // has none of the machines or the furniture — those stay Tripo's. normalise()
  // flattens both to the same toon material on load, which is the thing that
  // lets two sources read as one hand.
  ['boxing-ring', { x: 9.6, z: 1.6, width: 6.0, rotY: 0 }],
  ['exercise-bike', { x: 14.4, z: 8.4, width: 1.6, rotY: -Math.PI / 2 }],
  ['dip-station', { x: -14.4, z: -6.0, width: 1.8, rotY: Math.PI / 2 }],
  ['incline-bench', { x: -5.0, z: -4.6, width: 1.8, rotY: 0.3 }],
  ['weight-bench', { x: -12.0, z: -2.0, width: 1.8, rotY: Math.PI / 2 }],
  ['ab-bench', { x: 0.6, z: 3.4, width: 1.2, rotY: 0.2, solid: false }],
  ['yoga-mat', { x: 3.4, z: 4.6, width: 1.9, rotY: 0, solid: false }],
  ['yoga-mat', { x: 5.6, z: 4.6, width: 1.9, rotY: 0, solid: false }],
  ['barbell', { x: -8.0, z: -6.9, width: 2.2, rotY: 0.1, solid: false }],
  ['weight-plate', { x: -11.8, z: -9.6, width: 0.6, rotY: 0.4, solid: false }],
  ['weight-plate', { x: -11.2, z: -9.9, width: 0.6, rotY: 1.1, solid: false }],
  ['weight-plate', { x: -4.0, z: -6.4, width: 0.55, rotY: 0.7, solid: false }],

  // --- out on the forecourt ------------------------------------------------
  ['plate-tree', { x: -9.4, z: 15.6, width: 1.1, rotY: 0.3 }],
  ['dumbbell', { x: 5.6, z: 16.4, width: 0.6, rotY: 0.9, solid: false }],
  ['kettlebell', { x: 6.4, z: 17.0, width: 0.5, rotY: -0.4, solid: false }],
  ['protein-tub', { x: 4.4, z: 18.2, width: 0.62, rotY: 0.2, solid: false }],
  ['medicine-ball', { x: -4.8, z: 17.4, width: 0.5, rotY: 0, solid: false }],
  ['bucket', { x: 9.2, z: 14.2, width: 0.62, rotY: 0.6, solid: false }],
  ['towel-bin', { x: -7.2, z: 14.4, width: 0.9, rotY: -0.4 }],
];

// --- Kevin ------------------------------------------------------------------
// A built body, not a downloaded one, and on purpose: muscle here is bone
// scale, which sidesteps the trap that would otherwise sink this. glTF morph
// targets require every target to have the SAME vertex count and ordering as
// the base primitive, so a skinny Kevin and a buff Kevin generated separately
// can never blend — not "will look bad", cannot be loaded. Scaling limbs on one
// rig has no such constraint, and it is one number.

function buildKevin() {
  const g = new THREE.Group();
  const skin = toon(PALETTE.skin);
  const cream = toon(PALETTE.cream);
  const dark = toon('#B0141B');
  const shirt = toon('#E8232B');
  const cap = toon('#F5C400');
  for (const m of [skin, cream, dark, shirt, cap]) {
    m.userData.outlineParameters = { thickness: 0.012, color: [0, 0, 0], alpha: 1 };
  }

  const part = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  // torso — the piece muscle actually scales
  const torso = part(new THREE.CapsuleGeometry(0.30, 0.34, 4, 12), shirt, 0, 1.06, 0);
  g.add(torso);

  // head: the hood, the two enormous eyes, the cream muzzle
  const head = new THREE.Group();
  head.position.y = 1.66;
  head.add(part(new THREE.SphereGeometry(0.33, 16, 14), skin, 0, 0, 0));
  const snout = part(new THREE.SphereGeometry(0.19, 14, 12), cream, 0, -0.11, 0.26);
  snout.scale.set(1.25, 0.9, 1.0);
  head.add(snout);
  head.add(part(new THREE.SphereGeometry(0.038, 8, 8), toon(PALETTE.ink), 0, -0.05, 0.44));
  for (const sx of [-1, 1]) {
    // Enormous, and set high and forward so they cut up into the hood the way
    // they do in the 2D art. This is the whole silhouette.
    const eye = part(new THREE.SphereGeometry(0.155, 14, 12), toon('#FFFFFF'), sx * 0.15, 0.10, 0.20);
    eye.scale.set(0.8, 1.15, 0.8);
    eye.material.userData.outlineParameters = { thickness: 0.009, color: [0, 0, 0], alpha: 1 };
    head.add(eye);
    head.add(part(new THREE.SphereGeometry(0.05, 10, 8), toon(PALETTE.ink), sx * 0.16, 0.10, 0.33));
    // the blunt dreadlocks, three a side
    for (let i = 0; i < 3; i++) {
      const lock = part(new THREE.CapsuleGeometry(0.075, 0.20, 3, 8), dark, sx * 0.29, 0.06 - i * 0.15, -0.06 - i * 0.05);
      lock.rotation.z = sx * 0.45;
      head.add(lock);
    }
  }
  // A visor, not a helmet: a shallow crown band and a brim that sticks out.
  const crown = part(new THREE.SphereGeometry(0.335, 16, 8, 0, Math.PI * 2, 0, 0.62), cap, 0, 0.05, 0);
  head.add(crown);
  const brim = part(new THREE.CylinderGeometry(0.34, 0.34, 0.045, 16, 1, false, -0.2, Math.PI + 0.4), cap, 0, 0.22, 0.09);
  brim.rotation.x = 0.14;
  brim.scale.set(1, 1, 1.35);
  head.add(brim);
  g.add(head);

  const arms = [];
  const legs = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.34, 1.30, 0);
    arm.add(part(new THREE.CapsuleGeometry(0.105, 0.42, 4, 10), skin, 0, -0.28, 0));
    arm.add(part(new THREE.SphereGeometry(0.115, 12, 10), toon('#FFFFFF'), 0, -0.56, 0));
    g.add(arm);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(sx * 0.15, 0.74, 0);
    leg.add(part(new THREE.CapsuleGeometry(0.115, 0.44, 4, 10), dark, 0, -0.30, 0));
    leg.add(part(new THREE.BoxGeometry(0.20, 0.11, 0.30), toon('#FFFFFF'), 0, -0.56, 0.06));
    g.add(leg);
    legs.push(leg);
  }

  return { group: g, torso, head, arms, legs };
}

/** One number, 0..1, and the whole body reads as bigger. */
function applyMuscle(kev, m) {
  if (kev.sprite) {
    // A drawing has no bicep to inflate. Scale the whole of him a little
    // instead — Todd would have to draw a bigger Kevin for anything better,
    // and that is on the list rather than in the repo.
    const t = clamp(m, 0, 1);
    kev.mesh.scale.setScalar(1 + t * 0.16);
    kev.mesh.position.y = (1.85 / 2) * (1 + t * 0.16);
    return;
  }
  if (kev.unit) return applyCrewMuscle(kev, m);      // voxel body
  const t = clamp(m, 0, 1);
  kev.torso.scale.set(1 + t * 0.55, 1 + t * 0.10, 1 + t * 0.45);
  for (const a of kev.arms) a.scale.set(1 + t * 0.75, 1 + t * 0.12, 1 + t * 0.75);
  for (const l of kev.legs) l.scale.set(1 + t * 0.40, 1, 1 + t * 0.40);
  // the head does NOT scale — that is what sells the rest of him getting bigger
}

/**
 * Load the crew and build the player from one of them. Which token you hold is
 * which character you are — the avatar extrudes straight into the body, so
 * there is exactly one art pipeline for the NFT and the game.
 */
// A single-file build inlines everything and sets window.__KEVIN_ASSETS, since
// an artifact page cannot fetch. Served normally, this is undefined and the
// game loads from disk as usual.
const INLINE = typeof window !== 'undefined' ? window.__KEVIN_ASSETS : null;

let CREW = null;
async function loadCrew() {
  if (INLINE?.grids) { CREW = INLINE.grids; return CREW; }
  try {
    CREW = await withTimeout((async () => {
      const r = await fetch('../assets/crew/grids.json');
      if (!r.ok) throw new Error(`crew grids: HTTP ${r.status}`);
      return r.json();
    })(), CREW_TIMEOUT, 'the crew');
    return CREW;
  } catch {
    return null;                    // fall back to primitives — never a dead boot
  }
}

/**
 * The body you play as.
 *
 * 0 is Kevin, and Kevin is modelled rather than extruded: he is the face on the
 * poster, he predates the collection, and at 32 pixels the skull and the
 * dreadlocks — the two things that make him him — do not survive. Everything
 * above 0 is a crew token, extruded from its own grid exactly as it is drawn.
 *
 * They deliberately do not match. Kevin is the character; the crew are the
 * collection.
 */
/** Loaded once if the sprite look is on; shared by the player and the crowd. */
let walkAtlas = null;
/**
 * The unrecoloured atlas and Todd's measured palette, kept so a skin change is
 * a canvas redraw rather than another download. The <img> is the source every
 * colourway is derived from; recolouring an already-recoloured atlas would
 * compound, and Gold over Void is not a colour anybody chose.
 */
let atlasImage = null;
let atlasPalette = null;

/**
 * The RGB of the skin being worn, from either source, or null if it is the
 * default.
 *
 * Two sources because a contract skin computes its colour from the address and
 * so is never in parts.json, while Todd's named colourways are only there. One
 * function so nothing has to know which kind it got.
 */
function skinRGB() {
  const ca = CONTRACT_SKINS.find((s) => s.name === state.skin);
  if (ca) return ca.rgb;
  return atlasPalette?.colourways?.[state.skin] ?? null;
}

/**
 * Wear the skin on the BUILT body — the voxel Kevin, not the sprite.
 *
 * Without this the whole skins feature was invisible to everybody. The sprite
 * look is behind a ?sprite flag, so the default player is the built body, and
 * a shop shelf that only repaints a body almost nobody is playing is a shop
 * shelf that sells nothing. The built body wears its red as ONE material
 * (PALETTE.skin), so repainting it is a traversal and a colour set.
 *
 * Matched by colour rather than by a name or a flag on the mesh: the body is
 * assembled from several helpers that each call toon(PALETTE.skin) separately,
 * so there is no single material instance to hold on to, but there is exactly
 * one colour value they all share.
 */
function paintBody(kev, rgb) {
  if (!kev?.group || kev.sprite) return;
  // The kit body is not painted in one red. buildKitKevin uses #E02128 for the
  // kit and #B0141B for its shadow, buildKevin uses PALETTE.skin, and matching
  // any single hex catches at most one of them — which is why an exact match
  // repainted nothing at all. Classify by HUE instead: anything red and
  // saturated is Kevin, and his tan muscle, cream belly, white eyes and black
  // ink are not.
  const ref = new THREE.Color('#E02128');
  const r = { h: 0, s: 0, l: 0 };
  ref.getHSL(r);
  const target = rgb ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : null;
  const t = { h: 0, s: 0, l: 0 };
  (target ?? ref).getHSL(t);

  kev.group.traverse((o) => {
    if (!o.isMesh || !o.material?.color) return;
    // Remember each material's own colour the first time it is seen, so changing
    // skin twice does not compound and Classic Red can come back exactly.
    if (o.material.userData.baseColour === undefined) {
      o.material.userData.baseColour = o.material.color.getHex();
    }
    const base = new THREE.Color(o.material.userData.baseColour);
    if (!target) { o.material.color.copy(base); o.material.needsUpdate = true; return; }
    const b = { h: 0, s: 0, l: 0 };
    base.getHSL(b);
    const hue = Math.min(Math.abs(b.h - r.h), 1 - Math.abs(b.h - r.h));
    if (b.s < 0.35 || hue > 0.06) return;              // not one of his reds
    // Carry this material's own offset from the kit red across to the new
    // colour, so the shadow red stays darker than the body red in Cold Blue
    // exactly as it did in Classic Red. Flattening them loses the whole form.
    o.material.color.setHSL(
      t.h,
      clamp(t.s * (b.s / r.s), 0, 1),
      clamp(t.l * (b.l / r.l), 0.04, 0.96),
    );
    o.material.needsUpdate = true;
  });
}

/** The atlas in whatever colourway is worn now, or the plain one if unskinned. */
function skinnedAtlas() {
  if (!atlasImage || !atlasPalette) return walkAtlas;
  const rgb = skinRGB() ?? atlasPalette.colourways?.[DEFAULT_SKIN];
  if (!rgb) return walkAtlas;
  return skinTexture(atlasImage, atlasPalette.palette, rgb);
}

function makePlayer(gridIndex = 0) {
  // Todd's own drawings, billboarded. Kept behind a flag until it has been
  // looked at next to the voxel body it replaces.
  if (walkAtlas) return buildSpriteKevin(skinnedAtlas());
  if (!gridIndex) return buildKitKevin({ toon });
  if (!CREW?.crew?.length) return buildKevin();
  const mat = toon('#FFFFFF', { vertexColors: true });
  mat.userData.outlineParameters = { thickness: 0.010, color: [0, 0, 0], alpha: 1 };
  return buildCrewBody(CREW.crew[gridIndex % CREW.crew.length], { material: mat });
}

/**
 * Put a body in the world and hang the gear off it.
 *
 * Split out of init() because swapping character has to do all of it again —
 * the barbell is parented to the rig and the dumbbells to the hands, so a new
 * body with the old gear leaves a bar floating where the last one stood.
 */
function spawnPlayer(gridIndex, at) {
  const body = makePlayer(gridIndex);
  // A new body is born in Classic Red. Dress it before anybody sees it, or a
  // world change or a crew swap silently undoes what the player bought.
  paintBody(body, skinRGB());
  // Facing (Y) has to compose with lying back (X), not fight it.
  body.group.rotation.order = 'YXZ';
  body.group.position.copy(at);
  scene.add(body.group);

  const gearMat = toon('#FFFFFF', { vertexColors: true });
  gearMat.userData.outlineParameters = { thickness: 0.009, color: [0, 0, 0], alpha: 1 };
  bar = makeBarbell(gearMat, { length: 1.7 });
  bar.visible = false;
  (body.rig ?? body.group).add(bar);
  bells.length = 0;
  for (const arm of body.arms) {
    const d = makeDumbbell(gearMat);
    d.position.y = -body.torsoH * 0.95;
    d.visible = false;
    arm.add(d);
    bells.push(d);
  }
  return body;
}

/** Change character. Keeps where you were standing and what you have built. */
function swapPlayer(gridIndex) {
  if (set) abortSet();
  const at = kevin.group.position.clone();
  const facing = kevin.group.rotation.y;
  scene.remove(kevin.group);
  state.crewId = gridIndex;
  save(state);
  kevin = spawnPlayer(gridIndex, at);
  kevin.group.rotation.y = facing;
  applyMuscle(kevin, state.muscle / 100);
}

// --- the rest of the crew ---------------------------------------------------
// An empty gym reads as a tech demo. These are other minted crew members, each
// on a loop, and they cost almost nothing: the same voxel builder, the same
// shared material, no AI beyond a timer and a waypoint.

// Places worth standing, and what you do when you get there. These are AT the
// equipment on purpose — a figure doing curls in the middle of the floor reads
// as a mannequin, the same figure doing them at the rack reads as a person.
const SPOTS = [
  // Placed against what they are meant to be using, in the 32x24 room. A spot
  // in open floor is somebody miming, which is worse than nobody being there.
  // `gear` puts an actual weight in their hands: an empty curl is a shrug.
  { x: -8.0, z: -8.6, ry: 0, mode: 'press', label: 'platform', gear: 'bar' },
  { x: -4.6, z: -8.6, ry: 0, mode: 'press', label: 'squat rack', gear: 'bar' },
  { x: -11.2, z: -6.6, ry: 0.4, mode: 'curl', label: 'rack', gear: 'bells' },
  { x: -12.6, z: -8.4, ry: 0.2, mode: 'curl', label: 'rack', gear: 'bells' },
  { x: -9.6, z: -4.6, ry: Math.PI, mode: 'curl', label: 'bench', gear: 'bells' },
  { x: -13.6, z: -1.4, ry: -Math.PI / 2, mode: 'stretch', label: 'mirror' },
  { x: -13.2, z: 2.0, ry: -Math.PI / 2, mode: 'stretch', label: 'mirror' },
  { x: 12.4, z: -3.2, ry: -Math.PI / 2, mode: 'run', label: 'treadmill' },
  { x: 12.4, z: 0.2, ry: -Math.PI / 2, mode: 'run', label: 'treadmill' },
  { x: 8.6, z: -1.2, ry: -Math.PI / 2, mode: 'run', label: 'rower' },
  { x: 0.4, z: -8.8, ry: 0, mode: 'press', label: 'lat pulldown' },
  { x: 3.6, z: -8.8, ry: 0, mode: 'press', label: 'cable' },
  { x: 3.4, z: 2.0, ry: Math.PI, mode: 'stretch', label: 'turf' },
  { x: 4.4, z: -1.0, ry: Math.PI, mode: 'curl', label: 'turf', gear: 'bells' },
  { x: -6.0, z: 8.0, ry: Math.PI, mode: 'drink', label: 'water' },
  { x: -12.6, z: 6.0, ry: Math.PI / 2, mode: 'idle', label: 'lockers' },
  { x: 8.6, z: 6.0, ry: 0, mode: 'idle', label: 'reception' },
  { x: 14.0, z: 5.6, ry: -Math.PI / 2, mode: 'press', label: 'bag' },
];

/**
 * Shove every spot out of whatever it is standing in.
 *
 * These are written by hand next to the equipment they belong to, and the
 * equipment moves — after the room was re-laid, five of nine were inside a
 * machine, which is exactly what "characters get stuck in the machines" looks
 * like. Rather than re-tune the numbers every time the furniture changes,
 * resolve them against the props once they actually exist.
 */
function clearSpots() {
  for (const spot of SPOTS) {
    for (let step = 0; step < 40 && depthAt(spot.x, spot.z) > 0; step++) {
      let push = null;
      let worst = 0;
      for (const so of solids) {
        const pen = (so.r + BODY) - Math.hypot(spot.x - so.x, spot.z - so.z);
        if (pen > worst) { worst = pen; push = so; }
      }
      if (!push) break;
      const dx = spot.x - push.x;
      const dz = spot.z - push.z;
      const d = Math.hypot(dx, dz) || 1;
      spot.x += (dx / d) * (worst + 0.12);
      spot.z += (dz / d) * (worst + 0.12);
      // Face what pushed you out — you are meant to be using it.
      spot.ry = Math.atan2(push.x - spot.x, push.z - spot.z);
    }
    spot.x = clamp(spot.x, -ROOM.w / 2 + 0.8, ROOM.w / 2 - 0.8);
    spot.z = clamp(spot.z, -ROOM.d / 2 + 0.8, ROOM.d / 2 - 0.8);
  }
}

/**
 * Give them somewhere to go.
 *
 * Six figures bolted to six fixed spots looping the same animation read as
 * furniture. The fix is not better animation — it is that people in a gym
 * finish a set, walk somewhere else, and start another one. So each one claims
 * a spot, walks to it, works for a while, then gives it up and picks another.
 *
 * No pathfinding: the room is one rectangle and they walk in a straight line.
 * A* here would be engineering for a problem that does not exist.
 */
function makeNpc(grid, mat, startSpot) {
  const body = buildCrewBody(grid, { material: mat });
  body.group.rotation.order = 'YXZ';
  const strength = 0.12 + Math.random() * 0.7;
  applyCrewMuscle(body, strength);

  const st = {
    spot: null,
    state: 'idle',
    timer: 0.6 + Math.random() * 2.5,
    phase: Math.random() * 10,
    rate: 0.72 + Math.random() * 0.5,
    speed: 1.5 + Math.random() * 0.9,
  };

  // A weight in the hands, shown only at spots that call for one. Built once
  // and hidden between sets rather than made and thrown away every time
  // somebody wanders off — the churn is what would cost, not the geometry.
  const gearMat = toon('#2A2A2E');
  gearMat.userData.outlineParameters = { thickness: 0.008, color: [0, 0, 0], alpha: 1 };
  const held = {
    bar: makeBarbell(gearMat, { length: 2.1, plates: 2 }),
    bells: new THREE.Group(),
  };
  for (const side of [-1, 1]) {
    const d = makeDumbbell(gearMat);
    d.position.x = side * 0.42;
    held.bells.add(d);
  }
  for (const k of Object.keys(held)) {
    held[k].visible = false;
    held[k].position.y = 1.05;
    body.group.add(held[k]);
  }

  const claim = (spot) => {
    if (st.spot) st.spot.taken = false;
    st.spot = spot;
    if (spot) spot.taken = true;
    for (const k of Object.keys(held)) held[k].visible = spot?.gear === k;
  };
  claim(startSpot);
  if (startSpot) {
    body.group.position.set(startSpot.x, 0, startSpot.z);
    body.group.rotation.y = startSpot.ry;
    st.state = 'work';
    st.timer = 4 + Math.random() * 9;
  }

  const pickSpot = () => {
    const free = SPOTS.filter((sp) => !sp.taken);
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  };

  const rest = () => {
    for (const a of body.arms) a.rotation.set(0, 0, a.rotation.z);
    for (const l of body.legs) l.rotation.x = 0;
    body.group.position.y = 0;
  };

  /**
   * Put this one straight to work at a spot.
   *
   * Only safe once clearSpots() has run: until the props are loaded and the
   * spots nudged out of them, a spot is a guess, and seating somebody on a
   * guess puts them inside a squat rack.
   */
  body.seat = (spot) => {
    claim(spot);
    body.group.position.set(spot.x, 0, spot.z);
    body.group.rotation.y = spot.ry;
    st.state = 'work';
    st.timer = 4 + Math.random() * 9;
  };

  body.tick = (dt, now) => {
    st.timer -= dt;
    const t = now / 1000 * st.rate + st.phase;

    if (st.state === 'walk') {
      const dx = st.spot.x - body.group.position.x;
      const dz = st.spot.z - body.group.position.z;
      const d = Math.hypot(dx, dz);
      st.walked = (st.walked || 0) + dt;
      if (st.walked > 14) {          // something is in the way; go elsewhere
        st.walked = 0;
        const other = pickSpot();
        if (other) claim(other);
        else { st.state = 'idle'; st.timer = 2; }
        return;
      }
      if (d < 0.12) {
        st.walked = 0;
        body.group.position.set(st.spot.x, 0, st.spot.z);
        body.group.rotation.y = st.spot.ry;
        st.state = 'work';
        st.timer = 5 + Math.random() * 11;
        rest();
      } else {
        const step = Math.min(d, st.speed * dt);
        body.group.position.x += (dx / d) * step;
        body.group.position.z += (dz / d) * step;
        body.group.rotation.y = Math.atan2(dx, dz);
        const walk = Math.sin(now / 125 + st.phase) * 0.55;
        body.legs[0].rotation.x = walk;
        body.legs[1].rotation.x = -walk;
        body.arms[0].rotation.x = -walk * 0.6;
        body.arms[1].rotation.x = walk * 0.6;
      }
      return;
    }

    if (st.state === 'work') {
      const mode = st.spot?.mode ?? 'idle';
      if (mode === 'curl') {
        const p = Math.sin(t * 2.3) * 0.5 + 0.5;
        for (const a of body.arms) a.rotation.x = -p * 1.55;
        body.group.position.y = p * 0.025;
        // The bells travel the arc the hands travel, or they hang in mid-air
        // while he curls nothing.
        held.bells.position.set(0, 1.05 - Math.cos(p * 1.55) * 0.42, 0.16 + Math.sin(p * 1.55) * 0.42);
      } else if (mode === 'press') {
        const p = Math.sin(t * 1.8) * 0.5 + 0.5;
        for (const a of body.arms) a.rotation.x = -Math.PI + p * 0.7;
        body.torso.rotation.x = p * 0.07;
        held.bar.position.set(0, 1.62 + p * 0.52, -0.05);
      } else if (mode === 'run') {
        const r = Math.sin(t * 7.5) * 1.0;
        body.legs[0].rotation.x = r;
        body.legs[1].rotation.x = -r;
        for (const a of body.arms) a.rotation.x = -0.5 - r * 0.35;
      } else if (mode === 'drink') {
        // Standing at the cooler with a drink, which is most of what people
        // actually do in a gym.
        const p = Math.max(0, Math.sin(t * 0.7));
        body.arms[1].rotation.x = -p * 2.2;
        body.head.rotation.x = -p * 0.35;
      } else if (mode === 'stretch') {
        const p = Math.sin(t * 0.9);
        body.arms[0].rotation.x = -1.4 - p * 0.5;
        body.arms[1].rotation.x = -1.4 + p * 0.5;
        body.torso.rotation.y = p * 0.28;
      } else {
        const b = Math.sin(t * 1.15);
        body.group.position.y = Math.abs(b) * 0.018;
        for (const a of body.arms) a.rotation.x = b * 0.12;
        body.head.rotation.y = Math.sin(t * 0.42) * 0.42;
      }

      if (st.timer <= 0) {
        body.torso.rotation.set(0, 0, 0);
        body.head.rotation.set(0, 0, 0);
        rest();
        const next = pickSpot();
        if (next) { claim(next); st.state = 'walk'; }
        else st.timer = 3 + Math.random() * 4;
      }
      return;
    }

    // idle, between things
    const b = Math.sin(t * 1.1);
    body.group.position.y = Math.abs(b) * 0.016;
    if (st.timer <= 0) {
      const next = pickSpot();
      if (next) { claim(next); st.state = 'walk'; }
      else st.timer = 2 + Math.random() * 3;
    }
  };

  return body;
}

// --- boot -------------------------------------------------------------------

const canvas = $('#c');
let renderer, effect, scene, camera, kevin, clock;
let state = load();
const props = new Map();
/**
 * Prop names the server does not have.
 *
 * SHOP_PROPS is a shopping list as much as a manifest — most of it is missing
 * on purpose until a pack lands — and loadProps() only skips names already in
 * the cache, which a failed fetch never enters. Without this, every walk back
 * into McKevin's costs another round of 404s. A timeout is not a miss: that is
 * a slow phone, and it deserves the retry.
 */
const missingProps = new Set();
const solids = [];                    // {x,z,r} circles the player cannot walk into
// Walls are rectangles. Approximating the front of a building with circles
// leaves gaps you can squeeze through and a doorway you cannot.
const blockers = [];                  // {x0,x1,z0,z1}
const DOOR = { x0: -3.0, x1: 3.0 };   // the way in, in world x
// The forecourt has to start where the building now ends, and still be deep
// enough to be a place rather than a kerb.
const YARD = { z: 30, x: 21 };
const BODY = 0.34;                    // how wide anybody is, for collision

/**
 * How deep into something a point is — not merely whether it is inside.
 *
 * A boolean test traps you: once you are inside a prop, every candidate
 * position is also inside, both axes get rejected, and you are stuck in the
 * machine forever. Depth lets a move be allowed whenever it makes things
 * better, so there is always a way out of anything you end up in.
 */
function depthAt(x, z) {
  let worst = 0;
  for (const s of solids) {
    const pen = (s.r + BODY) - Math.hypot(x - s.x, z - s.z);
    if (pen > worst) worst = pen;
  }
  for (const b of blockers) {
    if (x > b.x0 - BODY && x < b.x1 + BODY && z > b.z0 - BODY && z < b.z1 + BODY) {
      // Shallowest way out of the box is the smallest of the four overlaps.
      const pen = Math.min(x - (b.x0 - BODY), (b.x1 + BODY) - x,
                           z - (b.z0 - BODY), (b.z1 + BODY) - z);
      if (pen > worst) worst = pen;
    }
  }
  return worst;
}

const input = { f: 0, s: 0, turn: 0, act: false };
let set = null;                       // the RepSet in progress, or null
let nearest = null;
let lastStep = 0;
/** Everything you can walk up to and press E at. Filled during init. */
const places = [];
let shift = null;                     // the shift in progress, or null
let board = null;                     // the leaderboard mesh on the back wall
const customers = [];                 // bodies in the queue at the window
let shiftCam = null;                  // where the camera sits while working
/**
 * Dev only, and only when asked for: ?peek lets a screenshot harness park the
 * camera anywhere so scene composition can be checked without walking there.
 * Camera position and aim, nothing else — it cannot touch state or progress.
 */
let peek = null;
let bar = null;                       // the barbell, parented to the body
const bells = [];                     // one dumbbell per hand
let resultTimer = null;
const npcs = [];

function fail(msg) {
  $('#err').textContent = msg;
  $('#start').textContent = 'Reload';
  // Clicking Open the doors disables this button. Without putting that back,
  // every failure below ends on a greyed-out Reload that cannot be pressed —
  // which from the outside is indistinguishable from the button doing nothing.
  $('#start').disabled = false;
  $('#start').onclick = () => location.reload();
}

/** Boot-screen progress. The button is the only thing anyone is looking at. */
function booting(msg) {
  const b = $('#start');
  if (b && !b.textContent.startsWith('Reload')) b.textContent = msg;
}

/**
 * A promise that can also lose.
 *
 * fetch() and GLTFLoader hang forever on a stalled connection — they neither
 * resolve nor reject — and every await in init() was unguarded, so a single
 * dead request left the boot screen reading "Opening…" with nothing to press.
 * A prop that never arrives is already survivable; a prop that never *answers*
 * was not.
 */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
        e.timeout = true;                 // a slow phone, not a missing file
        reject(e);
      }, ms);
    }),
  ]);
}

const CREW_TIMEOUT = 15000;
const PROP_TIMEOUT = 25000;
const BOOT_TIMEOUT = 75000;   // the whole opening, including slow parsing
const PROP_LANES = 4;         // how many props load at once

async function init() {
  booting('Opening…');

  // Ask for a context on a throwaway canvas first. A WebGLRenderer built where
  // WebGL is blocked does not reliably throw — it can hand back a renderer
  // whose context is already gone, and the failure then surfaces as a blank
  // screen much later, far from the cause.
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
    fail('This browser has WebGL turned off, and the gym needs it. Try Chrome or Safari, or turn off Low Power Mode.');
    return;
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    // Some phones refuse the high-performance GPU but will give up the other one.
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      fail(`This browser could not start WebGL. The gym needs it. (${e.message})`);
      return;
    }
  }

  // Running out of memory shows up here rather than as an exception.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    $('#boot').classList.remove('gone');
    fail('The browser dropped the graphics context — usually low memory. Close some tabs and reload.');
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // above 2 costs a lot and shows nothing
  renderer.setClearColor('#8FC8EA');

  effect = new OutlineEffect(renderer, { defaultThickness: 0.007, defaultColor: [0, 0, 0], defaultAlpha: 1 });

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#AFD8EF', 44, 88);
  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 120);
  clock = new THREE.Clock();

  // One key light and a flat fill. No shadow maps: a toon ramp already reads as
  // one light source, and shadows on mobile cost more than they add here.
  // Key, sky and a warm bounce. One flat hemisphere lit every surface the same
  // and a 32-metre room lit that way has no depth in it at all: a second light
  // low and warm from the other side is what separates the far wall from the
  // near one under a toon ramp, which has very few steps to play with.
  scene.add(new THREE.HemisphereLight('#EAF2FF', '#6E6354', 1.55));
  const key = new THREE.DirectionalLight('#FFF4DA', 1.65);
  key.position.set(9, 14, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#FFC98A', 0.55);
  fill.position.set(-12, 6, -10);
  scene.add(fill);

  if (location.search.includes('sprite')) {
    walkAtlas = await new THREE.TextureLoader().loadAsync('../assets/sprites/walk-atlas.png')
      .catch(() => null);
    // The same bytes again as an <img>, which is what a canvas can draw and a
    // THREE.Texture's .image already is — no second request, it is cached.
    atlasImage = walkAtlas?.image ?? null;
  }
  // ALWAYS, not only under ?sprite. The colourways live here, and they now dress
  // the built body too — gating this on the sprite flag is what made the entire
  // skins shelf invisible to every default player. A few KB of JSON.
  //
  // parts.json rather than a copy of the palette in code: sprite-parts.mjs
  // measures it off the art, and a second hardcoded copy is a second thing to be
  // wrong when Todd's red moves.
  atlasPalette = await fetch('../assets/sprites/parts/parts.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  await loadCrew();
  // The player is built once and moves between worlds; only the scenery is torn
  // down and rebuilt.
  kevin = spawnPlayer(state.crewId ?? 0, new THREE.Vector3(CRIB.spawn.x, 0, CRIB.spawn.z));

  await setWorld(state.world ?? 'crib');

  // Settle the absence before the first frame, so the number in the toast is
  // the number on the bars.
  const gone = settle(state, Date.now());
  save(state);
  applyMuscle(kevin, state.muscle / 100);
  refreshHud();
  refreshBoard();
  if (gone.days >= 1) {
    if (gone.frozen) {
      toast('Protein shake used.<br><small>One missed day covered. That was the last spare.</small>', 4200);
    } else if (gone.lost > 0.4) {
      toast(
        `You were gone ${gone.days < 2 ? 'a day' : Math.floor(gone.days) + ' days'}.` +
        `<br><small>−${gone.lost.toFixed(1)} muscle. It comes off. That is just how it works.</small>`,
        5200
      );
    }
  }

  if (location.search.includes('peek')) {
    window.__peek = (pos, at) => {
      peek = pos ? { pos: new THREE.Vector3(...pos), at: new THREE.Vector3(...at) } : null;
    };
    // Where the player is, and putting them somewhere. Enough to drive the real
    // walk-up-and-press-E path from a test without waiting out a software
    // renderer's frame rate. It moves a position; it cannot touch muscle,
    // coins, streaks or anything that is saved.
    window.__where = () => ({ x: kevin.group.position.x, z: kevin.group.position.z, near: nearest?.kind ?? null });
    window.__warp = (x, z) => kevin.group.position.set(x, 0, z);
    window.__scene = scene;
    window.__state = state;          // ?peek only: lets a test buy something
    window.__kev = () => kevin;      // ?peek only: the real player, not a guess
    window.__customers = customers;
    window.__npcs = npcs;
  }

  addEventListener('resize', onResize);
  onResize();
  renderer.setAnimationLoop(frame);

  $('#boot').classList.add('gone');
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// --- loop -------------------------------------------------------------------

const SPEED = 4.2;
const tmp = new THREE.Vector3();
const aim = new THREE.Vector3();

let shake = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (shift) tickShift(now);
  else if (set) tickSet(dt, now);
  else move(dt, now);

  for (const n of npcs) n.tick(dt, now);

  // Behind the player normally; during a set the station picks the shot, because
  // you film a bench press from the side and a chase camera shows the soles of
  // his shoes.
  let lookY = 1.25;
  if (firstPerson && !set && !shift) {
    // Eyes, not a chase cam. In a room this size the camera IS the player:
    // there is no near wall to see past and no roof to lift off, which is why
    // the crib is first person and the street is not.
    const p = kevin.group.position;
    camera.position.set(p.x, 1.58, p.z);
    aim.set(
      p.x + Math.sin(look.yaw) * 4,
      1.58 + Math.tan(look.pitch) * 4,
      p.z + Math.cos(look.yaw) * 4
    );
  } else if (peek) {
    camera.position.copy(peek.pos);
    aim.copy(peek.at);
  } else if (shift && shiftCam) {
    // Locked off at the window. A chase camera here would follow a player who
    // is standing still and frame the inside of a wall.
    camera.position.lerp(shiftCam.pos, 1 - Math.pow(0.004, dt));
    aim.copy(shiftCam.at);
  } else if (set?.station.cam) {
    const c = set.station.cam;
    tmp.set(set.station.x + c.x, c.y, set.station.z + c.z);
    lookY = c.at;
    camera.position.lerp(tmp, 1 - Math.pow(0.004, dt));
    aim.set(set.station.x, lookY, set.station.z);
  } else {
    // Outside, pull back and up: there is a building to read, and the same
    // shot that frames a room nicely puts your nose against its front wall.
    const out = clamp((kevin.group.position.z - ROOM.d / 2) / 6, 0, 1);
    tmp.set(
      kevin.group.position.x,
      kevin.group.position.y + 3.4 + out * 2.6,
      kevin.group.position.z + 5.6 + out * 5.2
    );
    camera.position.lerp(tmp, 1 - Math.pow(0.0015, dt));
    aim.set(kevin.group.position.x, kevin.group.position.y + lookY + out * 1.4, kevin.group.position.z);
  }

  // Shake is a decaying impulse rather than a duration, so a perfect rep on top
  // of a perfect rep stacks instead of restarting.
  if (shake > 0.001) {
    shake *= Math.pow(0.0009, dt);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  } else shake = 0;

  camera.lookAt(aim);
  effect.render(scene, camera);
}



/**
 * The things a gym has that a weights room does not: somewhere to be signed in,
 * somewhere to buy a tub, and somewhere to fill a bottle. All boxes and painted
 * quads — furniture seen from a few metres, where a model costs megabytes to
 * look the same.
 */
function buildFittings(scene) {
  const flat = (color, map = null) => {
    const m = toon(color, map ? { map } : {});
    m.userData.outlineParameters = { visible: false };
    return m;
  };
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

  // --- reception, right of the door ----------------------------------------
  solid(6.4, 1.06, 1.0, '#C7382F', 8.6, 0.53, 7.6);              // desk
  solid(6.6, 0.12, 1.2, '#1C1C1C', 8.6, 1.12, 7.6);              // its top
  solid(6.0, 2.4, 0.3, '#E8DFD0', 8.6, 1.2, 10.4);               // back board
  quad(5.0, 1.1, signTexture(['RECEPTION', 'SIGN IN, THEN SUFFER'],
    { bg: '#0B0B0B', fg: '#FFE500' }), 8.6, 2.55, 10.24);
  // Shelves of stock behind it, so the counter has something to sell.
  for (let i = 0; i < 3; i++) {
    solid(5.2, 0.09, 0.42, '#8A6A4A', 8.6, 1.7 + i * 0.62, 10.0);
    for (let j = 0; j < 7; j++) {
      solid(0.34, 0.44, 0.3, ['#E8232B', '#FFE500', '#2F8F45', '#6B4BC4'][(i + j) % 4],
        6.3 + j * 0.78, 1.96 + i * 0.62, 10.0);
    }
  }

  // --- the water station, left of the door ---------------------------------
  solid(3.4, 0.16, 0.9, '#B9C7D0', -6.0, 0.9, 9.5);              // shelf
  solid(0.16, 0.9, 0.9, '#B9C7D0', -7.6, 0.45, 9.5);
  solid(0.16, 0.9, 0.9, '#B9C7D0', -4.4, 0.45, 9.5);
  solid(3.6, 1.9, 0.24, '#DCE6EC', -6.0, 1.6, 10.15);
  quad(3.0, 0.72, signTexture(['WATER', 'DRINK IT'],
    { bg: '#1E4E6B', fg: '#CFEAF7' }), -6.0, 1.9, 10.02);
  for (let i = 0; i < 5; i++) {
    solid(0.2, 0.5, 0.2, '#7FD4F0', -7.2 + i * 0.6, 1.24, 9.4);  // bottles
  }

  // --- a stretching mat, so the middle of the floor is not dead ------------
  const mat2 = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 5.0), flat('#2F6E4E'));
  mat2.rotation.x = -Math.PI / 2;
  mat2.position.set(4.0, 0.03, 3.2);
  scene.add(mat2);

  blockers.push(
    { x0: 5.3, x1: 11.9, z0: 7.0, z1: 8.2 },      // the desk
    { x0: 5.5, x1: 11.7, z0: 10.1, z1: 10.7 },    // the back board
    { x0: -7.8, x1: -4.2, z0: 9.1, z1: 10.4 },    // the water station
  );
}

/**
 * Fetch props by name into the shared cache.
 *
 * Four lanes, not twenty-two at once. A phone opening twenty-two connections is
 * slower than one opening four, and decoding that many meshopt buffers
 * concurrently is what pushes a mobile tab over its memory ceiling — which from
 * the outside looks exactly like the button doing nothing.
 *
 * The cache outlives the world on purpose: a prop fetched for the gym is still
 * decoded when you walk back into it. It is the CLONES that get disposed, which
 * is why worlds.js leaves cloned geometry alone.
 */
async function loadProps(names) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const queue = names.filter((n) => !props.has(n) && !missingProps.has(n));
  const total = queue.length;
  let done = 0;
  const lane = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      try {
        const g = INLINE?.props?.[name]
          ? await loader.parseAsync(INLINE.props[name], '')
          : await withTimeout(loader.loadAsync(`./assets/props/${name}.glb`), PROP_TIMEOUT, name);
        props.set(name, g.scene);
      } catch (e) {
        /* missing, slow or broken — the room opens without it rather than not at all */
        if (!e?.timeout) missingProps.add(name);
      }
      booting(`Opening… ${++done}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: PROP_LANES }, lane));
}

/**
 * Recolour bought props while this is set. Cleared when the world is torn down.
 *
 * A property of the world, not of each call site: threading it through forty
 * fixture() calls would be forty chances to forget one and leave a pastel
 * armchair in an otherwise repainted room.
 */
let worldPalette = null;

/** Put one in the world. Shared by every world that has props. */
function spawnProp(name, opts, tag) {
  const src = props.get(name);
  if (!src) return null;
  const obj = normalise(src.clone(true), { palette: worldPalette });
  place(obj, opts);
  if (opts.y) obj.position.y += opts.y;
  scene.add(obj);
  if (opts.solid !== false) {
    // A natural-scale prop has no declared width to take a radius from, so ask
    // the model how wide it turned out.
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    const r = (opts.width ?? Math.max(size.x, size.z)) * 0.42;
    solids.push({ x: opts.x, z: opts.z, r });
  }
  if (tag) obj.userData.station = tag;
  // The pose has to sit on the actual model, not on a guess about it.
  opts.top = new THREE.Box3().setFromObject(obj).max.y;
  return obj;
}

// --- worlds -----------------------------------------------------------------
// Each world owns its scenery and nothing else's. Entering builds it; leaving
// disposes it, so detail added to one room does not cost anything in another.
// The player, the lights and the camera are shared and survive the switch.

let worldGroup = null;
let worldId = null;
/** First person in the crib, chase camera outside. */
let firstPerson = false;
const look = { yaw: Math.PI, pitch: -0.06 };

async function buildGymWorld() {
  buildRoom(scene);
  buildExterior(scene);
  // Skyline and market only. The fry house is its own world now, and building
  // it here would be the whole point of splitting them thrown away.
  buildCity(scene, { flat: flatMat, solids, blockers }, { skyline: true, market: true, fry: false });
  buildFittings(scene);
  board = buildLeaderboard(scene, { flat: flatMat });

  // Everyone shares one material, so the whole crew costs one shader. They do
  // NOT get collision: they move, so a static solid would leave an invisible
  // wall wherever one happened to start, and being nudged past somebody is
  // better than being stopped by where they used to be.
  if (CREW?.crew?.length > 1) {
    const crewMat = toon('#FFFFFF', { vertexColors: true });
    crewMat.userData.outlineParameters = { thickness: 0.010, color: [0, 0, 0], alpha: 1 };
    // Started with no spot: props are not loaded yet, so the spots have not
    // been resolved and seating them now would place them inside machines.
    // A big floor with six people on it reads as closing time.
    const many = Math.min(12, CREW.crew.length - 1);
    // Seated at the equipment from the first frame, not walking in from the
    // door. Somebody arriving to an empty floor that fills up over the next
    // half minute has already decided the gym is dead.
    for (let i = 0; i < many; i++) {
      const npc = makeNpc(CREW.crew[(i + 1) % CREW.crew.length], crewMat, null);
      npc.group.position.set(-11 + i * 2.0, 0, 9.0);
      scene.add(npc.group);
      npcs.push(npc);
    }
  }
  await loadProps([...new Set([...STATIONS.map((s) => s.prop), ...SCENERY.map((s) => s[0])])]);

  for (const st of STATIONS) st.object = spawnProp(st.prop, st, st.id);
  for (const [name, opts] of SCENERY) spawnProp(name, opts);
  clearSpots();
  // Now the spots are real, put the crowd on them. Walking in from the door
  // means the first half minute of every visit is an empty gym.
  const seats = SPOTS.filter((sp) => !sp.taken);
  npcs.forEach((npc, i) => { if (seats[i]) npc.seat(seats[i]); });

  // Everything walk-up-able, in the order you meet it coming out of the door.
  for (const st of STATIONS) {
    places.push({ kind: 'station', station: st, label: st.label, x: st.x, z: st.z,
      note: `${REPS_PER_SET} reps`, act: st.stat === 'stamina' ? 'Run' : 'Lift' });
  }
  const stallLabel = {
    supplements: ['Supplement stall', 'spend $KEVIN', 'Shop'],
    crew: ["Kevin's Crew", 'have a look', 'Look'],
    produce: ['Fresh produce', 'closed, obviously', ''],
  };
  for (const st of MARKET) {
    const [label, note, act] = stallLabel[st.id];
    if (!act) continue;                       // the produce stall is set dressing
    places.push({ kind: st.id === 'crew' ? 'nft' : 'shop', label, note, act,
      x: st.x, z: st.z - 1.2 });
  }
  places.push({ kind: 'shop', label: 'Reception', note: 'supplements',
    act: 'Shop', x: 8.6, z: 6.4 });
  // Both ways off the forecourt, so the street is walkable rather than a menu.
  places.push({ kind: 'door', to: 'crib', label: 'Home', note: "Kevin's crib",
    act: 'Home', x: -YARD.x + 3.0, z: YARD.z - 4.0 });
  places.push({ kind: 'door', to: 'work', label: "McKevin's", note: 'down the road',
    act: 'Go', x: YARD.x - 3.0, z: YARD.z - 4.0 });
  return { fp: false, spawn: { x: 0, z: 15.5 } };
}

/**
 * McKevin's. Its own world, so the fry house does not have to be a box at the
 * end of the gym's forecourt any more — and so the gym does not pay for it.
 */
async function buildWorkWorld() {
  // Sky and skyline only from the shared builders — the gym's forecourt, kerb
  // and grass belong to the gym, and McKevin's lays its own tarmac.
  buildExterior(scene, { unit: false, ground: false });
  // The old box shop is retired; buildShop is the real one.
  buildCity(scene, { flat: flatMat, solids, blockers }, { skyline: true, market: false, fry: false });
  await loadProps(SHOP_PROPS);
  const ctx = { flat: flatMat, solids, blockers, spawn: spawnProp };
  buildShop(scene, ctx);
  buildMcKevins(scene, ctx);
  places.push({ kind: 'work', label: "McKevin's", note: 'clock in',
    act: 'Work', x: -2.5, z: FRY.counterZ - 1.5 });
  places.push({ kind: 'door', to: 'gym', label: 'Back to the gym', note: 'up the road',
    act: 'Go', x: 5.8, z: 12.0 });
  return { fp: false, spawn: { x: 5.8, z: 10.5 } };
}

async function buildCribWorld() {
  await loadProps(CRIB_PROPS);
  // The only world that repaints its props. brand.js says why: the furniture
  // kit is somebody else's palette, and eleven lookups make it Kevin's.
  worldPalette = rebrand;
  buildCrib(scene, { flat: flatMat, solids, blockers, spawn: spawnProp });
  places.push({ kind: 'cards', label: 'Card table', note: "Kevin's card room",
    act: 'Play', x: CRIB.table.x + 1.5, z: CRIB.table.z - 0.9 });
  places.push({ kind: 'map', label: 'The telly', note: 'pick a world',
    act: 'Worlds', x: CRIB.tv.x - 1.3, z: CRIB.tv.z });
  places.push({ kind: 'door', to: 'gym', label: 'Front door', note: "out to the gym",
    act: 'Go out', x: (CRIB.door.x0 + CRIB.door.x1) / 2, z: CRIB.front + 0.9 });
  return { fp: true, spawn: CRIB.spawn, yaw: CRIB.yaw };
}

const WORLDS = {
  crib: { label: "Kevin's Crib", build: buildCribWorld },
  gym: { label: "Kevin's Gym", build: buildGymWorld },
  work: { label: "McKevin's", build: buildWorkWorld },
};

/**
 * Swap worlds. Tears the old one down before building the new one, so the two
 * are never resident at the same time — which is the entire reason they are
 * separate.
 */
async function setWorld(id, at = null) {
  const w = WORLDS[id];
  if (!w || id === worldId) return;
  if (set) abortSet();
  if (worldGroup) {
    disposeWorld(worldGroup);
    worldGroup = null;
  }
  // Everything that describes the old world's shape has to go with it, or you
  // collide with a wall that is no longer there.
  solids.length = 0;
  blockers.length = 0;
  places.length = 0;
  for (const n of npcs) n.group.removeFromParent();
  npcs.length = 0;
  // SPOTS outlives the world. Leave the flags set and the next visit finds
  // every seat claimed by somebody who no longer exists.
  for (const sp of SPOTS) sp.taken = false;
  board = null;
  nearest = null;
  $('#prompt').classList.remove('on');

  worldPalette = null;          // each world opts in; none inherits the last one's
  worldGroup = new THREE.Group();
  scene.add(worldGroup);
  let meta;
  await captureInto(scene, worldGroup, async () => { meta = await w.build(); });
  // captureInto returns before an async builder finishes, so adopt again for
  // anything the awaited half added.
  for (const child of [...scene.children]) {
    if (child !== worldGroup && child !== kevin.group && !child.isLight && !npcs.some((n) => n.group === child)) {
      worldGroup.add(child);
    }
  }
  worldId = id;
  state.world = id;
  save(state);
  firstPerson = !!meta.fp;
  kevin.group.visible = !firstPerson;
  const spot = at ?? meta.spawn;
  kevin.group.position.set(spot.x, 0, spot.z);
  if (firstPerson) { look.yaw = meta.yaw ?? 0; look.pitch = -0.05; }
  if (board) refreshBoard();
  $('#boot').classList.add('gone');
}

/**
 * Going through a door.
 *
 * Fade out, swap, fade in. The worlds are genuinely torn down and rebuilt
 * between those two frames, which takes long enough to see — and a hitch you
 * can see reads as a bug, while a hitch behind a fade reads as a door. The
 * fade is also what makes three separate scenes feel like one place, which is
 * the entire trick.
 */
let travelling = false;
async function travel(id, at = null) {
  if (travelling || id === worldId) return;
  travelling = true;
  const veil = $('#veil');
  veil.classList.add('on');
  await new Promise((r) => setTimeout(r, 260));
  await setWorld(id, at);
  // A frame with the new world already drawn, so the fade lifts on the room
  // rather than on the last one.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  veil.classList.remove('on');
  travelling = false;
}

/**
 * Where to look, in first person.
 *
 * Drag rather than pointer lock. Lock needs a click to arm, is refused outright
 * in some embedded webviews, and does nothing at all on a phone — and this has
 * to work in a Telegram browser on a phone before it has to feel like Quake.
 */
function lookBy(dx, dy) {
  look.yaw -= dx * 0.0042;
  look.pitch = clamp(look.pitch - dy * 0.0034, -0.9, 0.55);
}

// --- the set ----------------------------------------------------------------

function tickSet(dt, now) {
  const st = set.station;

  if (set.armed) {
    set.tick(dt);
    $('#marker').style.left = `${set.pos * 100}%`;
    if (set.expired) gradeRep(set.timeout());
  }

  // The marker drives the movement, so the press lands at the bottom of a real
  // rep rather than somewhere in a loop that ignores you. The bar goes with it.
  const p = set.armed ? set.pos : 1;
  const pose = st.mount?.pose;

  if (pose === 'seated') {
    // Press up and down. The arms swing back past vertical, and the bar tracks
    // the hands rather than floating on a timer of its own.
    for (const a of kevin.arms) a.rotation.x = -Math.PI + p * 0.62;
    for (const l of kevin.legs) l.rotation.x = -Math.PI / 2;
    const reach = kevin.legH + kevin.torsoH * 0.94;
    bar.position.set(0, reach + 0.44 - p * 0.40, 0.06);
    bar.rotation.set(0, 0, 0);
  } else if (pose === 'run') {
    const run = Math.sin(now / 70) * 1.05;
    kevin.legs[0].rotation.x = run;
    kevin.legs[1].rotation.x = -run;
    for (const a of kevin.arms) a.rotation.x = -0.5 - run * 0.35;
  } else {
    for (const a of kevin.arms) a.rotation.x = -0.15 - p * 1.55;
    kevin.torso.rotation.x = p * 0.06;
  }

  if (input.act) { input.act = false; if (set.armed) gradeRep(set.hit()); }
}

function gradeRep(r) {
  if (!r) return;
  play(r.sound);
  shake = r.shake;
  floatText(r.combo >= 3 && r.grade !== 'miss' ? `${r.label} x${r.combo}` : r.label, r.grade);

  const pips = $('#setPips').children;
  if (pips[r.rep - 1]) pips[r.rep - 1].className = r.grade;
  $('#track').animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${r.grade === 'miss' ? 6 : -3}px)` }, { transform: 'translateX(0)' }],
    { duration: 130 }
  );

  setTimeout(() => {
    if (!set) return;
    set.nextRep();
    if (set.done) finishSet();
    else refreshSetUI();
  }, 260);
}

function refreshSetUI() {
  if (!set) return;
  $('#setReps').textContent = `REP ${set.rep} / ${REPS_PER_SET}`;
  const half = set.half * 100;
  const c = set.target * 100;
  $('#zone').style.left = `${c - half}%`;
  $('#zone').style.width = `${half * 2}%`;
  $('#zoneHot').style.left = `${c - half * 0.34}%`;
  $('#zoneHot').style.width = `${half * 0.68}%`;
}

function startWorkout(st) {
  set = new RepSet(st, state.stamina);
  $('#prompt').classList.remove('on');
  $('#setStation').textContent = st.label;
  $('#setPips').innerHTML = Array.from({ length: REPS_PER_SET }, () => '<i></i>').join('');
  $('#setHint').innerHTML = matchMedia('(pointer:coarse)').matches
    ? 'Tap the button in the band · move to quit'
    : 'Press <b>E</b> in the band · <b>Esc</b> to quit';
  refreshSetUI();
  $('#set').classList.add('on');
  $('#act').textContent = 'Rep';
  mount(st);
  play('rack');
}

/**
 * Put him ON the machine.
 *
 * Standing beside a bench swinging your arms is the single thing that made the
 * old version read as a tech demo: the animation had nothing to do with the
 * object. So each station names a spot, a facing and a pose, and the height
 * comes from the prop's own bounding box rather than a guessed constant.
 *
 * Rotation order is set to YXZ on the body at build time so facing (Y) composes
 * with lying back (X) instead of fighting it.
 */
function mount(st) {
  const m = st.mount;
  if (!m) return;
  const cos = Math.cos(m.ry);
  const sin = Math.sin(m.ry);
  kevin.group.position.set(
    st.x + m.dx * cos + m.dz * sin,
    0,
    st.z - m.dx * sin + m.dz * cos
  );
  kevin.group.rotation.set(0, m.ry, 0);

  kevin.group.position.y = m.seatY ?? 0;

  if (m.pose === 'seated') {
    // Sitting on the end of the bench: thighs forward, bar overhead. The legs
    // are single limbs, so rotating them at the hip is the whole of "seated" —
    // there is no knee to bend and none is needed.
    for (const l of kevin.legs) l.rotation.x = -Math.PI / 2;
    bar.visible = true;
    bells.forEach((bl) => { bl.visible = false; });
  } else if (m.pose === 'run') {
    bar.visible = false;
    bells.forEach((b) => { b.visible = false; });
  } else {
    bar.visible = false;
    bells.forEach((b) => { b.visible = true; });
  }
}

/** Back on your feet, hands empty. */
function unmount() {
  if (kevin.rig) kevin.rig.rotation.set(0, 0, 0);
  for (const l of kevin.legs) l.rotation.x = 0;
  kevin.group.rotation.set(0, kevin.group.rotation.y, 0);
  kevin.group.position.y = 0;
  bar.visible = false;
  bells.forEach((b) => { b.visible = false; });
}

/**
 * Bail out of a set. There was no way out at all: once mounted, movement is
 * ignored and the only exit was five graded reps, so a mistaken press locked
 * you to a machine for fifteen seconds. Nothing is banked — quitting a set
 * should cost you the set, not pay for it.
 */
function abortSet() {
  if (!set) return;
  const st = set.station;
  set = null;
  for (const a of kevin.arms) a.rotation.x = 0;
  for (const l of kevin.legs) l.rotation.x = 0;
  kevin.torso.rotation.set(0, 0, 0);
  unmount();
  $('#set').classList.remove('on');
  $('#result').classList.remove('on');
  $('#act').textContent = st.stat === 'stamina' ? 'Run' : 'Lift';
  // Step off the machine, or you are instantly back in range and the prompt
  // reads as though nothing happened.
  kevin.group.position.z += 1.5;
  nearest = null;
  play('ui');
}

function finishSet() {
  const st = set.station;
  const sc = set.score();
  set = null;

  for (const a of kevin.arms) a.rotation.x = 0;
  for (const l of kevin.legs) l.rotation.x = 0;
  kevin.torso.rotation.x = 0;
  unmount();
  $('#set').classList.remove('on');
  $('#act').textContent = st.stat === 'stamina' ? 'Run' : 'Lift';

  const before = rankOf(state.muscle).index;
  const r = workout(state, st, Date.now(), sc.mult);
  state.sessions = (state.sessions || 0) + 1;
  state.bestCombo = Math.max(state.bestCombo || 0, sc.bestCombo);
  save(state);
  applyMuscle(kevin, state.muscle / 100);
  refreshHud();

  refreshBoard();
  play(sc.flawless ? 'rank' : 'set');
  shake = sc.flawless ? 0.55 : 0.2;

  const title = sc.flawless ? 'FLAWLESS SET' : sc.clean ? 'CLEAN SET' : sc.misses >= 3 ? 'ROUGH SET' : 'SET DONE';
  const gained = st.stat === 'muscle' ? r.gain : r.stam;
  $('#resultTitle').textContent = title;
  $('#resultBody').innerHTML =
    `<span>+${gained.toFixed(1)}</span> ${st.stat} &nbsp;·&nbsp; <span>+${r.coin}</span> $KEVIN<br>` +
    `${sc.perfects}/${REPS_PER_SET} perfect${sc.bestCombo > 1 ? ` · best chain ${sc.bestCombo}` : ''}<br>` +
    `<small style="opacity:.7">${st.lines[Math.floor(Math.random() * st.lines.length)]}</small>`;
  $('#result').classList.add('on');
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => $('#result').classList.remove('on'), 2600);

  // A rank is the one thing worth interrupting for.
  const after = rankOf(state.muscle).index;
  if (after > before) {
    setTimeout(() => {
      play('rank');
      toast(`${rankOf(state.muscle).name.toUpperCase()}<br><small>Rank up. Noted.</small>`, 3000);
    }, 900);
  }

  nearest = null;
}

// --- movement ---------------------------------------------------------------

function move(dt, now) {
  if (input.turn) look.yaw += input.turn * 1.9 * dt;
  const len = Math.hypot(input.f, input.s);
  if (len > 0.02) {
    let nx = (input.s / len) * SPEED * dt;
    let nz = (-input.f / len) * SPEED * dt;
    if (firstPerson) {
      // Forward is where you are facing, not where the world's -z happens to
      // be. Without this, turning around makes W walk you backwards.
      const sin = Math.sin(look.yaw), cos = Math.cos(look.yaw);
      const f = (input.f / len) * SPEED * dt;
      const r = (input.s / len) * SPEED * dt;
      nx = f * sin + r * cos;
      nz = f * cos - r * sin;
    }
    const p = kevin.group.position;
    // Each world holds you differently, so the crib does not get the street's
    // limits and vice versa.
    if (worldId === 'crib') {
      p.x = clamp(p.x + nx, CRIB.x - CRIB.w / 2 + 0.5, CRIB.x + CRIB.w / 2 - 0.5);
      p.z = clamp(p.z + nz, CRIB.front + 0.5, CRIB.z + CRIB.d / 2 - 0.5);
      // Furniture still blocks; back out of anything we have ended up inside.
      for (let i = 0; i < 6 && depthAt(p.x, p.z) > 0; i++) {
        p.x -= nx * 0.34;
        p.z -= nz * 0.34;
      }
    } else {
    // Inside, you are held by the room. Outside, by the street.
    const inRoom = p.z <= ROOM.d / 2;
    // And you cannot walk up the SIDE of the gym. Without this the x limit
    // changes the instant you cross z=7, so stepping north at the left edge of
    // the street teleports you fifteen metres sideways into the doorway — which
    // was already true on the right before the crib existed, just harder to
    // reach. Holding z back wherever x is outside the room's width means the
    // limit only ever changes where the two agree.
    const throughDoor = Math.abs(p.x) <= ROOM.w / 2 - 0.7;
    const lim = {
      x0: inRoom ? -(ROOM.w / 2 - 0.7) : CRIB.x - CRIB.w / 2 - 0.7,
      x1: inRoom ? ROOM.w / 2 - 0.7 : YARD.x,
      z0: throughDoor ? -YARD.z : ROOM.d / 2 + 0.5,
      z1: YARD.z,
    };

    // Resolve each axis separately so sliding along a prop feels right rather
    // than sticking to it.
    for (const [axis, d, lo, hi] of [['x', nx, lim.x0, lim.x1], ['z', nz, lim.z0, lim.z1]]) {
      const was = p[axis];
      const before = depthAt(p.x, p.z);
      p[axis] = clamp(p[axis] + d, lo, hi);
      // Allow the move if it lands clear, or if it is digging you out.
      if (depthAt(p.x, p.z) > 0 && depthAt(p.x, p.z) >= before) p[axis] = was;
    }
    }

    kevin.group.rotation.y = firstPerson ? look.yaw : Math.atan2(nx, nz);
    if (kevin.sprite) kevin.facing = Math.atan2(nx, nz);
    const walk = Math.sin(now / 110) * 0.6;
    kevin.legs[0].rotation.x = walk;
    kevin.legs[1].rotation.x = -walk;
    kevin.arms[0].rotation.x = -walk * 0.7;
    kevin.arms[1].rotation.x = walk * 0.7;
    if (Math.sin(now / 110) > 0.97 && now - lastStep > 220) { play('step'); lastStep = now; }
  } else {
    const idle = Math.sin(now / 620) * 0.04;
    kevin.group.position.y = idle * 0.5;
    for (const l of kevin.legs) l.rotation.x *= 0.85;
    for (const a of kevin.arms) a.rotation.x = a.rotation.x * 0.85 + idle;
  }

  // Proximity, not raycasting — you walk up to a machine, you do not aim at it.
  // Everything walk-up-able is in one list now: the three stations, the three
  // market stalls, and the window at the fry house. Scanning two lists is how
  // you end up with a stall that shows a prompt and a station that does not.
  let best = null;
  let bestD = 2.6;
  for (const pl of places) {
    if (pl.kind === 'station' && !pl.station.object) continue;
    const d = Math.hypot(kevin.group.position.x - pl.x, kevin.group.position.z - pl.z);
    if (d < bestD) { bestD = d; best = pl; }
  }
  if (best !== nearest) {
    nearest = best;
    const p = $('#prompt');
    if (best) {
      const tap = matchMedia('(pointer:coarse)').matches ? 'tap' : 'E';
      p.innerHTML = `${best.label} — <b>${tap}</b>${best.note ? ` · ${best.note}` : ''}`;
      p.classList.add('on');
      $('#act').textContent = best.act;
    } else {
      p.classList.remove('on');
    }
  }

  // The sheet runs off whether he moved this frame, and needs the camera's
  // heading to know which way he is facing relative to the viewer.
  if (kevin.sprite) {
    kevin.step(dt, len > 0.02, Math.atan2(
      camera.position.x - kevin.group.position.x,
      camera.position.z - kevin.group.position.z));
  }

  if (input.act && nearest) enter(nearest);
  input.act = false;
}

/** What pressing E at a place does. One switch, so adding a place is one line. */
function enter(pl) {
  if (pl.kind === 'station') return startWorkout(pl.station);
  if (pl.kind === 'shop') return openShop();
  if (pl.kind === 'nft') return openCrew();
  if (pl.kind === 'work') return clockIn();
  if (pl.kind === 'cards') return openCards();
  if (pl.kind === 'map') return openMap();
  if (pl.kind === 'door') return travel(pl.to);
}

/**
 * The card room, in a frame rather than a link.
 *
 * /poker is a whole page of its own and works standing alone, so this does not
 * reimplement it — it borrows it. Navigating away instead would drop the 3D
 * scene, the walk back and the save, and coming back would cost a full reload
 * of three hundred megabytes of gym. The frame is loaded on first open and kept
 * afterwards, so sitting down a second time is instant.
 */
let cardsFrame = null;
function openCards() {
  if (set) abortSet();
  play('ui');
  if (!cardsFrame) {
    cardsFrame = document.createElement('iframe');
    cardsFrame.title = "Kevin's card room";
    cardsFrame.src = '../poker/';
    $('#cardsBody').append(cardsFrame);
  }
  $('#cards').classList.add('on');
}

function openMap() {
  if (set) abortSet();
  play('ui');
  $('#map').classList.add('on');
}

/**
 * Leaving one world for another. Not fast travel any more — they are separate
 * scenes now, so this is the only way between them.
 */
function goWorld(id) {
  if (!WORLDS[id]) return;
  $('#map').classList.remove('on');
  play('ui');
  travel(id);
}

// --- floating numbers -------------------------------------------------------
// Screen-space, over the character's head. In-scene text would cost a draw call
// and alias; an absolutely-positioned div costs nothing and stays crisp.

const proj = new THREE.Vector3();
function floatText(text, cls) {
  const st = set?.station;
  proj.set(
    st ? st.x : kevin.group.position.x,
    (st ? 1.4 : kevin.group.position.y + 2.2),
    st ? st.z : kevin.group.position.z
  ).project(camera);
  const el = document.createElement('div');
  el.className = `float ${cls}`;
  el.textContent = text;
  el.style.left = `${(proj.x * 0.5 + 0.5) * 100}%`;
  el.style.top = `${(-proj.y * 0.5 + 0.5) * 100}%`;
  $('#floaters').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// --- hud --------------------------------------------------------------------

let toastTimer = null;
function toast(html, ms = 2000) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function refreshHud() {
  const set = (bar, num, v, max = 100) => {
    $(bar).style.width = `${clamp((v / max) * 100, 0, 100)}%`;
    $(num).textContent = Math.round(v);
  };
  set('#barMuscle', '#numMuscle', state.muscle);
  set('#barStam', '#numStam', state.stamina);
  set('#barStreak', '#numStreak', state.streak, 14);
  $('#numCoin').textContent = Math.round(state.coin);

  const rk = rankOf(state.muscle);
  $('#rankName').textContent = rk.name;
  $('#barRank').style.width = `${rk.progress * 100}%`;
  $('#rankNext').textContent = rk.next
    ? `${rk.toNext.toFixed(1)} to ${rk.next}`
    : 'Top rank. There is nothing above this.';

  const sets = state.goalDay === Math.floor(Date.now() / 86400000) ? (state.goalSets || 0) : 0;
  const hit = sets >= DAILY_GOAL;
  $('#goal').classList.toggle('done', hit);
  $('#goalText').textContent = hit ? `Today done · ${sets} sets` : `Today · ${sets} of ${DAILY_GOAL} sets`;
  $('#goalBar').style.width = `${Math.min(100, (sets / DAILY_GOAL) * 100)}%`;

  // The most important line on the screen. Everything else is decoration.
  const loss = projectedLoss(state);
  const slowed = Date.now() < state.decaySlowUntil;
  $('#warn').innerHTML = state.muscle < 1
    ? 'Nothing to lose yet. Work a station.'
    : `Skip tomorrow and you lose <b>${loss.toFixed(1)} muscle</b>.` +
      `<br><small>${slowed ? 'Shake active — decay halved. ' : ''}` +
      `${state.freezes} protein shake${state.freezes === 1 ? '' : 's'} spare · ` +
      `one set keeps the streak.</small>`;
}

// --- the market -------------------------------------------------------------

function openShop() {
  if (set) abortSet();
  play('ui');
  renderShop();
  $('#shop').classList.add('on');
}

function openCrew() {
  if (set) abortSet();
  play('ui');
  renderCrew();
  $('#nft').classList.add('on');
}

/**
 * The crew stall.
 *
 * Draws the same 32x32 grids the game extrudes into heads, so what is on the
 * stall is exactly what walks around the room — no separate art to fall out of
 * step with the game.
 *
 * It sells nothing, and that is deliberate. There is no contract and no mint,
 * and a stall that took money for a token which does not exist is the one
 * thing in this build that could actually cost somebody something. So it shows
 * the art and says plainly where it has got to.
 */
function renderCrew() {
  const grid = $('#nftGrid');
  const crew = CREW?.crew ?? [];
  $('#nftNote').textContent = crew.length
    ? 'Pick who you walk around as. Nothing here is minted or for sale — there is no contract yet, so nothing checks who owns what and everybody can wear everybody. When that changes, this is where it gets wired in.'
    : 'The crew could not be loaded. Reload and they should turn up.';

  // Drawn once — the art never changes. Only the selection does, and that is
  // re-marked below on every open.
  if (!grid.childElementCount) {
    const frag = document.createDocumentFragment();
    // Kevin is not a token. He is index 0 and he is the default.
    frag.append(pickTile(0, 'KEVIN', null));
    for (let i = 1; i < crew.length; i++) {
      frag.append(pickTile(i, '#' + String(i).padStart(3, '0'), crew[i]));
    }
    grid.append(frag);
  }
  for (const el of grid.querySelectorAll('figure')) {
    el.classList.toggle('on', Number(el.dataset.id) === (state.crewId ?? 0));
  }
}

/** One selectable face. Kevin gets his own tile because he has no grid. */
function pickTile(id, label, grid) {
  const fig = document.createElement('figure');
  fig.dataset.id = String(id);
  fig.setAttribute('role', 'button');
  fig.tabIndex = 0;
  fig.append(grid ? gridCanvas(grid) : kevinTile());
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  fig.append(cap);
  return fig;
}

/** A drawn stand-in for Kevin's tile — he is modelled, so there is no grid. */
function kevinTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const ell = (cx, cy, rx, ry, fill) => {
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    x.fillStyle = fill;
    x.fill();
  };
  x.fillStyle = '#B0141B';
  ell(6.5, 15, 2.6, 6.4, '#B0141B');
  ell(25.5, 15, 2.6, 6.4, '#B0141B');
  ell(16, 13, 10, 9.5, '#E02128');
  ell(12.4, 12.6, 3.4, 4.8, '#FFFFFF');
  ell(19.6, 12.6, 3.4, 4.8, '#FFFFFF');
  ell(12.7, 14.2, 1.3, 2.1, '#0B0B0B');
  ell(19.3, 14.2, 1.3, 2.1, '#0B0B0B');
  ell(16, 21, 7.2, 4.4, '#F2E4C4');
  ell(16, 30, 8.5, 5, '#E02128');
  return c;
}

/** One 32x32 grid, painted at native size and scaled up by CSS. */
function gridCanvas(g) {
  const c = document.createElement('canvas');
  c.width = g.w;
  c.height = g.h;
  const x = c.getContext('2d');
  for (let i = 0; i < g.cells.length; i++) {
    const colour = g.palette[g.cells[i]];
    if (!colour || colour === 'none') continue;
    x.fillStyle = colour;
    x.fillRect(i % g.w, Math.floor(i / g.w), 1, 1);
  }
  return c;
}

// --- the shift --------------------------------------------------------------
// Clock in at the window, fill orders, get paid. The queue behind the panel is
// real geometry rather than a picture: the customers are crew bodies standing
// on the marks in QUEUE, and they leave when they are served or when they have
// waited long enough to give up.

let parked = null;                     // where the player stood before clocking in

function clockIn() {
  if (shift) return;
  if (set) abortSet();
  play('ui');

  parked = kevin.group.position.clone();
  // Behind the counter, facing the queue.
  kevin.group.position.set(-2.5, 0, FRY.counterZ - 1.5);
  kevin.group.rotation.y = Math.PI;

  // Three-quarters from the front left: the queue leads away to the window, so
  // you can see who is next as well as who you are serving. Straight over the
  // shoulder shows four backs, and side-on from far enough to fit them all in
  // frames most of the forecourt instead.
  // Aimed low on purpose. The order panel owns the bottom third of the screen,
  // and anything at eye level ends up behind it — aiming at the queue's feet
  // lifts their heads into the clear half.
  shiftCam = {
    // On the customer's side of the counter, which moved when the building
    // was turned round to face the camera.
    // Over the player's shoulder from behind the counter, looking at the queue.
    pos: new THREE.Vector3(-2.5, 3.4, FRY.counterZ - 6.2),
    at: new THREE.Vector3(-2.2, 1.1, FRY.counterZ + 1.4),
  };

  shift = new Shift(performance.now());
  spawnCustomers();
  document.body.classList.add('working');
  $('#prompt').classList.remove('on');
  $('#shift').classList.add('on');
  renderTray();
  renderShift();
}

function clockOff({ paid = false } = {}) {
  if (!shift) return;
  const r = shift.result();
  shift = null;
  shiftCam = null;
  clearCustomers();
  document.body.classList.remove('working');
  $('#shift').classList.remove('on');
  if (parked) { kevin.group.position.copy(parked); parked = null; }
  nearest = null;                       // so the prompt re-arms when you step away

  if (!paid) return null;
  payShift(state, r, Date.now());
  save(state);
  refreshHud();
  refreshBoard();
  return r;
}

function finishShift() {
  const r = clockOff({ paid: true });
  if (!r) return;
  play(r.clean ? 'rank' : 'set');
  shake = r.clean ? 0.5 : 0.2;
  $('#resultTitle').textContent = r.title;
  $('#resultBody').innerHTML =
    `<span>+${r.coin}</span> $KEVIN<br>` +
    `${r.served}/${SHIFT_LENGTH} served` +
    `${r.walked ? ` · ${r.walked} walked out` : ''}` +
    `${r.bonus ? `<br><small style="opacity:.7">+${r.bonus} bonus</small>` : ''}`;
  $('#result').classList.add('on');
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => $('#result').classList.remove('on'), 3000);
}

/** Called every frame while a shift is up. */
function tickShift(now) {
  const ev = shift.tick(now);
  if (ev?.walked) {
    play('deny');
    floatText('WALKED OUT', 'miss');
    shuffleQueue();
  }
  if (shift.done) { finishShift(); return; }

  const left = shift.patienceLeft(now);
  const bar = $('#patience');
  bar.style.width = (left * 100).toFixed(1) + '%';
  bar.classList.toggle('low', left < 0.34);
}

function pressItem(id) {
  if (!shift) return;
  const before = shift.index;
  const r = shift.press(id, performance.now());
  const btn = $(`#tray button[data-id="${id}"]`);
  if (btn) {
    btn.classList.add(r.ok ? 'hit' : 'bad');
    setTimeout(() => btn.classList.remove('hit', 'bad'), 160);
  }
  if (!r.ok) play('miss');
  else if (r.served) play('buy');
  else play('good');

  if (r.served) {
    floatText(`+${r.pay}`, r.fast ? 'perfect' : 'good');
    shuffleQueue();
  } else if (r.walked && shift.index !== before) {
    shuffleQueue();
  }
  if (shift.done) { finishShift(); return; }
  renderShift();
}

function renderShift() {
  if (!shift) return;
  const o = shift.order;
  if (!o) return;
  $('#shiftWho').textContent = o.name;
  $('#shiftCount').textContent = `customer ${shift.index + 1} of ${SHIFT_LENGTH} · ${shift.coin} earned`;

  // Wants, in the order they were asked for, ticked off as the bag fills. A
  // count would be smaller; a row of what is left is what you can act on
  // without reading.
  const left = shift.remaining().slice();
  $('#order').innerHTML = o.want.map((id) => {
    const i = left.indexOf(id);
    const outstanding = i !== -1;
    if (outstanding) left.splice(i, 1);
    const it = ITEMS.find((t) => t.id === id);
    return `<span class="want${outstanding ? '' : ' done'}" title="${it.label}">${it.icon}</span>`;
  }).join('');
}

function renderTray() {
  $('#tray').innerHTML = ITEMS.map((it) =>
    `<button data-id="${it.id}"><span>${it.icon}</span>${it.label}<small>${it.key}</small></button>`
  ).join('');
}

// --- the queue --------------------------------------------------------------

function spawnCustomers() {
  clearCustomers();
  const crew = CREW?.crew ?? [];
  if (!crew.length) return;
  for (let i = 0; i < QUEUE.length; i++) {
    customers.push(makeCustomer(crew, i));
  }
}

/**
 * One person in the queue.
 *
 * Same body the crew inside use, with a build of its own — without
 * applyCrewMuscle every customer is the same untouched beanpole, and four
 * identical strangers read as a rendering bug rather than as a queue.
 */
function makeCustomer(crew, i) {
  const mat = toon('#FFFFFF', { vertexColors: true });
  mat.userData.outlineParameters = { thickness: 0.010, color: [0, 0, 0], alpha: 1 };
  const body = buildCrewBody(crew[1 + Math.floor(Math.random() * (crew.length - 1))], { material: mat });
  body.group.rotation.order = 'YXZ';
  applyCrewMuscle(body, 0.1 + Math.random() * 0.75);
  const spot = QUEUE[Math.min(i, QUEUE.length - 1)];
  body.group.position.set(spot.x, 0, spot.z);
  // Turned toward the counter, but angled off it so the camera gets a face
  // rather than four backs. Squarely facing the window is more correct and
  // makes the queue anonymous, which defeats the point of having people in it.
  body.group.rotation.y = -0.8 + (Math.random() - 0.5) * 0.4;
  scene.add(body.group);
  return body;
}

/** Somebody left the front of the queue. Everyone steps up. */
function shuffleQueue() {
  const gone = customers.shift();
  if (gone) scene.remove(gone.group);
  customers.forEach((c, i) => {
    if (QUEUE[i]) c.group.position.set(QUEUE[i].x, 0, QUEUE[i].z);
  });
  // Top the queue back up so the window never looks shut mid-shift.
  const crew = CREW?.crew ?? [];
  const ahead = shift ? SHIFT_LENGTH - shift.index : 0;
  if (crew.length > 1 && customers.length < Math.min(QUEUE.length, ahead)) {
    customers.push(makeCustomer(crew, customers.length));
  }
}

function clearCustomers() {
  for (const c of customers) scene.remove(c.group);
  customers.length = 0;
}

// --- the board --------------------------------------------------------------

/** Repaint the wall board. Cheap enough to call whenever a number moves. */
function refreshBoard() {
  if (!board) return;
  paintLeaderboard(board, leaderboard(state), {
    title: 'TOP OF THE GYM',
    note: 'LOCAL — THIS BROWSER ONLY',
  });
}

// --- shop -------------------------------------------------------------------
// Three items, one of each kind the loop needs: more now, less lost later, and
// one that is purely a flex. No wallet, no chain, no purchase — putting crypto
// in v1 turns a game problem into a compliance problem before anyone knows
// whether the game works.

const SHOP = [
  {
    id: 'preworkout', name: 'Robinhood Crunch', cost: 120,
    blurb: '100% degen fuel. Double gains for the next 10 minutes.',
    apply(s) { s.boosterUntil = Date.now() + 600000; },
  },
  {
    id: 'shake', name: 'Protein shake', cost: 200,
    blurb: 'A spare day. Miss one and this covers it instead of your muscle.',
    can: (s) => s.freezes < 2,
    apply(s) { s.freezes = Math.min(2, s.freezes + 1); },
  },
  {
    id: 'slow', name: 'Creatine tub', cost: 340,
    blurb: 'Decay runs at half speed for three days. Does not stop it.',
    apply(s) { s.decaySlowUntil = Math.max(Date.now(), s.decaySlowUntil) + 259200000; },
  },
];

/**
 * Put the skin on without rebuilding the world.
 *
 * The player is built once and survives every world change, so a skin swap has
 * to reach into the body that is already standing there. Only the map changes —
 * same geometry, same material, same frame — which is why this is a texture
 * assignment rather than a respawn: respawning drops the barbell parented to
 * his rig and leaves it floating where he stood.
 */
function wearSkin(name) {
  state.skin = name;
  save(state);
  // The built body is the common case: repaint it and we are done.
  if (kevin && !kevin.sprite) { paintBody(kevin, skinRGB()); return; }
  const tex = skinnedAtlas();
  if (!tex || !kevin?.sprite || !kevin.mesh?.material) return;
  const old = kevin.mesh.material.map;
  // sprite.js clones and sets repeat/offset for the atlas cell it shows, so
  // carry those over or he snaps back to frame 0 facing the wrong way.
  tex.wrapS = old.wrapS; tex.wrapT = old.wrapT;
  tex.magFilter = old.magFilter; tex.minFilter = old.minFilter;
  tex.generateMipmaps = old.generateMipmaps;
  tex.repeat.copy(old.repeat);
  tex.offset.copy(old.offset);
  tex.needsUpdate = true;
  kevin.mesh.material.map = tex;
  kevin.mesh.material.needsUpdate = true;
  old.dispose();
}

function renderShop() {
  const consumables = SHOP.map((it) => {
    const ok = state.coin >= it.cost && (!it.can || it.can(state));
    return `<div class="item"><div><h3>${it.name}</h3><small>${it.blurb}</small></div>
      <button class="buy" data-id="${it.id}"${ok ? '' : ' disabled'}>${it.cost} $KEVIN</button></div>`;
  }).join('');

  // The shelf needs the colourways, and nothing else. It used to be gated on the
  // sprite look, which meant nobody in the default build ever saw it.
  if (!atlasPalette) { $('#shopItems').innerHTML = consumables; return; }

  const owned = new Set(state.skins ?? [DEFAULT_SKIN]);
  const rows = [{ name: DEFAULT_SKIN, cost: 0, blurb: 'What you already are.' }, ...SKINS]
    .map((sk) => {
      const have = owned.has(sk.name);
      const worn = state.skin === sk.name;
      const rgb = atlasPalette.colourways?.[sk.name] ?? [216, 28, 36];
      const swatch = `<i class="swatch" style="background:rgb(${rgb.join(',')})"></i>`;
      const btn = worn
        ? '<button class="buy" disabled>Worn</button>'
        : have
          ? `<button class="buy wear" data-skin="${sk.name}">Wear</button>`
          : `<button class="buy skin" data-skin="${sk.name}"${state.coin >= sk.cost ? '' : ' disabled'}>${sk.cost} $KEVIN</button>`;
      return `<div class="item"><div><h3>${swatch}${sk.name}</h3><small>${sk.blurb}</small></div>${btn}</div>`;
    }).join('');

  // The contract shelf. Six colours that ARE the address, in order, so reading
  // the shelf top to bottom is reading the CA — which is the point of it.
  const sixOwned = CONTRACT_SKINS.filter((s) => !s.tail).every((s) => owned.has(s.name));
  const caRows = CONTRACT_SKINS.map((sk) => {
    const have = owned.has(sk.name);
    const worn = state.skin === sk.name;
    const locked = sk.tail && !sixOwned;
    const swatch = `<i class="swatch" style="background:rgb(${sk.rgb.join(',')})"></i>`;
    const btn = worn
      ? '<button class="buy" disabled>Worn</button>'
      : locked
        ? '<button class="buy" disabled>Locked</button>'
        : have
          ? `<button class="buy wear" data-skin="${sk.name}">Wear</button>`
          : sk.tail
            ? `<button class="buy skin" data-skin="${sk.name}">Claim</button>`
            : `<button class="buy skin" data-skin="${sk.name}"${state.coin >= sk.cost ? '' : ' disabled'}>${sk.cost} $KEVIN</button>`;
    return `<div class="item"><div><h3>${swatch}<code>${sk.name}</code></h3><small>${sk.blurb}</small></div>${btn}</div>`;
  }).join('');

  $('#shopItems').innerHTML =
    `${consumables}<h3 class="shelf">Skins</h3>
     <p class="note">Yours for good once bought. Changes how Kevin looks to you — no wallet, no chain.</p>
     ${rows}
     <h3 class="shelf">The contract</h3>
     <p class="note">Six colours cut straight out of the contract address, in order.
       Chop it into sixes yourself and you get the same ones — that is the point.
       <code class="ca">${CONTRACT}</code></p>
     ${caRows}`;
}

$('#muteBtn').onclick = () => {
  setMuted(!isMuted());
  $('#muteBtn').textContent = isMuted() ? 'SOUND OFF' : 'SOUND ON';
  try { localStorage.setItem('kevin.gym.muted', isMuted() ? '1' : '0'); } catch { /* private mode */ }
  if (!isMuted()) play('ui');
};
try { if (localStorage.getItem('kevin.gym.muted') === '1') { setMuted(true); $('#muteBtn').textContent = 'SOUND OFF'; } } catch { /* private mode */ }

$('#shopBtn').onclick = () => {
  if (set) abortSet();          // it opened straight over the rep track otherwise
  play('ui');
  renderShop();
  $('#shop').classList.add('on');
};
$('#closeShop').onclick = () => { play('ui'); $('#shop').classList.remove('on'); };
$('#closeNft').onclick = () => { play('ui'); $('#nft').classList.remove('on'); };
$('#closeCards').onclick = () => { play('ui'); $('#cards').classList.remove('on'); };
$('#closeMap').onclick = () => { play('ui'); $('#map').classList.remove('on'); };
$('#worldBtn').onclick = () => openMap();
for (const b of document.querySelectorAll('#map .worlds button')) {
  b.onclick = () => goWorld(b.dataset.world);
}
$('#nftGrid').onclick = (e) => {
  const fig = e.target.closest('figure');
  if (!fig) return;
  const id = Number(fig.dataset.id);
  if (id === (state.crewId ?? 0)) return;
  play('buy');
  swapPlayer(id);
  renderCrew();
  toast(id ? `Now playing as #${String(id).padStart(3, '0')}` : 'Now playing as Kevin', 1800);
};
$('#nftGrid').onkeydown = (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.target.closest('figure')?.click();
};

// The tray, and the number keys that shadow it. Delegated, because the buttons
// are rebuilt whenever the item list changes.
$('#tray').onclick = (e) => {
  const id = e.target.closest('button')?.dataset.id;
  if (id) pressItem(id);
};
$('#clockOff').onclick = () => { play('ui'); finishShift(); };
$('#shopItems').onclick = (e) => {
  const btn = e.target.closest('.buy');
  const skin = btn?.dataset.skin;
  if (skin) {
    const owned = state.skins ?? (state.skins = [DEFAULT_SKIN]);
    if (!owned.includes(skin)) {
      const ca = CONTRACT_SKINS.find((s) => s.name === skin);
      const sk = ca ?? SKINS.find((s) => s.name === skin);
      if (!sk) { play('deny'); return; }
      // The tail is not for sale at any price. It opens when the other six are
      // yours, by which point you have read the address enough times to know it.
      if (ca?.tail && !CONTRACT_SKINS.filter((s) => !s.tail).every((s) => owned.includes(s.name))) {
        play('deny');
        return;
      }
      if (state.coin < sk.cost) { play('deny'); return; }
      state.coin -= sk.cost;
      owned.push(skin);
      play('buy');
      const done = ca && !ca.tail &&
        CONTRACT_SKINS.filter((s) => !s.tail).every((s) => owned.includes(s.name));
      toast(done
        ? `${skin}.<br><small>That is the whole address. The last four is yours to claim.</small>`
        : `${skin}.<br><small>Yours. Wearing it now.</small>`, done ? 3600 : 2000);
    } else {
      play('ui');
    }
    wearSkin(skin);
    refreshHud();
    renderShop();
    return;
  }
  const id = btn?.dataset.id;
  if (!id) return;
  const it = SHOP.find((s) => s.id === id);
  if (!it || state.coin < it.cost || (it.can && !it.can(state))) { play('deny'); return; }
  state.coin -= it.cost;
  it.apply(state);
  save(state);
  refreshHud();
  renderShop();
  play('buy');
  toast(`${it.name}.<br><small>Bought. Noted.</small>`, 1800);
};

// --- input ------------------------------------------------------------------

const keys = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'e' || k === ' ') { input.act = true; e.preventDefault(); }
  // 1-4 fill the bag. Only while a shift is up, so they stay free elsewhere.
  if (shift) {
    const it = ITEMS.find((t) => t.key === k);
    if (it) { pressItem(it.id); e.preventDefault(); }
  }
  if (k === 'escape') {
    if (shift) finishShift();
    else if (set) abortSet();
    else { $('#shop').classList.remove('on'); $('#nft').classList.remove('on'); }
  }
  // Trying to walk out of a set means you want out of the set.
  if (set && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) abortSet();
  readKeys();
});
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); readKeys(); });
addEventListener('blur', () => { keys.clear(); readKeys(); });

function readKeys() {
  input.f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  // In first person the arrows turn instead of strafing — WASD moves, arrows
  // look, which is the layout somebody who has never used a mouse-look game
  // will try first.
  input.s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (!firstPerson) {
    input.s += (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
  }
  input.turn = firstPerson
    ? (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)
    : 0;
}

if (matchMedia('(pointer:coarse)').matches) document.body.classList.add('touch');

// --- looking around, in first person ---------------------------------------
// Drag on the canvas. Not pointer lock: it needs a click to arm, some embedded
// webviews refuse it outright, and it does nothing at all on a phone — and this
// has to work in a Telegram browser before it has to feel like Quake.
let lookId = null;
let lookAt = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!firstPerson || lookId !== null) return;
  lookId = e.pointerId;
  lookAt = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  lookBy(e.clientX - lookAt.x, e.clientY - lookAt.y);
  lookAt = { x: e.clientX, y: e.clientY };
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(ev, (e) => { if (e.pointerId === lookId) { lookId = null; } });
}

const stick = $('#stick');
const knob = stick.querySelector('i');
let stickId = null;
const R = 44;
stick.addEventListener('pointerdown', (e) => {
  stickId = e.pointerId;
  stick.setPointerCapture(e.pointerId);
  dragStick(e);
});
stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) dragStick(e); });
for (const ev of ['pointerup', 'pointercancel']) {
  stick.addEventListener(ev, () => {
    stickId = null;
    input.f = input.s = 0;
    knob.style.transform = '';
  });
}
function dragStick(e) {
  if (set) abortSet();
  const r = stick.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, R / d);
  dx *= k; dy *= k;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  input.s = dx / R;
  input.f = -dy / R;
}
$('#act').onclick = () => { input.act = true; };

$('#start').onclick = () => {
  $('#start').disabled = true;
  booting('Opening…');
  // Every wait inside init() is bounded now, but a slow device can still take
  // longer than anyone will sit through. Say so, with something to press,
  // rather than leaving the button reading "Opening…" indefinitely.
  const watchdog = setTimeout(() => {
    if (!$('#boot').classList.contains('gone')) {
      fail('The gym is taking longer than it should. Check your connection and try again.');
    }
  }, BOOT_TIMEOUT);
  init()
    .then(() => clearTimeout(watchdog))
    .catch((e) => {
      clearTimeout(watchdog);
      fail(`Could not start: ${e.message}`);
    });
};

// Re-settle when the tab comes back after a long time away, so somebody who
// leaves it open overnight sees the same thing as somebody who closed it.
addEventListener('visibilitychange', () => {
  if (document.hidden || !kevin) return;
  const gone = settle(state, Date.now());
  if (gone.lost > 0.05) {
    save(state);
    applyMuscle(kevin, state.muscle / 100);
    refreshHud();
  }
});

// Decay is time-based, so the projection goes stale just sitting there.
setInterval(() => { if (kevin) refreshHud(); }, 30000);

export { DECAY_PER_DAY };
