// The floor keeper.
//
//   node keeper/floor.mjs            watch and report, send nothing
//   LIVE=1 node keeper/floor.mjs     actually send transactions
//
// It drives KevinFloorV4, which is the contract that holds the tokens. This
// file holds no money and decides nothing that matters: every limit that
// protects the treasury is enforced on-chain, so the worst a compromised
// keeper can do is waste one day's allowance on badly timed but legal trades.
// That is the whole reason the rails live in the contract and not here.
//
// WHAT IT DOES EVERY TICK
//
//   1. read the contract and the pool
//   2. if there is room above the floor, poke it — the pool decides the size,
//      not this script, because the swap carries the floor as its price limit
//   3. if the price has risen, ratchet the floor up under it
//   4. otherwise say why not, and wait
//
// It never sizes a trade cleverly. It offers the maximum and lets the pool fill
// what fits above the floor. Sizing is the part a keeper gets wrong at 3am and
// the part v4 does correctly for free.
//
// DRY RUN IS THE DEFAULT. It has to be told to send.

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, http, defineChain, formatEther, formatUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// --- config -----------------------------------------------------------------

/** Keys live on the box, chmod 600, gitignored. This repo is public. */
function loadKey(name) {
  const p = join(ROOT, 'keeper', name);
  if (!existsSync(p)) return null;
  const v = readFileSync(p, 'utf8').trim();
  return v || null;
}

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  floor: process.env.FLOOR_ADDRESS,
  live: process.env.LIVE === '1',
  // How often to look. The contract has its own cooldown; this only decides how
  // often we ask, and asking is a free eth_call.
  everyMs: Number(process.env.TICK_MS || 45_000),
  // Stop sending if the operator wallet gets this low — a keeper that cannot
  // pay for gas should say so once, not fail a transaction every tick.
  minGasWei: BigInt(process.env.MIN_GAS_WEI || 2_000_000_000_000_000n), // 0.002 ETH
};

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

