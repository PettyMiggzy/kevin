// Wallet tracer — answers "is this wallet still holding, and did they sell?"
//
//   node keeper/trace.mjs 0xabc...                 one wallet
//   node keeper/trace.mjs 0xabc... --cluster       follow the money between wallets
//   SPAN=3000000 node keeper/trace.mjs 0xabc...    look further back
//
// WHY IT EXISTS
//
// The question comes up constantly and the explorer answers it badly. A big
// red OUT on a block explorer looks like a dump, and most of the time it is
// not one — it is somebody moving tokens between their own addresses. Those
// two things could not be more different: a transfer to another wallet costs
// the chart nothing, a sale into a pool is real sell pressure.
//
// So this separates them, and it does it the only way that cannot be argued
// with: a SALE is a transfer whose recipient is the Uniswap v4 PoolManager.
// Everything else is a wallet-to-wallet move, however big and however scary
// it looks on the explorer.
//
// --cluster follows every counterparty outward, so a holder who splits across
// six addresses is counted once, as one person, with one holding and one
// sold figure. Wallet-hopping is the normal way to look like many holders.

import { createPublicClient, http, defineChain, formatUnits, getAddress } from 'viem';

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  token: process.env.KEVIN_TOKEN || '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A',
  // Every pool's tokens live in the v4 PoolManager, so a transfer to it is a
  // sale whichever of the three pools it went through.
  poolManager: getAddress(process.env.POOL_MANAGER || '0x8366a39CC670B4001A1121B8F6A443A643e40951'),
  // ...but MOST sells never touch the PoolManager directly. They go through a
  // router, which takes the tokens, sells them, and forwards the proceeds. To
  // a naive scan that first hop looks like an innocent wallet-to-wallet move,
  // so counting only the PoolManager reports real sellers as pure holders.
  //
  // 0x8876...C0904 is the sell router on this chain: a contract holding zero
  // KEVIN that 36 unrelated wallets have sent tokens to, every one of which
  // it forwarded straight into the pools. Sending to it IS selling.
  // ...and there is more than one of them. This repo already names two others
  // in keeper/buywatch.mjs and keeper/feewatch.mjs; trace knew about neither,
  // so a wallet that sold everything through the Universal Router came back as
  // "Nothing here was ever sold", which is the most damaging thing this tool
  // can get wrong.
  routers: (process.env.SELL_ROUTERS || [
    '0x8876789976dEcBfCbBbe364623C63652db8C0904', // sell router — 36 wallets route sells through it
    '0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99', // Universal Router
    '0xcae82a0059cb441d263170743b82a62e2499c378', // launchpad router
  ].join(','))
    .split(',').filter(Boolean).map((a) => getAddress(a.trim())),
  // The token's first block. A rolling window is worse than useless here: at
  // ~18 blocks a second, 1,800,000 blocks is about a day, while `held` is a
  // live balanceOf — so the two halves of every row described different
  // periods and old sells read as no sells.
  fromBlock: BigInt(process.env.FROM_BLOCK || 53_285_633),
  span: BigInt(process.env.SPAN || 0),
  chunk: BigInt(process.env.CHUNK || 200_000),
  paceMs: Number(process.env.PACE_MS || 300),
  maxWallets: Number(process.env.MAX_WALLETS || 12),
};

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO = '0x0000000000000000000000000000000000000000';
// Contracts that are plumbing, not people — the same set keeper/buywatch.mjs
// maintains. Crawling outward from any of these stops tracing a cluster and
// starts tracing the whole chain, which is how a shared router's throughput
// gets reported as one person's holdings.
const PLUMBING = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0x8366a39cc670b4001a1121b8f6a443a643e40951', // v4 PoolManager
  '0x58daec3116aae6d93017baaea7749052e8a04fa7', // v4 PositionManager
  '0x06afba43fd06227fa663b0daecf536f6eaa6bf99', // Universal Router
  '0xcae82a0059cb441d263170743b82a62e2499c378', // launchpad router
  '0xeb0226f992f959b7fa2ac7c3dafc712915310fea', // launchpad liquidity
  '0x506200532b0a5a7b9d1e7c50d0014680fc3b5b13', // launchpad locker
  '0x000000000022d473030f116ddee9f6b43ac78ba3', // permit2
  '0xe4acdb51b6554246da8488d1e68e8fad1b93f383', // launchpad factory
  '0x8876789976decbfcbbbe364623c63652db8c0904', // sell router
]);
const isPlumbing = (a) => PLUMBING.has(a.toLowerCase());
const pad32 = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const partyOf = (log, side) => getAddress('0x' + log.topics[side].slice(26));
const amountOf = (log) => Number(formatUnits(BigInt(log.data), 18));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => n.toLocaleString('en-GB', { maximumFractionDigits: 0 });

const chain = defineChain({
  id: cfg.chainId, name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});
const pub = createPublicClient({ chain, transport: http(cfg.rpc) });

/** The public RPC rate-limits bursts and a scan is a burst. */
async function withRetry(fn, tries = 7) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1 || !/429|Too Many|rate/i.test(e?.message ?? '')) throw e;
      await sleep(1200 * 2 ** i);
    }
  }
}

