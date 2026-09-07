// LP fee watcher — the receipts behind the "fees collected" panel on the site.
//
//   node keeper/feewatch.mjs                 scan and print, write nothing
//   WRITE=1 node keeper/feewatch.mjs         update data/fees.json
//   FROM_BLOCK=57090885 WRITE=1 node ...     rescan from a chosen block
//
// WHY THIS EXISTS
//
// The pad pays LP fees to the treasury wallet. "Trust me, I collected X" is
// worth nothing; a list of transaction hashes anybody can open in the explorer
// is worth something. This produces that list, and the site renders it.
//
// THE PRIVACY PROBLEM, AND THE RULE THAT SOLVES IT
//
// The treasury wallet is a PERSON'S wallet. Publishing every inbound transfer
// to it would publish every payment that person ever receives, permanently, on
// a public website. That is not transparency, it is an accident.
//
// So: an inbound transfer is only ever PUBLISHED when it came from a contract
// on the allowlist below — the pad's own machinery. Everything else is counted
// as `unclassified`, kept out of the published file, and reported in the
// console so a new pad contract can be recognised and added deliberately.
//
// Default deny. A transfer has to be provably a fee claim to reach the site.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, defineChain, formatUnits, getAddress } from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// --- what we are watching ----------------------------------------------------

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  wallet: getAddress(process.env.TREASURY || '0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf'),
  // Baseline: the block at which this watcher was first pointed at the wallet.
  // Nothing before it is scanned, so the panel never implies it knows about
  // history it never looked at.
  fromBlock: BigInt(process.env.FROM_BLOCK || 57090885),
  chunk: BigInt(process.env.CHUNK || 2000),
  confirmations: BigInt(process.env.CONFIRMATIONS || 2),
  paceMs: Number(process.env.PACE_MS || 250), // the public RPC rate-limits bursts

  write: process.env.WRITE === '1',
  out: join(ROOT, 'data', 'fees.json'),
};

// Tokens we can name. Anything else is reported by address and left unnamed
// rather than guessed at.
const TOKENS = {
  '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A': { symbol: 'KEVIN', decimals: 18 },
  '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73': { symbol: 'WETH', decimals: 18 },
  '0x5a3544a0328afD50A9979e03404F35c555B88c00': { symbol: 'KEK', decimals: 18 },
  '0x1b0E319c6A659F002271B69dB8A7df2F911c153E': { symbol: 'GME', decimals: 18 },
};

// The allowlist. Only a transfer whose SENDER is one of these is published.
// Every entry is a contract that has been checked on chain, with a note saying
// what it is — an address nobody can explain does not belong here.
const PAD = {
  '0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383': 'launchpad factory',
  '0x506200532B0a5A7B9d1e7C50D0014680FC3B5b13': 'launchpad locker',
  '0x58daec3116aae6D93017bAAea7749052E8a04fA7': 'uniswap v4 position manager',
  '0x8366a39CC670B4001A1121B8F6A443A643e40951': 'uniswap v4 pool manager',
  '0xcae82a0059cb441d263170743b82a62e2499c378': 'launchpad router',
};
const padOf = (addr) => {
  const hit = Object.keys(PAD).find((k) => k.toLowerCase() === addr.toLowerCase());
  return hit ? PAD[hit] : null;
};

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad32 = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (...a) => console.log(stamp(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The public RPC rate-limits, and a scan is a burst of requests by nature.
 * Back off and retry rather than dying halfway through — a run that aborts at
 * chunk nine leaves data/fees.json stale with no sign that anything is wrong,
 * which is the worst failure this script has available to it.
 */
async function withRetry(fn, what, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const rateLimited = /429|Too Many Requests|rate/i.test(e?.message ?? '');
      if (i === tries - 1 || !rateLimited) throw e;
      const wait = 1000 * 2 ** i;
      say(`${what}: rate limited, waiting ${wait}ms`);
      await sleep(wait);
    }
  }
}

/**
 * Sum published claims per token symbol.
 * Kept as a pure function of the claim list so the totals can never drift from
 * the rows underneath them — the bug that has already bitten this repo once,
 * when a hand-typed liquidity total said eighteen over a list that said fifteen.
 */
