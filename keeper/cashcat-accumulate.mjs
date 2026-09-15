// The Cash Cat accumulator.
//
//   node keeper/cashcat-accumulate.mjs            watch and report, send nothing
//   LIVE=1 node keeper/cashcat-accumulate.mjs      actually send transactions
//
// UNLIKE keeper/floor.mjs, this does not drive a contract WE control — CASHCAT
// is someone else's token, on a plain Uniswap v3 pool, and the only thing this
// script is allowed to do is BUY it with WETH and hold. There is no sell path
// anywhere in this file, on purpose: this is not a market maker defending a
// floor, it is a one-way accumulator. See keeper/README.md.
//
// That also means none of KevinFloorV4's on-chain rails apply here — there is
// no contract of ours in the loop to cap a bad trade, only this script and a
// dedicated wallet holding its own small budget (never the treasury). Every
// limit that matters — the per-trade cap, the daily cap, the cooldown, the
// slippage bound — is enforced HERE, in JavaScript, not on chain. Keep the
// wallet's balance to what you are willing to lose to a bug or a leaked key.
//
// WHAT IT DOES EVERY TICK
//
//   1. read the pool's spot price (CASHCAT is 18 decimals, so is WETH — no
//      decimal adjustment needed, the raw sqrtPriceX96 ratio IS the price)
//   2. track the recent high over REF_WINDOW_MS
//   3. if spot has fallen DIP_BPS below that recent high, and the daily
//      budget and per-trade cap allow it, and the cooldown has passed — buy
//   4. otherwise say why not, and wait
//
// DRY RUN IS THE DEFAULT. It has to be told to send.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, http, defineChain, formatEther, parseAbi,
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
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  pool: process.env.POOL_ADDRESS || '0xA70fc67C9F69da90B63a0e4C05D229954574E313',
  token: process.env.TOKEN_ADDRESS || '0x020bfC650A365f8BB26819deAAbF3E21291018b4',
  weth: process.env.WETH_ADDRESS || '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  // SwapRouter02 — verified against this exact pool: pool.factory() matches
  // Uniswap's own published UniswapV3Factory for Robinhood Chain (see
  // keeper/README.md). Robinhood Chain reportedly hosts more than one v3-shaped
  // DEX fork, which would have its own, INCOMPATIBLE router/factory pair — do
  // not point this at a router without re-doing that same factory() check
  // against whatever pool it is meant to trade on.
  router: process.env.ROUTER_ADDRESS || '0xCAf681a66D020601342297493863E78C959e5CB2',
  expectedFactory: process.env.EXPECTED_FACTORY || '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  live: process.env.LIVE === '1',
  everyMs: Number(process.env.TICK_MS || 45_000),

  // BUY THE DIP, NOT THE TOP. Spot readings are kept for refWindowMs; a buy
  // only fires once the current price has fallen dipBps below the highest
  // spot seen in that window. A keeper with no history yet (just started)
  // buys nothing — the safe direction to fail, same reasoning as floor.mjs's
  // momentum guard.
  dipBps: Number(process.env.DIP_BPS || 500), // 5%
  refWindowMs: Number(process.env.REF_WINDOW_MS || 6 * 60 * 60 * 1000), // 6h

  maxWethPerTrade: BigInt(process.env.MAX_WETH_PER_TRADE_WEI || 1_000_000_000_000_000n), // 0.001 WETH
  dailyWethCap: BigInt(process.env.DAILY_WETH_CAP_WEI || 5_000_000_000_000_000n), // 0.005 WETH
  cooldownS: Number(process.env.COOLDOWN_S || 3600), // 1h between buys

  // Slack on top of the price this tick read, same idea as floor.mjs's
  // slipBufferBps: the quote is from an earlier block than the fill.
  slipBufferBps: Math.max(1, Number(process.env.SLIP_BUFFER_BPS || 200)), // 2%

  minGasWei: BigInt(process.env.MIN_GAS_WEI || 500_000_000_000_000n), // 0.0005 ETH

  state: process.env.STATE_FILE || join(ROOT, 'keeper', '.cashcat.state'),
};

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

const say = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
const warn = (...a) => console.warn(new Date().toISOString().slice(0, 19).replace('T', ' '), '!!', ...a);

const POOL_ABI = parseAbi([
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
]);
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
]);

/** sqrtPriceX96 -> price of token1 per token0, as a float. Both tokens here
 * are 18 decimals, so the raw ratio IS the price with no scaling needed —
 * a pool pairing tokens with different decimals would need adjusting by
 * 10**(dec0-dec1), which this script deliberately does not handle since it
 * is built for this one pool. */
