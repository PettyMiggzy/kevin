#!/usr/bin/env node
// Kevin PFP generator.
//
//   node tools/gen-pfp.mjs --count 1000
//   node tools/gen-pfp.mjs --count 12 --out /tmp/preview --sheet
//
// Layered traits over ONE base drawing, which is the only way to get a
// thousand pictures that are all the same character. Generating a thousand
// through an image model gives a thousand different characters — that is the
// exact drift this project has spent a week fighting, and at a thousand times
// the scale it is not fixable afterwards.
//
// Everything is drawn from a seeded RNG, so the whole collection is
// reproducible from `--seed`: same seed, same thousand PFPs, byte for byte.
// Trait combinations are guaranteed unique.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const COUNT = Number(flag('count', 1000));
const SEED = Number(flag('seed', 20260907));
const OUT = flag('out', join(ROOT, 'assets/pfp'));
const SIZE = Number(flag('size', 512));
const BASE = join(ROOT, 'assets/refs/16-kevin-idle.png');

// --- traits ------------------------------------------------------------------
// Weights are relative, not percentages. Rarity is a design decision, so it
// lives here in one place rather than being spread through the drawing code.
const TRAITS = {
  background: [
    ['Brand Yellow', 46, '#FFE500'], ['Fry Red', 16, '#E02128'],
    ['Kek Green', 12, '#2FB457'], ['Fryer Blue', 10, '#2B6CD4'],
    ['Night Shift', 7, '#171512'], ['Cream', 5, '#F7F0DA'],
    ['Rays', 3, 'rays'], ['Gold Rush', 1, 'gold'],
  ],
  fur: [
    ['Classic Red', 62, 0], ['Fryer Orange', 12, 24], ['Kek Green', 8, 128],
    ['Cold Blue', 7, 210], ['Grape', 5, 275], ['Bubblegum', 4, 320],
    ['Gold', 2, 45],
  ],
  hat: [
    ['None', 44, null], ['Red Cap', 16, 'cap'], ['Visor', 10, 'visor'],
    ['Headband', 10, 'band'], ['Crown', 6, 'crown'], ['Top Hat', 5, 'tophat'],
    ['Halo', 5, 'halo'], ['Horns', 4, 'horns'],
  ],
  eyes: [
    ['Normal', 52, null], ['Shades', 20, 'shades'], ['Laser', 9, 'laser'],
    ['Money', 7, 'money'], ['Spiral', 6, 'spiral'], ['3D', 4, 'threed'],
    ['Visor Shades', 2, 'visorshades'],
  ],
  mouth: [
    ['Triangle', 66, null], ['Cigar', 12, 'cigar'], ['Joint', 10, 'joint'],
    ['Lolly', 7, 'lolly'], ['Gold Tooth', 5, 'tooth'],
  ],
  aura: [
    ['None', 78, null], ['Sparks', 10, 'sparks'], ['Smoke', 7, 'smoke'],
    ['Flames', 4, 'flames'], ['Rainbow', 1, 'rainbow'],
  ],
};

/** mulberry32 — small, fast, and reproducible across machines. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rand, table) {
  const total = table.reduce((n, t) => n + t[1], 0);
  let r = rand() * total;
  for (const t of table) { r -= t[1]; if (r <= 0) return t; }
  return table[table.length - 1];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(join(OUT, 'meta'), { recursive: true });
  const baseData = 'data:image/png;base64,' + (await readFile(BASE)).toString('base64');

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--force-color-profile=srgb', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  await page.addScriptTag({ path: join(ROOT, 'tools/lib/pfp-draw.js') });
  await page.evaluate(async (d) => { await window.__pfpInit(d); }, baseData);

  const rand = rng(SEED);
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    let traits, key, tries = 0;
    do {
      traits = Object.fromEntries(Object.entries(TRAITS).map(([k, table]) => {
        const [name, , value] = pick(rand, table);
        return [k, { name, value }];
      }));
      key = Object.values(traits).map((t) => t.name).join('|');
    } while (seen.has(key) && ++tries < 400);
    if (seen.has(key)) { console.log(`  stopped at ${i}: the trait space is exhausted`); break; }
    seen.add(key);

    const png = await page.evaluate(([t, size]) => window.__pfpDraw(t, size), [traits, SIZE]);
    const id = String(i + 1).padStart(4, '0');
    await writeFile(join(OUT, `${id}.png`), Buffer.from(png.split(',')[1], 'base64'));
    const meta = {
      name: `Kevin #${i + 1}`,
      description: "One of the crew. Kevin works the fryer.",
      image: `${id}.png`,
      attributes: Object.entries(traits).map(([k, v]) => ({
        trait_type: k[0].toUpperCase() + k.slice(1), value: v.name,
      })),
    };
    await writeFile(join(OUT, 'meta', `${id}.json`), JSON.stringify(meta, null, 2));
    rows.push(meta);
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${COUNT}`);
  }

  if (has('sheet')) {
    const sheet = await page.evaluate((n) => window.__pfpSheet(n), Math.min(rows.length, 24));
    await writeFile(join(OUT, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
  }
  await browser.close();

  // Rarity table, so the collection can be checked before it is minted.
  const tally = {};
  for (const m of rows) for (const a of m.attributes) {
    tally[a.trait_type] ??= {};
    tally[a.trait_type][a.value] = (tally[a.trait_type][a.value] || 0) + 1;
  }
  await writeFile(join(OUT, 'rarity.json'), JSON.stringify(tally, null, 2));
  console.log(`\n${rows.length} PFPs in ${OUT.replace(ROOT + '/', '')}`);
  console.log(`  every trait combination unique · seed ${SEED} reproduces this exactly`);
  for (const [k, v] of Object.entries(tally)) {
    const top = Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n, c]) => `${n} ${(c / rows.length * 100).toFixed(1)}%`).join(', ');
    console.log(`  ${k.padEnd(11)} ${top}`);
  }
}

await main();
