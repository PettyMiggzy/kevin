#!/usr/bin/env node
// Squeeze Tripo's output down to something a phone can load.
//
//   node tools/optimize-props.mjs
//   node tools/optimize-props.mjs --budget 8000
//
// Tripo hands back ~375,000 triangles and 2048px PBR maps for a single bench —
// about 11MB each, or 128MB for a gym. That is not a "later" problem: it is the
// difference between the game opening in three seconds and not opening.
//
// raw/ holds what was paid for and is gitignored. The optimised GLB next to it
// is what ships and what gets committed. Never delete raw/ without checking
// state.json first — re-generating costs credits, re-optimising is free.
import { readdir, mkdir, stat, rename } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'gym/assets/props');
const RAW = join(DIR, 'raw');
const CLI = join(ROOT, 'node_modules/.bin/gltf-transform');

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};

// A prop in a one-room gym gets a few thousand triangles. Anything that will
// not simplify to this is not a prop, it is a problem — say so rather than
// quietly shipping a 300k-triangle bench.
const BUDGET = Number(flag('budget', 6000));
const TEXTURE = Number(flag('texture', 512));

const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
const kb = (n) => (n / 1024).toFixed(0) + 'KB';

/**
 * Triangle count, read through the CLI's own inspector so meshopt-compressed
 * files work too. CSV rather than the pretty table: the table is padded and
 * ANSI-coloured, and parsing it silently returned zero for every prop — which
 * made the budget check below pass on nothing at all.
 */
async function tris(file) {
  const { stdout } = await run(CLI, ['inspect', file, '--format', 'csv'], { maxBuffer: 1 << 24 });
  const lines = stdout.split('\n');
  // Find the header row by its content. Splitting on the section title and
  // taking the next line lands on a box-drawing divider instead, which is how
  // this quietly returned zero for every prop and made the budget check
  // congratulate itself on nothing.
  const h = lines.findIndex((l) => l.startsWith('#,name,mode,') && l.includes('glPrimitives'));
  if (h === -1) return 0;
  const col = lines[h].split(',').indexOf('glPrimitives');
  let total = 0;
  for (const line of lines.slice(h + 1)) {
    if (!/^\d+,/.test(line)) break;                 // section ends at the first non-row
    const v = Number(line.split(',')[col]);          // glPrimitives sits before the quoted cells
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

async function main() {
  await mkdir(RAW, { recursive: true });

  // First run migrates: anything sitting loose in props/ is unoptimised output.
  for (const f of await readdir(DIR)) {
    if (f.endsWith('.glb') && !existsSync(join(RAW, f))) {
      const size = (await stat(join(DIR, f))).size;
      if (size > 2 * 1048576) await rename(join(DIR, f), join(RAW, f));
    }
  }

  const files = (await readdir(RAW)).filter((f) => f.endsWith('.glb')).sort();
  if (!files.length) {
    console.log(`nothing in ${RAW} — run tools/gen-props.mjs first`);
    return;
  }

  let before = 0;
  let after = 0;
  const over = [];

  for (const f of files) {
    const src = join(RAW, f);
    const out = join(DIR, f);
    const inSize = (await stat(src)).size;
    const inTris = await tris(src);

    // Simplification is driven by an error tolerance rather than a ratio, so a
    // simple prop keeps the geometry it needs and a dense one loses what it
    // does not. The budget below is what catches the ones that ignore it.
    await run(CLI, [
      'optimize', src, out,
      '--compress', 'meshopt',
      '--texture-size', String(TEXTURE),
      '--texture-compress', 'webp',
      '--simplify-error', '0.005',
    ], { maxBuffer: 1 << 26 });

    const outSize = (await stat(out)).size;
    const outTris = await tris(out);
    before += inSize;
    after += outSize;
    if (outTris > BUDGET) over.push([basename(f, '.glb'), outTris]);

    console.log(
      `  ${basename(f, '.glb').padEnd(15)} ${String(inTris).padStart(7)} → ${String(outTris).padStart(6)} tris` +
      `   ${mb(inSize).padStart(8)} → ${kb(outSize).padStart(7)}`
    );
  }

  console.log(`\n  ${files.length} props · ${mb(before)} → ${kb(after)} (${(before / after).toFixed(0)}x smaller)`);

  if (over.length) {
    console.log(`\n  ! over the ${BUDGET}-triangle budget, these need a look:`);
    for (const [name, n] of over) console.log(`      ${name.padEnd(15)} ${n}`);
    process.exitCode = 1;
  }
}

await main();
