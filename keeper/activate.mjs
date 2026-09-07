// The warm-up bell.
//
//   node keeper/activate.mjs            watch and report, send nothing
//   LIVE=1 node keeper/activate.mjs     actually send
//
// KevinStaking pays out of a single global accumulator, so nothing fires by
// itself when one account's warm-up ends — somebody has to touch the account
// to bring it into the effective supply. `activate` is permissionless
// precisely so that anybody can, and this is the anybody.
//
// WHY THIS MATTERS MORE THAN IT SOUNDS
//
// An account inside its warm-up counts for zero, so a late activation costs
// that staker and nobody else. Which means: if nothing runs this, people who
// staked and waited their five days earn NOTHING and have no idea why. They
// did everything right. That is the failure this file exists to prevent, and
// it is a support nightmare rather than an exploit — which is exactly the kind
// of thing that goes unbuilt until it has already happened.
//
// DRY RUN IS THE DEFAULT. It has to be told to send.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, defineChain, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  staking: process.env.STAKING_ADDRESS,
  live: process.env.LIVE === '1',
  // Activation is not time critical — a staker loses nothing by being brought
  // in a few minutes after their warm-up ends, because they were earning
  // nothing either way. Hourly is plenty and keeps the log quiet.
  everyMs: Number(process.env.TICK_MS || 3_600_000),
  // How many addresses to put in one activateMany. The contract walks the
  // list, so this is a gas bound, not a correctness one.
  batch: Number(process.env.BATCH || 50),
  fromBlock: BigInt(process.env.FROM_BLOCK || 0),
  chunk: Number(process.env.CHUNK || 9000),
  minGasWei: BigInt(process.env.MIN_GAS_WEI || 2_000_000_000_000_000n),
};

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

const ABI = [
  { type: 'function', name: 'needsSync', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'effectiveBalanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'minStake', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'warmup', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'activateMany', stateMutability: 'nonpayable', inputs: [{ type: 'address[]' }], outputs: [] },
  { type: 'event', name: 'Staked', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
];

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (...a) => console.log(stamp(), ...a);
const warn = (...a) => console.error(stamp(), '!!', ...a);

function loadKey() {
  const p = join(HERE, '.operator.key');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim() || null;
}

async function main() {
  if (!cfg.staking) {
    warn('STAKING_ADDRESS is not set. Nothing to drive.');
    process.exit(1);
  }
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const key = loadKey();
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

  say('warm-up bell starting');
  say('  staking  ', cfg.staking);
  say('  chain    ', cfg.chainId, cfg.rpc);
  say('  operator ', account ? account.address : '(none — dry run)');
  say('  mode     ', cfg.live ? 'LIVE, it will send transactions' : 'DRY RUN, it will send nothing');
  say('  tick     ', `${cfg.everyMs / 60000}m`);

  try {
    const [min, warm] = await Promise.all([
      pub.readContract({ address: cfg.staking, abi: ABI, functionName: 'minStake' }),
      pub.readContract({ address: cfg.staking, abi: ABI, functionName: 'warmup' }),
    ]);
    say('  minStake ', formatUnits(min, 18), '$KEVIN');
    say('  warmup   ', `${Number(warm) / 86400}d`);
    if (warm === 0n) say('  (no warm-up configured, so there is nothing here to do yet)');
  } catch (e) {
    warn('could not read the contract:', e.shortMessage || e.message);
    warn('check STAKING_ADDRESS and the RPC.');
    process.exit(1);
  }

  // Everyone who has ever staked. Once known, an address is never forgotten:
  // somebody who left and came back needs activating again, and the set is
  // small enough that keeping it costs nothing.
  const known = new Set();
  let scanned = cfg.fromBlock;

  async function findStakers(head) {
    let from = scanned;
    while (from <= head) {
      const to = from + BigInt(cfg.chunk) > head ? head : from + BigInt(cfg.chunk);
      let logs;
      try {
        logs = await pub.getLogs({
          address: cfg.staking, event: ABI.find((x) => x.type === 'event'),
          fromBlock: from, toBlock: to,
        });
      } catch (e) {
        // Public endpoints cap the range and word it differently every time.
        if (cfg.chunk > 200) { cfg.chunk = Math.floor(cfg.chunk / 2); continue; }
        throw e;
      }
      for (const l of logs) known.add(l.args.account);
      from = to + 1n;
    }
    scanned = head + 1n;
  }

  let lastSaid = '';
  for (;;) {
    try {
      const head = await pub.getBlockNumber();
      await findStakers(head);

      // ONE CALL, AND THE CONTRACT DECIDES.
      //
      // This used to ask "warmed up and not yet counted", which is only one of
      // the reasons an account can be owed a sync — it missed a term expiring,
      // so a boost went on being paid after the promise it was paid for had
      // ended. Rather than reimplement the weighting here and quietly disagree
      // with the contract about who is owed what, `needsSync` compares the
      // applied weight to what it should be and answers in one word.
      const due = [];
      for (const a of known) {
        const owed = await pub.readContract({
          address: cfg.staking, abi: ABI, functionName: 'needsSync', args: [a],
        });
        if (owed) due.push(a);
      }

      if (!due.length) {
        const line = `everybody is settled · ${known.size} stakers known`;
        if (line !== lastSaid) say(line);
        lastSaid = line;
      } else {
        lastSaid = '';
        say(`${due.length} of ${known.size} stakers are owed a sync`);
        for (let i = 0; i < due.length; i += cfg.batch) {
          const slice = due.slice(i, i + cfg.batch);
          if (!cfg.live) { say('  WOULD ACTIVATE', slice.length, slice.slice(0, 3).join(' '), '...'); continue; }
          const bal = await pub.getBalance({ address: account.address });
          if (bal < cfg.minGasWei) { warn('  operator is out of gas money — not sending. Top it up.'); break; }
          try {
            const { request } = await pub.simulateContract({
              address: cfg.staking, abi: ABI, functionName: 'activateMany', args: [slice], account,
            });
            const hash = await wallet.writeContract(request);
            const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
            say(`  activated ${slice.length} · ${rc.status} in block ${rc.blockNumber} · gas ${rc.gasUsed}`);
          } catch (e) {
            warn('  batch failed:', (e.shortMessage || e.message).split('\n')[0]);
          }
        }
      }
    } catch (e) {
      warn('tick failed:', e.shortMessage || e.message);
    }
    await new Promise((r) => setTimeout(r, cfg.everyMs));
  }
}

main().catch((e) => {
  warn('fatal:', e.stack || e.message);
  process.exit(1);
});
