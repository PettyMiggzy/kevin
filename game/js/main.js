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
import { load, save, settle, workout, projectedLoss, DECAY_PER_DAY, DAILY_GOAL } from './save.js';
import { buildCrewBody, applyCrewMuscle } from './voxel.js';
import { Set as RepSet, REPS_PER_SET, rankOf } from './reps.js';
import { play, setMuted, isMuted } from './audio.js';

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
 * Tripo hands back photoreal PBR. Left alone, twelve models from twelve prompts
 * read as an asset flip — this is the pass that makes them read as one hand.
 * Keep each material's base colour, throw away everything else that says
 * "renderer": metalness, roughness, normal and env maps, and the map itself.
 */
function normalise(root, { outline = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const base = src?.color ? src.color.clone() : new THREE.Color('#B9B2A6');
    // Tripo's albedo often bakes in lighting, which fights a flat ramp. Push
    // the colour up and desaturate slightly so the bands stay readable.
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    base.setHSL(hsl.h, Math.min(0.85, hsl.s * 0.9), clamp(hsl.l * 1.15 + 0.06, 0.16, 0.92));
    const m = toon(base);
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
function place(obj, { x = 0, z = 0, width = 1, rotY = 0 }) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = width / Math.max(size.x, size.z);
  obj.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c = box2.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, -box2.min.y, z - c.z);
  obj.rotation.y = rotY;
  return obj;
}

// --- the room ---------------------------------------------------------------

const ROOM = { w: 18, d: 14, h: 4.4 };

function buildRoom(scene) {
  const flat = (color) => {
    const m = toon(color);
    m.userData.outlineParameters = { visible: false };  // outlining the room makes a cage
    return m;
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w + 14, ROOM.d + 14), flat(PALETTE.floor));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // A rubber mat marks the free-weight area without another model.
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.6), flat(PALETTE.mat));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(-4.2, 0.01, 1.2);
  scene.add(mat);

  const wall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(PALETTE.wall));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
    // A red band at head height, so the walls have a horizon and the room
    // reads as a place rather than a box.
    const band = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.34), flat(PALETTE.trim));
    band.position.set(x, 2.5, z);
    band.rotation.y = ry;
    band.translateZ(0.02);
    scene.add(band);
  };
  wall(ROOM.w, ROOM.h, 0, ROOM.h / 2, -ROOM.d / 2, 0);
  wall(ROOM.d, ROOM.h, -ROOM.w / 2, ROOM.h / 2, 0, Math.PI / 2);
  wall(ROOM.d, ROOM.h, ROOM.w / 2, ROOM.h / 2, 0, -Math.PI / 2);

  return { floor };
}

// --- stations ---------------------------------------------------------------
// Two code paths, three things to walk up to: bench and dumbbells both feed
// strength, the treadmill feeds stamina. Deliberately no minigame — v1 tests
// whether people come back, and a timing bar would confound that with whether
// the minigame is fun.

const STATIONS = [
  {
    id: 'bench', prop: 'bench', label: 'Bench press',
    x: -4.4, z: 1.4, width: 2.2, rotY: Math.PI / 2,
    stat: 'muscle', gain: 3.0, coin: 10,
    sweep: 0.80, window: 0.115,          // slow sweep, tight band — heavy and precise
    lines: ['That is a set.', 'Chest day. Every day is chest day.', 'Two more than last time.'],
  },
  {
    id: 'rack', prop: 'dumbbell-rack', label: 'Dumbbells',
    x: -7.2, z: -4.4, width: 3.0, rotY: 0,
    stat: 'muscle', gain: 2.0, coin: 7,
    sweep: 1.35, window: 0.175,          // quick and forgiving — the warm-up
    lines: ['Curls. For the girls. And for me.', 'Light weight.', 'I do this on my break as well.'],
  },
  {
    id: 'treadmill', prop: 'treadmill', label: 'Treadmill',
    x: 5.4, z: -3.6, width: 2.6, rotY: -Math.PI / 2,
    stat: 'stamina', gain: 3.6, coin: 9,
    sweep: 1.75, window: 0.155,          // fastest sweep in the room
    lines: ['Cardio. Reluctantly.', 'I walk to work anyway.', 'This is my third shift today.'],
  },
];

