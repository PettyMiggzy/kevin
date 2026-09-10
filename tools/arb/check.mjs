#!/usr/bin/env node
// Is there an arbitrage on KEVIN right now?
//
// Reads every pool KEVIN or KEK can be routed through, straight off the
// PoolManager with extsload, then walks each closed loop with the real
// swap maths and the real lp fee. Prints the best trade size and what it
// would earn. A negative edge means the fees eat the gap.
//
//   node tools/arb/check.mjs
//
// The reserves are the full-range equivalents of the pool's liquidity, so
// depth is an over-estimate for a concentrated position. That biases the
// answer toward finding arbitrage, not away from it: if this says no, no.

import { keccak256, encodePacked } from 'viem';

const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const PM  = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const EXTSLOAD = '0x1e2eaeaf';
const POOLS_SLOT = 6n;   // mapping(PoolId => Pool.State) _pools

// Every pool id was found by filtering the PoolManager's Initialize event on
// its indexed currencies — not by guessing fee tiers. See docs/ARBITRAGE.md.
const POOLS = {
  'WETH/KEVIN': ['0xd3ca7f46595df4eb7a3af7c12fdc0d7bd5bf7a2b98f1369282a278ef8283af63', 'WETH', 'KEVIN'],
  'KEK/KEVIN' : ['0x2d36afcddd3abe0f09a560a45e19e6f709bcfd49d249116c2c471c0091dfd05b', 'KEK',  'KEVIN'],
  'GME/KEVIN' : ['0x3af7e5d7ef962f99c4bfa54285ee705c61e11ecbd42cf1ddaea240c4acf49743', 'GME',  'KEVIN'],
  'WETH/KEK'  : ['0x1a2170d9ba519e87b90132d6443b16de6a4a2237c7a38ae89c81d4fc255e7ed3', 'WETH', 'KEK'],
  'ETH/KEK'   : ['0x5516075a46017cae65a9b5da18e99aad9f160e8baf9c7e47f033b3e9166f8fc6', 'ETH',  'KEK'],
  'KEK/USDG'  : ['0xfa87fe8ba525adb96b45b74539d0b97b1e7b97ad47e4c56bf8e8f59ba7e66f2f', 'KEK',  'USDG'],
  'ETH/GME'   : ['0xf5896cad76be6a03a228898963064a25c9dd8770ef843a3f267cef96b7bdf92b', 'ETH',  'GME'],
  'GME/USDG'  : ['0x9a82aa6af873870874cf11cf9e99bb81c9ebf28cc5b394e4fa4996a6805c7c06', 'GME',  'USDG'],
  'WETH/USDG' : ['0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593', 'WETH', 'USDG'],
  'ETH/USDG'  : ['0xefcec38281d4cccaf9c9d7da02aff071d3b94d54fa50bb14b8e6b8e74529a16b', 'ETH',  'USDG'],
};

const DECIMALS = { ETH: 18, WETH: 18, USDG: 6, GME: 18, KEK: 18, KEVIN: 18 };

// Each loop starts and ends in the same asset. ETH and WETH are treated as
// one asset because wrapping is free and exact.
const LOOPS = [
  ['KEVIN: buy on WETH, sell via KEK', [['WETH/KEVIN','WETH'], ['KEK/KEVIN','KEVIN'], ['WETH/KEK','KEK']]],
  ['KEVIN: buy via KEK, sell on WETH', [['WETH/KEK','WETH'], ['KEK/KEVIN','KEK'], ['WETH/KEVIN','KEVIN']]],
  ['KEVIN: buy on WETH, sell via GME', [['WETH/KEVIN','WETH'], ['GME/KEVIN','KEVIN'], ['ETH/GME','GME']]],
  ['KEVIN: buy via GME, sell on WETH', [['ETH/GME','ETH'], ['GME/KEVIN','GME'], ['WETH/KEVIN','KEVIN']]],
  ['KEK: buy wrapped, sell native',    [['WETH/KEK','WETH'], ['ETH/KEK','KEK'], ['ETH/USDG','ETH'], ['WETH/USDG','USDG']]],
  ['KEK: buy native, sell wrapped',    [['WETH/USDG','WETH'], ['ETH/USDG','USDG'], ['ETH/KEK','ETH'], ['WETH/KEK','KEK']]],
  ['KEK: buy on WETH, sell on USDG',   [['WETH/KEK','WETH'], ['KEK/USDG','KEK'], ['WETH/USDG','USDG']]],
  ['KEK: buy on USDG, sell on WETH',   [['WETH/USDG','WETH'], ['KEK/USDG','USDG'], ['WETH/KEK','KEK']]],
];

