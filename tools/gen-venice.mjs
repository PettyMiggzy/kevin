#!/usr/bin/env node
// Generate the scene art through Venice.
//
//   VENICE_API_KEY=... node tools/gen-venice.mjs                 # every scene
//   node tools/gen-venice.mjs getaway gym                        # named scenes
//   node tools/gen-venice.mjs --model gpt-image-2 --variants 3   # pick model
//   node tools/gen-venice.mjs --list                             # show scenes
//   node tools/gen-venice.mjs --models                           # show models
//
// Output lands in assets/scenes/venice/<scene>-<model>-<n>.png
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { loadKey, generate, save, listModels, styleRefs } from './lib/venice.mjs';
import { SCENES, NEGATIVE, MODEL_PRESETS } from './venice-prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/scenes/venice');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);
const names = argv.filter((a) => !a.startsWith('--') && !argv.includes(`--${a}`) === false ? false : !a.startsWith('--'))
  .filter((a, i) => {
    // drop values that belong to a flag
    const prev = argv[argv.indexOf(a) - 1];
    return !(prev && prev.startsWith('--'));
  });

async function main() {
  if (has('list')) {
    for (const s of SCENES) console.log(`  ${s.id.padEnd(16)} ${s.situation.slice(0, 88)}…`);
    return;
  }

  const key = await loadKey();

  if (has('models')) {
    const models = await listModels(key);
    for (const m of models) {
      const preset = MODEL_PRESETS[m.id];
      console.log(`  ${m.id.padEnd(28)} ${preset ? '★ ' + preset.note : ''}`);
    }
    return;
  }

  const model = flag('model', 'ideogram-v4');
  const variants = Number(flag('variants', 1));

  // --ref locks the look to assets/refs/. Pass names (01,hero) or "all".
  // Only krea-v2-* and luma-uni-1* actually honour style references; the API
  // silently ignores them elsewhere, so warn rather than pretend.
  const refArg = flag('ref');
  const refStrength = Number(flag('ref-strength', 0.6));
  let references = null;
  if (refArg) {
    const dir = join(ROOT, 'assets/refs');
    const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
    const wanted =
      refArg === 'all'
        ? files
        : files.filter((f) => refArg.split(',').some((r) => f.toLowerCase().includes(r.toLowerCase())));
    if (!wanted.length) {
      console.error(`No reference matched "${refArg}". Available:\n  ${files.join('\n  ')}`);
      process.exit(1);
    }
    references = await styleRefs(wanted.map((f) => join(dir, f)), refStrength);
    const supports = /^(krea-v2|luma-uni-1)/.test(model);
    console.log(`refs: ${wanted.join(', ')} @ strength ${refStrength}`);
    if (!supports) console.log(`  ! ${model} ignores style references — use krea-v2-large or luma-uni-1-max`);
  }
  const preset = MODEL_PRESETS[model] || {};
  const wanted = names.length ? SCENES.filter((s) => names.includes(s.id)) : SCENES;

  if (!wanted.length) {
    console.error(`No scene matched. Try --list. Wanted: ${names.join(', ')}`);
    process.exit(1);
  }

  console.log(`model: ${model}${preset.note ? ` (${preset.note})` : ''}`);
  console.log(`scenes: ${wanted.map((s) => s.id).join(', ')}\n`);

  for (const s of wanted) {
    for (let v = 1; v <= variants; v++) {
      const label = `${s.id}${variants > 1 ? `-${v}` : ''}`;
      process.stdout.write(`  ${label.padEnd(22)} `);
      try {
        const buf = await generate(key, {
          model,
          prompt: s.prompt,
          negative_prompt: NEGATIVE,
          format: 'png',
          seed: s.seed ?? undefined,
          ...preset,
          ...(s.width ? { width: s.width } : {}),
          ...(s.height ? { height: s.height } : {}),
          ...(s.aspect_ratio ? { aspect_ratio: s.aspect_ratio } : {}),
          ...(references ? { style_references: references } : {}),
        });
        const p = await save(buf, OUT, `${label}-${model}${references ? '-ref' : ''}.png`);
        console.log(`${(buf.length / 1024).toFixed(0)}KB  →  ${p.replace(ROOT + '/', '')}`);
      } catch (e) {
        console.log(`FAILED — ${e.message.split('\n')[0]}`);
      }
    }
  }
}

await main();
