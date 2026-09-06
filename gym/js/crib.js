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
import { signTexture, chartTexture, neonTexture, planTexture } from './gear.js';

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
  // Against the wall. At -11.2 the stand's back was 0.80m clear of it, so there
  // was a strip of dead floor behind the television that the player could see
  // straight down — and every extra centimetre of that gap also lengthened the
  // throw from the sofa, which was already 4.2m for a 1.35m set.
  tv: { x: -10.48, z: 17.4 },                        // the set, and the world map
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
  'jukebox', 'wall-lamp',
  // the desk he actually makes the money at
  'desk', 'desk-chair', 'monitor', 'keyboard', 'mouse', 'laptop', 'speaker-hifi',
  // living
  'crib-sofa', 'crib-armchair', 'coffee-table', 'tv', 'tv-stand', 'rug',
  'floor-lamp', 'bookcase', 'books', 'radio', 'potted-plant', 'plant-small',
  // kitchen
  'kitchen-cabinet', 'kitchen-upper', 'kitchen-sink', 'stove', 'fridge',
  'mini-fridge', 'microwave', 'coffee-machine', 'extractor', 'bar-stool',
  'cook-pot', 'frying-pan',
  // sleeping, clutter and the hallway
  'bed', 'pillow', 'bedside', 'table-lamp', 'side-table', 'soda-cup', 'tray-stack',
  'box-open', 'box-closed', 'doormat', 'coat-rack', 'trashcan', 'picture-frame',
];