// Scenery. No interaction, entirely there so the room is not three objects
// floating in a beige void.
const SCENERY = [
  ['squat-rack', { x: -1.0, z: -5.6, width: 2.4, rotY: 0 }],
  ['plate-tree', { x: 1.6, z: -5.4, width: 1.1, rotY: 0 }],
  ['locker', { x: -8.2, z: 3.6, width: 1.0, rotY: Math.PI / 2 }],
  ['locker', { x: -8.2, z: 4.9, width: 1.0, rotY: Math.PI / 2 }],
  ['water-cooler', { x: 7.6, z: 3.4, width: 0.8, rotY: -Math.PI / 2 }],
  ['protein-tub', { x: 7.4, z: 1.6, width: 0.6, rotY: 0.4 }],
  ['bucket', { x: 6.4, z: 4.6, width: 0.7, rotY: -0.3 }],
  // Loose on the floor: you step over these, so they get no collision. Left
  // solid they quietly wall off the route to the bench.
  ['dumbbell', { x: -2.6, z: 2.9, width: 0.6, rotY: 0.8, solid: false }],
  ['dumbbell', { x: -2.0, z: 3.4, width: 0.6, rotY: -0.5, solid: false }],
  ['speaker', { x: -8.6, z: -6.2, width: 0.7, rotY: 0.7 }],
  ['gym-mirror', { x: 8.7, z: -1.0, width: 3.2, rotY: -Math.PI / 2 }],
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
    const r = await fetch('../assets/crew/grids.json');
    if (!r.ok) return null;
    CREW = await r.json();
    return CREW;
  } catch {
    return null;                                     // fall back to primitives
  }
}

function makePlayer(gridIndex = 0) {
  if (!CREW?.crew?.length) return buildKevin();
  const mat = toon('#FFFFFF', { vertexColors: true });
  mat.userData.outlineParameters = { thickness: 0.010, color: [0, 0, 0], alpha: 1 };
  return buildCrewBody(CREW.crew[gridIndex % CREW.crew.length], { material: mat });
}

// --- the rest of the crew ---------------------------------------------------
// An empty gym reads as a tech demo. These are other minted crew members, each
// on a loop, and they cost almost nothing: the same voxel builder, the same
// shared material, no AI beyond a timer and a waypoint.

const NPC_SPOTS = [
  { x: -7.4, z: -3.2, ry: 0.9, mode: 'curl' },
  { x: 3.2, z: -4.8, ry: -0.4, mode: 'press' },
  { x: 7.0, z: 0.2, ry: -1.5, mode: 'idle' },
  { x: -2.2, z: -3.4, ry: 2.6, mode: 'curl' },
  { x: 6.2, z: 5.2, ry: 2.4, mode: 'idle' },
  { x: -7.8, z: -1.6, ry: 1.6, mode: 'press' },
];

function makeNpc(grid, spot, mat) {
  const body = buildCrewBody(grid, { material: mat });
  body.group.position.set(spot.x, 0, spot.z);
  body.group.rotation.y = spot.ry;
  applyCrewMuscle(body, 0.15 + Math.random() * 0.6);
  const phase = Math.random() * 10;
  const rate = 0.6 + Math.random() * 0.5;

  body.tick = (dt, now) => {
    const t = now / 1000 * rate + phase;
    if (spot.mode === 'curl') {
      const p = Math.sin(t * 2.2) * 0.5 + 0.5;
      for (const a of body.arms) a.rotation.x = -p * 1.5;
      body.group.position.y = p * 0.03;
    } else if (spot.mode === 'press') {
      const p = Math.sin(t * 1.7) * 0.5 + 0.5;
      for (const a of body.arms) a.rotation.x = -0.3 - p * 1.4;
      body.torso.rotation.x = p * 0.1;
    } else {
      // Idling still moves. A motionless figure reads as a prop, not a person.
      const b = Math.sin(t * 1.1);
      body.group.position.y = Math.abs(b) * 0.02;
      for (const a of body.arms) a.rotation.x = b * 0.12;
      body.head.rotation.y = Math.sin(t * 0.4) * 0.4;
    }
  };
  return body;
}

// --- boot -------------------------------------------------------------------

const canvas = $('#c');
let renderer, effect, scene, camera, kevin, clock;
let state = load();
const props = new Map();
const solids = [];                    // {x,z,r} circles the player cannot walk into

const input = { f: 0, s: 0, act: false };
let set = null;                       // the RepSet in progress, or null
let nearest = null;
let lastStep = 0;
let resultTimer = null;
const npcs = [];

function fail(msg) {
  $('#err').textContent = msg;
  $('#start').textContent = 'Reload';
  $('#start').onclick = () => location.reload();
}