function priceFromSqrt(sqrtPriceX96) {
  const Q96 = 2 ** 96;
  const s = Number(sqrtPriceX96) / Q96;
  return s * s;
}

function loadState() {
  if (!existsSync(cfg.state)) return { day: null, spentWei: '0', lastBuyAt: 0 };
  try {
    return JSON.parse(readFileSync(cfg.state, 'utf8'));
  } catch {
    return { day: null, spentWei: '0', lastBuyAt: 0 };
  }
}
function saveState(s) {
  writeFileSync(cfg.state, JSON.stringify(s));
}

async function main() {
  const pub = createPublicClient({
    chain, batch: { multicall: true }, transport: http(cfg.rpc, { batch: true }),
  });
  const key = loadKey('.cashcat.key');
  let wallet = null;
  let account = null;

  if (cfg.live) {
    if (!key) {
      warn('LIVE=1 but keeper/.cashcat.key is missing. Refusing to start.');
      process.exit(1);
    }
    account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
    wallet = createWalletClient({ account, chain, transport: http(cfg.rpc) });
  }

  say('cash cat accumulator starting');
  say('  pool     ', cfg.pool);
  say('  token    ', cfg.token);
  say('  wallet   ', account ? account.address : '(none — dry run)');
  say('  mode     ', cfg.live ? 'LIVE, it will send transactions' : 'DRY RUN, it will send nothing');
  say('  tick     ', `${cfg.everyMs / 1000}s`);
  say('  trigger  ', `buy when spot is ${cfg.dipBps / 100}% below the ${cfg.refWindowMs / 3600000}h high`);
  say('  caps     ', `${formatEther(cfg.maxWethPerTrade)} WETH/trade, ${formatEther(cfg.dailyWethCap)} WETH/day, ${cfg.cooldownS}s cooldown`);

  // SANITY, ONCE, LOUDLY — same reasoning as floor.mjs's own startup checks.
  // A wrong router here does not just fail politely: this chain reportedly
  // hosts more than one v3-shaped fork, so a mismatched router could still
  // ACCEPT the call and swap against a completely different, unintended pool.
  // Refuse to start rather than find that out from a fill.
  const [factory, t0, t1, fee] = await Promise.all([
    pub.readContract({ address: cfg.pool, abi: POOL_ABI, functionName: 'factory' }),
    pub.readContract({ address: cfg.pool, abi: POOL_ABI, functionName: 'token0' }),
    pub.readContract({ address: cfg.pool, abi: POOL_ABI, functionName: 'token1' }),
    pub.readContract({ address: cfg.pool, abi: POOL_ABI, functionName: 'fee' }),
  ]);
  if (factory.toLowerCase() !== cfg.expectedFactory.toLowerCase()) {
    warn(`pool.factory() is ${factory}, not the expected ${cfg.expectedFactory}.`);
    warn('This is not the Uniswap v3 pool this script was built for. Refusing to start.');
    process.exit(1);
  }
  const addrs = [t0.toLowerCase(), t1.toLowerCase()];
  if (!addrs.includes(cfg.token.toLowerCase()) || !addrs.includes(cfg.weth.toLowerCase())) {
    warn(`pool tokens are ${t0} / ${t1}, which do not match TOKEN_ADDRESS/WETH_ADDRESS.`);
    process.exit(1);
  }
  // token1/token0 from sqrtPriceX96 — which one is CASHCAT decides which way
  // "price rising" means "CASHCAT getting more expensive." Read once, used by
  // every tick's priceFromSqrt() call.
  const cashcatIsToken0 = t0.toLowerCase() === cfg.token.toLowerCase();
  say('  fee tier ', `${fee / 10000}%`);
  say('  orientation', cashcatIsToken0 ? 'token0=CASHCAT token1=WETH' : 'token0=WETH token1=CASHCAT');

  const state = loadState();

  // Spot readings, oldest first, for the dip test. In memory only, same as
  // floor.mjs's momentum log — a restart forgets, and a keeper with no
  // history does not buy until it has watched for refWindowMs. Safe to fail
  // that direction: the worst case is a missed dip, not a bad buy.
  const spotLog = [];

  async function tick() {
    try {
      const [slot0, gasBal] = await Promise.all([
        pub.readContract({ address: cfg.pool, abi: POOL_ABI, functionName: 'slot0' }),
        account ? pub.getBalance({ address: account.address }) : Promise.resolve(null),
      ]);
      const sqrtPriceX96 = slot0[0];
      const rawPrice = priceFromSqrt(sqrtPriceX96); // token1 per token0
      // Normalize to "WETH per CASHCAT" regardless of which slot each landed in.
      const wethPerCashcat = cashcatIsToken0 ? rawPrice : 1 / rawPrice;

      const now = Date.now();
      spotLog.push({ t: now, p: wethPerCashcat });
      while (spotLog.length && spotLog[0].t < now - cfg.refWindowMs) spotLog.shift();
      const recentHigh = spotLog.reduce((m, s) => Math.max(m, s.p), wethPerCashcat);
      const dipFromHigh = recentHigh > 0 ? (recentHigh - wethPerCashcat) / recentHigh : 0;

      const day = new Date().toISOString().slice(0, 10);
      if (state.day !== day) { state.day = day; state.spentWei = '0'; saveState(state); }
      const spentToday = BigInt(state.spentWei);
      const roomToday = cfg.dailyWethCap > spentToday ? cfg.dailyWethCap - spentToday : 0n;
      const sinceLastBuy = now - state.lastBuyAt;

      say(`spot=${wethPerCashcat.toExponential(4)} WETH/CASHCAT  recentHigh=${recentHigh.toExponential(4)}`
        + `  dip=${(dipFromHigh * 100).toFixed(2)}%  spentToday=${formatEther(spentToday)}/${formatEther(cfg.dailyWethCap)} WETH`);

      if (dipFromHigh < cfg.dipBps / 10_000) return say('  no buy: not enough of a dip yet');
      if (roomToday === 0n) return say('  no buy: daily WETH cap already spent');
      if (sinceLastBuy < cfg.cooldownS * 1000) return say(`  no buy: cooldown, ${Math.ceil((cfg.cooldownS * 1000 - sinceLastBuy) / 1000)}s left`);
      if (!cfg.live) return say('  would buy here — DRY RUN, sending nothing');
      if (gasBal < cfg.minGasWei) return warn(`  no buy: wallet gas ${formatEther(gasBal)} ETH below floor ${formatEther(cfg.minGasWei)}`);

      let amountIn = cfg.maxWethPerTrade < roomToday ? cfg.maxWethPerTrade : roomToday;
      const wethBal = await pub.readContract({ address: cfg.weth, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
      if (amountIn > wethBal) amountIn = wethBal;
      if (amountIn === 0n) return warn('  no buy: wallet holds no WETH');

      // Same shape as floor.mjs's slippage bound: a minimum computed from the
      // price THIS tick just read, with slack for drift between the read and
      // the landing — not a live quote, which would be one more call every
      // tick for a number this bound already covers.
      const cashcatOutFloat = Number(amountIn) / 1e18 / wethPerCashcat;
      const minOutFloat = cashcatOutFloat * (1 - cfg.slipBufferBps / 10_000);
      const amountOutMinimum = BigInt(Math.floor(minOutFloat * 1e18));

      const allowance = await pub.readContract({
        address: cfg.weth, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, cfg.router],
      });
      if (allowance < amountIn) {
        say(`  approving router for ${formatEther(amountIn)} WETH`);
        const approveHash = await wallet.writeContract({
          address: cfg.weth, abi: ERC20_ABI, functionName: 'approve', args: [cfg.router, amountIn],
        });
        await pub.waitForTransactionReceipt({ hash: approveHash });
      }

      say(`  BUYING: ${formatEther(amountIn)} WETH -> CASHCAT, min out ${(minOutFloat).toFixed(2)} CASHCAT`);
      const hash = await wallet.writeContract({
        address: cfg.router,
        abi: ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: cfg.weth,
          tokenOut: cfg.token,
          fee,
          recipient: account.address,
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        }],
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') { warn(`  swap reverted: ${hash}`); return; }
      state.spentWei = String(spentToday + amountIn);
      state.lastBuyAt = now;
      saveState(state);
      const newBal = await pub.readContract({ address: cfg.token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
      say(`  bought. tx=${hash}  CASHCAT held now: ${formatEther(newBal)}`);
    } catch (e) {
      warn('tick failed:', e.shortMessage || e.message);
    }
  }

  // Sequential, not setInterval: a live buy waits on two receipts (approve,
  // then swap), which can easily outlast one tick's own interval under
  // congestion. setInterval would fire the next tick anyway, overlapping a
  // still-pending buy — a second approve racing the first, or two ticks both
  // reading spentToday before either writes it back and one buy's spend
  // never getting counted against the daily cap. Same shape as floor.mjs's
  // own `for (;;) { await tick(); await sleep(...) }` loop, for the same
  // reason.
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, cfg.everyMs));
  }
}

main();
