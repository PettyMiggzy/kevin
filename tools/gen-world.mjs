#!/usr/bin/env node
// The painted block for /world, through Venice.
//
//   node tools/gen-world.mjs                       # default model, 2 variants
//   node tools/gen-world.mjs --model gpt-image-2 --variants 3
//   node tools/gen-world.mjs --models              # list what is available
//
// Output: assets/png/world/<model>-<n>.png
//
// WHY ONE PAINTED IMAGE AND NOT DRAWN GEOMETRY
//
// world/index.html first drew its buildings from canvas rectangles. It worked
// and it looked like canvas rectangles. A teardown of the reference the owner
// pointed at settled the question: that world is ONE hand-painted image with an
// invisible grid projected over it, and its engine only does setDepth(base + y)
// plus two lines of grid maths. The art is the product; the code is plumbing.
//
// So the model paints the street, and the existing sprite atlas walks on top of
// it. NOTHING ALIVE goes in this image — a generated character would be a
// second, different Kevin standing next to the real one.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKey, generate, save, listModels } from './lib/venice.mjs';
import { STYLE, NEGATIVE } from './venice-prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/png/world');
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

// One entry per zone. Each is a painted plate the world walks around on.
// NOTHING ALIVE goes in any of them: a generated character would be a second,
// different Kevin standing next to the real one.
const ZONES = {
  block:
    'A wide THREE-QUARTER OVERHEAD VIEW of a small city block, drawn like a ' +
    'game map. Along the TOP THIRD, FOUR small shopfronts face the viewer, ' +
    'spaced apart. The BOTTOM TWO THIRDS is OPEN, EMPTY, WALKABLE paving, ' +
    'uncluttered. Fry crates, bins, lamp posts, traffic cones and low planters ' +
    'only around the EDGES.',

  downtown:
    'A wide THREE-QUARTER OVERHEAD VIEW of a small downtown street, drawn like ' +
    'a game map. Along the TOP, a row of TALLER buildings of different heights ' +
    'face the viewer: a fast-food restaurant with a big bold letter M on its ' +
    'sign, a video game shop with a wide window, a glass-fronted office tower ' +
    'with a green feather-like leaf emblem, and a gym with a barbell over the ' +
    'door. Each has a wide doorway a character could walk into. A ROAD runs ' +
    'across the middle with painted lane markings, kerbs and a crossing. The ' +
    'BOTTOM THIRD is OPEN, EMPTY, WALKABLE pavement. Street furniture — ' +
    'benches, bins, lamp posts, a bus stop, a fire hydrant — only at the EDGES.',

  neighbourhood:
    'A wide THREE-QUARTER OVERHEAD VIEW of a quiet suburban street, drawn like ' +
    'a game map. Along the TOP, four modest detached HOUSES with pitched ' +
    'roofs, porches, front doors and small front gardens with fences and ' +
    'hedges. A pavement and a road run across the middle. The BOTTOM THIRD is ' +
    'OPEN, EMPTY, WALKABLE road and pavement. Bins, a parked bicycle, a ' +
    'postbox, a lamp post and a tree only at the EDGES.',

  // --- interiors -------------------------------------------------------
  // A door you cannot walk through is a painted door. These are the insides,
  // painted to the same rules: back wall along the top, open floor below,
  // clutter pushed to the edges so there is somewhere to stand.

  mckevins:
    'The INSIDE of a small fast-food restaurant, THREE-QUARTER OVERHEAD VIEW, ' +
    'drawn like a game map. Along the TOP, a long SERVICE COUNTER with two ' +
    'tills, a blank menu board above it, and behind the counter a row of deep ' +
    'fryers, a drinks machine and a heat lamp. Down the LEFT and RIGHT edges, ' +
    'small tables with fixed seats, a bin with a swing lid, a mop bucket and a ' +
    'stack of trays. The MIDDLE and BOTTOM is OPEN, EMPTY, WALKABLE tiled ' +
    'floor with a chequered pattern. Fluorescent ceiling panels.',

  gameshop:
    'The INSIDE of a small video game shop, THREE-QUARTER OVERHEAD VIEW, drawn ' +
    'like a game map. Along the TOP, a SALES COUNTER with a till and a glass ' +
    'display case, and behind it a wall of shelves packed with blank game ' +
    'boxes and controllers on pegs. Down the LEFT and RIGHT edges, tall ' +
    'freestanding shelving units of boxed games, a bargain bin, a demo ' +
    'television on a stand, a spinner rack. The MIDDLE and BOTTOM is OPEN, ' +
    'EMPTY, WALKABLE carpet. Bright strip lighting.',

  brokerage:
    'The INSIDE of a modern trading floor lobby, THREE-QUARTER OVERHEAD VIEW, ' +
    'drawn like a game map. Along the TOP, a long reception DESK, and behind ' +
    'it a wall of large flat SCREENS showing blank candlestick charts and ' +
    'jagged line graphs going up and down. Down the LEFT and RIGHT edges, ' +
    'low leather seating, potted plants, a rope barrier, a water cooler, a ' +
    'ticker board. The MIDDLE and BOTTOM is OPEN, EMPTY, WALKABLE polished ' +
    'floor with a mirror sheen. Tall windows on one side.',

  house:
    'The INSIDE of a small tidy living room, THREE-QUARTER OVERHEAD VIEW, ' +
    'drawn like a game map. Along the TOP, a large WHITEBOARD on the wall ' +
    'covered in blank boxes and arrows, beside a window with curtains. Down ' +
    'the LEFT and RIGHT edges, a worn sofa, a small television on a stand, a ' +
    'bookshelf, a desk with a chair, a houseplant, a laundry basket. The ' +
    'MIDDLE and BOTTOM is OPEN, EMPTY, WALKABLE floorboards with a rug. Warm ' +
    'lamp light.',
};

