// KEVIN'S CREW — the people he works with.
//
// Punk-format pixel avatars: one 32x32 grid, every feature a separate layer, so
// the set is a generator rather than a folder of drawings. Twenty today, two
// thousand later, and a new trait multiplies the space instead of replacing it.
//
// TWO RULES, and the whole design hangs off them:
//
//   1. A minted token's traits are FROZEN. They get written to crew.json and
//      are read back from there forever. Adding a trait must never reshuffle a
//      character somebody already owns.
//   2. Trait tables are APPEND-ONLY. Add to the end of a list; never reorder,
//      never delete. Removing an entry would change what an old seed rolls, and
//      rule 1 only holds because rule 2 does.
//
// Every trait name here is also a thing the gym can put on a 3D body later — a
// cap is a hat mesh, a shirt is a texture swap. The traits are the bridge
// between the picture and the character; the art style is not.
import { Canvas } from './pixel.mjs';

export const SIZE = 32;

// --- palette ---------------------------------------------------------------
const INK = '#0B0B0B';
const CREAM = '#FFF6C8';
const WHITE = '#FFFFFF';

/** Shift a hex toward black (amount > 0) or white (amount < 0), clamped. */
function shift(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const t = amount >= 0 ? v * (1 - amount) : v + (255 - v) * -amount;
    return Math.max(0, Math.min(255, Math.round(t)));
  });
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const dark = (hex, amount = 0.32) => shift(hex, amount);
const light = (hex, amount = 0.28) => shift(hex, -amount);

// --- trait tables ----------------------------------------------------------
// [name, weight, ...payload]. APPEND ONLY — see rule 2 at the top.

const CREW = [
  ['Kevin Red', 30, '#E8232B'],
  ['Blue', 18, '#3B82C4'],
  ['Green', 14, '#3FA34D'],
  ['Orange', 12, '#F2812F'],
  ['Purple', 10, '#8B5CF6'],
  ['Grey', 8, '#8A8F98'],
  ['Ink', 5, '#4E4E58'],
  ['Gold', 2, '#FFC531'],
  ['Ghost', 1, '#E6E6E6'],
];

const SHIRT = [
  ['Crew Red', 34, '#E8232B'],
  ['Crew Yellow', 22, '#F5C400'],
  ['Manager Black', 16, '#2B2B2B'],
  ['Gym Vest', 12, '#F0F0F0'],
  ['Hoodie', 10, '#4A5568'],
  ['Hi-Vis', 6, '#C8F53C'],
];

const CAP = [
  ['None', 20],
  ['Visor', 22],
  ['Backwards Cap', 18],
  ['Paper Hat', 14],
  ['Hairnet', 10],
  ['Headband', 8],
  ['Chef Hat', 5],
  ['Crown', 3],
];

const EYES = [
  ['Normal', 40],
  ['Tired', 16],
  ['Shades', 12],
  ['Angry', 12],
  ['Wide', 8],
  ['Xs', 6],
  ['Laser', 4],
  ['Stars', 2],
];

const MOUTH = [
  ['Flat', 26],
  ['Grin', 24],
  ['Shouting', 18],
  ['Frown', 14],
  ['Tongue', 10],
  ['Straw', 8],
];

const FACE = [
  ['None', 46],
  ['Stubble', 14],
  ['Moustache', 12],
  ['Gum', 10],
  ['Plaster', 8],
  ['Sweat', 6],
  ['Toothpick', 4],
];

const EXTRA = [
  ['None', 40],
  ['Name Badge', 18],
  ['Drive-Thru Headset', 14],
  ['Earring', 12],
  ['Sweatband', 8],
  ['Whistle', 5],
  ['Gold Chain', 3],
];

const BACKGROUND = [
  ['Punk Blue', 26, '#6E8CA0'],
  ['Brand Yellow', 22, '#FFE500'],
  ['Cream', 16, '#F0E2C0'],
  ['Mint', 12, '#9FD8C0'],
  ['Dusk', 10, '#7B6AA8'],
  ['Sunset', 8, '#E9946A'],
  ['Fryer Grey', 5, '#B4B8BD'],
  ['Closed', 1, '#151515'],
];

export const TABLES = { CREW, SHIRT, CAP, EYES, MOUTH, FACE, EXTRA, BACKGROUND };

/** Total trait combinations the current tables can express. */
export const SPACE = Object.values(TABLES).reduce((n, t) => n * t.length, 1);

// --- rolling ---------------------------------------------------------------

