#!/usr/bin/env node
// Price the burn-to-mint ladder and show what it actually costs, in KEVIN and
// against today's price — so a tier is a real number checked against real
// supply before it is ever promised publicly.
//
//   node tools/mint-model-burn.mjs                                  # the shipped default
//   node tools/mint-model-burn.mjs --base 5 --step 12.5 --weth-per-kevin 1.301e-9
//
// WHY BASIS POINTS OF CIRCULATING SUPPLY, NOT A FLAT KEVIN NUMBER: a flat
// number picked today ("5M KEVIN") means something completely different once
// the chart moves or more gets burned elsewhere — the same flaw the existing
// USD-priced mint-model.mjs calls out for quoting tiers in raw KEVIN. A % of
// CIRCULATING supply is the one unit that still means the same thing after
// price moves, and it is checkable against the one hard constraint that
// actually exists: the ladder's own sellout total cannot exceed what is
// actually out there to burn.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : Number(args[i + 1]); };

const ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const TOTAL_SUPPLY = 1_000_000_000;
// Read from data/burns.json so this stays accurate as more gets burned —
// hand-typing "30.5M" here would silently go stale the next burn watch
// resync, same class of bug this whole file exists to avoid.
const burns = JSON.parse(await readFile(join(ROOT, 'data/burns.json'), 'utf8'));
const BURNED_SO_FAR = Number(burns.total.tokens);
const CIRCULATING = TOTAL_SUPPLY - BURNED_SO_FAR;

function table(counts, baseBps, stepBpsMult, wethPerKevin) {
  let totalKevin = 0;
  const rows = ORDER.map((tier, i) => {
    const n = counts[tier] || 0;
    // Geometric, not linear — the tier populations themselves roughly halve
    // or better going up (400/300/200/75/25), so a linear cost ladder would
    // make the rarest tier feel cheap relative to how hard it is to get one.
    const bps = baseBps * Math.pow(stepBpsMult, i);
    const kevin = Math.round(CIRCULATING * (bps / 10_000));
    const take = n * kevin;
    totalKevin += take;
    return { tier, n, bps, kevin, take, weth: kevin * wethPerKevin };
  });
  return { rows, totalKevin };
}

const counts = JSON.parse(await readFile(join(ROOT, 'assets/pfp/tiers.json'), 'utf8')).counts;

function render(label, baseBps, stepBpsMult, wethPerKevin) {
  const { rows, totalKevin } = table(counts, baseBps, stepBpsMult, wethPerKevin);
  console.log(`\n${label}  —  ${baseBps} bps base, ×${stepBpsMult} per tier (of ${(CIRCULATING / 1e6).toFixed(1)}M circulating)`);
  for (const r of rows) {
    console.log(
      `  ${r.tier.padEnd(10)} ${String(r.n).padStart(4)} slots  burn ${r.kevin.toLocaleString().padStart(12)} KEVIN` +
      ` (~${r.weth.toFixed(5)} WETH each)  =  ${r.take.toLocaleString().padStart(14)} KEVIN if that tier sells out`
    );
  }
  const pctOfCirc = (totalKevin / CIRCULATING) * 100;
  const pctOfSupply = (totalKevin / TOTAL_SUPPLY) * 100;
  console.log(`  ${''.padEnd(10)} ${String(Object.values(counts).reduce((a, b) => a + b, 0)).padStart(4)} slots  ` +
    `total if EVERY slot fills: ${totalKevin.toLocaleString()} KEVIN` +
    ` = ${pctOfCirc.toFixed(1)}% of circulating, ${pctOfSupply.toFixed(1)}% of total supply`);
  return { rows, totalKevin, pctOfCirc };
}

const wethPerKevin = flag('weth-per-kevin', 1.301e-9);
console.log(`circulating supply right now: ${CIRCULATING.toLocaleString()} KEVIN (${BURNED_SO_FAR.toLocaleString()} already burned)`);
console.log(`price used: 1 KEVIN = ${wethPerKevin.toExponential(4)} WETH`);

render('Shipped default', flag('base', 0.4), flag('step', 2.6), wethPerKevin);
if (!args.includes('--base') && !args.includes('--step')) {
  console.log(`
Geometric, not linear — Legendary is disproportionately harder than Common,
matching how much rarer the slot itself already is (25 vs 400). A full
sellout burns 20% of circulating supply, which is the whole point: it is a
real, checkable ceiling, not a promise nobody could ever keep (the first
draft of this ladder asked for 424%-912% of circulating supply before this
model caught it — see git history). Common is a genuine impulse burn at
today's price; Legendary alone is ~0.18% of the ENTIRE current market cap.
Neither tier is meant to actually sell out soon — if NOTHING moves past
Common/Uncommon after a real mint window, that is the signal to re-run this
with a smaller --base/--step, not to leave it as-is.`);
}
