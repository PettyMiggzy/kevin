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

const SITUATION =
  'A wide THREE-QUARTER OVERHEAD VIEW of a small city block, drawn like a ' +
  'game map you would walk a character around. Along the TOP THIRD of the ' +
  'frame stand FOUR small shopfront buildings in a row, each face-on to the ' +
  'viewer with a flat roof, a door and two windows, spaced apart with gaps ' +
  'between them. The BOTTOM TWO THIRDS is OPEN, EMPTY, WALKABLE GROUND — ' +
  'flat paving and asphalt, uncluttered, nothing in the middle of it. ' +
  'Scattered only around the EDGES: wooden fry crates, metal bins, tall lamp ' +
  'posts, a few traffic cones and low planters. The palette is locked: bright ' +
  'yellow #ffe500 sky and light, deep yellow #f5c400 paving, red #e8232b ' +
  'awnings and roofs, cream #fff6c8 walls, pure black outlines. Fast-food ' +
  'back-alley mood, late afternoon, one clear light source from the upper ' +
  'right casting hard flat shadows';

async function main() {
  const key = await loadKey();
  if (argv.includes('--models')) {
    for (const m of await listModels(key)) console.log('  ' + m.id);
    return;
  }
  const model = flag('model', 'ideogram-v4');
  const variants = Number(flag('variants', 2));

  const prompt = `SCENE: ${SITUATION}. STYLE: ${STYLE}. ` +
    'Thick confident hand-drawn black linework, slightly wobbly rather than ' +
    'vector-perfect. Flat cel shading, absolutely no gradients. ' +
    'COMPLETELY EMPTY OF LIFE: no people, no characters, no mascots, no ' +
    'animals, no creatures, no faces. No lettering or signage text.';

  for (let i = 1; i <= variants; i++) {
    process.stdout.write(`${model} ${i}/${variants}… `);
    const buf = await generate(key, {
      model,
      prompt,
      negative_prompt: NEGATIVE +
        ', character, mascot, person, people, figure, creature, animal, face, ' +
        'hands, text, letters, words, signage, captions, logos, isometric ' +
        'diamond tiles, gradients, soft shading, photorealistic, 3d render',
      aspect_ratio: '16:9',
      width: 1280,
      height: 720,
    });
    const p = await save(buf, OUT, `${model}-${i}.png`);
    console.log(`→ ${p.replace(ROOT + '/', '')}`);
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