/** mulberry32 — small, fast, and identical on every machine, which is the point. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(table, r) {
  const total = table.reduce((n, t) => n + t[1], 0);
  let roll = r() * total;
  for (const row of table) {
    roll -= row[1];
    if (roll <= 0) return row;
  }
  return table[table.length - 1];
}

/**
 * Roll a token's traits from its id. Deterministic, but only ever used to MINT
 * — once a token is in the manifest its traits are read from there, so a later
 * trait addition cannot change a character that already exists.
 */
export function roll(id) {
  const r = rng(id * 2654435761);
  const t = {};
  for (const [key, table] of Object.entries(TABLES)) t[key] = pick(table, r);
  return {
    id,
    crew: t.CREW[0],
    hood: t.CREW[2],
    shirt: t.SHIRT[0],
    shirtColor: t.SHIRT[2],
    cap: t.CAP[0],
    eyes: t.EYES[0],
    mouth: t.MOUTH[0],
    face: t.FACE[0],
    extra: t.EXTRA[0],
    background: t.BACKGROUND[0],
    backgroundColor: t.BACKGROUND[2],
  };
}

// --- drawing ---------------------------------------------------------------
// Layers, bottom to top: body, hood, dreadlocks, muzzle, eyes, mouth, face,
// cap, accessory. Each one only knows about its own trait, which is what lets
// a new hat be twenty lines rather than a redraw.

function body(c, t) {
  const col = t.shirtColor;
  c.roundRect(4, 26, 27, 31, 3, col);
  c.rect(4, 29, 27, 31, dark(col, 0.2));        // shadow under the shoulders
  c.roundRect(4, 26, 27, 29, 3, col);
  c.rect(13, 23, 18, 27, CREAM);                 // neck
  c.rect(13, 23, 18, 24, dark(CREAM, 0.22));
  c.rect(12, 27, 19, 28, dark(col, 0.38));       // collar opening around it
}

// Thick blunt locks: three a side, stepping out and down with a gap between.
// They sit clear of the skull on purpose — flush to it they read as ear cups,
// which is exactly what went wrong the first time.
function dreads(c, t) {
  const h = t.hood;
  const d = dark(h, 0.22);
  // Falling from the crown and overlapping each other and the skull, so the
  // whole side reads as one mass of hair. Level with the ears and detached,
  // two symmetrical lobes read as headphones instead.
  for (const [x0, y0, x1, y1, col] of [[7, 8, 10, 14, h], [5, 12, 9, 18, d], [4, 17, 8, 23, h]]) {
    c.rect(x0, y0, x1, y1, col);
    c.rect(31 - x1, y0, 31 - x0, y1, col);       // mirrored
  }
}

function hood(c, t) {
  const h = t.hood;
  c.roundRect(9, 3, 22, 24, 5, h);
  c.rect(9, 18, 22, 24, dark(h, 0.16));          // underside shade
  c.roundRect(9, 3, 22, 19, 5, h);
  c.rect(11, 5, 13, 6, light(h, 0.32));          // top-left highlight
}

function muzzle(c) {
  c.roundRect(10, 15, 21, 24, 4, CREAM);
  c.rect(10, 22, 21, 24, dark(CREAM, 0.13));
  c.roundRect(10, 15, 21, 22, 4, CREAM);
}

function eyes(c, t) {
  // The signature, and the thing that makes him Kevin rather than a punk: two
  // enormous whites cutting up into the hood, nearly meeting in the middle.
  c.roundRect(9, 7, 15, 17, 3, WHITE);
  c.roundRect(16, 7, 22, 17, 3, WHITE);
  c.rect(15, 9, 16, 16, dark(t.hood, 0.25));    // the seam between them

  const pupil = (x, y, w = 2, h = 4, col = INK) => c.rect(x, y, x + w - 1, y + h - 1, col);

  switch (t.eyes) {
    case 'Tired':
      c.rect(9, 7, 15, 12, t.hood);             // heavy lids most of the way down
      c.rect(16, 7, 22, 12, t.hood);
      pupil(11, 13); pupil(19, 13);
      break;
    case 'Angry':
      c.rect(9, 7, 15, 10, t.hood);
      c.rect(16, 7, 22, 10, t.hood);
      c.line(9, 8, 14, 11, INK, 1);             // brows angled in
      c.line(22, 8, 17, 11, INK, 1);
      pupil(12, 12); pupil(18, 12);
      break;
    case 'Wide':
      pupil(11, 11, 1, 2); pupil(20, 11, 1, 2);   // tiny pupils, lots of white
      break;
    case 'Shades':
      c.rect(8, 9, 23, 16, INK);
      c.rect(9, 10, 15, 14, '#33333B');
      c.rect(16, 10, 22, 14, '#33333B');
      c.rect(10, 11, 12, 12, '#5A5A66');          // glare
      c.rect(17, 11, 19, 12, '#5A5A66');
      break;
    case 'Xs':
      for (const ox of [10, 17]) {
        c.line(ox, 10, ox + 4, 15, INK, 1);
        c.line(ox + 4, 10, ox, 15, INK, 1);
      }
      break;
    case 'Laser':
      c.rect(9, 9, 15, 15, '#FF1744');
      c.rect(16, 9, 22, 15, '#FF1744');
      c.rect(0, 11, 8, 13, '#FF1744');          // beams off both edges
      c.rect(23, 11, 31, 13, '#FF1744');
      break;
    case 'Stars':
      for (const ox of [10, 17]) {
        c.rect(ox + 1, 9, ox + 2, 15, '#FFC531');
        c.rect(ox - 1, 11, ox + 4, 13, '#FFC531');
      }
      break;
    default:
      pupil(11, 11); pupil(19, 11);
  }
}