async function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    fail('This browser could not start WebGL. The gym needs it.');
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // above 2 costs a lot and shows nothing
  renderer.setClearColor('#FFE500');

  effect = new OutlineEffect(renderer, { defaultThickness: 0.007, defaultColor: [0, 0, 0], defaultAlpha: 1 });

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#FFE500', 26, 46);
  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 120);
  clock = new THREE.Clock();

  // One key light and a flat fill. No shadow maps: a toon ramp already reads as
  // one light source, and shadows on mobile cost more than they add here.
  scene.add(new THREE.HemisphereLight('#FFFFFF', '#8A7F6A', 2.1));
  const key = new THREE.DirectionalLight('#FFFFFF', 1.5);
  key.position.set(6, 10, 5);
  scene.add(key);

  buildRoom(scene);

  await loadCrew();
  kevin = makePlayer(state.crewId ?? 0);
  kevin.group.position.set(0, 0, 3.6);
  scene.add(kevin.group);

  // Everyone shares one material, so the whole crew costs one shader.
  if (CREW?.crew?.length > 1) {
    const crewMat = toon('#FFFFFF', { vertexColors: true });
    crewMat.userData.outlineParameters = { thickness: 0.010, color: [0, 0, 0], alpha: 1 };
    NPC_SPOTS.forEach((spot, i) => {
      const grid = CREW.crew[(i + 1) % CREW.crew.length];
      const npc = makeNpc(grid, spot, crewMat);
      scene.add(npc.group);
      npcs.push(npc);
      solids.push({ x: spot.x, z: spot.z, r: 0.42 });
    });
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const need = [...new Set([...STATIONS.map((s) => s.prop), ...SCENERY.map((s) => s[0])])];
  const loaded = await Promise.all(need.map(async (name) => {
    try {
      if (INLINE?.props?.[name]) {
        const g = await loader.parseAsync(INLINE.props[name], '');
        return [name, g.scene];
      }
      const g = await loader.loadAsync(`./assets/props/${name}.glb`);
      return [name, g.scene];
    } catch {
      return [name, null];             // a missing prop must not empty the room
    }
  }));
  for (const [name, obj] of loaded) if (obj) props.set(name, obj);

  const spawn = (name, opts, tag) => {
    const src = props.get(name);
    if (!src) return null;
    const obj = normalise(src.clone(true));
    place(obj, opts);
    scene.add(obj);
    if (opts.solid !== false) solids.push({ x: opts.x, z: opts.z, r: opts.width * 0.42 });
    if (tag) obj.userData.station = tag;
    return obj;
  };

  for (const st of STATIONS) st.object = spawn(st.prop, st, st.id);
  for (const [name, opts] of SCENERY) spawn(name, opts);

  // Settle the absence before the first frame, so the number in the toast is
  // the number on the bars.
  const gone = settle(state, Date.now());
  save(state);
  applyMuscle(kevin, state.muscle / 100);
  refreshHud();
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

let shake = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (set) tickSet(dt, now);
  else move(dt, now);

  for (const n of npcs) n.tick(dt, now);

  // Chase camera, behind and above, easing in so it never snaps. Pulls in a
  // little during a set so the reps read bigger.
  const close = set ? 0.72 : 1;
  const want = tmp.set(
    kevin.group.position.x,
    kevin.group.position.y + 3.4 * close,
    kevin.group.position.z + 5.6 * close
  );
  camera.position.lerp(want, 1 - Math.pow(set ? 0.004 : 0.0015, dt));

  // Shake is a decaying impulse rather than a duration, so a perfect rep on top
  // of a perfect rep stacks instead of restarting.
  if (shake > 0.001) {
    shake *= Math.pow(0.0009, dt);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  } else shake = 0;

  camera.lookAt(kevin.group.position.x, kevin.group.position.y + 1.25, kevin.group.position.z);
  effect.render(scene, camera);
}

// --- the set ----------------------------------------------------------------

