#!/usr/bin/env node
// Computes each token's tier from COMBINATION rarity and stamps it onto
// every meta file plus assets/pfp/tiers.json.
//
//   node tools/assign-tiers.mjs
//
// WHY THIS IS ITS OWN SCRIPT, NOT PART OF gen-pfp.mjs: tier depends on the
// frequency of every trait value ACROSS THE WHOLE 1,000-token set, which
// only exists once generation has finished — it cannot be computed for
// token #1 while token #1 is being drawn. The very first run of this
// pipeline did this step inline and only committed its OUTPUT (tiers.json,
// and a "Tier" attribute merged into each meta file), so a later
// regeneration silently dropped the Tier attribute with nothing to catch
// it. This script is that missing, reusable step, checked into git so it
// can't go missing again.
//
// Each token scores the sum of 1/frequency across its six core traits
// (Background/Fur/Hat/Eyes/Mouth/Aura -- NOT Tier, which doesn't exist yet
// at scoring time). Highest scores are rarest. Cut 25/75/200/300/400 into
// Legendary/Epic/Rare/Uncommon/Common, matching docs/NFT.md and the counts
// already baked into tiers.json.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const META_DIR = join(ROOT, 'assets/pfp/meta');
const CUTS = [['Legendary', 25], ['Epic', 75], ['Rare', 200], ['Uncommon', 300], ['Common', 400]];

const files = (await readdir(META_DIR)).filter((f) => f.endsWith('.json')).sort();
const tokens = await Promise.all(
  files.map(async (f) => {
    const meta = JSON.parse(await readFile(join(META_DIR, f), 'utf8'));
    const id = f.replace(/\.json$/, '');
    // Drop any stale Tier attribute from a previous run before scoring --
    // it must never itself count toward its own rarity score.
    const attrs = meta.attributes.filter((a) => a.trait_type !== 'Tier');
    return { id, f, meta, attrs };
  })
);

if (tokens.length !== CUTS.reduce((n, [, c]) => n + c, 0)) {
  throw new Error(`expected ${CUTS.reduce((n, [, c]) => n + c, 0)} tokens, found ${tokens.length}`);
}

const freq = {};
for (const t of tokens) {
  for (const a of t.attrs) {
    const key = `${a.trait_type}:${a.value}`;
    freq[key] = (freq[key] || 0) + 1;
  }
}

for (const t of tokens) {
  t.score = t.attrs.reduce((s, a) => s + 1 / freq[`${a.trait_type}:${a.value}`], 0);
}

tokens.sort((a, b) => b.score - a.score);

const byId = {};
let cursor = 0;
for (const [tier, count] of CUTS) {
  for (let i = 0; i < count; i++) {
    const t = tokens[cursor++];
    byId[t.id] = tier;
  }
}
if (cursor !== tokens.length) throw new Error('cut counts do not add up to the token count');

for (const t of tokens) {
  const tier = byId[t.id];
  t.meta.attributes = [...t.attrs, { trait_type: 'Tier', value: tier }];
  await writeFile(join(META_DIR, t.f), JSON.stringify(t.meta, null, 2));
}

const counts = Object.fromEntries(CUTS.map(([tier, count]) => [tier, count]));
await writeFile(join(ROOT, 'assets/pfp/tiers.json'), JSON.stringify({ byId, counts }, null, 2));

console.log(`tiered ${tokens.length} tokens`);
for (const [tier, count] of CUTS) console.log(`  ${tier.padEnd(10)} ${count}`);