let rpcId = 0;
async function extsload(slot) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'eth_call',
        params: [{ to: PM, data: EXTSLOAD + slot.slice(2) }, 'latest'] }),
    }).then(r => r.json()).catch(() => ({}));
    if (res.result !== undefined) return res.result;
    await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
}

async function readPool(poolId) {
  const base = keccak256(encodePacked(['bytes32', 'uint256'], [poolId, POOLS_SLOT]));
  const slot0 = await extsload(base);
  if (!slot0) return null;
  const packed = BigInt(slot0);
  const sqrtPriceX96 = packed & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) return null;                       // never initialised
  const lpFee = Number((packed >> 208n) & 0xffffffn);         // what a swap pays today
  const liqSlot = '0x' + (BigInt(base) + 3n).toString(16).padStart(64, '0');
  const liquidity = Number(BigInt((await extsload(liqSlot)) || '0x0'));
  if (liquidity === 0) return null;                           // no depth
  return { sqrtPriceX96, lpFee, liquidity };
}

function reserves(state, dec0, dec1) {
  const sqrtP = Number(state.sqrtPriceX96) / 2 ** 96;
  return {
    x: state.liquidity / sqrtP / 10 ** dec0,
    y: state.liquidity * sqrtP / 10 ** dec1,
  };
}


function walk(loop, book, amount) {
  let token = loop[0][1];
  for (const [name, expect] of loop) {
    const [, c0, c1] = POOLS[name];
    const s = book[name];
    const [rIn, rOut] = token === c0 ? [s.x, s.y] : [s.y, s.x];
    token = token === c0 ? c1 : c0;
    const net = amount * (1 - s.fee / 1e6);
    amount = rOut * net / (rIn + net);
  }
  return amount;
}

function bestSize(loop, book) {
  let bestProfit = -Infinity, bestIn = 0;
  for (let i = 0; i < 400; i++) {
    const size = 1e-9 * Math.pow(1e11, i / 399);   // 1e-9 to 100 units, log spaced
    const profit = walk(loop, book, size) - size;
    if (profit > bestProfit) { bestProfit = profit; bestIn = size; }
  }
  return { size: bestIn, profit: bestProfit, edge: bestProfit / bestIn };
}

const book = {};
const missing = [];
for (const [name, [poolId, c0, c1]] of Object.entries(POOLS)) {
  const state = await readPool(poolId);
  if (!state) { missing.push(name); continue; }
  const r = reserves(state, DECIMALS[c0], DECIMALS[c1]);
  book[name] = { ...r, fee: state.lpFee };
  console.log(`${name.padEnd(11)} fee ${(state.lpFee / 1e4).toFixed(4).padStart(8)}%   ` +
              `${r.x.toExponential(4)} ${c0} / ${r.y.toExponential(4)} ${c1}`);
}
if (missing.length) console.log(`\nno liquidity, skipped: ${missing.join(', ')}`);

const ETH_USD = book['ETH/USDG'] ? book['ETH/USDG'].y / book['ETH/USDG'].x
              : book['WETH/USDG'] ? book['WETH/USDG'].y / book['WETH/USDG'].x : 0;

console.log(`\nETH is $${ETH_USD.toFixed(2)} on chain\n`);
console.log('loop'.padEnd(36) + 'best size'.padStart(12) + 'profit'.padStart(12) + '   edge');

let any = false;
for (const [label, loop] of LOOPS) {
  if (loop.some(([p]) => !book[p])) { console.log(`${label.padEnd(36)}${'—'.padStart(12)}${'—'.padStart(12)}   pool missing`); continue; }
  const { size, profit, edge } = bestSize(loop, book);
  const usd = profit * ETH_USD, sizeUsd = size * ETH_USD;
  if (usd > 1) any = true;
  console.log(`${label.padEnd(36)}${('$' + sizeUsd.toFixed(2)).padStart(12)}` +
              `${('$' + usd.toFixed(4)).padStart(12)}   ${(edge * 100).toFixed(3)}%`);
}
console.log(any ? '\nsomething is open. check the pool has real trades before sizing up.'
                : '\nnothing open. every gap is inside the fees.');