async function main() {
  const key = await loadKey();
  if (argv.includes('--models')) {
    for (const m of await listModels(key)) console.log('  ' + m.id);
    return;
  }
  const model = flag('model', 'ideogram-v4');
  const variants = Number(flag('variants', 2));
  const wanted = (flag('zone', 'block') || 'block').split(',');

  for (const zone of wanted) {
  const SITUATION = ZONES[zone];
  if (!SITUATION) { console.error(`no zone "${zone}". have: ${Object.keys(ZONES).join(', ')}`); continue; }
  // An interior has no sky, so it gets a palette sentence of its own rather
  // than a yellow ceiling and a note apologising for it.
  const INSIDE = ['mckevins', 'gameshop', 'brokerage', 'house'].includes(zone);
  const PALETTE = INSIDE
    ? 'The camera is INSIDE the room at standing height, looking at the back ' +
      'wall. The room FILLS THE WHOLE FRAME edge to edge: the floor runs off ' +
      'the bottom and off both sides of the picture, the side walls run off ' +
      'the left and right edges, the ceiling runs off the top. NOT a doll ' +
      'house, NOT a cutaway box, NOT a floating room on a plain background — ' +
      'there is no background, only the room. ' +
      'The palette is locked: cream #fff6c8 walls, deep yellow #f5c400 floor, ' +
      'red #e8232b furniture and fittings, bright yellow #ffe500 highlights, ' +
      'pure black outlines. '
    : 'The palette is locked: bright yellow #ffe500 sky, deep yellow #f5c400 ' +
      'ground, red #e8232b roofs and awnings, cream #fff6c8 walls, pure black ' +
      'outlines. ';
  const prompt = `SCENE: ${SITUATION} ${PALETTE}` +
    'One clear light source from the ' +
    `upper right casting hard flat shadows. STYLE: ${STYLE}. ` +
    'Thick confident hand-drawn black linework, slightly wobbly rather than ' +
    'vector-perfect. Flat cel shading, absolutely no gradients. ' +
    'COMPLETELY EMPTY OF LIFE: no people, no characters, no mascots, no ' +
    'animals, no creatures, no faces. No lettering or signage text.';

  for (let i = 1; i <= variants; i++) {
    process.stdout.write(`${zone} ${model} ${i}/${variants}… `);
    const buf = await generate(key, {
      model,
      prompt,
      negative_prompt: NEGATIVE +
        ', character, mascot, person, people, figure, creature, animal, face, ' +
        'hands, text, letters, words, signage, captions, logos, ' +
        'floating room, doll house, cutaway, diorama, miniature, plain ' +
        'background, empty border, vignette, drop shadow under the room, ' +
        'transparent background, isometric ' +
        'diamond tiles, gradients, soft shading, photorealistic, 3d render',
      aspect_ratio: '16:9',
      width: 1280,
      height: 720,
    });
    const p = await save(buf, OUT, `${zone}-${model}-${i}.png`);
    console.log(`→ ${p.replace(ROOT + '/', '')}`);
  }
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
