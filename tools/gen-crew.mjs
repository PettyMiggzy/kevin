#!/usr/bin/env node
// Mint KEVIN'S CREW.
//
//   node tools/gen-crew.mjs                 # render whatever is in the manifest
//   node tools/gen-crew.mjs --mint 20       # mint up to 20, then render
//   node tools/gen-crew.mjs --mint 50       # extend to 50 — the first 20 do not move
//   node tools/gen-crew.mjs --sheet         # also write a contact sheet
//
// Minting is append-only. A token's traits are rolled once, written to
// assets/crew/crew.json, and read from there ever after — so adding a hat next
// month gives new tokens more to roll and leaves every existing one untouched.
// Re-running with no --mint just re-renders the art from the frozen manifest.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { roll, crewSVG, crewGrid, KEVIN, TABLES, SPACE } from './lib/crew.mjs';
import { withBrowser, svgToPng, contactSheet } from './lib/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/crew');
const MANIFEST = join(OUT, 'crew.json');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

async function main() {
  await mkdir(join(OUT, 'png'), { recursive: true });
  await mkdir(join(OUT, 'svg'), { recursive: true });

  let crew = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')).crew : [];
  const before = crew.length;

  const target = Number(flag('mint', 0));
  if (target > crew.length) {
    for (let id = crew.length + 1; id <= target; id++) crew.push(roll(id));
    console.log(`minted #${before + 1}–#${crew.length}`);
  } else if (target && target < crew.length) {
    // Shrinking would un-mint somebody. Say so instead of doing it.
    console.log(`manifest already holds ${crew.length}; --mint ${target} would remove ${crew.length - target}. Ignored.`);
  }

  if (!crew.length) {
    console.log('nothing minted yet — try --mint 20');
    return;
  }

  await writeFile(MANIFEST, JSON.stringify({
    name: "KEVIN'S CREW",
    description: 'The people Kevin works with. 32x32, every feature a layer.',
    space: SPACE,
    traits: Object.fromEntries(
      Object.entries(TABLES).map(([k, v]) => [k.toLowerCase(), v.map((r) => r[0])])
    ),
    crew,
  }, null, 2) + '\n');

  // The grids the game extrudes into voxel heads. Small — palette plus one
  // index per cell — so the whole collection ships as a single file.
  await writeFile(
    join(OUT, 'grids.json'),
    // Kevin goes in at index 0 and is not part of the collection — he is the
    // player, not a token. The minted crew follow him.
    JSON.stringify({ size: crew.length, crew: [crewGrid(KEVIN), ...crew.map(crewGrid)] }) + '\n'
  );

  const svgs = crew.map((t) => crewSVG(t));
  await withBrowser(async (browser) => {
    for (let i = 0; i < crew.length; i++) {
      const n = String(crew[i].id).padStart(3, '0');
      await writeFile(join(OUT, 'svg', `${n}.svg`), svgs[i]);
      await svgToPng(browser, svgs[i], join(OUT, 'png', `${n}.png`), 512, 512);
    }
    if (args.includes('--sheet')) {
      await contactSheet(browser, svgs, join(OUT, 'contact-sheet.png'), {
        cell: 160,
        cols: Math.min(5, crew.length),
        bg: '#0B0B0B',
        labels: crew.map((t) => `#${String(t.id).padStart(3, '0')} ${t.crew}`),
      });
      console.log('contact sheet → assets/crew/contact-sheet.png');
    }
  });

  // Rarity, straight off the manifest, so it is never out of step with the art.
  const tally = {};
  for (const t of crew) {
    for (const k of ['crew', 'cap', 'eyes', 'mouth', 'face', 'extra', 'background', 'shirt']) {
      ((tally[k] ??= {})[t[k]] ??= 0), tally[k][t[k]]++;
    }
  }
  console.log(`\n${crew.length} crew · ${SPACE.toLocaleString()} possible combinations\n`);
  for (const [k, counts] of Object.entries(tally)) {
    const line = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([n, v]) => `${n} ${v}`)
      .join(' · ');
    console.log(`  ${k.padEnd(11)} ${line}`);
  }
}

await main();
