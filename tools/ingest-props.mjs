#!/usr/bin/env node
// Take a bought asset kit and make it this game's props.
//
//   node tools/ingest-props.mjs --from ~/Downloads/gym-kit --dry
//   node tools/ingest-props.mjs --from ~/Downloads/gym-kit
//
// The props in here were generated one prompt at a time, which is why they are
// twelve art directions held together by normalise(). A kit is modelled as a
// set, so it fixes that in one purchase — but a kit does not ship with this
// game's names on it. It ships SM_Prop_Gym_Bench_01.glb, and the game asks for
// bench.glb, and doing that by hand across forty files is where mistakes live.
//
// So: match what the kit has against what the game needs, copy the winners into
// raw/ under the game's names, and hand off to optimize-props.mjs, which is
// already the thing that turns a 375,000-triangle model into something a phone
// will open. Nothing here is kit-specific — it is name matching and a copy.
import { readdir, copyFile, mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'gym/assets/props');
const RAW = join(DIR, 'raw');
const ALIASES = join(ROOT, 'gym/assets/props/aliases.json');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const DRY = args.includes('--dry');
const FROM = flag('from');

/**
 * Every prop the game asks for by name.
 *
 * Kept here rather than parsed out of main.js: a name the game stopped using
 * should stop being ingested, and that is a decision, not something to infer
 * from a regex over source code.
 */
const NEEDED = [
  'bench', 'dumbbell-rack', 'treadmill',                        // the three stations
  'squat-rack', 'plate-tree', 'pullup-rig', 'kettlebell', 'dumbbell', 'medicine-ball',
  'lat-pulldown', 'cable-machine', 'leg-press', 'rowing-machine', 'punching-bag',
  'locker', 'water-cooler', 'towel-bin', 'protein-tub', 'bucket', 'speaker',
  'gym-clock', 'gym-mirror',

  // McKevin's. Every one of these is currently a hand-placed box with a model
  // slot behind it (see SHOP_PROPS in gym/js/mckevins.js), so a restaurant pack
  // furnishes the whole restaurant without a line of placement code.
  'fryer', 'grill', 'prep-counter', 'shake-machine', 'kitchen-shelf', 'walk-in',
  'till', 'tray-stack', 'diner-booth', 'trash-bin',
  'picnic-table', 'lamp-post', 'wheelie-bin', 'car',
];

/**
 * Equipment the game does not place yet but would take if a pack had it.
 *
 * A pack is bought for what is in it, and a matcher that only knows the
 * twenty-two names already in use throws away the boxing ring. These get
 * ingested under a clean name so they are sitting in props/ ready to place —
 * the placement is a line in SCENERY, which is the easy half.
 */
const BONUS = [
  'boxing-ring', 'yoga-mat', 'exercise-bike', 'smith-machine', 'incline-bench',
  'barbell', 'weight-plate', 'jump-rope', 'ab-bench', 'dip-station',
  'battle-rope', 'sled', 'foam-roller', 'gym-ball', 'chalk-bucket',
  'bench-press', 'preacher-curl', 'hack-squat', 'stair-climber', 'elliptical',
  'weight-bench', 'barbell-rack', 'wall-clock', 'poster', 'bin', 'stool',

  // Restaurant dressing. Not placed yet, but a fast-food pack is bought for the
  // burger on the tray as much as for the fryer, and a matcher that only knows
  // the fourteen names above throws the dressing away.
  'diner-table', 'diner-chair', 'drinks-machine', 'coffee-machine', 'microwave',
  'extractor-hood', 'fry-basket', 'heat-lamp', 'menu-board', 'napkin-dispenser',
  'ketchup-bottle', 'burger', 'fries', 'soda-cup', 'food-tray', 'pizza',
  'plate', 'mug', 'bottle', 'crate', 'pallet', 'parasol', 'bollard', 'traffic-cone',
];

/** Tokens that say nothing about what a thing is. */
const NOISE = new Set(['sm', 'sk', 'prop', 'props', 'static', 'mesh', 'gym', 'fitness',
  'polygon', 'synty', 'kenney', 'lod0', 'lod', 'a', 'b', 'c', '01', '02', '03', 'low', 'high',
  // A pack named for its art style says that in every filename, and "psx" or
  // "restaurant" matching the word "restaurant" in nothing is pure noise.
  'psx', 'poly', 'lowpoly', 'style', 'pack', 'asset', 'kit', 'game', 'ready']);

