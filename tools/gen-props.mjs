#!/usr/bin/env node
// Generate the gym's props with Tripo.
//
//   node tools/gen-props.mjs --list
//   node tools/gen-props.mjs --dry          # what it would cost, spends nothing
//   node tools/gen-props.mjs                # generate everything not cached
//   node tools/gen-props.mjs bench treadmill
//
// Cached in game/assets/props/state.json by prompt, and that file is COMMITTED.
// A cached task id is the difference between re-downloading a model and paying
// for it a second time — so never gitignore it, and never edit a prompt unless
// you mean to buy a new model.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadKey, balance, textToModel, wait, download, loadState, saveState } from './lib/tripo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'game/assets/props');
const STATE = join(OUT, 'state.json');

// One art direction, stated once and appended to every prompt. Mixed-source
// props are what make a level look like an asset flip; a shared style line is
// the cheapest defence against it.
const STYLE =
  'bold flat cartoon style, thick black outlines, simple chunky low-poly shapes, ' +
  'flat saturated colours, no realistic detail, no text, no logos, ' +
  'clean single object centred, game asset';

export const PROPS = [
  ['bench', 'a flat weight-lifting bench with a black padded top and red steel frame'],
  ['dumbbell-rack', 'a two-tier gym dumbbell rack holding rows of black dumbbells'],
  ['dumbbell', 'a single chunky black gym dumbbell'],
  ['treadmill', 'a gym treadmill with a running belt, side rails and a small console'],
  ['squat-rack', 'a red steel squat rack with a loaded barbell resting on it'],
  ['plate-tree', 'a weight plate tree stacked with round black and red weight plates'],
  ['protein-tub', 'a large plastic protein powder tub with a screw lid'],
  ['water-cooler', 'a water cooler with a blue bottle on top'],
  ['locker', 'a tall narrow metal gym locker with a vent and a handle'],
  ['bucket', 'an upturned plastic mop bucket'],
  ['speaker', 'a chunky square gym wall speaker'],
  ['gym-mirror', 'a large rectangular wall mirror with a simple frame'],
];

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const only = args.filter((a) => !a.startsWith('--'));

async function main() {
  const list = only.length ? PROPS.filter(([slug]) => only.includes(slug)) : PROPS;
  if (has('list')) {
    for (const [slug, p] of PROPS) console.log(`  ${slug.padEnd(15)} ${p}`);
    return;
  }

  const key = await loadKey();
  const state = await loadState(STATE);
  const { balance: credits } = await balance(key);

  const todo = list.filter(([slug, prompt]) => {
    const hit = state[slug];
    const cached = hit && hit.prompt === prompt && existsSync(join(OUT, `${slug}.glb`));
    if (cached) console.log(`  ${slug.padEnd(15)} cached`);
    return !cached;
  });

  console.log(`\n${credits} credits · ${todo.length} to generate\n`);
  if (has('dry') || !todo.length) return;

  // Queue everything first, then collect. Tripo runs them concurrently, so
  // twelve props take about as long as the slowest one rather than the sum.
  const queued = [];
  for (const [slug, prompt] of todo) {
    try {
      const id = await textToModel(key, `${prompt}, ${STYLE}`);
      queued.push({ slug, prompt, id });
      console.log(`  ${slug.padEnd(15)} queued ${id.slice(0, 8)}`);
    } catch (e) {
      console.log(`  ${slug.padEnd(15)} QUEUE FAILED — ${e.message.slice(0, 90)}`);
    }
  }

  for (const { slug, prompt, id } of queued) {
    try {
      const done = await wait(key, id);
      await download(done, join(OUT, `${slug}.glb`));
      state[slug] = { prompt, id, at: new Date().toISOString() };
      await saveState(STATE, state);          // save after each, so a crash costs nothing
      console.log(`  ${slug.padEnd(15)} done`);
    } catch (e) {
      console.log(`  ${slug.padEnd(15)} FAILED — ${e.message.slice(0, 90)}`);
    }
  }

  const after = await balance(key);
  console.log(`\n${after.balance} credits left (spent ${credits - after.balance})`);
}

await main();
