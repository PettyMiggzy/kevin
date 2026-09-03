#!/usr/bin/env node
// Derives a staking tier for every minted crew member from the manifest.
//
//   node script/derive-tiers.mjs                    # print the table
//   node script/derive-tiers.mjs --out tiers.json   # write the file the
//                                                   # Configure script reads
//
// The contract stores tokenId -> tier and tier -> boost. This is the half that
// turns traits into a tier. It is deliberately out here, in plain sight, so a
// holder can re-run it against assets/crew/crew.json and check that what the
// owner published on-chain is what the traits say.
//
// Two rules keep this stable as the collection grows:
//
//   1. Scores are FIXED POINTS PER TRAIT, never percentiles. A trait is worth
//      what it is worth; minting more crew members never re-tiers an old one.
//   2. Thresholds are FIXED. Same reason. Adding a new trait next month means
//      adding a line to POINTS, not re-running everybody.
//
// Both follow from the manifest's own rules: minted traits are frozen and the
// trait tables are append-only.

import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, "../../assets/crew/crew.json");

// Points per trait value. Anything not listed is worth zero, which is the safe
// default: a trait nobody has scored yet cannot inflate a tier by accident.
const POINTS = {
  crew: {Gold: 4, Ghost: 4, Ink: 2, Purple: 1},
  cap: {Crown: 4, "Chef Hat": 2, "Paper Hat": 1, Hairnet: 1},
  eyes: {Laser: 4, Stars: 3, Shades: 2, Xs: 1},
  extra: {"Gold Chain": 3, Whistle: 2, "Drive-Thru Headset": 1, "Name Badge": 1},
  mouth: {Shouting: 1, Straw: 1},
  face: {Moustache: 1, Toothpick: 1, Gum: 1},
  shirt: {"Manager Black": 2, "Hi-Vis": 1, "Gym Vest": 1},
  background: {Closed: 2, Sunset: 1, Dusk: 1},
};

// score -> tier. Fixed bands, low end inclusive.
const BANDS = [
  {min: 12, tier: 5},
  {min: 9, tier: 4},
  {min: 6, tier: 3},
  {min: 3, tier: 2},
  {min: 0, tier: 1},
];

// What each tier is worth on-chain, in basis points. This is what
// `setTierBoost` publishes, and the owner can retune it later without
// re-tiering a single token.
const TIER_BPS = {1: 500, 2: 1_500, 3: 3_000, 4: 6_000, 5: 10_000};
const TIER_LABEL = {
  1: "Crew",
  2: "Crew, seasoned",
  3: "Shift lead",
  4: "Manager",
  5: "CEO of Chaos",
};

function scoreOf(member) {
  let score = 0;
  const breakdown = [];
  for (const [layer, table] of Object.entries(POINTS)) {
    const value = member[layer];
    const points = table[value] ?? 0;
    if (points > 0) breakdown.push(`${layer}:${value}+${points}`);
    score += points;
  }
  return {score, breakdown};
}

function tierOf(score) {
  return BANDS.find((b) => score >= b.min).tier;
}

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx === -1 ? null : argv[outIdx + 1];

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const byTier = new Map();

  const rows = manifest.crew.map((member) => {
    const {score, breakdown} = scoreOf(member);
    const tier = tierOf(score);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(member.id);
    return {id: member.id, score, tier, breakdown};
  });

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad("#", 5)}${pad("score", 7)}${pad("tier", 6)}why`);
  for (const r of rows) {
    console.log(`${pad(r.id, 5)}${pad(r.score, 7)}${pad(r.tier, 6)}${r.breakdown.join(" ")}`);
  }

  console.log("\ntier  bps     label                 count  ids");
  for (const tier of [...byTier.keys()].sort()) {
    const ids = byTier.get(tier);
    console.log(
      `${pad(tier, 6)}${pad(TIER_BPS[tier], 8)}${pad(TIER_LABEL[tier], 22)}${pad(ids.length, 7)}${ids.join(",")}`
    );
  }

  // Parallel arrays, because that is what `script/Configure.s.sol` can parse
  // out of JSON without heroics. Index i of every array describes the same tier.
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  const doc = {
    manifest: "assets/crew/crew.json",
    generatedFrom: `${manifest.crew.length} minted`,
    tierIds: tiers,
    tierBps: tiers.map((t) => TIER_BPS[t]),
    tierLabels: tiers.map((t) => TIER_LABEL[t]),
    tokenIdsByTier: tiers.map((t) => byTier.get(t)),
  };

  if (outPath) {
    writeFileSync(resolve(process.cwd(), outPath), `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`\nwrote ${outPath}`);
  }
}

main();