// Only what this keeper calls. A short ABI is a short list of things it can do.
const ABI = [
  { type: 'function', name: 'reading', stateMutability: 'view', inputs: [], outputs: [
    { name: 'sell', type: 'bool' }, { name: 'buy', type: 'bool' },
    { name: 'spot', type: 'uint160' }, { name: 'floorAt', type: 'uint160' }] },
  { type: 'function', name: 'poke', stateMutability: 'nonpayable',
    inputs: [{ name: 'size', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'ratchet', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'floorSqrtPriceX96', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }] },
  { type: 'function', name: 'spotSqrtPriceX96', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }] },
  { type: 'function', name: 'warChest', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastTradeAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'cooldown', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'upIsUp', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'floorGapBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ratchetBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokensSoldInWindow', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'dailyTokenCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'quoteSpentInWindow', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'dailyQuoteCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

// --- logging ----------------------------------------------------------------
// One line per tick, always, whether or not anything happened. A keeper that
// only logs when it acts is indistinguishable from a keeper that has died.

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (...a) => console.log(stamp(), ...a);
const warn = (...a) => console.error(stamp(), '!!', ...a);

/**
 * A sqrt price is not a number anybody can read. Turn it into the ratio it
 * stands for, which at least moves in a direction you can follow.
 */
function readable(sqrtPriceX96) {
  const q = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  return q < 0.001 || q > 1000 ? q.toExponential(4) : q.toFixed(6);
}

/** How far apart two sqrt prices are, in percent of the first. */
function gapPct(a, b) {
  if (a === 0n) return 0;
  return (Number(b - a) / Number(a)) * 100;
}

// --- the loop ---------------------------------------------------------------

async function main() {
  if (!cfg.floor) {
    warn('FLOOR_ADDRESS is not set. Nothing to drive.');
    process.exit(1);
  }

  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const key = loadKey('.operator.key');
  let wallet = null;
  let account = null;

  if (cfg.live) {
    if (!key) {
      warn('LIVE=1 but keeper/.operator.key is missing. Refusing to start.');
      process.exit(1);
    }
    account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
    wallet = createWalletClient({ account, chain, transport: http(cfg.rpc) });
  }

  say('floor keeper starting');
  say('  contract ', cfg.floor);
  say('  chain    ', cfg.chainId, cfg.rpc);
  say('  operator ', account ? account.address : '(none — dry run)');
  say('  mode     ', cfg.live ? 'LIVE, it will send transactions' : 'DRY RUN, it will send nothing');
  say('  tick     ', `${cfg.everyMs / 1000}s`);

  const read = (name, args = []) =>
    pub.readContract({ address: cfg.floor, abi: ABI, functionName: name, args });

  // Sanity, once, loudly. Getting the orientation wrong is the one mistake that
  // turns this from a floor into a dumper, so it is stated at startup rather
  // than left in a storage slot nobody reads.
  try {
    const up = await read('upIsUp');
    say('  upIsUp   ', up, up ? '(a rising $KEVIN is a RISING sqrtPrice)' : '(a rising $KEVIN is a FALLING sqrtPrice)');
  } catch (e) {
    warn('could not read the contract at all:', e.shortMessage || e.message);
    warn('check FLOOR_ADDRESS and the RPC before going live.');
    process.exit(1);
  }

  let quiet = 0;      // consecutive ticks with nothing to do
  let lastSaid = '';  // so a long quiet spell does not fill the journal

  for (;;) {
    try {
      await tick();
    } catch (e) {
      warn('tick failed:', e.shortMessage || e.message);
    }
    await new Promise((r) => setTimeout(r, cfg.everyMs));
  }

  async function tick() {
    const [reading, paused, last, cool, sold, capT, spent, capQ, chest] = await Promise.all([
      read('reading'), read('paused'), read('lastTradeAt'), read('cooldown'),
      read('tokensSoldInWindow'), read('dailyTokenCap'),
      read('quoteSpentInWindow'), read('dailyQuoteCap'), read('warChest'),
    ]);
    const [sell, buy, spot, floorAt] = reading;

    if (paused) return note('paused by the owner');
    if (floorAt === 0n) return note('no floor set yet — setFloorFromSpot() first, it does nothing until then');

    const now = BigInt(Math.floor(Date.now() / 1000));
    const readyAt = last === 0n ? 0n : last + cool;
    if (now < readyAt) return note(`cooling down, ${readyAt - now}s left`);

    const state =
      `spot ${readable(spot)} floor ${readable(floorAt)} (${gapPct(floorAt, spot).toFixed(2)}%)` +
      ` sold ${formatUnits(sold, 18)}/${formatUnits(capT, 18)}` +
      ` chest ${formatEther(chest)}`;

    // RATCHET BEFORE SELLING, and the order is the whole point.
    //
    // A sell stops exactly at the floor — that is the guarantee the contract is
    // built on — so after every sale spot and floor are the same number. Sell
    // first and the floor can never rise: the price is dragged back down to it
    // every time, and "a floor that rises with the market cap" quietly becomes
    // "a floor pinned to launch day". Driving it against a live pool is what
    // showed this; the first version sold into a 30 ETH pump and left the floor
    // exactly where it started.
    //
    // Ratcheting first means the rise is banked before any of it is sold into.
    if (await worthRatcheting(spot, floorAt)) {
      return act('ratchet', [], `RATCHET the floor up under a higher price · ${state}`);
    }
    if (sell) return act('poke', [(1n << 255n)], `SELL into the room above the floor · ${state}`);
    if (buy) return act('poke', [(1n << 255n)], `BID under the floor · ${state}`);
    return note(`nothing to do · ${state}`);
  }

  /**
   * Would `ratchet()` actually move the floor? The contract decides how far —
   * capped at ratchetBps a call — this only avoids paying gas for a no-op.
   *
   * It mirrors the contract's own arithmetic: the floor wants to sit floorGapBps
   * on the wrong side of spot, and it only ever moves toward a better $KEVIN
   * price.
   */
  async function worthRatcheting(spot, floorAt) {
    const [up, gapBps] = await Promise.all([read('upIsUp'), read('floorGapBps')]);
    const B = 10_000n;
    // Where the floor would like to be, given where the price is now.
    const target = up ? (spot * (B - gapBps)) / B : (spot * (B + gapBps)) / B;
    const better = up ? target > floorAt : target < floorAt;
    if (!better) return false;
    // Ignore a step under a tenth of a percent: it is dust and it costs gas.
    return Math.abs(gapPct(floorAt, target)) > 0.1;
  }

  function note(why) {
    quiet += 1;
    // Say it the first time, then every twentieth tick, so a quiet hour is one
    // or two lines rather than eighty.
    if (why !== lastSaid || quiet % 20 === 0) say(why);
    lastSaid = why;
  }

  async function act(fn, args, why) {
    quiet = 0;
    lastSaid = '';
    if (!cfg.live) return say('WOULD', fn.toUpperCase(), '·', why);

    const bal = await pub.getBalance({ address: account.address });
    if (bal < cfg.minGasWei) {
      return warn(`operator has ${formatEther(bal)} ETH, under the ${formatEther(cfg.minGasWei)} floor — not sending. Top it up.`);
    }

    say(fn.toUpperCase(), '·', why);
    try {
      // Simulate first. Everything this contract refuses — cooldown, caps, no
      // room above the floor — reverts cleanly, and a simulated revert costs
      // nothing while a sent one costs gas and fills the journal with noise.
      const { request } = await pub.simulateContract({
        address: cfg.floor, abi: ABI, functionName: fn, args, account,
      });
      const hash = await wallet.writeContract(request);
      say('  sent', hash);
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      say('  ', rc.status, 'in block', rc.blockNumber, `· gas ${rc.gasUsed}`);
    } catch (e) {
      const m = e.shortMessage || e.message || String(e);
      // These are the contract saying no, which is the system working.
      if (/NothingToDo|TooSoon|OverDailyCap/.test(m)) return say('  declined by the contract:', m.split('\n')[0]);
      warn('  send failed:', m.split('\n')[0]);
    }
  }
}

main().catch((e) => {
  warn('fatal:', e.stack || e.message);
  process.exit(1);
});