function tickSet(dt, now) {
  const st = set.station;

  if (set.armed) {
    set.tick(dt);
    $('#marker').style.left = `${set.pos * 100}%`;
    if (set.expired) gradeRep(set.timeout());
  }

  // Kevin follows the marker: he lowers on the way out and drives on the way
  // back, so the press lands at the bottom of a real movement rather than
  // somewhere in a loop that ignores you.
  const p = set.armed ? set.pos : 1;
  if (st.stat === 'muscle') {
    for (const a of kevin.arms) a.rotation.x = -0.4 - p * 1.25;
    kevin.torso.rotation.x = p * 0.12;
    kevin.group.position.y = -p * 0.06;
  } else {
    const run = Math.sin(now / 70) * 1.05;
    kevin.legs[0].rotation.x = run;
    kevin.legs[1].rotation.x = -run;
    for (const a of kevin.arms) a.rotation.x = -run * 0.6;
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
    ? 'Tap the button in the band'
    : 'Press <b>E</b> in the band';
  refreshSetUI();
  $('#set').classList.add('on');
  $('#act').textContent = 'Rep';
  kevin.group.lookAt(st.x, kevin.group.position.y, st.z);
  play('rack');
}

function finishSet() {
  const st = set.station;
  const sc = set.score();
  set = null;

  for (const a of kevin.arms) a.rotation.x = 0;
  for (const l of kevin.legs) l.rotation.x = 0;
  kevin.torso.rotation.x = 0;
  kevin.group.position.y = 0;
  $('#set').classList.remove('on');
  $('#act').textContent = st.stat === 'stamina' ? 'Run' : 'Lift';

  const before = rankOf(state.muscle).index;
  const r = workout(state, st, Date.now(), sc.mult);
  state.sessions = (state.sessions || 0) + 1;
  state.bestCombo = Math.max(state.bestCombo || 0, sc.bestCombo);
  save(state);
  applyMuscle(kevin, state.muscle / 100);
  refreshHud();

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
  const len = Math.hypot(input.f, input.s);
  if (len > 0.02) {
    const nx = (input.s / len) * SPEED * dt;
    const nz = (-input.f / len) * SPEED * dt;
    const p = kevin.group.position;
    const half = { x: ROOM.w / 2 - 0.7, z: ROOM.d / 2 - 0.7 };

    // Resolve each axis separately so sliding along a prop feels right rather
    // than sticking to it.
    for (const [axis, d, limit] of [['x', nx, half.x], ['z', nz, half.z]]) {
      const was = p[axis];
      p[axis] = clamp(p[axis] + d, -limit, limit);
      if (solids.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r + 0.34)) p[axis] = was;
    }

    kevin.group.rotation.y = Math.atan2(nx, nz);
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
  let best = null;
  let bestD = 2.4;
  for (const st of STATIONS) {
    if (!st.object) continue;
    const d = Math.hypot(kevin.group.position.x - st.x, kevin.group.position.z - st.z);
    if (d < bestD) { bestD = d; best = st; }
  }
  if (best !== nearest) {
    nearest = best;
    const p = $('#prompt');
    if (best) {
      p.innerHTML = `${best.label} — <b>${matchMedia('(pointer:coarse)').matches ? 'tap' : 'E'}</b> · ${REPS_PER_SET} reps`;
      p.classList.add('on');
      $('#act').textContent = best.stat === 'stamina' ? 'Run' : 'Lift';
    } else {
      p.classList.remove('on');
    }
  }

  if (input.act && nearest) startWorkout(nearest);
  input.act = false;
}

// --- floating numbers -------------------------------------------------------
// Screen-space, over the character's head. In-scene text would cost a draw call
// and alias; an absolutely-positioned div costs nothing and stays crisp.

const proj = new THREE.Vector3();
function floatText(text, cls) {
  proj.set(kevin.group.position.x, kevin.group.position.y + 2.2, kevin.group.position.z).project(camera);
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

function renderShop() {
  $('#shopItems').innerHTML = SHOP.map((it) => {
    const ok = state.coin >= it.cost && (!it.can || it.can(state));
    return `<div class="item"><div><h3>${it.name}</h3><small>${it.blurb}</small></div>
      <button class="buy" data-id="${it.id}"${ok ? '' : ' disabled'}>${it.cost} $KEVIN</button></div>`;
  }).join('');
}

$('#muteBtn').onclick = () => {
  setMuted(!isMuted());
  $('#muteBtn').textContent = isMuted() ? 'SOUND OFF' : 'SOUND ON';
  try { localStorage.setItem('kevin.gym.muted', isMuted() ? '1' : '0'); } catch { /* private mode */ }
  if (!isMuted()) play('ui');
};
try { if (localStorage.getItem('kevin.gym.muted') === '1') { setMuted(true); $('#muteBtn').textContent = 'SOUND OFF'; } } catch { /* private mode */ }

$('#shopBtn').onclick = () => { play('ui'); renderShop(); $('#shop').classList.add('on'); };
$('#closeShop').onclick = () => { play('ui'); $('#shop').classList.remove('on'); };
$('#shopItems').onclick = (e) => {
  const id = e.target.closest('.buy')?.dataset.id;
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
  if (k === 'escape') $('#shop').classList.remove('on');
  readKeys();
});
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); readKeys(); });
addEventListener('blur', () => { keys.clear(); readKeys(); });

function readKeys() {
  input.f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  input.s = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
}

if (matchMedia('(pointer:coarse)').matches) document.body.classList.add('touch');

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
  $('#start').textContent = 'Opening…';
  init().catch((e) => fail(`Could not start: ${e.message}`));
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