/** The one black dot at the top of the muzzle. Small, or he stops being Kevin. */
function nose(c) {
  c.rect(15, 15, 16, 16, INK);
}

function mouth(c, t) {
  switch (t.mouth) {
    case 'Grin':
      c.roundRect(12, 19, 19, 22, 1, INK);
      c.rect(13, 19, 18, 19, WHITE);            // teeth along the top
      break;
    case 'Shouting':
      c.roundRect(12, 18, 19, 22, 2, INK);
      c.rect(14, 21, 18, 22, '#E85A7A');        // tongue at the back
      break;
    case 'Frown':
      c.rect(13, 21, 18, 21, INK);
      c.rect(12, 20, 12, 20, INK);
      c.rect(19, 20, 19, 20, INK);
      break;
    case 'Tongue':
      c.rect(12, 19, 19, 20, INK);
      c.rect(14, 21, 17, 23, '#E85A7A');
      break;
    case 'Straw':
      c.rect(13, 20, 18, 21, INK);
      c.rect(20, 13, 21, 21, '#E8232B');        // straw up out of the side
      c.rect(21, 11, 23, 13, '#E8232B');
      break;
    default:
      c.rect(13, 20, 18, 21, INK);
  }
}

function face(c, t) {
  switch (t.face) {
    case 'Stubble':
      for (let x = 10; x <= 21; x += 2)
        for (let y = 21; y <= 23; y += 2) c.shade(x, y, '#B9AE84');
      break;
    case 'Moustache':
      c.rect(12, 18, 19, 19, '#4A3520');
      c.rect(11, 19, 20, 19, '#4A3520');
      break;
    case 'Gum':
      c.ellipse(26, 21, 3, 3, '#FF8FC8');       // bubble blown off to the side
      c.ellipse(26, 21, 2, 2, '#FFB4DA');
      break;
    case 'Plaster':
      c.rect(9, 19, 13, 21, '#F2D9A8');         // across the cheek
      c.rect(10, 20, 12, 20, '#E0C08A');
      break;
    case 'Sweat':
      c.rect(25, 4, 26, 7, '#7EC8F0');
      c.rect(24, 6, 27, 8, '#7EC8F0');
      break;
    case 'Toothpick':
      c.rect(19, 20, 24, 20, '#D8B878');
      break;
    default:
  }
}

function cap(c, t) {
  const h = t.hood;
  switch (t.cap) {
    case 'Visor':
      c.rect(8, 4, 23, 7, '#E8232B');
      c.rect(8, 4, 23, 4, '#FF4A52');
      c.rect(6, 8, 25, 9, '#F5C400');           // brim, wider than the head
      break;
    case 'Backwards Cap':
      c.roundRect(8, 1, 23, 7, 3, '#E8232B');
      c.rect(8, 7, 23, 8, '#B0141B');
      c.rect(22, 5, 27, 7, '#E8232B');          // brim round the back
      c.rect(14, 2, 17, 3, '#F5C400');          // button
      break;
    case 'Paper Hat':
      c.rect(8, 5, 23, 8, WHITE);               // band
      c.rect(11, 2, 20, 5, WHITE);              // body
      c.rect(14, 0, 17, 2, WHITE);              // peak
      c.rect(8, 8, 23, 9, '#D2D2D2');
      c.rect(15, 2, 16, 5, '#E6E6E6');          // the fold
      break;
    case 'Hairnet':
      for (let x = 9; x <= 22; x++)
        for (let y = 3; y <= 9; y++) if ((x + y) % 2 === 0) c.shade(x, y, dark(h, 0.42));
      c.rect(9, 3, 22, 3, dark(h, 0.5));
      break;
    case 'Headband':
      c.rect(8, 6, 23, 9, '#F0F0F0');
      c.rect(8, 7, 23, 8, '#E8232B');
      break;
    case 'Chef Hat':
      c.rect(11, 3, 20, 6, WHITE);
      c.ellipse(13, 1, 4, 3, WHITE);
      c.ellipse(18, 1, 4, 3, WHITE);
      c.ellipse(16, 0, 4, 3, WHITE);
      c.rect(9, 6, 22, 9, '#EDEDED');           // band
      break;
    case 'Crown':
      c.rect(9, 5, 22, 8, '#FFC531');
      c.rect(9, 2, 12, 5, '#FFC531');
      c.rect(14, 1, 17, 5, '#FFC531');
      c.rect(19, 2, 22, 5, '#FFC531');
      c.rect(9, 8, 22, 8, '#C8961B');
      break;
    default:
  }
}

