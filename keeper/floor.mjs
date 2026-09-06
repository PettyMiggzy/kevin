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
//   2. if the price has risen, ratchet the floor up under it
//   3. if the price is back at a floor that had started to yield, ratchet
//      anyway — that call is what tells the contract the wait is over
//   4. if there is room above the floor, poke it — the pool decides the size,
//      not this script, because the swap carries the floor as its price limit
//   5. otherwise say why not, and wait
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
  // Optional. The lockbox holding the treasury bag, if there is one. The keeper
  // pushes its daily allowance into the floor keeper so the floor always has
  // inventory to work with. release() is permissionless and can only ever send
  // to the floor, so driving it needs no privilege and risks nothing.
  lock: process.env.LOCK_ADDRESS,
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
  { type: 'function', name: 'effectiveFloorSqrtPriceX96', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }] },
  { type: 'function', name: 'floorDecayBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'floorHeldSince', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxDecayBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'patience', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decayBpsPerDay', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'floorGapBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ratchetBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastRatchetAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ratchetCooldown', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lockbox', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokensSoldInWindow', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'dailyTokenCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'quoteSpentInWindow', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'dailyQuoteCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const LOCK_ABI = [
  { type: 'function', name: 'releasable', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'release', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ratePerDay', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'locked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'exitCountdown', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'floor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
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

/** Seconds, said the way a person would say them. */
function forHumans(secs) {
  const n = Number(secs);
  if (n < 90) return `${n}s`;
  if (n < 5400) return `${(n / 60).toFixed(0)}m`;
  if (n < 172800) return `${(n / 3600).toFixed(1)}h`;
  return `${(n / 86400).toFixed(1)}d`;
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
  say('  lockbox  ', cfg.lock || '(none)');
  say('  chain    ', cfg.chainId, cfg.rpc);
  say('  operator ', account ? account.address : '(none — dry run)');
  say('  mode     ', cfg.live ? 'LIVE, it will send transactions' : 'DRY RUN, it will send nothing');
  say('  tick     ', `${cfg.everyMs / 1000}s`);

  const read = (name, args = []) =>
    pub.readContract({ address: cfg.floor, abi: ABI, functionName: name, args });

  // $KEVIN, read off the lockbox at startup. Declared here because the startup
  // block below assigns it, and a `let` further down would be in its temporal
  // dead zone by then — a ReferenceError on the first tick, not at parse time.
  let token = null;

  // Sanity, once, loudly. Getting the orientation wrong is the one mistake that
  // turns this from a floor into a dumper, so it is stated at startup rather
  // than left in a storage slot nobody reads.
  try {
    const up = await read('upIsUp');
    say('  upIsUp   ', up, up ? '(a rising $KEVIN is a RISING sqrtPrice)' : '(a rising $KEVIN is a FALLING sqrtPrice)');
    if (cfg.lock) {
      // If this points at the wrong floor, the keeper would be pushing the
      // treasury's bag into a contract that is not the one it is driving.
      const target = await pub.readContract({
        address: cfg.lock, abi: LOCK_ABI, functionName: 'floor',
      });
      if (target.toLowerCase() !== cfg.floor.toLowerCase()) {
        warn(`the lockbox at ${cfg.lock} releases to ${target}, not to ${cfg.floor}.`);
        warn('one of the two addresses is wrong. Refusing to start.');
        process.exit(1);
      }
      // If the floor keeper has named a lockbox, it had better be this one:
      // sweep() will only return $KEVIN there, so a mismatch means the keeper
      // is feeding a contract whose tokens can never come back.
      const named = await read('lockbox');
      if (named !== '0x0000000000000000000000000000000000000000'
          && named.toLowerCase() !== cfg.lock.toLowerCase()) {
        warn(`the floor keeper's lockbox is ${named}, but LOCK_ADDRESS is ${cfg.lock}.`);
        warn('one of the two is wrong. Refusing to start.');
        process.exit(1);
      }
      const [rate, held] = await Promise.all([
        pub.readContract({ address: cfg.lock, abi: LOCK_ABI, functionName: 'ratePerDay' }),
        pub.readContract({ address: cfg.lock, abi: LOCK_ABI, functionName: 'locked' }),
      ]);
      token = await pub.readContract({ address: cfg.lock, abi: LOCK_ABI, functionName: 'token' });
      say('  locked   ', `${formatUnits(held, 18)} $KEVIN, dripping ${formatUnits(rate, 18)}/day`);
    }
    const [pat, perDay, maxD] = await Promise.all([
      read('patience'), read('decayBpsPerDay'), read('maxDecayBps'),
    ]);
    say('  patience ', perDay === 0n
      ? 'never yields — if the price does not come back it will not sell again'
      : `holds ${forHumans(pat)} under water, then gives up ${Number(perDay) / 100}%/day,`
        + ` down to -${Number(maxD) / 100}% and no further`);
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
    const [reading, paused, last, cool, sold, capT, spent, capQ, chest, mark, decay, gapBps, up, blk] =
      await Promise.all([
        read('reading'), read('paused'), read('lastTradeAt'), read('cooldown'),
        read('tokensSoldInWindow'), read('dailyTokenCap'),
        read('quoteSpentInWindow'), read('dailyQuoteCap'), read('warChest'),
        read('floorSqrtPriceX96'), read('floorDecayBps'),
        read('floorGapBps'), read('upIsUp'), pub.getBlock(),
      ]);
    const [ratchetedAt, ratchetCool] = await Promise.all([
      read('lastRatchetAt'), read('ratchetCooldown'),
    ]);
    const [lockReady, lockRate, floorHas] = cfg.lock
      ? await Promise.all([
        pub.readContract({ address: cfg.lock, abi: LOCK_ABI, functionName: 'releasable' }),
        pub.readContract({ address: cfg.lock, abi: LOCK_ABI, functionName: 'ratePerDay' }),
        pub.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [cfg.floor] }),
      ])
      : [0n, 0n, 0n];
    // `floorAt` is the EFFECTIVE floor — the high-water mark eased by whatever
    // the waiting has cost it. `mark` is the mark itself. They are the same
    // number in a healthy market and the difference is the whole of the
    // yielding, so both are read and both are printed.
    const [sell, buy, spot, floorAt] = reading;

    if (paused) return note('paused by the owner');
    if (floorAt === 0n) return note('no floor set yet — setFloorFromSpot() first, it does nothing until then');

    const state =
      `spot ${readable(spot)} floor ${readable(floorAt)} (${gapPct(floorAt, spot).toFixed(2)}%)` +
      (decay > 0n ? ` YIELDING ${(Number(decay) / 100).toFixed(2)}% under the mark ${readable(mark)}` : '') +
      ` sold ${formatUnits(sold, 18)}/${formatUnits(capT, 18)}` +
      ` sold-for ${formatEther(spent)}/${formatEther(capQ)}` +
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
    //
    // NOTE the comparison is against the MARK, not against `floorAt`. The
    // effective floor is already lower when the contract has been waiting, and
    // ratchet() measures its step from the mark — so checking the effective
    // one would have the keeper paying gas for a call that does nothing.
    // ratchet() RETURNS rather than reverts while it is cooling down, so a
    // simulation succeeds and the keeper would happily pay for a no-op every
    // tick forever. The cooldown has to be checked here as well as there.
    const canRatchet = blk.timestamp >= ratchetedAt + ratchetCool;

    if (canRatchet && worthRatcheting(spot, mark, up, gapBps)) {
      return act('ratchet', [], `RATCHET the floor up under a higher price · ${state}`);
    }

    // The price is back at a floor that had started to yield. ratchet() is
    // what tells the contract so, and it must happen BEFORE any sale: sell
    // first and the sale goes out against a floor that is lower than the one
    // the market has just proved it will pay.
    if (canRatchet && decay > 0n && !worse(spot, mark, up)) {
      return act('ratchet', [], `RESET the yielding — the market came back · ${state}`);
    }

    // Top the floor keeper up out of the lockbox. After the two ratchet
    // branches, which are the time-critical ones, and before selling, so the
    // floor always has inventory when a fill is there to be taken.
    //
    // NOT every tick. The lockbox accrues continuously, so `releasable()` is
    // essentially always above zero and a keeper that released whenever it
    // could would send a transaction every tick for a few seconds' worth of
    // dust — about nineteen hundred of them a day, all gas, no purpose. Found
    // by driving it: three seconds after a clean two-million release it went
    // back for sixty-nine tokens.
    //
    // So: only when a quarter of a day has piled up, OR when the floor keeper
    // is nearly out of inventory and a sale would otherwise stall for want of
    // tokens. Four or five transactions a day instead of two thousand.
    if (lockRate > 0n) {
      const enough = lockReady >= lockRate / 4n;
      const starving = floorHas < lockRate / 24n && lockReady > 0n;
      if (enough || starving) {
        return act(
          'release', [],
          `RELEASE ${formatUnits(lockReady, 18)} $KEVIN from the lockbox`
            + (starving && !enough ? ' (the floor keeper is out of inventory)' : ''),
          cfg.lock, LOCK_ABI,
        );
      }
    }

    // The cooldown is checked HERE and not before the two branches above,
    // because ratchet() has no cooldown on chain — it is permissionless and it
    // only ever moves the floor in the direction that costs an attacker money.
    // Checking it first meant that a pump arriving during the five minutes
    // after a sale was neither ratcheted under nor reset, and the sale at the
    // end of the cooldown then went out against a stale floor. Which is the
    // one ordering mistake this whole file exists to avoid.
    //
    // THE CHAIN'S CLOCK, NOT THIS BOX'S. Every deadline in the contract is in
    // block time, and the two are not the same number — a keeper with a
    // drifting system clock would either sit out its own cooldown for hours or
    // hammer the contract with calls it is going to refuse. Found by driving
    // this against an anvil warped eight days forward: it reported "cooling
    // down, 691149s left" on a sixty-second cooldown.
    const now = blk.timestamp;
    const readyAt = last === 0n ? 0n : last + cool;
    // Short on purpose: this one prints every tick until it clears.
    if (now < readyAt) return note(`cooling down, ${forHumans(readyAt - now)} left`);

    if (sell) return act('poke', [(1n << 255n)], `SELL into the room above the floor · ${state}`);
    if (buy) return act('poke', [(1n << 255n)], `BID under the floor · ${state}`);
    return note(`nothing to do · ${state}`);
  }

  /**
   * Would `ratchet()` actually move the mark? The contract decides how far —
   * capped at ratchetBps a call — this only avoids paying gas for a no-op.
   *
   * It mirrors the contract's own arithmetic: the mark wants to sit floorGapBps
   * under spot IN PRICE TERMS, which in sqrt-price space is a move of the
   * square root of that ratio. Applying the bps straight to the sqrt price —
   * which is what this did first, and the contract with it — makes every
   * number mean about twice what it says.
   */
  function worthRatcheting(spot, mark, up, gapBps) {
    const target = worseBy(spot, gapBps, up);
    const better = up ? target > mark : target < mark;
    if (!better) return false;
    // Ignore a step under a tenth of a percent: it is dust and it costs gas.
    return Math.abs(gapPct(mark, target)) > 0.1;
  }

  /** Is `a` a worse $KEVIN price than `b`? */
  function worse(a, b, up) {
    return up ? a < b : a > b;
  }

  /** `x`, moved so that $KEVIN is worth `bps` less. Price bps, not sqrt bps. */
  function worseBy(x, bps, up) {
    const B = 10_000n;
    const [num, den] = up ? [B - bps, B] : [B, B - bps];
    // sqrt(num/den) in floating point is plenty here: this only decides whether
    // to pay for a call, and the contract redoes the arithmetic exactly.
    return BigInt(Math.floor(Number(x) * Math.sqrt(Number(num) / Number(den))));
  }

  function note(why) {
    quiet += 1;
    // Say it the first time, then every twentieth tick, so a quiet hour is one
    // or two lines rather than eighty.
    if (why !== lastSaid || quiet % 20 === 0) say(why);
    lastSaid = why;
  }

  async function act(fn, args, why, to = cfg.floor, abi = ABI) {
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
        address: to, abi, functionName: fn, args, account,
      });
      const hash = await wallet.writeContract(request);
      say('  sent', hash);
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      say('  ', rc.status, 'in block', rc.blockNumber, `· gas ${rc.gasUsed}`);
    } catch (e) {
      const m = e.shortMessage || e.message || String(e);
      // These are the contract saying no, which is the system working.
      if (/NothingToDo|TooSoon|OverDailyCap|NothingToRelease/.test(m)) return say('  declined by the contract:', m.split('\n')[0]);
      warn('  send failed:', m.split('\n')[0]);
    }
  }
}

main().catch((e) => {
  warn('fatal:', e.stack || e.message);
  process.exit(1);
});