// CamelCase has to be split before lowercasing. Kits name things
// SM_Prop_Gym_LatPulldown_01, which without this is one token "latpulldown"
// and never matches the two the game asks for — that alone was half the
// misses on the first pass.
const tokens = (s) => s
  .replace(/\.(glb|gltf)$/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((t) => t && !NOISE.has(t) && !/^\d+$/.test(t));

/**
 * How well a file's name answers a wanted name.
 *
 * Deliberately blunt: shared tokens, with a bonus for the wanted name's LAST
 * token, because "dumbbell-rack" is a rack and "dumbbell" is not, and a scorer
 * that treats both tokens equally will hand you the wrong one about half the
 * time.
 */
function score(want, file) {
  const w = tokens(want);
  const f = new Set(tokens(file));
  if (!w.length) return 0;
  let n = 0;
  for (const t of w) if (f.has(t)) n++;
  if (n === 0) return 0;
  const head = w[w.length - 1];
  // Every token the file has that the game did not ask for is a small strike
  // against it, so "Bench" beats "BenchPress" for `bench` and the specific
  // thing still wins when the game actually asked for it.
  const extra = Math.max(0, f.size - w.length);
  return n / w.length + (f.has(head) ? 0.5 : 0) - extra * 0.12;
}

async function main() {
  if (!FROM) {
    console.log('what to do:\n');
    console.log('  1. Put the kit somewhere and point --from at it. Any folder of');
    console.log('     .glb or .gltf files, nested or not.');
    console.log('  2. Run with --dry first and read what it matched.');
    console.log('  3. Fix anything wrong in gym/assets/props/aliases.json, which is');
    console.log('     written on the first run: "game-name": "file-name".');
    console.log('  4. Run for real, then: npm run props:optimize\n');
    console.log(`The game asks for ${NEEDED.length} props:`);
    console.log('  ' + NEEDED.join(', '));
    process.exit(1);
  }
  if (!existsSync(FROM)) { console.log(`no such folder: ${FROM}`); process.exit(1); }

  // Walk it. Kits nest by category and nobody wants to flatten that by hand.
  const found = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(glb|gltf)$/i.test(e.name)) found.push(p);
    }
  };
  await walk(FROM);
  console.log(`${found.length} model(s) in ${FROM}\n`);
  if (!found.length) {
    console.log('Nothing to ingest. If the kit is .fbx or .blend, export to .glb first —');
    console.log('Blender: File > Export > glTF 2.0, format glTF Binary, one file per prop.');
    process.exit(1);
  }

  // A hand-written alias always beats the scorer.
  let aliases = {};
  if (existsSync(ALIASES)) aliases = JSON.parse(await readFile(ALIASES, 'utf8'));

  // Bonus names are matched too, but only when a pack actually has them, and
  // never at the expense of something the game already asks for.
  const WANTED = [...NEEDED, ...BONUS];
  const picks = [];
  const missing = [];
  const taken = new Set();
  const claimed = new Set();

  // A prop the game already ships is only ever replaced deliberately.
  //
  // The second pack ingested is where this bites: this one is a diner, and its
  // toilet bin scored a perfect 1.00 against the gym's towel-bin, which would
  // have swapped a towel bin the gym is using for a lavatory bin. A pack you
  // bought for its fryers has no business redecorating the gym, so an existing
  // prop needs a hand-written alias to be overwritten — a guess is not enough.
  const shipped = new Set();
  for (const f of existsSync(DIR) ? await readdir(DIR) : []) {
    if (extname(f).toLowerCase() === '.glb') shipped.add(basename(f, extname(f)));
  }

  // Aliases first and unconditionally: a name somebody wrote down beats
  // anything a scorer works out.
  for (const want of WANTED) {
    // null vetoes the name for this pack: "we looked, it does not have one".
    // Without it the scorer matched picnic-table to a paper napkin at 1.00,
    // because "table" is in "SM_TableNapkin" and nothing outranked it.
    if (aliases[want] === null) { claimed.add(want); continue; }
    if (!aliases[want]) continue;
    const a = String(aliases[want]).toLowerCase();
    const hit = found.find((f) => basename(f).toLowerCase() === a) ||
                found.find((f) => basename(f, extname(f)).toLowerCase() === a);
    if (!hit) { console.log(`  !  ${want.padEnd(15)} alias "${aliases[want]}" is not in the folder`); continue; }
    picks.push({ want, file: hit, how: 'alias' });
    taken.add(hit); claimed.add(want);
  }

  // Then best-first across everything left, rather than in the order the game
  // happens to list its props. Going in order lets "dumbbell-rack" take the
  // one file "squat-rack" needed and leaves the better match for neither —
  // which is exactly what it did: both got handed the same rack.
  const pairs = [];
  for (const want of WANTED) {
    if (claimed.has(want) || shipped.has(want)) continue;
    for (const f of found) {
      const sc = score(want, basename(f));
      if (sc >= 0.6) pairs.push({ want, file: f, sc });
    }
  }
  const rank = (w) => (NEEDED.includes(w) ? 0 : 1);
  pairs.sort((a, b) => rank(a.want) - rank(b.want) || b.sc - a.sc);
  for (const pr of pairs) {
    if (claimed.has(pr.want) || taken.has(pr.file)) continue;
    picks.push({ want: pr.want, file: pr.file, how: `guess ${pr.sc.toFixed(2)}` });
    taken.add(pr.file); claimed.add(pr.want);
  }
  for (const want of NEEDED) if (!claimed.has(want) && !shipped.has(want)) missing.push(want);
  picks.sort((a, b) => WANTED.indexOf(a.want) - WANTED.indexOf(b.want));

  for (const p of picks) {
    const tag = NEEDED.includes(p.want) ? 'ok ' : '++ ';
    console.log(`  ${tag} ${p.want.padEnd(15)} <- ${basename(p.file).padEnd(38)} ${p.how}`);
  }
  for (const m of missing) console.log(`  --  ${m.padEnd(15)} nothing close enough; add an alias`);

  // Everything the pack has that nothing asked for. Printed rather than
  // silently dropped: this is the list to read when deciding what else the
  // gym could have, and an unmatched name here is usually a missing alias
  // rather than a model nobody wants.
  const spare = found.filter((f) => !taken.has(f));
  if (spare.length) {
    console.log(`\n${spare.length} model(s) in the pack that nothing claimed:`);
    for (const f of spare.slice(0, 40)) console.log(`      ${basename(f)}`);
    if (spare.length > 40) console.log(`      … and ${spare.length - 40} more`);
    console.log('  To use one: add it to BONUS in this file, or alias it to a name in NEEDED.');
  }

  const core = picks.filter((p) => NEEDED.includes(p.want)).length;
  console.log(`\n${core}/${NEEDED.length} the game places now` +
    (picks.length > core ? `, plus ${picks.length - core} extra ingested and ready to place` : ''));
  if (DRY) { console.log('\n--dry: nothing copied. Check the matches, then run without --dry.'); return; }

  await mkdir(RAW, { recursive: true });
  let bytes = 0;
  for (const p of picks) {
    await copyFile(p.file, join(RAW, `${p.want}.glb`));
    bytes += (await stat(p.file)).size;
  }
  // Write the map back out with what was actually used, so the next run is
  // reproducible and anything mis-guessed can be corrected in one place.
  //
  // Merged, not replaced. This started as `const out = {}`, which assumed one
  // kit would ever be ingested — the second pack silently erased the first
  // pack's seventeen aliases, throwing away the record of which Sketchfab file
  // became which prop. That record is the whole point: without it a re-ingest
  // re-guesses, and re-guessing is what handed two different props the same
  // rack. A name this run did not claim keeps whatever it was mapped to.
  const out = { ...aliases };
  for (const p of picks) out[p.want] = basename(p.file);
  await writeFile(ALIASES, JSON.stringify(out, null, 2) + '\n');

  console.log(`\ncopied ${picks.length} into gym/assets/props/raw/ (${(bytes / 1e6).toFixed(1)}MB)`);
  console.log(`aliases written to ${ALIASES.replace(ROOT + '/', '')}`);
  console.log('\nnow:  npm run props:optimize');
}

await main();