function extra(c, t) {
  switch (t.extra) {
    case 'Name Badge':
      c.rect(5, 28, 11, 31, WHITE);
      c.rect(6, 29, 10, 29, '#E8232B');
      c.rect(6, 30, 9, 30, '#9A9A9A');
      break;
    case 'Drive-Thru Headset':
      c.rect(9, 2, 22, 3, '#2B2B2B');           // band over the top of the head
      c.rect(6, 4, 9, 9, '#2B2B2B');            // earpiece
      c.rect(22, 4, 25, 9, '#2B2B2B');
      c.rect(6, 9, 9, 10, '#2B2B2B');           // boom mic down to the cheek
      c.rect(8, 10, 10, 12, '#3A3A3A');
      break;
    case 'Earring':
      c.rect(1, 20, 2, 22, '#FFC531');
      c.rect(29, 20, 30, 22, '#FFC531');
      break;
    case 'Sweatband':
      c.rect(0, 26, 4, 29, '#F0F0F0');          // wristband at the shoulder edge
      c.rect(0, 27, 4, 28, '#E8232B');
      break;
    case 'Whistle':
      c.rect(11, 26, 20, 27, '#E8232B');        // lanyard
      c.rect(15, 28, 16, 30, '#C0C0C0');
      c.rect(14, 29, 18, 31, '#C0C0C0');
      break;
    case 'Gold Chain':
      for (let x = 10; x <= 21; x += 2) c.rect(x, 28 + ((x >> 1) % 2), x + 1, 28 + ((x >> 1) % 2), '#FFC531');
      break;
    default:
  }
}

/**
 * Draw one crew member. Returns a Canvas with a transparent background — the
 * background trait is painted at export time so the same figure can sit on any
 * of them without redrawing.
 */
export function drawCrew(t) {
  const c = new Canvas(SIZE, SIZE);
  body(c, t);
  hood(c, t);
  dreads(c, t);
  muzzle(c);
  eyes(c, t);
  nose(c);
  mouth(c, t);
  face(c, t);
  cap(c, t);
  extra(c, t);
  c.outline(INK, { diagonal: false });
  return c;
}

/** One crew member as an SVG string, background included. */
export function crewSVG(t, { scale = 1 } = {}) {
  return drawCrew(t).toSVG({
    scale,
    background: t.backgroundColor,
    title: `KEVIN'S CREW #${String(t.id).padStart(3, '0')}`,
  });
}

/**
 * The same character as a grid the game can extrude into voxels.
 *
 * This is the whole reason the collection is pixels rather than paintings: a
 * 32x32 grid turns into a 3D head mechanically, so the token somebody owns IS
 * the character they play, and nobody has to model, rig or skin anything.
 *
 * Returns a palette plus one index per cell (-1 for empty), which keeps the
 * whole set small enough to ship as one JSON file.
 */
export function crewGrid(t) {
  const c = drawCrew(t);
  const palette = [];
  const index = new Map();
  const cells = new Array(c.w * c.h);
  for (let i = 0; i < cells.length; i++) {
    const col = c.px[i];
    if (col === null) { cells[i] = -1; continue; }
    if (!index.has(col)) { index.set(col, palette.length); palette.push(col); }
    cells[i] = index.get(col);
  }
  return { id: t.id, w: c.w, h: c.h, palette, cells, traits: t };
}

/**
 * Kevin himself. Not a roll — he is the player, so his traits are fixed and he
 * is never minted into the collection. Gym vest on purpose: the whole product
 * is watching a body change, and a crew shirt hides the body.
 */
export const KEVIN = {
  id: 0,
  crew: 'Kevin Red',
  hood: '#E8232B',
  shirt: 'Gym Vest',
  shirtColor: '#F2F2F2',
  cap: 'Visor',
  eyes: 'Normal',
  mouth: 'Grin',
  face: 'None',
  extra: 'None',
  background: 'Brand Yellow',
  backgroundColor: '#FFE500',
};
