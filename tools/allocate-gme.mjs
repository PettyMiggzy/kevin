#!/usr/bin/env node
// Work out who gets what from the GME pool.
//
//   node tools/allocate-gme.mjs --snapshot holders.csv --shares 1200
//   node tools/allocate-gme.mjs --demo
//
// Snapshot CSV: wallet,kevin_balance,nft_ids   (nft_ids space-separated)
//
// The formula is deliberately dull and auditable. Anyone holding the snapshot
// can recompute this and get the same answer to the share, which is the only
// property that matters when people are being handed something of value.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

/** Tier weights. A Legendary counts as sixteen Commons, and nothing else. */
export const TIER_WEIGHT = { Common: 1, Uncommon: 2, Rare: 4, Epic: 8, Legendary: 16 };
/** Floor to be eligible at all, in whole KEVIN. */
export const MIN_KEVIN = 10_000_000;

/**
 * @param {Array<{wallet:string, kevin:number, tiers:string[]}>} holders
 * @param {number} shares  whole shares in the pool
 */
export function allocate(holders, shares) {
  const eligible = holders
    .map((h) => ({
      ...h,
      weight: h.tiers.reduce((n, t) => n + (TIER_WEIGHT[t] || 0), 0),
    }))
    .filter((h) => h.kevin >= MIN_KEVIN && h.weight > 0);

  const total = eligible.reduce((n, h) => n + h.weight, 0);
  if (!total) return { rows: [], total: 0, distributed: 0, dust: shares };

  // Largest-remainder. Plain rounding either hands out more shares than exist
  // or silently loses some; this always distributes exactly `shares`, and ties
  // break on weight then wallet so the result does not depend on input order.
  const raw = eligible.map((h) => ({ ...h, exact: (shares * h.weight) / total }));
  const rows = raw.map((h) => ({ ...h, shares: Math.floor(h.exact) }));
  let left = shares - rows.reduce((n, r) => n + r.shares, 0);
  const order = rows
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact), weight: r.weight, wallet: r.wallet }))
    .sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.wallet.localeCompare(b.wallet));
  for (let k = 0; k < order.length && left > 0; k++, left--) rows[order[k].i].shares++;

  rows.sort((a, b) => b.shares - a.shares || a.wallet.localeCompare(b.wallet));
  return { rows, total, distributed: rows.reduce((n, r) => n + r.shares, 0), dust: left };
}

function parseCsv(text) {
  return text.trim().split('\n').slice(1).filter(Boolean).map((line) => {
    const [wallet, kevin, ids = ''] = line.split(',').map((s) => s.trim());
    return { wallet, kevin: Number(kevin), nftIds: ids.split(/\s+/).filter(Boolean) };
  });
}

async function main() {
  const shares = Number(flag('shares', 1000));
  let holders;

  if (has('demo')) {
    const tiers = Object.keys(TIER_WEIGHT);
    holders = Array.from({ length: 40 }, (_, i) => ({
      wallet: '0x' + String(i + 1).padStart(4, '0') + 'demo',
      kevin: Math.round((2 + Math.random() * 40) * 1_000_000),
      tiers: Array.from({ length: 1 + Math.floor(Math.random() * 4) },
        () => tiers[Math.floor(Math.random() * tiers.length)]),
    }));
  } else {
    const path = flag('snapshot');
    if (!path) { console.error('need --snapshot <csv> or --demo'); process.exit(1); }
    const meta = JSON.parse(await readFile(join(ROOT, 'assets/pfp/tiers.json'), 'utf8')).byId;
    holders = parseCsv(await readFile(path, 'utf8'))
      .map((h) => ({ wallet: h.wallet, kevin: h.kevin, tiers: h.nftIds.map((id) => meta[id]).filter(Boolean) }));
  }

  const { rows, total, distributed, dust } = allocate(holders, shares);
  console.log(`pool ${shares} shares · ${rows.length} eligible wallets · ${total} total weight`);
  console.log(`min holding ${MIN_KEVIN.toLocaleString()} KEVIN\n`);
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${r.wallet}  ${String(r.shares).padStart(4)} shares` +
      `  weight ${String(r.weight).padStart(3)}  ${(r.kevin / 1e6).toFixed(1)}M KEVIN`);
  }
  if (rows.length > 12) console.log(`  … ${rows.length - 12} more`);
  console.log(`\ndistributed ${distributed}/${shares}, ${dust} undistributed`);
  if (distributed !== shares) { console.error('ALLOCATION DOES NOT BALANCE'); process.exit(1); }
  if (has('out')) {
    await writeFile(flag('out'), 'wallet,shares,weight,kevin\n' +
      rows.map((r) => `${r.wallet},${r.shares},${r.weight},${r.kevin}`).join('\n') + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
