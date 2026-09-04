#!/usr/bin/env node
// Price the mint and show what it raises.
//
//   node tools/mint-model.mjs                       # both of the shapes discussed
//   node tools/mint-model.mjs --base 9.99 --step 5
//
// Prices are quoted in USD and paid in KEVIN at the spot rate at mint. Quoting
// the TIER in dollars and settling in KEVIN keeps the ladder meaningful while
// the token price moves; quoting it in KEVIN means tier five is cheaper than
// tier one the moment the chart does anything.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : Number(args[i + 1]); };

const ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

function table(counts, base, step) {
  let total = 0;
  const rows = ORDER.map((tier, i) => {
    const n = counts[tier] || 0;
    const price = base + step * i;
    const take = n * price;
    total += take;
    return { tier, n, price, take };
  });
  return { rows, total };
}

const counts = JSON.parse(await readFile(join(ROOT, 'assets/pfp/tiers.json'), 'utf8')).counts;

function show(label, base, step) {
  const { rows, total } = table(counts, base, step);
  console.log(`\n${label}  —  $${base.toFixed(2)} base, +$${step.toFixed(2)} per tier`);
  for (const r of rows) {
    console.log(`  ${r.tier.padEnd(10)} ${String(r.n).padStart(4)} × $${r.price.toFixed(2).padStart(6)}` +
      ` = $${r.take.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  }
  console.log(`  ${''.padEnd(10)} ${String(Object.values(counts).reduce((a, b) => a + b, 0)).padStart(4)}` +
    `            = $${total.toLocaleString(undefined, { minimumFractionDigits: 2 })} if it all sells`);
}

if (args.length) show('Custom', flag('base', 9.99), flag('step', 5));
else {
  show('Option A', 9.99, 5);
  show('Option B', 5, 3);
  console.log('\nA raises roughly double B on a full sellout. B is the easier first mint:');
  console.log('a $5 floor is an impulse, and a sold-out cheap mint is better marketing');
  console.log('than a half-sold dear one — the unsold half is the thing people notice.');
}
