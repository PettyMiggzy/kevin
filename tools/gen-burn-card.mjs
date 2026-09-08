#!/usr/bin/env node
// The burn card background, through Venice.
//
//   node tools/gen-burn-card.mjs                    # default model, 2 variants
//   node tools/gen-burn-card.mjs --model gpt-image-2 --variants 3
//
// Output: assets/png/burn-card/<model>-<n>.png
//
// WHY A BACKGROUND AND NOT A FINISHED IMAGE
//
// The bot posts one of these on every burn, and every burn is a different
// number. Baking a number into generated art means regenerating art for each
// burn — slow, expensive, and the model would draw a different Kevin each
// time, which is the one thing venice-prompts.mjs exists to prevent.
//
// So Venice draws the scene once and tools/burn-card.mjs stamps the live
// figures over it at post time. The art stays identical burn to burn, which is
// what makes it recognisable, and the numbers are always real.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKey, generate, save } from './lib/venice.mjs';
import { STYLE, NEGATIVE } from './venice-prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/png/burn-card');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

// The scene, WITH NO KEVIN IN IT.
//
// Both attempts at generating him drifted: ideogram gave a different character
// entirely, and krea with style references got close but still moved the hood
// and the eyes. For a meme brand the face IS the asset, and a face that shifts
// between posts stops being recognisable — which is the whole reason
// venice-prompts.mjs locks the character in the first place.
//
// So the model draws the environment, which it is genuinely good at, and
// tools/burn-card.mjs composites the real hand-drawn sprite over it. The
// background can drift all it likes. Kevin cannot.
const SITUATION =
  'A bank vault corridor lined with rows of black steel safety deposit boxes ' +
  'with brass hinges and small round keyholes, drawn as a bold 2D cartoon with ' +
  'heavy black outlines and flat cel shading. One box in the RIGHT half of the ' +
  'frame hangs open and is ROARING WITH FIRE — tall orange and yellow flames ' +
  'and thick black smoke pouring upward, embers and sparks flying. Inside the ' +
  'burning box, stacks of GOLD COINS and gold bars are alight. Warm orange ' +
  'firelight rakes leftward across the vault wall. The LEFT HALF of the image ' +
  'is calm dark vault wall in shadow, empty, no detail. ' +
  'ABSOLUTELY NO CHARACTERS, no people, no animals, no mascots — the corridor ' +
  'is empty';

async function main() {
  const key = await loadKey();
  const model = flag('model', 'ideogram-v4');
  const variants = Number(flag('variants', 2));

  // Lock the character to the art that already exists, where the model supports
  // it. Ten prompts for "Kevin" otherwise gives ten different characters, and a
  // meme brand dies the moment the face stops being recognisable.
  // No style references here: they are pictures of Kevin, and feeding them in
  // is asking the model to put him back into a scene he must stay out of.
  const prompt = `SCENE: ${SITUATION}. STYLE: ${STYLE}. ` +
    'NO lettering, NO numbers, NO signage, NO logos, NO characters anywhere.';

  for (let i = 1; i <= variants; i++) {
    process.stdout.write(`${model} variant ${i}/${variants}… `);
    const buf = await generate(key, {
      model,
      prompt,
      // Text is stamped on afterwards, so any lettering the model invents is
      // pure liability — it is always misspelled and it sits where the real
      // numbers need to go.
      negative_prompt: NEGATIVE + ', text, letters, numbers, words, signage, logos, ' +
        'captions, character, mascot, person, figure, creature, face, hands',
      aspect_ratio: '1:1',
      width: 1280,
      height: 1280,
    });
    const p = await save(buf, OUT, `${model}-${i}.png`);
    console.log(`→ ${p.replace(ROOT + '/', '')}`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