export function totalsOf(claims) {
  const out = {};
  for (const c of claims) {
    const prev = BigInt(out[c.symbol]?.raw ?? '0');
    const raw = prev + BigInt(c.raw);
    out[c.symbol] = { raw: raw.toString(), amount: formatUnits(raw, c.decimals), decimals: c.decimals };
  }
  return out;
}

/** Turn one Transfer log into a claim row, or null if it is not publishable. */
export function classify(log, tokens = TOKENS, padLookup = padOf) {
  const token = getAddress(log.address);
  const from = getAddress('0x' + log.topics[1].slice(26));
  const meta = Object.entries(tokens).find(([k]) => k.toLowerCase() === token.toLowerCase())?.[1];
  const source = padLookup(from);
  const raw = BigInt(log.data);
  if (raw === 0n) return null;                 // a zero-value transfer is noise
  return {
    tx: log.transactionHash,
    block: Number(BigInt(log.blockNumber)),
    token,
    symbol: meta?.symbol ?? null,
    decimals: meta?.decimals ?? 18,
    raw: raw.toString(),
    amount: formatUnits(raw, meta?.decimals ?? 18),
    from,
    source,                                     // null => not from the pad
    publish: Boolean(source && meta),           // named token AND known sender
  };
}

async function main() {
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });

  const head = await pub.getBlockNumber();
  const safe = head - cfg.confirmations;
  say(`head ${head}, scanning ${cfg.fromBlock} -> ${safe} for transfers into ${cfg.wallet}`);

  const logs = [];
  for (let from = cfg.fromBlock; from <= safe; from += cfg.chunk) {
    const to = from + cfg.chunk - 1n > safe ? safe : from + cfg.chunk - 1n;
    // Raw eth_getLogs: viem's getLogs() takes an `event`/`args` pair and
    // silently drops a hand-built `topics` array, which turns this into an
    // unfiltered scan of every log on the chain. Ask the node directly.
    const batch = await withRetry(() => pub.request({
      method: 'eth_getLogs',
      params: [{
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        topics: [TRANSFER, null, pad32(cfg.wallet)],
      }],
    }), `logs ${from}-${to}`);
    logs.push(...batch);
    await sleep(cfg.paceMs);
  }
  say(`${logs.length} inbound transfer${logs.length === 1 ? '' : 's'} found`);

  const rows = logs.map((l) => classify(l)).filter(Boolean);

  // Timestamps, one call per distinct block rather than one per row.
  const blocks = [...new Set(rows.map((r) => r.block))];
  const times = new Map();
  for (const b of blocks) {
    const blk = await withRetry(() => pub.getBlock({ blockNumber: BigInt(b) }), `block ${b}`);
    times.set(b, new Date(Number(blk.timestamp) * 1000).toISOString());
    await sleep(cfg.paceMs);
  }
  rows.forEach((r) => { r.at = times.get(r.block); });

  const claims = rows.filter((r) => r.publish).sort((a, b) => b.block - a.block);
  const held = rows.filter((r) => !r.publish);

  for (const c of claims) say(`  FEE   ${c.amount} ${c.symbol}  from ${c.source}  ${c.tx}`);
  for (const h of held) {
    say(`  held  ${h.amount} ${h.symbol ?? h.token} from ${h.from} — sender not on the pad allowlist, NOT published`);
  }

  const doc = {
    wallet: cfg.wallet,
    note: 'LP fees claimed from the launchpad. Every row is a real transaction — open the hash in the explorer and check it. Only transfers sent by the pad\'s own contracts appear here.',
    explorer: 'https://robinhoodchain.blockscout.com/tx/',
    watchedFrom: Number(cfg.fromBlock),
    lastBlock: Number(safe),
    updatedAt: new Date().toISOString(),
    totals: totalsOf(claims),
    claims: claims.map(({ publish, ...c }) => c),
    unpublished: held.length,
  };

  if (cfg.write) {
    mkdirSync(dirname(cfg.out), { recursive: true });
    writeFileSync(cfg.out, JSON.stringify(doc, null, 2) + '\n');
    say(`wrote ${cfg.out}`);
  } else {
    say('dry run — pass WRITE=1 to update data/fees.json');
    console.log(JSON.stringify(doc.totals, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
