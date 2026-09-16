#!/usr/bin/env node
// One-shot: prices every KevinNFT tier and loads every token id from
// assets/pfp/tiers.json onto the contract, chunked well under the block gas
// limit (loadTier's own doc comment on the contract asks for "a couple
// hundred ids" per call, not all 1,000 at once).
//
// Deliberately stops there. lockTiers() and openMint() are one-shot and
// irreversible — see DeployKevinNFT.s.sol's own printed next-steps — so this
// script never calls them. Run it, read remaining(tier) back yourself, and
// only then lock by hand.
//
//   node tools/load-nft-tiers.mjs                             status only, sends nothing
//   NFT_ADDRESS=0x.. node tools/load-nft-tiers.mjs --set-prices --load   dry run of both
//   LIVE=1 NFT_ADDRESS=0x.. node tools/load-nft-tiers.mjs --set-prices --load   actually send
//
// Env:
//   NFT_ADDRESS         required to read or send anything
//   ROBINHOOD_RPC_URL   default https://rpc.mainnet.chain.robinhood.com
//   CHAIN_ID            default 4663
//   PRIVATE_KEY         owner key. Only read when LIVE=1.
//   CHUNK_SIZE          ids per loadTier() call, default 200
//
// Prices come from `node tools/mint-model-burn.mjs --json`, not a second
// copy of that formula here — see that file for why the ladder is shaped
// the way it is.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  createPublicClient, createWalletClient, http, defineChain, parseEther, formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']; // must match the Tier enum's declared order

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  nft: process.env.NFT_ADDRESS,
  live: process.env.LIVE === '1',
  chunkSize: Number(process.env.CHUNK_SIZE || 200),
};

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

const ABI = [
  { type: 'function', name: 'setBurnAmount', stateMutability: 'nonpayable', inputs: [{ type: 'uint8' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'loadTier', stateMutability: 'nonpayable', inputs: [{ type: 'uint8' }, { type: 'uint256[]' }], outputs: [] },
  { type: 'function', name: 'remaining', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'burnAmount', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tiersLocked', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'mintOpen', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
];

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function tierIds() {
  const { byId, counts } = JSON.parse(await readFile(join(ROOT, 'assets/pfp/tiers.json'), 'utf8'));
  const byTier = Object.fromEntries(ORDER.map((t) => [t, []]));
  for (const [idStr, tier] of Object.entries(byId)) byTier[tier].push(Number(idStr));
  // Sort numerically, not by object-key iteration order, so the load order
  // (and therefore which ids the resumability check below assumes are
  // "already sent") is deterministic across runs and engines.
  for (const t of ORDER) byTier[t].sort((a, b) => a - b);
  for (const t of ORDER) {
    if (byTier[t].length !== counts[t]) {
      throw new Error(`tiers.json says ${counts[t]} ${t} ids but byId only lists ${byTier[t].length}`);
    }
  }
  return byTier;
}

function pricesFromModel() {
  const out = JSON.parse(execFileSync('node', [join(ROOT, 'tools/mint-model-burn.mjs'), '--json'], { encoding: 'utf8' }));
  return Object.fromEntries(out.rows.map((r) => [r.tier, r.kevin]));
}

async function main() {
  if (!cfg.nft) {
    console.error('NFT_ADDRESS is not set. Nothing to read or drive.');
    process.exit(1);
  }
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });

  let wallet = null, account = null;
  if (cfg.live) {
    const key = process.env.PRIVATE_KEY;
    if (!key) {
      console.error('LIVE=1 but PRIVATE_KEY is not set. Refusing to start.');
      process.exit(1);
    }
    account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
    wallet = createWalletClient({ account, chain, transport: http(cfg.rpc) });
  }

  const [locked, open] = await Promise.all([
    pub.readContract({ address: cfg.nft, abi: ABI, functionName: 'tiersLocked' }),
    pub.readContract({ address: cfg.nft, abi: ABI, functionName: 'mintOpen' }),
  ]);
  console.log(`contract   ${cfg.nft}`);
  console.log(`mode       ${cfg.live ? `LIVE as ${account.address}` : 'DRY RUN, sending nothing'}`);
  console.log(`tiersLocked ${locked}   mintOpen ${open}`);
  if (locked) {
    console.log('\nTiers are already locked. setBurnAmount and loadTier are dead on this contract forever — nothing to do here.');
    return;
  }

  const byTier = await tierIds();
  const prices = args.includes('--set-prices') ? pricesFromModel() : null;

  for (const tier of ORDER) {
    const tierIndex = ORDER.indexOf(tier);
    const already = Number(await pub.readContract({ address: cfg.nft, abi: ABI, functionName: 'remaining', args: [tierIndex] }));
    const onChainPrice = await pub.readContract({ address: cfg.nft, abi: ABI, functionName: 'burnAmount', args: [tierIndex] });
    console.log(`\n${tier}: ${already}/${byTier[tier].length} ids loaded on chain, priced at ${formatEther(onChainPrice)} KEVIN`);

    if (prices) {
      const wei = parseEther(String(prices[tier]));
      if (onChainPrice === wei) {
        console.log(`  price already set to ${prices[tier].toLocaleString()} KEVIN, skipping`);
      } else {
        console.log(`  ${cfg.live ? 'sending' : 'would send'} setBurnAmount(${tier}, ${prices[tier].toLocaleString()} KEVIN)`);
        if (cfg.live) {
          const hash = await wallet.writeContract({
            address: cfg.nft, abi: ABI, functionName: 'setBurnAmount', args: [tierIndex, wei],
          });
          await pub.waitForTransactionReceipt({ hash });
          console.log(`  confirmed ${hash}`);
        }
      }
    }

    if (args.includes('--load')) {
      // already loaded ids are assumed to be the leading slice of our
      // deterministic sort — true as long as this script is the only thing
      // that ever calls loadTier, which is the point of it existing.
      const remainingIds = byTier[tier].slice(already);
      if (remainingIds.length === 0) {
        console.log('  all ids already loaded');
        continue;
      }
      for (const batch of chunk(remainingIds, cfg.chunkSize)) {
        console.log(`  ${cfg.live ? 'sending' : 'would send'} loadTier(${tier}, [${batch[0]}..${batch[batch.length - 1]}], ${batch.length} ids)`);
        if (cfg.live) {
          const hash = await wallet.writeContract({
            address: cfg.nft, abi: ABI, functionName: 'loadTier', args: [tierIndex, batch.map(BigInt)],
          });
          await pub.waitForTransactionReceipt({ hash });
          console.log(`  confirmed ${hash}`);
        }
      }
    }
  }

  console.log(`\nDone. Read remaining(tier) for all five tiers before running lockTiers() by hand —`);
  console.log('once every tier matches its committed count exactly, lockTiers() is the one-shot that freezes it.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