async function transfersFor(wallet, from, head) {
  const out = [], into = [];
  for (let f = from; f <= head; f += cfg.chunk) {
    const t = f + cfg.chunk - 1n > head ? head : f + cfg.chunk - 1n;
    const range = { address: cfg.token, fromBlock: '0x' + f.toString(16), toBlock: '0x' + t.toString(16) };
    out.push(...await withRetry(() => pub.request({
      method: 'eth_getLogs', params: [{ ...range, topics: [TRANSFER, pad32(wallet), null] }],
    })));
    await sleep(cfg.paceMs);
    into.push(...await withRetry(() => pub.request({
      method: 'eth_getLogs', params: [{ ...range, topics: [TRANSFER, null, pad32(wallet)] }],
    })));
    await sleep(cfg.paceMs);
  }
  return { out, into };
}

const balanceAbi = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }],
}];
const balanceOf = (w) => withRetry(async () =>
  Number(formatUnits(await pub.readContract(
    { address: cfg.token, abi: balanceAbi, functionName: 'balanceOf', args: [w] }), 18)));

/** One wallet's story: what it bought from the pools, what it SOLD back, what it holds. */
export function isVenue(addr) {
  return addr === cfg.poolManager || cfg.routers.includes(addr);
}

export async function inspect(wallet, from, head) {
  const { out, into } = await transfersFor(wallet, from, head);
  const sum = (logs, side, pick) => logs.filter((l) => pick(partyOf(l, side))).reduce((a, l) => a + amountOf(l), 0);
  const total = (logs) => logs.reduce((a, l) => a + amountOf(l), 0);
  const bought = sum(into, 1, isVenue);
  const sold = sum(out, 2, isVenue);             // pool OR router: both are sales
  return {
    wallet,
    held: await balanceOf(wallet),
    bought,
    sold,
    viaRouter: sum(out, 2, (a) => cfg.routers.includes(a)),
    movedIn: total(into) - bought,
    movedOut: total(out) - sold,
    txs: new Set([...out, ...into].map((l) => l.transactionHash)).size,
    // Never follow a venue outward. A router is used by everybody, so crawling
    // through one stops tracing a cluster and starts tracing the whole chain —
    // which is how a shared router's throughput gets misread as one person's dump.
    counterparties: [...new Set([...out, ...into].flatMap((l) => [partyOf(l, 1), partyOf(l, 2)]))]
      .filter((a) => !isVenue(a) && !isPlumbing(a) && a !== ZERO && a !== wallet),
  };
}

async function main() {
  const seed = getAddress(process.argv[2] || '');
  const cluster = process.argv.includes('--cluster');
  const head = await pub.getBlockNumber();
  // SPAN is still there for a deliberately short look, but the default is the
  // token's whole life, because "bought" and "sold" have to cover the same
  // period as "held" or the row is three numbers about three different things.
  const from = cfg.span > 0n ? head - cfg.span : cfg.fromBlock;
  const whole = from <= cfg.fromBlock;
  console.log(`token ${cfg.token}`);
  console.log(`scanning blocks ${from} -> ${head}` +
    (whole ? '  (the token\'s whole life)' : `  (a WINDOW — anything before ${from} is invisible)`) +
    `${cluster ? ', following the cluster' : ''}`);
  console.log(`venues counted as a sale: pool manager + ${cfg.routers.length} router(s)\n`);

  const seen = new Set(), queue = [seed], rows = [];
  while (queue.length && rows.length < (cluster ? cfg.maxWallets : 1)) {
    const w = queue.shift();
    if (seen.has(w)) continue;
    seen.add(w);
    const r = await inspect(w, from, head);
    rows.push(r);
    console.log(`${r.wallet}`);
    console.log(`   holds ${fmt(r.held).padStart(14)}   bought ${fmt(r.bought).padStart(14)}   SOLD ${fmt(r.sold).padStart(14)}${r.viaRouter ? ` (${fmt(r.viaRouter)} via router)` : ''}`);
    console.log(`   moved to/from other wallets: ${fmt(r.movedIn)} in / ${fmt(r.movedOut)} out   (${r.txs} txs)\n`);
    if (cluster) for (const c of r.counterparties) if (!seen.has(c) && !queue.includes(c)) queue.push(c);
  }

  const t = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  console.log(`=== ${rows.length} wallet${rows.length === 1 ? '' : 's'} ===`);
  console.log(`bought from pools : ${fmt(t('bought'))}`);
  console.log(`SOLD to pools     : ${fmt(t('sold'))}`);
  console.log(`still holding     : ${fmt(t('held'))}  = ${(t('held') / 1e9 * 100).toFixed(2)}% of supply`);
  if (t('sold') === 0 && !whole) {
    console.log(`\nNo sale in blocks ${from}-${head}. That is a window, not a history —`);
    console.log(`re-run without SPAN to cover the token's whole life before saying more.`);
  } else if (t('sold') === 0) {
    console.log(`\nNothing here was ever sold into the pool manager or through any of the`);
    console.log(`${cfg.routers.length} routers this tool knows about. A venue it has never seen would not`);
    console.log(`be counted, so this is "no sale through a known venue", not a character reference.`);
    if (t('movedOut') > 0) {
      console.log(`But ${fmt(t('movedOut'))} did leave for other wallets. Whether THOSE sold is`);
      console.log(`a separate question: re-run with --cluster, or trace them directly.`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
