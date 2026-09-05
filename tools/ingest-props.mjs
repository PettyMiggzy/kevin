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
const RAW = join(ROOT, 'gym/assets/props/raw');
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
];

/** Tokens that say nothing about what a thing is. */
const NOISE = new Set(['sm', 'sk', 'prop', 'props', 'static', 'mesh', 'gym', 'fitness',
  'polygon', 'synty', 'kenney', 'lod0', 'lod', 'a', 'b', 'c', '01', '02', '03', 'low', 'high']);

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

  const picks = [];
  const missing = [];
  const taken = new Set();
  const claimed = new Set();

  // Aliases first and unconditionally: a name somebody wrote down beats
  // anything a scorer works out.
  for (const want of NEEDED) {
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
  for (const want of NEEDED) {
    if (claimed.has(want)) continue;
    for (const f of found) {
      const sc = score(want, basename(f));
      if (sc >= 0.6) pairs.push({ want, file: f, sc });
    }
  }
  pairs.sort((a, b) => b.sc - a.sc);
  for (const pr of pairs) {
    if (claimed.has(pr.want) || taken.has(pr.file)) continue;
    picks.push({ want: pr.want, file: pr.file, how: `guess ${pr.sc.toFixed(2)}` });
    taken.add(pr.file); claimed.add(pr.want);
  }
  for (const want of NEEDED) if (!claimed.has(want)) missing.push(want);
  picks.sort((a, b) => NEEDED.indexOf(a.want) - NEEDED.indexOf(b.want));

  for (const p of picks) {
    console.log(`  ok  ${p.want.padEnd(15)} <- ${basename(p.file).padEnd(38)} ${p.how}`);
  }
  for (const m of missing) console.log(`  --  ${m.padEnd(15)} nothing close enough; add an alias`);

  console.log(`\n${picks.length}/${NEEDED.length} matched`);
  if (DRY) { console.log('\n--dry: nothing copied. Check the matches, then run without --dry.'); return; }

  await mkdir(RAW, { recursive: true });
  let bytes = 0;
  for (const p of picks) {
    await copyFile(p.file, join(RAW, `${p.want}.glb`));
    bytes += (await stat(p.file)).size;
  }
  // Write the map back out with what was actually used, so the next run is
  // reproducible and anything mis-guessed can be corrected in one place.
  const out = {};
  for (const p of picks) out[p.want] = basename(p.file);
  await writeFile(ALIASES, JSON.stringify(out, null, 2) + '\n');

  console.log(`\ncopied ${picks.length} into gym/assets/props/raw/ (${(bytes / 1e6).toFixed(1)}MB)`);
  console.log(`aliases written to ${ALIASES.replace(ROOT + '/', '')}`);
  console.log('\nnow:  npm run props:optimize');
}

await main();