const WOOD = '#4A3222';        // darker than v2. A card room is not a sunroom.
// Lifted from #232A33. Under the crib's own lighting the old value fell to
// effectively black away from a lamp, and a black wall is not atmosphere — it
// is an absence, and it made everything standing against one look like it was
// floating in front of nothing.
const WALL = '#2C3644';
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
  /**
   * Model if the pack has one, the boxes we drew by hand if not.
   *
   * Collision is not part of the swap — blockers and solids are pushed by the
   * caller either way, because whether you can walk through the sofa must not
   * depend on whether a download finished.
   *
   * MUTATES the opts object you pass, writing `top` — the y the placed prop
   * actually reaches. Author-time y values are guesses against a model whose
   * height nobody knows until it is loaded and scaled, and every one of those
   * guesses has been wrong at least once: a radio measured as fully inside a
   * bookcase, trophies inside the books, a row of monitors floating. Pass a
   * named object and read opts.top to stack something on top of it for real.
   */
  const fixture = (name, opts, box = () => {}) => {
    opts.solid = false;                 // set ON the caller's object, not a copy,
    return spawn?.(name, opts) ?? box(); // so opts.top survives back to them
  };

  const { x, z, w, d, h } = CRIB;
  const front = CRIB.front;
  const back = z + d / 2;
  const left = x - w / 2;
  const right = x + w / 2;

  // --- floor and shell -----------------------------------------------------
  // Lifted off y=0: the forecourt plane passes under the whole building, and
  // two surfaces at exactly zero tear as the camera moves.
  paint(w, d, WOOD, x, z, 0.01);
  // A RUG, not a shadow. This was a single 6x6 metre plane of #2A1A20 — near
  // black, hard-edged, more than a third of the floor — and from anywhere in
  // the room it read as a rendering fault rather than a floor covering: a big
  // dark triangle cutting diagonally across the boards. A rug is smaller than
  // the room, it is a colour rather than an absence of one, and it has a
  // border, because that is what tells your eye it is a rug.
  paint(5.0, 5.0, '#2A1216', CRIB.table.x, CRIB.table.z, 0.016);
  paint(4.5, 4.5, '#5A2028', CRIB.table.x, CRIB.table.z, 0.020);
  paint(4.0, 4.0, '#4A1A22', CRIB.table.x, CRIB.table.z, 0.024);

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
  solid(w, 0.18, 0.06, TRIM, x, 0.09, back - 0.16);
  // Split around the doorway. A skirting board that runs across the gap you
  // walk through is a trip hazard drawn in wood.
  solid(leftW, 0.18, 0.06, TRIM, left + leftW / 2, 0.09, front + 0.16);
  solid(rightW, 0.18, 0.06, TRIM, right - rightW / 2, 0.09, front + 0.16);
  for (const sx of [left + 0.16, right - 0.16]) solid(0.06, 0.18, d, TRIM, sx, 0.09, z);
  // Picture rail, dropped to 2.22 so it passes UNDER both neon signs rather
  // than cutting a 6 cm band across the middle of them.
  solid(w, 0.06, 0.05, '#3A2A20', x, 2.22, back - 0.16);
  solid(leftW, 0.06, 0.05, '#3A2A20', left + leftW / 2, 2.22, front + 0.16);
  solid(rightW, 0.06, 0.05, '#3A2A20', right - rightW / 2, 2.22, front + 0.16);
  for (const sx of [left + 0.16, right - 0.16]) solid(0.05, 0.06, d, '#3A2A20', sx, 2.22, z);

  // --- the neon, which is the first thing you see ---------------------------
  // Over the door on the inside, facing the room. A sign facing the street
  // would be a shop; facing in, it is somebody's front room.
  // 2.85 puts the bottom edge at 2.32, clear of the 2.22 rail, and the top at
  // 3.38 just under the 3.4 ceiling.
  quad(3.4, 1.06, neonTexture('KEVIN', { fg: '#FF3B4E' }), x, 2.85, front + 0.17);
  quad(2.2, 0.69, neonTexture('KEK', { fg: '#3FD07A' }), left + 0.18, 2.78, 20.4, Math.PI / 2);

  // --- the card room, left end ---------------------------------------------
  const t = CRIB.table;
  const tbl = { x: t.x, z: t.z, width: 1.9 };
  fixture('card-table', tbl, () => {
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 24), flat('#1F6B44'));
    felt.position.set(t.x, 0.78, t.z);
    scene.add(felt);
    solid(0.9, 0.72, 0.9, '#3A2A1C', t.x, 0.38, t.z);
    solid(1.5, 0.12, 1.5, '#3A2A1C', t.x, 0.06, t.z);
  });
  // On the cloth, at whatever height the cloth turned out to be. A hardcoded
  // 0.78 against a table whose top measures 0.76 showed two centimetres of
  // green daylight under every chip stack.
  const felt = tbl.top ?? 0.76;
  fixture('poker-chips', { x: t.x - 0.46, z: t.z - 0.36, width: 0.32, y: felt });
  fixture('poker-chips', { x: t.x + 0.5, z: t.z + 0.2, width: 0.26, y: felt, rotY: 0.7 });
  fixture('playing-cards', { x: t.x + 0.36, z: t.z + 0.44, width: 0.36, y: felt, rotY: 0.4 });
  // A hand in front of two of the seats, so it reads as a game somebody is
  // playing rather than a table with three objects clustered on one side.
  fixture('playing-cards', { x: t.x - 0.62, z: t.z + 0.58, width: 0.3, y: felt, rotY: 2.4 });
  fixture('playing-cards', { x: t.x + 0.58, z: t.z - 0.56, width: 0.3, y: felt, rotY: -0.9 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = t.x + Math.sin(a) * 1.5, cz = t.z + Math.cos(a) * 1.5;
    fixture('card-chair', { x: cx, z: cz, width: 0.54, rotY: a + Math.PI }, () => {
      solid(0.42, 0.1, 0.42, '#5A3A24', cx, 0.44, cz, null, a);
      solid(0.42, 0.5, 0.1, '#5A3A24', cx - Math.sin(a) * 0.2, 0.7, cz - Math.cos(a) * 0.2, null, a);
    });
    solids.push({ x: cx, z: cz, r: 0.32 });
  }
  // 1.95, not 2.25. At 2.25 its lowest point was 1.49m above the felt — a
  // ceiling fixture in a hall, not the low lamp that makes a card table a card
  // table. 1.95 puts it 1.19m over the cloth and still 33cm above eye height,
  // so it lights the game without standing in front of the player's face.
  const chan = { x: t.x, z: t.z, width: 1.0, y: 1.95 };
  fixture('chandelier', chan, () => {
    solid(1.5, 0.30, 1.5, RED, t.x, 2.15, t.z);
  });
  // A stem up to the ceiling. It hung with a 0.4 m gap above it and nothing
  // holding it, which reads as a bug rather than a light. chan.top is where the
  // model actually reaches once placed and scaled, not a guess at it.
  const chanTop = chan.top ?? 2.95;
  if (chanTop < h - 0.04) solid(0.05, h - chanTop, 0.05, '#1A1A1A', t.x, (chanTop + h) / 2, t.z);
  // One warm pool of light is the whole mood of a card room, and it survives
  // whether or not the chandelier model loaded.
  //
  // ON THE FLOOR. It was a 3-metre horizontal plane floating at y 0.95, which
  // is chair-back height — so a translucent gold sheet cut clean through the
  // backrest of all four chairs and out the other side. A pool of light goes
  // where light pools.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), flat(GOLD));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(t.x, 0.028, t.z);
  glow.material.transparent = true;
  glow.material.opacity = 0.13;
  scene.add(glow);
  solids.push({ x: t.x, z: t.z, r: 1.25 });

  // The machines along the left wall. A slot machine in a memecoin's flat is
  // the joke telling itself, so it stands where you pass it on the way in.
  /**
   * Take a model down a stop, artwork and all.
   *
   * These cabinets carry their colour in a TEXTURE. brand.js reads material
   * colours, so what it actually repaints is their default white base — which
   * warms the atlas but cannot quieten it. The result was primary-coloured
   * boxes in a charcoal flat: the loudest things in the room, and a large part
   * of why it read as a toybox. Scaling the material colour multiplies through
   * the map, and through vertex colours too, which is the only handle there is.
   */
  const knock = (obj, k) => obj?.traverse?.((o) => {
    if (!o.isMesh) return;
    for (const mm of Array.isArray(o.material) ? o.material : [o.material]) {
      mm?.color?.multiplyScalar(k);
    }
  });

  // SIZED LIKE MACHINES, not like toys. `width` rescales a model so its larger
  // horizontal footprint is that many metres, and a cabinet's footprint is much
  // smaller than its height — so asking for 0.95 across gave four machines
  // between 1.21 and 1.41 tall. At an eye height of 1.62 the player looked DOWN
  // on all of them, which is most of why this wall read as a toybox. A real
  // cabinet is about 1.75, so that is what each is scaled to reach.
  for (const [name, mx, mz, mw] of [
    ['slot-machine', left + 0.85, 15.0, 1.18],
    ['prize-wheel', left + 0.85, 16.5, 1.24],
    ['claw-machine', left + 0.85, 18.1, 1.30],
    ['arcade-machine', left + 0.85, 21.1, 1.30],
  ]) {
    const cab = fixture(name, { x: mx, z: mz, width: mw, rotY: Math.PI / 2 }, () => {
      solid(0.7, 1.75, mw, '#3A3A48', mx, 0.875, mz);
      solid(0.1, 0.5, mw * 0.7, '#101018', mx + 0.35, 1.3, mz);
    });
    knock(cab, 0.52);
    solids.push({ x: mx, z: mz, r: mw * 0.5 });
  }
  // A card room wants a jukebox more than it wants another lamp, and this one
  // was already in the repo unplaced — ingested with the diner kit and never
  // given a home.
  // Knocked back with its neighbours. It stood 1.7m from four cabinets at 52%
  // and was left at full brightness — and at 1.99m it is the tallest thing in
  // the corner, so the eye went straight to the one object nobody had touched.
  knock(fixture('jukebox', { x: -23.4, z: 21.3, width: 1.1, rotY: Math.PI / 4 }, () => {
    solid(0.9, 1.5, 0.6, '#7A2A24', -23.4, 0.75, 21.3);
  }), 0.52);
  solids.push({ x: -23.4, z: 21.3, r: 0.6 });
  // A roulette wheel needs a table under it, and it had a console 0.27m deep
  // with a 0.70m wheel balanced on it — at a hardcoded y that missed the
  // console's real top by 19cm, so the wheel hung in mid-air over a table too
  // small to hold it anyway. A turned plinth is three lines and it is right.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 0.72, 20), flat('#3A2A1C'));
  plinth.position.set(-21.0, 0.36, 21.4);
  scene.add(plinth);
  const rw = { x: -21.0, z: 21.4, width: 0.78, y: 0.72 };
  // Exempt from BOTH the palette and the dim: it is vertex-coloured with no
  // material of its own, so normalise() gives it a white base and lets its own
  // colours through untouched. Next to cabinets at 52% it was the most
  // saturated thing in the corner. Less of a knock than they get — it is the
  // hero of this end of the room — but not none.
  knock(fixture('roulette-wheel', rw), 0.78);
  solids.push({ x: -21.0, z: 21.4, r: 0.5 });

  // Two on the long wall, above the picture rail height, so the card end is not
  // lit only from directly over the table.
  for (const wz of [15.4, 19.8]) {
    fixture('wall-lamp', { x: left + 0.22, z: wz, width: 0.3, y: 1.95, rotY: Math.PI / 2 });
  }

  // THE PLAN, on the wall the desk faces.
  //
  // Kevin sits at the desk looking down the room at a blank wall two and a half
  // metres away. docs/LORE.md has been describing what is on that wall since
  // before any of this was modelled — a whiteboard in what he calls his office,
  // with three of four boxes already ticked and nobody having asked him on what
  // basis — and it is the single line that explains the whole character. A room
  // full of somebody's furniture is a room; one thing they wrote themselves is
  // a person.
  // ABOVE THE SCREENS. At y 1.78 the monitor bank covered its bottom half and
  // the two ticked boxes that are the whole joke were behind a chart. The top
  // of the upper row is 1.655, so the board starts there and runs up to 2.47.
  quad(1.25, 0.81, planTexture('ROBIN PLAN:', [
    '\u2611 LAUNCH',
    '\u2611 MOON',
    '\u2611 LAMBO',
    '\u2610 SLEEP   \u2190 later',
  ]), left + 0.24, 2.06, 13.5, Math.PI / 2);
  // Its frame, so it hangs on the wall rather than being painted on it. The
  // board has to sit clear of the frame's FRONT FACE, not of its centre: at
  // left + 0.155 the 4cm-thick frame reached to left + 0.175 and swallowed a
  // board hung at left + 0.17 whole, which showed as a black panel on the wall.
  // At left + 0.24 it is also proud of the picture rail it now crosses.
  solid(0.04, 0.92, 1.36, TRIM, left + 0.185, 2.06, 13.5);

  // --- the desk, which is where the money actually comes from ---------------
  // Six monitors of green candles. Three seeds, so three different markets:
  // the same chart repeated is the tell that makes set dressing look fake.
  const dk = CRIB.desk;
  const dsk = { x: dk.x, z: dk.z, width: 1.9, rotY: -Math.PI / 2 };
  fixture('desk', dsk, () => {
    solid(0.8, 0.08, 1.9, '#4A3524', dk.x, 0.74, dk.z);
    solid(0.08, 0.72, 1.8, '#3A2A1C', dk.x + 0.34, 0.37, dk.z);
  });
  // Everything on this desk stands on the desk that was actually placed. Every
  // hardcoded height here has been wrong by a few centimetres at some point,
  // and a few centimetres is the whole difference between a thing resting on a
  // surface and a thing hovering over it.
  const deskTop = dsk.top ?? 0.75;
  //
  // AND THE DESK IS AN L. desk.glb's mesh is called "deskCorner" — a corner
  // desk with a square 0.97 footprint, which is why it measures 1.90 x 1.90
  // rather than the 1.90 x 0.70 a straight desk would. Read off its own top
  // surface after placing and scaling, the wood is:
  //
  //     arm A, the working slab   x -22.42 .. -21.65,  z 12.45 .. 14.35
  //     arm B, the return         x -23.55 .. -22.42,  z 13.58 .. 14.35
  //     the knee hole, which is A VOID   x -23.55 .. -22.42,  z 12.45 .. 13.58
  //
  // Every object here was authored against the flat 0.8-deep slab in the
  // fallback box below, so most of them were placed over that void: the six
  // monitors hung two thirds off the back edge, one shelf post started in
  // mid-air, the laptop was 89% past the end and the radio half off the front.
  // ARM_X is the middle of arm A, which is where things actually go.
  const ARM_X = dk.x + 0.35;

  // The shelf the upper row stands on, built BEFORE them rather than after.
  // It used to be created below the loop, so the monitors were given y 1.28 —
  // a guess at a shelf whose top is 1.285, five millimetres out, every time.
  const shelfY = deskTop + 0.51;
  solid(0.34, 0.05, 1.86, '#3A2A1C', ARM_X, shelfY, dk.z);
  // IN THE GAPS BETWEEN THE SCREENS. Moving the posts onto arm A lined them up
  // with the outer two monitors and drove a 0.5m post straight through each —
  // the monitors sit at dk.z -0.62 / 0 / +0.62 and are 0.5 deep, so the only
  // clear air on that arm is the two 12cm gaps at +-0.31.
  for (const bz of [dk.z - 0.31, dk.z + 0.31]) {
    solid(0.06, shelfY - deskTop, 0.06, '#3A2A1C', ARM_X, (deskTop + shelfY) / 2, bz);
  }
  const shelfTop = shelfY + 0.025;

  /**
   * A chart, on the face of the monitor that was actually placed.
   *
   * The quads were 0.29 tall pinned 0.30 above each monitor's base, and a
   * monitor is 0.37 tall INCLUDING ITS STAND — so all six charts overhung the
   * top of their own bezel by 7.5cm and hung in front of the row below. The
   * panel is the top ~62% of the model; the stand is the rest.
   */
  const screen = (m, mz, seed, up) => {
    const top = m.top ?? m.y + 0.37;
    const panel = (top - m.y) * 0.62;
    quad(0.46, panel * 0.86, chartTexture(seed, { up }), ARM_X + 0.10, top - panel / 2, mz, Math.PI / 2);
  };

  for (let i = 0; i < 3; i++) {
    const mz = dk.z - 0.62 + i * 0.62;
    // Facing +x, toward the chair. A plane's normal is +z, so -PI/2 turns it to
    // face -x — into the wall — and the whole desk reads as six grey backs.
    const lo = { x: ARM_X, z: mz, width: 0.5, y: deskTop, rotY: Math.PI / 2 };
    fixture('monitor', lo, () => {
      solid(0.06, 0.36, 0.5, '#26262C', ARM_X, deskTop + 0.24, mz);
    });
    screen(lo, mz, i + 1, i !== 1);
    // A second row above, on the shelf. Six screens is a person with a problem,
    // which is the correct number for this character.
    const hi = { x: ARM_X, z: mz, width: 0.5, y: shelfTop, rotY: Math.PI / 2 };
    fixture('monitor', hi);
    screen(hi, mz, i + 7, i === 1);
  }
  fixture('keyboard', { x: dk.x + 0.68, z: dk.z, width: 0.42, y: deskTop, rotY: Math.PI / 2 });
  fixture('mouse', { x: dk.x + 0.68, z: dk.z + 0.42, width: 0.1, y: deskTop, rotY: -Math.PI / 2 });
  // PULLED OUT AND TURNED, like a chair somebody got up from.
  //
  // It was at dk.x + 1.1, which drove it 13cm into the desk through 75cm of
  // height — the desk is an L, 1.9m on both axes, and the chair was inside the
  // return. That is the clip you can see from the door and the reason this
  // rebuild happened. The blocker below grew with it, or you could walk through
  // the chair to reach a desk you cannot walk through.
  // AND FACING THE SCREENS. Measured off the placed model — split its vertices
  // about its own centre and the backrest is whichever half is taller — the
  // chair's back was at -x with the six monitors also at -x, so it was turned
  // away from the only thing it exists to sit in front of. Negating the half
  // turn puts the back to the room and the seat to the desk.
  fixture('desk-chair', { x: dk.x + 1.45, z: dk.z + 0.18, width: 0.6, rotY: -Math.PI / 2 + 0.34 }, () => {
    solid(0.5, 0.1, 0.5, '#26262C', dk.x + 1.45, 0.46, dk.z + 0.18);
  });
  fixture('speaker-hifi', { x: dk.x + 0.3, z: dk.z - 1.15, width: 0.3 });
  // ON THE RETURN, which was carrying nothing at all while the laptop hung 89%
  // of its depth past the end of the other arm.
  fixture('laptop', { x: dk.x - 0.70, z: dk.z + 0.55, width: 0.38, y: deskTop, rotY: Math.PI });
  fixture('soda-cup', { x: dk.x + 0.78, z: dk.z - 0.35, width: 0.14, y: deskTop });
  blockers.push({ x0: dk.x - 0.5, x1: dk.x + 1.9, z0: dk.z - 1.1, z1: dk.z + 1.1 });

  // --- living, right of the door -------------------------------------------
  // THE SEATING GROUP, moved east as one. The sofa sat 4.24m from the screen
  // with 2.4m of bare floor between the coffee table and the set, spread across
  // the full width of the room — which is why the sofa, the table and the
  // television read as three separate things rather than one arrangement.
  fixture('rug', { x: -13.4, z: 17.4, width: 4.0 }, () => {
    paint(4.0, 2.8, '#6B1F24', -13.4, 17.4, 0.026);
  });
  const s = { x: -14.7, z: 17.4 };
  fixture('crib-sofa', { x: s.x, z: s.z, width: 2.3, rotY: Math.PI / 2 }, () => {
    solid(1.1, 0.5, 2.4, RED, s.x, 0.32, s.z);
    solid(0.35, 0.8, 2.4, RED, s.x - 0.5, 0.68, s.z);
    solid(1.1, 0.75, 0.34, '#A82B24', s.x, 0.5, s.z - 1.15);
    solid(1.1, 0.75, 0.34, '#A82B24', s.x, 0.5, s.z + 1.15);
  });
  blockers.push({ x0: s.x - 0.65, x1: s.x + 0.65, z0: s.z - 1.4, z1: s.z + 1.4 });

  // Pulled off the fridge. At (-14.0, 20.0) the armchair, a full-height fridge
  // and the end of the kitchen run formed one continuous lump of unrelated
  // objects — three things touching that have nothing to do with each other,
  // which is what a room looks like when the furniture was placed one at a time
  // rather than arranged. It sits across the coffee table from the sofa now.
  // Same measurement, same fault: at rotY -2.4 the armchair's backrest was on
  // its +x/+z side, so it faced back down the room at the front door rather
  // than at the television or the table it shares with the sofa. 2.16 points it
  // at the set.
  fixture('crib-armchair', { x: -13.0, z: 19.25, width: 0.95, rotY: 2.16 }, () => {
    solid(0.85, 0.6, 0.85, '#A82B24', -13.0, 0.34, 19.25);
  });
  solids.push({ x: -13.0, z: 19.25, r: 0.52 });
  // The side table, which used to be under the roulette wheel and 0.27m deep —
  // far too small for a 0.70m wheel. Next to a chair it is exactly right, and
  // a chair with nowhere to put a drink is a chair nobody has ever sat in.
  const st = { x: -14.2, z: 19.7, width: 0.62 };
  fixture('side-table', st, () => {
    solid(0.56, 0.1, 0.56, '#5A3A24', st.x, 0.52, st.z);
  });
  fixture('soda-cup', { x: st.x, z: st.z, width: 0.15, y: st.top ?? 0.55 });
  solids.push({ x: st.x, z: st.z, r: 0.34 });

  const ct = { x: -13.0, z: 17.4, width: 1.15 };
  fixture('coffee-table', ct, () => {
    solid(1.0, 0.1, 0.7, '#4A3524', ct.x, 0.42, ct.z);
  });
  // What is actually on his coffee table — ON it. The hardcoded 0.46 was six
  // centimetres above the model's real top, so the cup and the pizza box both
  // floated over the table in the middle of the room you look straight at.
  const ctTop = ct.top ?? 0.47;
  fixture('soda-cup', { x: -12.72, z: 17.18, width: 0.15, y: ctTop });
  // The old z put 27% of it over air: the table's back edge is 0.35 from its
  // centre and the box reaches 0.21 either side of its own once turned.
  fixture('box-open', { x: -13.22, z: 17.42, width: 0.42, y: ctTop, rotY: 0.5 });
  solids.push({ x: ct.x, z: ct.z, r: 0.62 });

  const tv = CRIB.tv;
  const tvs = { x: tv.x, z: tv.z, width: 1.6, rotY: -Math.PI / 2 };
  fixture('tv-stand', tvs, () => {
    solid(0.5, 0.06, 1.6, '#26262C', tv.x, 0.62, tv.z);
  });
  const tvo = { x: tv.x, z: tv.z, width: 1.35, rotY: -Math.PI / 2, y: tvs.top ?? 0.62 };
  fixture('tv', tvo, () => {
    solid(0.22, 1.2, 1.9, '#101014', tv.x, 1.32, tv.z);
  });
  // THE PICTURE, INSET INTO THE SET. It was a 1.60 x 0.95 quad hung 21cm in
  // front of a television measuring 1.35 by 0.90 — bigger than the set it was
  // supposed to be the screen of, overhanging the top by 25cm and each end by
  // 12cm, and floating clear of it in mid-air. It is the brightest object in
  // the room and the one the world map lives on, so it was also the most
  // obvious. Measured off the model that was actually placed.
  const tvBase = tvo.y;
  const tvTop = tvo.top ?? tvBase + 0.9;
  quad(1.16, (tvTop - tvBase) * 0.69, signTexture(['WORLDS', 'gym · fry house'],
    { bg: '#101014', fg: '#7BE08A' }),
    tv.x - 0.14, tvBase + (tvTop - tvBase) * 0.55, tv.z, -Math.PI / 2);
  blockers.push({ x0: tv.x - 0.4, x1: tv.x + 0.4, z0: tv.z - 1.0, z1: tv.z + 1.0 });

  // It stood 1.45m past the end of the sofa with nothing near it, lighting
  // empty floor. It caps the group now.
  fixture('floor-lamp', { x: -15.7, z: 19.4, width: 0.44 }, () => {
    solid(0.1, 1.5, 0.1, '#8A8F98', -15.7, 0.75, 19.4);
    solid(0.5, 0.34, 0.5, GOLD, -15.7, 1.65, 19.4);
  });
  solids.push({ x: -15.7, z: 19.4, r: 0.3 });

  // The shelf, and the trophies that say what he does all day.
  // AGAINST THE WALL. It stood at z 20.9 with its back 0.87m clear of the back
  // wall, which is not where anybody puts a bookcase and reads as a prop
  // dropped into a room rather than furniture in one.
  const bc = { x: -11.6, z: 21.72, width: 1.2, rotY: Math.PI };
  fixture('bookcase', bc, () => {
    solid(1.1, 1.8, 0.36, '#4A3524', -11.6, 0.9, 20.9);
  });
  // 0.62, not 0.85. At 0.85 the block measured 0.85 by 0.53 inside a case
  // 1.20 by 0.75 and pierced the shelf, both side panels and the back — the
  // books were not on a shelf, they were inside the furniture.
  fixture('books', { x: bc.x, z: bc.z - 0.06, width: 0.62, y: 1.18, rotY: Math.PI });
  // The radio used to sit at y 1.84 "on" the bookcase and measured as fully
  // inside it — the fallback box is 1.8 tall but the MODEL is not, and an
  // author-time y cannot know that. It lives on the desk now, where a radio
  // belongs anyway and the surface height is one we set ourselves.
  fixture('radio', { x: dk.x + 0.70, z: dk.z - 0.70, width: 0.34, y: deskTop, rotY: Math.PI / 2 });
  // ON the bookcase, at whatever height it turned out to be. A hardcoded 1.55
  // put all four trophies inside the books.
  // ON A SHELF, not on the roof. bc.top is 2.64 and the trophies sat on top of
  // that at 2.64-2.98 — a quarter of a metre above the 2.4 line where a
  // first-person camera at 1.62 stops seeing anything at all. Four objects
  // whose entire job is to say what he does all day, placed where nobody would
  // ever look at them. The colours were #FFE500 and #E8232B, out of the gym's
  // signage rather than this room's palette, and were the loudest thing in the
  // living half.
  // 1.85, on the shelf ABOVE the books. At 1.35 they were inside them: the
  // books span 1.18 to 1.77, so four trophies 0.34 tall starting at 1.35 stood
  // straight through the spines.
  for (let i = 0; i < 4; i++) {
    solid(0.13, 0.34, 0.13, [GOLD, RED, '#C6BEAC', GOLD][i],
      -12.0 + i * 0.22, 1.85, bc.z - 0.12);
  }
  blockers.push({ x0: -12.3, x1: -10.9, z0: 21.3, z1: 22.2 });

  // Into the corner it was nearly in. At (-11.4, 18.9) it stood 98cm out from
  // the right wall, in the middle of the floor, on the line you walk from the
  // telly to the kitchen.
  for (const [px, pz, name, pw] of [[-10.75, 20.55, 'potted-plant', 0.62]]) {
    fixture(name, { x: px, z: pz, width: pw }, () => {
      solid(pw * 0.7, 0.3, pw * 0.7, '#B06A3A', px, 0.15, pz);
      solid(pw * 0.9, 0.7, pw * 0.9, '#2F8F45', px, 0.62, pz);
    });
    solids.push({ x: px, z: pz, r: pw * 0.4 });
  }

  // --- the kitchen along the back wall -------------------------------------
  //
  // Rebuilt, because a single unbroken slab is not a kitchen worktop.
  //
  // It was one 5.6m plane of #CFC6B0 at a fixed height, laid across everything:
  // it PAVED OVER THE SINK — the basin filled in, 6cm of tap erupting out of a
  // solid counter, no visible sink anywhere in the room — and it paved over the
  // hob too, so the frying pan sat half buried in worktop and the cook pot 2cm
  // into it. Its separate "front edge" band was 9cm inside the cupboard doors,
  // invisible, and cutting through the slab it belonged to. And 1.45m of its
  // left-hand end had no base unit under it at all: a floating shelf carrying a
  // box, a stack of trays and a coffee machine, with a bar stool parked at it
  // facing 0.95m of cupboard door with no knee room.
  //
  // Now: units on a 0.92 pitch so there are 2cm reveals rather than 10cm holes,
  // worktop in RUNS that stop either side of the sink and the hob so both are
  // things you can see, and the open left end is a real breakfast bar on a real
  // end panel with two stools tucked under 0.40m of overhang.
  const KZ = back - 0.63;                     // units flush to the wall, not 8cm inside it
  const WORKTOP = 0.99;                       // 4cm proud of the units' own 0.95 tops
  const KX = [-18.28, -17.36, -16.44, -15.52, -14.60];   // cabinet, cabinet, SINK, cabinet, HOB
  // rotY PI, or the splashback faces +z into the back wall and is invisible
  // from the only side anybody stands on.
  quad(6.1, 1.1, signTexture([''], { bg: '#8E1F1A', fg: '#8E1F1A' }),
    -16.75, 1.45, back - 0.17, Math.PI);

  let stoveTop = 0.95;
  for (const [name, ux] of [['kitchen-cabinet', KX[0]], ['kitchen-cabinet', KX[1]],
                            ['kitchen-sink', KX[2]], ['kitchen-cabinet', KX[3]],
                            ['stove', KX[4]]]) {
    const unit = { x: ux, z: KZ, width: 0.90, rotY: Math.PI };
    fixture(name, unit, () => {
      solid(0.90, 0.86, 0.62, '#4A4A55', ux, 0.43, KZ);
    });
    if (name === 'stove') stoveTop = unit.top ?? 0.95;
  }

  // The runs. Gaps at the sink (-16.89..-15.99) and the hob (-15.05..-14.15).
  const worktop = (x0, x1, z, dep) =>
    solid(x1 - x0, 0.05, dep, '#CFC6B0', (x0 + x1) / 2, WORKTOP - 0.025, z);
  worktop(-19.70, -18.73, 21.42, 1.36);        // the bar: deep, for knees
  worktop(-18.75, -16.91, 21.60, 1.02);        // the run, over the two left cabinets
  worktop(-15.97, -15.07, 21.60, 1.02);        // between the sink and the hob
  // What holds the bar up where there is no cupboard: an end panel and a leg.
  solid(0.06, 0.94, 1.32, WOOD, -19.67, 0.47, 21.42);
  solid(0.08, 0.94, 0.08, WOOD, -18.80, 0.47, 20.86);

  fixture('microwave', { x: -17.45, z: 21.66, width: 0.52, y: WORKTOP, rotY: Math.PI });
  fixture('coffee-machine', { x: -18.10, z: 21.66, width: 0.32, y: WORKTOP, rotY: Math.PI });
  // The hood, back against the wall with a duct to the ceiling. It hung 12cm
  // clear of the wall with the picture rail showing in the gap behind it, and
  // stopped dead at 2.39 with a metre of bare wall above it and nothing
  // carrying it anywhere — the same "what is holding that up" the chandelier
  // had. 1.60 over a 0.95 hob is 65cm of clearance, which is right.
  fixture('extractor', { x: KX[4], z: 21.83, width: 0.85, y: 1.60, rotY: Math.PI });
  solid(0.34, 0.98, 0.32, '#8A8F98', KX[4], 2.88, 21.97);
  // On the hob under it, which is now a hob you can see.
  fixture('cook-pot', { x: -14.82, z: 21.60, width: 0.30, y: stoveTop });
  fixture('frying-pan', { x: -14.38, z: 21.72, width: 0.34, y: stoveTop, rotY: 0.6 });

  // Three uppers, bay for bay with the base units, hard against the wall — they
  // were 7cm INSIDE it, with the picture rail running through their insides,
  // and they stopped 1.11m short of the hood leaving a hole in the run at
  // exactly the height everything is looked at.
  for (const ux of KX.slice(0, 3)) {
    fixture('kitchen-upper', { x: ux, z: 21.90, width: 0.90, y: 1.55, rotY: Math.PI });
  }
  // A strip under them. The kitchen had no light of its own at all — the card
  // table gets a chandelier and a pool on the floor, and this end got a flat
  // red plane and four grey boxes.
  solid(2.74, 0.03, 0.07, GOLD, -17.36, 1.535, 21.70);
  // Open shelves in the bay between the uppers and the hood, which is the one
  // stretch of this wall at eye height and was bare.
  for (const sy of [1.62, 2.00]) solid(0.92, 0.04, 0.28, WOOD, -15.51, sy, 21.99);
  for (const bx of [-15.94, -15.08]) solid(0.04, 0.34, 0.26, TRIM, bx, 1.81, 22.00);

  // Handles. Two lines of geometry are the whole difference between "cabinets"
  // and "boxes", and the doors were unbroken charcoal within 5% of the wall.
  for (const ux of [KX[0], KX[1], KX[3]]) solid(0.34, 0.03, 0.03, GOLD, ux, 0.86, 21.16);
  for (const ux of KX.slice(0, 3)) solid(0.34, 0.03, 0.03, GOLD, ux, 1.62, 21.66);

  // The fridge, against the wall and in line with the cupboard fronts. It stood
  // 14cm off the wall and 22cm behind the run, with a 47cm hole beside the hob.
  const frg = { x: -13.72, z: 21.80, width: 0.76, rotY: Math.PI };
  fixture('fridge', frg, () => {
    solid(0.75, 1.8, 0.68, '#4A4A55', -13.72, 0.9, 21.80);
  });

  // What is left on the counter, which is more characterful than the counter.
  fixture('tray-stack', { x: -18.60, z: 21.60, width: 0.40, y: WORKTOP, rotY: Math.PI });
  fixture('soda-cup', { x: -17.02, z: 21.52, width: 0.15, y: WORKTOP });
  fixture('soda-cup', { x: -15.52, z: 21.68, width: 0.15, y: WORKTOP, rotY: 0.8 });
  fixture('box-closed', { x: -19.15, z: 21.66, width: 0.50, y: WORKTOP, rotY: 0.2 });
  // Two blockers, because the bar sticks out further than the run does.
  blockers.push({ x0: -19.75, x1: -18.70, z0: 20.72, z1: back });
  blockers.push({ x0: -18.70, x1: -13.30, z0: 21.10, z1: back });

  // A pool of light on the floor in front of it, the same trick the card table
  // uses. Without it the whole run sits in the dark below worktop height.
  const kglow = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.6), flat(GOLD));
  kglow.rotation.x = -Math.PI / 2;
  kglow.position.set(-17.1, 0.026, 20.85);
  kglow.material.transparent = true;
  kglow.material.opacity = 0.10;
  scene.add(kglow);

  // STOOLS AT A BAR. There was one, at a stretch of counter with no unit under
  // it, no overhang and no knee room — facing 0.95m of cupboard door. The bar
  // above gives 0.40m of overhang past the fronts, so now there are two and
  // they are tucked under it.
  for (const [sx, sz] of [[-19.30, 20.55], [-18.55, 20.55]]) {
    fixture('bar-stool', { x: sx, z: sz, width: 0.42 }, () => {
      solid(0.36, 0.1, 0.36, '#33333B', sx, 0.68, sz);
    });
    solids.push({ x: sx, z: sz, r: 0.30 });
  }
  // The plant goes ON the fridge rather than 6cm inside the side of it, which
  // is where it was and is also what actually happens to a plant in a flat with
  // a beer fridge in it.
  const mf = { x: -20.6, z: 12.5, width: 0.55 };
  fixture('mini-fridge', mf, () => {
    solid(0.55, 0.85, 0.55, '#33333B', -20.6, 0.42, 12.5);
  });
  fixture('plant-small', { x: -20.6, z: 12.5, width: 0.34, y: mf.top ?? 0.77 });
  solids.push({ x: -20.6, z: 12.5, r: 0.38 });

  // --- where he sleeps, front right ----------------------------------------
  const bed = { x: -12.6, z: 13.6 };
  const bd = { x: bed.x, z: bed.z, width: 2.05, rotY: Math.PI / 2 };
  fixture('bed', bd, () => {
    solid(1.5, 0.45, 2.0, '#4A3524', bed.x, 0.22, bed.z);
    solid(1.4, 0.22, 1.9, '#33333B', bed.x, 0.55, bed.z);
  });
  // ON the mattress and INSIDE the bed. At y 0.5 it was 18cm down inside a
  // mattress whose top is 0.68, and at z - 0.74 it hung 19cm off the end.
  fixture('pillow', { x: bed.x, z: bed.z - 0.55, width: 0.64, y: bd.top ?? 0.68, rotY: Math.PI / 2 });
  blockers.push({ x0: bed.x - 1.15, x1: bed.x + 1.15, z0: bed.z - 0.9, z1: bed.z + 0.9 });
  fixture('bedside', { x: -12.6, z: 15.2, width: 0.52 }, () => {
    solid(0.48, 0.55, 0.42, '#4A3524', -12.6, 0.28, 15.2);
  });
  fixture('table-lamp', { x: -12.6, z: 15.2, width: 0.3, y: 0.58 });
  solids.push({ x: -12.6, z: 15.2, r: 0.35 });
  // Clothes and cardboard where nobody has tidied. A perfectly clean flat is
  // the other way to look fake.
  // Moved off -13.7: the closed box was 22cm inside the corner of the bed.
  fixture('box-open', { x: -14.4, z: 12.6, width: 0.5, rotY: 0.6 });
  fixture('box-closed', { x: -15.3, z: 12.4, width: 0.45, rotY: -0.4 });
  solids.push({ x: -14.4, z: 12.6, r: 0.4 });
  solids.push({ x: -15.3, z: 12.4, r: 0.35 });

  // --- the hallway end ------------------------------------------------------
  fixture('doormat', { x: x, z: front + 0.8, width: 1.0 }, () => {
    paint(1.0, 0.66, '#3A2A20', x, front + 0.8, 0.03);
  });
  fixture('coat-rack', { x: -16.6, z: 12.5, width: 0.48 }, () => {
    solid(0.1, 1.7, 0.1, '#4A3524', -16.6, 0.85, 12.5);
    solid(0.5, 0.08, 0.08, '#4A3524', -16.6, 1.6, 12.5);
  });
  solids.push({ x: -16.6, z: 12.5, r: 0.3 });
  fixture('trashcan', { x: -19.9, z: 21.82, width: 0.45 }, () => {
    solid(0.4, 0.6, 0.4, '#26262C', -19.9, 0.3, 21.82);
  });
  // Labelled, because in the lore it is: the bin marked BEARS & FUD is where he
  // puts the things he has decided not to think about. A bin is set dressing;
  // a bin with that written on it is a joke somebody left in their own kitchen.
  quad(0.36, 0.10, signTexture(['BEARS & FUD'], { bg: '#26262C', fg: '#FFE500', size: 132 }),
    -19.9, 0.56, 21.58, Math.PI);
  solids.push({ x: -19.9, z: 21.82, r: 0.3 });

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
  // UNDER THE PICTURE RAIL, not through it. Every frame hung with its base at
  // 1.90-1.95, so it spanned 1.90 to 2.67 — and the rail is a 6cm wooden band
  // at 2.19-2.25 standing 1cm proud of the wall. It cut straight across the
  // bottom third of all six pictures. A base of 1.44 puts each top at 2.16,
  // three centimetres under the rail, and its art at 1.80: eye height for a
  // camera at 1.62, which is also where a picture belongs.
  //
  // WAGMI moved off the kitchen wall as well. At 1.44 the fridge in front of it
  // would have covered its bottom 19cm; the back wall between the card room and
  // the kitchen is 2.8m of bare charcoal and had nothing on it at all.
  const ART_Y = 1.44;
  const art = [
    [-15.0, ART_Y, front + 0.17, 0, ['GM', 'no thoughts'], '#1C2E3F'],
    [-12.6, ART_Y, front + 0.17, 0, ['0x63D7fa…', '9e284A'], '#0B0B0B'],
    [-20.6, ART_Y, back - 0.17, Math.PI, ['WAGMI', 'probably'], '#1C2E3F'],
    [right - 0.17, ART_Y, 15.6, -Math.PI / 2, ['NO PAIN', 'ONLY KEVIN'], '#8E1F1A'],
    [right - 0.17, ART_Y, 19.4, -Math.PI / 2, ["McKEVIN'S", 'employee of the month'], '#8E1F1A'],
    // Moved from z 13.2 to make room for the whiteboard, and a second frame
    // added on the same wall — it is 11 metres of it and it had one picture.
    [left + 0.18, ART_Y, 11.95, Math.PI / 2, ['KEK', 'to the moon'], '#1C2E3F'],
    [left + 0.18, ART_Y, 16.95, Math.PI / 2, ['CEO OF', 'CHAOS'], '#8E1F1A'],
  ];
  for (const [ax, ay, az, ry, lines, bg] of art) {
    const nx = Math.abs(ry) === Math.PI / 2 ? (ry > 0 ? 0.03 : -0.03) : 0;
    const nz = ry === 0 ? 0.03 : ry === Math.PI ? -0.03 : 0;
    // opts.y is where the prop's BASE goes — spawnProp stands it on the floor
    // and then lifts it — so passing the intended centre hung every frame half
    // its own height too high, with the art quad floating at its bottom edge.
    // Measure the frame, then centre the art on it.
    const fr = { x: ax + nx, z: az + nz, width: 0.98, y: ay, rotY: ry };
    fixture('picture-frame', fr);
    const artY = fr.top ? (fr.top + ay) / 2 : ay;
    quad(0.82, 0.58, signTexture(lines, { bg, fg: '#FFE500', size: 62 }),
      ax + nx * 2.6, artY, az + nz * 2.6, ry);
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
