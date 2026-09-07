// Burn watcher — the receipts behind the burn counter, and the bot's alert.
//
//   node keeper/burnwatch.mjs               scan and print, write nothing
//   WRITE=1 node keeper/burnwatch.mjs       update data/burns.json
//   WRITE=1 LIVE=1 node keeper/burnwatch.mjs   ...and announce new burns
//
// A burn counter that reads a number somebody typed is worth nothing — it is
// the same sentence as "trust me". This reads the chain: every transfer of
// $KEVIN into a burn address, with its transaction hash, so the total on the
// site is a sum of rows a stranger can open in the explorer.
//
// Burn addresses are the two that cannot spend: 0x...dEaD and 0x0. Tokens sent
// there are gone, because nobody holds the key to either. Nothing else counts —
// a "burn wallet" somebody controls is not a burn, it is a wallet.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, defineChain, formatUnits, getAddress } from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  token: process.env.KEVIN_TOKEN || '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A',
  supply: Number(process.env.SUPPLY || 1_000_000_000),
  // The block the token started trading. Scanning from here means the counter
  // covers the whole life of the token, not just since the watcher was written.
  fromBlock: BigInt(process.env.FROM_BLOCK || 56_600_000),
  chunk: BigInt(process.env.CHUNK || 200_000),
  paceMs: Number(process.env.PACE_MS || 300),
  confirmations: BigInt(process.env.CONFIRMATIONS || 2),
  write: process.env.WRITE === '1',
  live: process.env.LIVE === '1',
  chat: process.env.BURN_CHAT_ID || process.env.BUY_CHAT_ID,
  out: join(ROOT, 'data', 'burns.json'),
};

// The only two destinations that are actually unspendable.
export const BURN_ADDRESSES = [
  '0x000000000000000000000000000000000000dEaD',
  '0x0000000000000000000000000000000000000000',
].map(getAddress);

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad32 = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (...a) => console.log(stamp(), ...a);

const chain = defineChain({
  id: cfg.chainId, name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

async function withRetry(fn, what, tries = 7) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1 || !/429|Too Many|rate/i.test(e?.message ?? '')) throw e;
      const wait = 1000 * 2 ** i;
      say(`${what}: rate limited, waiting ${wait}ms`);
      await sleep(wait);
    }
  }
}

/**
 * Totals, derived from the rows and never stored separately, so the headline
 * and the list underneath it cannot drift apart.
 */
export function totalOf(burns, supply) {
  const raw = burns.reduce((a, b) => a + BigInt(b.raw), 0n);
  const tokens = Number(formatUnits(raw, 18));
  return {
    raw: raw.toString(),
    tokens,
    amount: formatUnits(raw, 18),
    percentOfSupply: supply ? (tokens / supply) * 100 : null,
  };
}

/** Kevin's voice. Never a price, never a promise, and never a target. */
export function announce(burn, total, supply) {
  const n = (x) => x.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  return [
    '🔥'.repeat(8),
    '',
    'Some KEVIN just went in the fryer and did not come out.',
    '',
    `  ${n(Number(burn.amount))} KEVIN burned`,
    `  ${n(total.tokens)} gone in total`,
    `  ${total.percentOfSupply.toFixed(3)}% of everything there will ever be`,
    '',
    'It is at the dead address. Nobody has that key. Nobody is getting it back.',
    '',
    burn.tx,
  ].join('\n');
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'telegram said no');
  return j.result;
}

async function main() {
  if (cfg.live && !cfg.chat) {
    console.error('LIVE=1 but no BURN_CHAT_ID. Refusing to start.');
    process.exit(1);
  }
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const head = (await pub.getBlockNumber()) - cfg.confirmations;
  say(`scanning ${cfg.fromBlock} -> ${head} for burns of ${cfg.token}`);

  const logs = [];
  for (let from = cfg.fromBlock; from <= head; from += cfg.chunk) {
    const to = from + cfg.chunk - 1n > head ? head : from + cfg.chunk - 1n;
    for (const dead of BURN_ADDRESSES) {
      logs.push(...await withRetry(() => pub.request({
        method: 'eth_getLogs',
        params: [{
          address: cfg.token,
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          topics: [TRANSFER, null, pad32(dead)],
        }],
      }), `logs ${from}-${to}`));
      await sleep(cfg.paceMs);
    }
  }

  const burns = logs
    .filter((l) => BigInt(l.data) > 0n)
    .map((l) => ({
      tx: l.transactionHash,
      block: Number(BigInt(l.blockNumber)),
      raw: BigInt(l.data).toString(),
      amount: formatUnits(BigInt(l.data), 18),
      from: getAddress('0x' + l.topics[1].slice(26)),
      to: getAddress('0x' + l.topics[2].slice(26)),
    }));

  for (const b of burns) {
    const blk = await withRetry(() => pub.getBlock({ blockNumber: BigInt(b.block) }), `block ${b.block}`);
    b.at = new Date(Number(blk.timestamp) * 1000).toISOString();
    await sleep(cfg.paceMs);
  }
  burns.sort((a, b) => b.block - a.block);

  const total = totalOf(burns, cfg.supply);
  say(`${burns.length} burn${burns.length === 1 ? '' : 's'}, ${total.amount} KEVIN (${total.percentOfSupply.toFixed(4)}% of supply)`);
  for (const b of burns) say(`  ${b.amount} from ${b.from}  ${b.tx}`);

  const doc = {
    token: cfg.token,
    note: 'Every $KEVIN sent to an address nobody holds the key to. Open any hash in the explorer and check it.',
    explorer: 'https://robinhoodchain.blockscout.com/tx/',
    burnAddresses: BURN_ADDRESSES,
    supply: cfg.supply,
    watchedFrom: Number(cfg.fromBlock),
    lastBlock: Number(head),
    updatedAt: new Date().toISOString(),
    total,
    burns,
  };

  if (cfg.write) {
    mkdirSync(dirname(cfg.out), { recursive: true });
    // Announce only what is new since the last write, so a rescan does not
    // re-post the whole history into the group.
    let known = new Set();
    if (existsSync(cfg.out)) {
      try { known = new Set((JSON.parse(readFileSync(cfg.out, 'utf8')).burns || []).map((b) => b.tx)); }
      catch { /* a corrupt file must not stop the write; it just means nothing is "known" */ }
    }
    const fresh = burns.filter((b) => !known.has(b.tx));
    writeFileSync(cfg.out, JSON.stringify(doc, null, 2) + '\n');
    say(`wrote ${cfg.out}${fresh.length ? ` (${fresh.length} new)` : ''}`);

    if (cfg.live && fresh.length) {
      const p = join(ROOT, 'bot', '.telegram.key');
      const key = existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
      if (!key) { say('no bot/.telegram.key — cannot announce'); return; }
      for (const b of fresh.reverse()) {
        await tg(key, 'sendMessage', { chat_id: cfg.chat, text: announce(b, total, cfg.supply) });
        say(`announced ${b.tx}`);
      }
    } else if (fresh.length) {
      say('new burns found. LIVE=1 would have announced them:');
      console.log('\n' + announce(fresh[0], total, cfg.supply) + '\n');
    }
  } else {
    say('dry run — pass WRITE=1 to update data/burns.json');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
