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
  routers: (process.env.SELL_ROUTERS || '0x8876789976dEcBfCbBbe364623C63652db8C0904')
    .split(',').filter(Boolean).map((a) => getAddress(a.trim())),
  span: BigInt(process.env.SPAN || 1_800_000),
  chunk: BigInt(process.env.CHUNK || 200_000),
  paceMs: Number(process.env.PACE_MS || 300),
  maxWallets: Number(process.env.MAX_WALLETS || 12),
};

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO = '0x0000000000000000000000000000000000000000';
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
      .filter((a) => !isVenue(a) && a !== ZERO && a !== wallet),
  };
}

async function main() {
  const seed = getAddress(process.argv[2] || '');
  const cluster = process.argv.includes('--cluster');
  const head = await pub.getBlockNumber();
  const from = head - cfg.span;
  console.log(`token ${cfg.token}\nscanning blocks ${from} -> ${head}${cluster ? ' (following the cluster)' : ''}\n`);

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
  if (t('sold') === 0) {
    console.log(`\nNothing here was ever sold — into a pool or through a router.`);
    if (t('movedOut') > 0) {
      console.log(`But ${fmt(t('movedOut'))} did leave for other wallets. Whether THOSE sold is`);
      console.log(`a separate question: re-run with --cluster, or trace them directly.`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
