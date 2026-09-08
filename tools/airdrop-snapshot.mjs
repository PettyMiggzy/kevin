// Who held $KEVIN, for how long, and what that is worth in GME.
//
//   node tools/airdrop-snapshot.mjs --total 1000000000000000000000 --days 7
//
// Replays the token's whole Transfer log, works out a time-weighted average
// balance for every address over the window, and writes the round file plus
// the Merkle root that KevinAirdrop.openRound() takes.
//
// WHY TIME-WEIGHTED AND NOT A SNAPSHOT
//
// A snapshot at a block rewards whoever is holding at that instant, which is
// a game: buy the block before, claim, sell the block after. Weighting by
// balance MULTIPLIED BY TIME HELD makes that worth almost nothing — an hour of
// holding in a seven-day window scores about half a percent of what the whole
// window scores — and it is what "people who have held for a while, weighted
// by how much" actually means when you write it down.
//
// WHY IT IS NOT ON CHAIN
//
// $KEVIN is a plain ERC-20 clone with no transfer hook, so there is nowhere to
// record holding time. This is computed from the public Transfer log instead,
// which means it is verifiable rather than trusted: the run is deterministic
// from public data, the full list is published next to the root, and anybody
// can re-run this and check the root matches what the contract stores.

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keccak256, encodeAbiParameters, decodeAbiParameters, concatHex, getAddress } from 'viem';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? dflt : argv[i + 1];
};

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  token: arg('token', '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A'),
  // What is being paid out, in the payout token's smallest unit.
  total: BigInt(arg('total', '0')),
  // Only count the last N days. 0 means the token's whole life so far.
  days: Number(arg('days', '0')),
  // OR pin the window exactly. THIS IS WHAT MAKES A ROUND REPRODUCIBLE.
  // With only --days the window is anchored to whatever block the head
  // happened to be at when the team ran it, so nobody outside the team can
  // rebuild the root — and "this list hashes to this root" is a property a
  // fabricated list also has. Every round file records these, so re-running
  // the printed command must produce the same root or something is wrong.
  fromBlock: arg('from-block', null),
  toBlock: arg('to-block', null),
  blocksPerDay: arg('blocks-per-day', null),
  // An address must have held something for at least this long to qualify at
  // all, on top of being weighted by time. Stops a dust of accounts with a
  // few seconds of holding from appearing in the list at all.
  minHoldDays: Number(arg('min-hold-days', '1')),
  // Below this share of the payout, a row is not worth its own claim gas.
  minPayout: BigInt(arg('min-payout', '0')),
  // Must still be holding at least this much AT THE END of the window, in the
  // token's smallest unit. Time weighting alone would still pay somebody who
  // held a large balance early and sold it all before the snapshot — which is
  // exactly the person an airdrop for holders should not be paying.
  minBalance: BigInt(arg('min-balance', '5000000000000000000000000')), // 5,000,000 KEVIN
  out: arg('out', null),
  // Where the round will live once it is opened. Written into the round file so
  // the claim page has a destination instead of a null — a transaction with no
  // `to` is a contract deployment, and every claimant would have paid gas to
  // deploy their own claim calldata.
  airdrop: arg('airdrop', null),
  roundId: Number(arg('round', '0')),
  // WHAT IS BEING PAID OUT, which is not the same thing as the token the
  // snapshot was taken over. A KEVIN snapshot paying a GME round rendered its
  // amounts with no unit at all next to the words "5,000,000 KEVIN", so the
  // page read as if it were paying KEVIN.
  payoutToken: arg('payout-token', null),
  payoutSymbol: arg('payout-symbol', null),
  payoutDecimals: Number(arg('payout-decimals', '18')),
  // Both of these change WHICH addresses end up in the list, so both have to
  // travel in reproduceWith or an honest round fails its own verification.
  genesisBlock: Number(arg('genesis-block', '53285633')),
  extraExclude: arg('exclude', '') || '',
  // Robinhood Chain does ~18 blocks/sec — about 856,000 blocks a DAY — so a
  // 9,000-block chunk means ~95 requests per day of window and the public RPC
  // rate-limits long before the scan finishes.
  chunk: Number(arg('chunk', '150000')),
};

// Addresses that must never receive a drop: the pools hold the float, the
// treasury contracts hold the treasury's own tokens, and the burn address
// holds tokens nobody owns. Paying any of them is paying yourself and calling
// it a community airdrop.
const EXCLUDE = new Set([
  '0x0000000000000000000000000000000000000000', // mint/burn
  '0x000000000000000000000000000000000000dEaD', // burn
  '0x8366a39CC670B4001A1121B8F6A443A643e40951', // v4 PoolManager — holds ALL pool liquidity
  '0x58daec3116aae6D93017bAAea7749052E8a04fA7', // v4 PositionManager
  '0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383', // launchpad factory
  '0xcae82a0059cb441d263170743b82a62e2499c378', // launchpad router
  '0xeb0226f992f959b7fa2ac7c3dafc712915310fea', // launchpad liquidity manager
  '0x506200532B0a5A7B9d1e7C50D0014680FC3B5b13', // launchpad locker
  '0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99', // universal router
  '0x000000000022D473030F116dDEE9F6B43aC78BA3', // permit2
  '0x8876789976dEcBfCbBbe364623C63652db8C0904', // sell router — 36 wallets route sells through it
  // The treasury itself. It is the one address most obviously not entitled to
  // a share of its own airdrop, and the one an exclusion list built by looking
  // at the pools is most likely to forget.
  '0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf',
  ...(arg('exclude', '') || '').split(',').filter(Boolean),
].map((a) => getAddress(a)));

const TRANSFER = keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'));

/** One eth_call, for the verifier. */
async function rpcCall(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest']);
}

async function rpc(method, params, tries = 7) {
  // The public RPC rate-limits bursts, and a full log replay is a burst by
  // definition. Dying halfway through a snapshot is the worst outcome
  // available here: the reconciliation check below would pass on a partial
  // log if the run ever completed with one, so the scan must not silently
  // give up on a 429.
  for (let i = 0; i < tries; i++) {
    const r = await fetch(cfg.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
    if (!j.error) return j.result;
    const rate = /429|Too Many|rate/i.test(j.error.message || '');
    if (!rate || i === tries - 1) throw new Error(`${method}: ${j.error.message}`);
    await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
  }
}

const hexToBig = (h) => BigInt(h);
const addrOf = (topic) => getAddress('0x' + topic.slice(26));

/** Every Transfer the token has ever emitted, oldest first. */
async function allTransfers(latest) {
  const out = [];
  // Start at the token's own mint, not block 0. Robinhood Chain was already
  // 53M blocks deep when $KEVIN was minted, so scanning from zero spends
  // hundreds of requests on chain that provably cannot contain a Transfer of a
  // token that did not exist yet, and the public RPC rate-limits long before
  // reaching the blocks that matter.
  //
  // 53,285,633 is not a guess: it is the block of the single Transfer from the
  // zero address that created all 1,000,000,000 tokens, to the launchpad
  // factory. Starting one block later loses the mint, the replayed balances
  // come to zero, and the reconciliation check below correctly refuses to
  // publish — which is how this number was found.
  let from = cfg.genesisBlock;
  while (from <= latest) {
    const to = Math.min(from + cfg.chunk, latest);
    let logs;
    try {
      logs = await rpc('eth_getLogs', [{
        address: cfg.token,
        topics: [TRANSFER],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
    } catch (e) {
      // Public endpoints cap the range and say so in different words each
      // time. Halve and retry rather than trying to parse the message.
      if (cfg.chunk > 200) { cfg.chunk = Math.floor(cfg.chunk / 2); continue; }
      throw e;
    }
    for (const l of logs) {
      out.push({
        block: Number(l.blockNumber),
        from: addrOf(l.topics[1]),
        to: addrOf(l.topics[2]),
        value: hexToBig(l.data === '0x' ? '0x0' : l.data),
      });
    }
    process.stderr.write(`\r  logs ${out.length}  block ${to}/${latest}   `);
    from = to + 1;
  }
  process.stderr.write('\n');
  out.sort((a, b) => a.block - b.block);
  return out;
}

/**
 * Replay the log and accumulate balance x blocks-held for every address.
 *
 * Weighting by block number rather than by timestamp: on this chain blocks are
 * regular and the result is normalised anyway, so the two agree to well under
 * the precision anybody could argue about — and it avoids one RPC round trip
 * per block, which for a token's whole history is not a small thing.
 */
function weigh(transfers, fromBlock, toBlock) {
  const bal = new Map();
  const weight = new Map();   // address -> balance*blocks
  const heldFor = new Map();  // address -> blocks with a non-zero balance
  const since = new Map();    // address -> block its current balance started

  const get = (m, k) => m.get(k) ?? 0n;
  const settle = (a, upTo) => {
    const b = get(bal, a);
    const start = since.get(a) ?? fromBlock;
    if (upTo > start) {
      if (b > 0n) {
        weight.set(a, get(weight, a) + b * BigInt(upTo - start));
        heldFor.set(a, get(heldFor, a) + BigInt(upTo - start));
      }
    }
    since.set(a, upTo);
  };

  for (const t of transfers) {
    const at = Math.max(t.block, fromBlock);
    // Balances before the window still count from the window's start, so an
    // address that bought early and never moved is credited for all of it.
    if (t.from !== '0x0000000000000000000000000000000000000000') {
      settle(t.from, at);
      bal.set(t.from, get(bal, t.from) - t.value);
    }
    settle(t.to, at);
    bal.set(t.to, get(bal, t.to) + t.value);
  }
  for (const a of bal.keys()) settle(a, toBlock);

  return { weight, heldFor, bal };
}

// --- merkle -----------------------------------------------------------------
// Leaves are double-hashed and pairs are sorted, to match OpenZeppelin's
// MerkleProof.verify exactly. Both matter: sorted pairs is what OZ does, and
// double hashing is what stops an internal node being replayed as a leaf.

const leafOf = (index, account, amount) =>
  keccak256(keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
    // getAddress rather than the raw string: viem rejects a mixed-case address
    // whose checksum does not match, and the encoding is identical either way,
    // so normalising here means a hand-edited list cannot fail at the last step.
    [BigInt(index), getAddress(account), BigInt(amount)],
  )));

const pair = (a, b) => keccak256(concatHex(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));

function buildTree(leaves) {
  // A tree of nothing has no root, and `layers[last][0]` would be undefined —
  // which JSON.stringify then drops from the file entirely, so the round file
  // ends up with no root at all and everything downstream compares undefined
  // to undefined and passes.
  if (!leaves.length) throw new Error('cannot build a merkle tree with no leaves');
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return layers;
}

function proofFor(layers, index) {
  const proof = [];
  let i = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const sib = i ^ 1;
    if (sib < layers[l].length) proof.push(layers[l][sib]);
    i = Math.floor(i / 2);
  }
  return proof;
}

// --- verify -----------------------------------------------------------------

/**
 * Rebuild the root from a published round file and say whether it matches.
 *
 *   node tools/airdrop-snapshot.mjs --verify airdrop/round-1.json
 *
 * This is the whole reason the list is published. The contract stores a `uri`
 * but nothing on chain binds that file's CONTENTS to the root — so the check
 * has to be something anybody can run, on the file they were given, against
 * the root the contract actually holds. It re-derives every leaf, rebuilds
 * every layer, and re-checks each individual proof, so a file with a correct
 * root but a doctored proof fails too.
 */
async function verify(path) {
  const { readFile } = await import('node:fs/promises');
  const j = JSON.parse(await readFile(path, 'utf8'));
  const rows = Object.entries(j.claims)
    .map(([address, c]) => ({ address, index: c.index, amount: BigInt(c.amount), proof: c.proof }))
    .sort((a, b) => a.index - b.index);

  const problems = [];
  // Check the file HAS the things before checking they agree. A round file with
  // no root at all would otherwise compare undefined to undefined and pass.
  if (!/^0x[0-9a-fA-F]{64}$/.test(j.root || '')) problems.push(`the file has no usable root (${j.root})`);
  if (!rows.length) problems.push('the file has no claims in it');
  rows.forEach((r, i) => { if (r.index !== i) problems.push(`index ${r.index} is out of order at position ${i}`); });

  const leaves = rows.map((r) => leafOf(r.index, r.address, r.amount));
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];
  if (root !== j.root) problems.push(`root in the file is ${j.root} but the list hashes to ${root}`);

  // Each stored proof must actually verify, the way the contract verifies it.
  for (const r of rows) {
    let h = leafOf(r.index, r.address, r.amount);
    for (const p of r.proof) h = pair(h, p);
    if (h !== root) problems.push(`the stored proof for ${r.address} does not verify`);
  }

  const sum = rows.reduce((n, r) => n + r.amount, 0n);
  if (sum > BigInt(j.total)) problems.push(`the list pays out ${sum}, more than the round's ${j.total}`);

  console.log(`file       ${path}`);
  console.log(`holders    ${rows.length}`);
  console.log(`pays out   ${sum}  of ${j.total}`);
  console.log(`root       ${root}`);

  // AND, IF ASKED, AGAINST THE CHAIN RATHER THAN AGAINST THE FILE.
  //
  // Everything above compares the file to itself, which a fabricated file
  // satisfies just as well. This is the half that cannot be faked: the root,
  // the token and the funded total as the contract actually holds them.
  const at = arg('airdrop');
  const roundId = arg('round');
  if (at && roundId !== null) {
    const sel = keccak256(new TextEncoder().encode('rounds(uint256)')).slice(0, 10);
    const data = sel + BigInt(roundId).toString(16).padStart(64, '0');
    const res = await rpcCall(at, data);
    const [r] = decodeAbiParameters(
      [{
        type: 'tuple',
        components: [
          { name: 'token', type: 'address' }, { name: 'merkleRoot', type: 'bytes32' },
          { name: 'total', type: 'uint256' }, { name: 'claimed', type: 'uint256' },
          { name: 'deadline', type: 'uint64' }, { name: 'createdAt', type: 'uint64' },
          { name: 'swept', type: 'bool' }, { name: 'uri', type: 'string' },
        ],
      }],
      res,
    );
    console.log('');
    console.log(`on chain   round ${roundId} of ${at}`);
    console.log(`  root     ${r.merkleRoot}`);
    console.log(`  token    ${r.token}`);
    console.log(`  funded   ${r.total}   claimed ${r.claimed}`);
    console.log(`  uri      ${r.uri}`);
    if (r.merkleRoot.toLowerCase() !== root.toLowerCase()) {
      problems.push(`THE CHAIN'S ROOT IS ${r.merkleRoot}, NOT THIS LIST'S ${root}`);
    }
    if (sum > r.total) {
      problems.push(`the list pays ${sum} but the round is only funded with ${r.total}`);
    }
    // THE TOKEN. This was decoded, printed, and never compared to anything.
    //
    // AIRDROP.md tells strangers that running this command proves the on-chain
    // round matches the published list, and names the token as one of the
    // things it checks. It did not check it: the file could declare a payout in
    // GME while the round on chain paid out something worthless, and this
    // printed OK. That single command is the whole anti-rug story for the
    // round, so the one claim it makes that nobody can verify by eye is
    // exactly the one it has to actually make.
    const declared = j.payout && j.payout.token;
    if (!declared) {
      problems.push('the file declares no payout token, so there is nothing to check the round against');
    } else if (r.token.toLowerCase() !== declared.toLowerCase()) {
      problems.push(
        `THE ROUND PAYS ${r.token} BUT THIS FILE DECLARES ${declared}`
        + (j.payout.symbol ? ` (${j.payout.symbol})` : ''),
      );
    }
    if (j.token && r.token.toLowerCase() === j.token.toLowerCase()) {
      // Normal for a memecoin round, and the contract explicitly allows it. It
      // used to go into `problems`, which printed "DO NOT open a round against
      // this file" and exited 1 — so the one command we tell strangers to run
      // to prove this is not a scam returned a scam verdict on a correct round.
      console.log('  NOTE the payout token is the same as the snapshot token — check that is intended');
    }
  } else {
    console.log('');
    console.log('NOTE: checked the file against itself only. To check it against the');
    console.log('round the contract actually holds, add --airdrop <addr> --round <id>.');
  }

  if (problems.length) {
    console.log('');
    for (const p of problems) console.log('  BAD  ' + p);
    console.log('\nDO NOT open a round against this file.');
    process.exit(1);
  }
  console.log('');
  console.log('OK. Every leaf, every proof and the total all check out.');
  if (j.reproduceWith) {
    console.log('');
    console.log('That only proves the list hashes to the root, which a made-up list');
    console.log('also does. To prove it came off the chain, run this and compare:');
    console.log(`  ${j.reproduceWith}`);
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  if (cfg.total <= 0n) {
    console.error('--total is required: how much of the payout token to split, in wei.');
    process.exit(1);
  }
  const head0 = Number(await rpc('eth_blockNumber', []));
  const latest = cfg.toBlock !== null ? Number(cfg.toBlock) : head0;

  let blocksPerDay;
  if (cfg.blocksPerDay !== null) {
    blocksPerDay = Number(cfg.blocksPerDay);
  } else {
    const span = Math.min(10000, latest);
    const [a, b] = await Promise.all([
      rpc('eth_getBlockByNumber', ['0x' + latest.toString(16), false]),
      rpc('eth_getBlockByNumber', ['0x' + Math.max(0, latest - span).toString(16), false]),
    ]);
    const secs = (Number(a.timestamp) - Number(b.timestamp)) / (span || 1);
    blocksPerDay = Math.max(1, Math.round(86400 / (secs || 1)));
  }

  const fromBlock = cfg.fromBlock !== null
    ? Number(cfg.fromBlock)
    : (cfg.days > 0 ? Math.max(0, latest - cfg.days * blocksPerDay) : 0);

  console.error(`token      ${cfg.token}`);
  console.error(`window     blocks ${fromBlock}..${latest}  (${blocksPerDay} blocks/day)`);

  const transfers = await allTransfers(latest);
  const { weight, heldFor, bal } = weigh(transfers, fromBlock, latest);

  // EVERY BALANCE, ADDED UP, MUST BE THE SUPPLY.
  //
  // allTransfers halves its chunk when the endpoint errors, but an endpoint
  // that silently CAPS its results returns fewer logs and no error at all —
  // and a dropped Transfer corrupts every balance downstream while leaving the
  // round file perfectly self-consistent. $KEVIN is fixed at 1e27 and cannot
  // mint or burn, so this one line catches exactly that.
  const supply = BigInt(await rpc('eth_call', [{ to: cfg.token, data: '0x18160ddd' }, 'latest']));
  const replayed = [...bal.values()].reduce((n, v) => n + v, 0n);
  if (replayed !== supply) {
    console.error('');
    console.error(`MISMATCH: replaying the log gives ${replayed} but totalSupply() is ${supply}.`);
    console.error('Logs are missing — the RPC probably capped a range without erroring.');
    console.error('Re-run with a smaller --chunk. DO NOT publish this.');
    process.exit(1);
  }
  console.error(`supply     ${supply} reconciles against the replayed log`);

  const minBlocks = BigInt(Math.round(cfg.minHoldDays * blocksPerDay));
  let rows = [...weight.entries()]
    .filter(([a, w]) => w > 0n && !EXCLUDE.has(a))
    .filter(([a]) => (heldFor.get(a) ?? 0n) >= minBlocks)
    .map(([address, w]) => ({ address, weight: w, balance: bal.get(address) ?? 0n }))
    // Still holding, at the end of the window. Time weighting on its own would
    // still pay somebody who held a lot early and sold the whole lot before the
    // snapshot, which is the exact person a holder airdrop must not pay.
    .filter((r) => r.balance >= cfg.minBalance);
  console.error(`min-balance ${cfg.minBalance} leaves ${rows.length} addresses`);

  // EVERY remaining address is checked for bytecode. The hardcoded EXCLUDE list
  // above only catches contracts somebody thought of; this catches the ones
  // nobody did — a new router, an aggregator, a bridge, a vault. Tokens sent to
  // a contract that has no way to claim them are burnt by accident, and tokens
  // sent to a router are paid to whoever happens to use it next.
  const contracts = [];
  for (const r of rows) {
    const code = await rpc('eth_getCode', [r.address, 'latest']);
    // EIP-7702: an EOA that has signed a delegation carries `0xef0100` followed
    // by 20 bytes of address as its code. It still has a private key, it can
    // still sign, it can still claim — it is not a contract. Every modern
    // smart-account wallet flow sets this on an ordinary person's wallet, so
    // treating it as bytecode drops real holders and then tells them on the
    // claim page that they are a contract.
    const delegated = /^0xef0100[0-9a-fA-F]{40}$/i.test(code || '');
    if (code && code !== '0x' && !delegated) contracts.push(r.address);
    else if (delegated) console.error(`  keeping ${r.address} — EIP-7702 delegated EOA, not a contract`);
    await new Promise((res) => setTimeout(res, 40)); // the public RPC rate-limits
  }
  if (contracts.length) {
    console.error(`dropping ${contracts.length} CONTRACT address(es), none of which can claim:`);
    for (const a of contracts) console.error(`  ${a}`);
    const isContract = new Set(contracts);
    rows = rows.filter((r) => !isContract.has(r.address));
  } else {
    console.error('no contract addresses among the qualifiers');
  }

  const totalWeight = rows.reduce((n, r) => n + r.weight, 0n);
  if (totalWeight === 0n) {
    console.error('nobody qualifies. Nothing written.');
    process.exit(1);
  }
  for (const r of rows) r.amount = (cfg.total * r.weight) / totalWeight;
  rows = rows.filter((r) => r.amount > cfg.minPayout && r.amount > 0n);
  if (rows.length === 0) {
    console.error('nobody clears --min-payout. Nothing written.');
    process.exit(1);
  }
  // Biggest first, so the index order is stable and readable.
  rows.sort((a, b) => (b.amount === a.amount ? (a.address < b.address ? -1 : 1) : b.amount > a.amount ? 1 : -1));

  const leaves = rows.map((r, i) => leafOf(i, r.address, r.amount));
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];

  // The exact command that regenerates this file, declared BEFORE the object
  // that embeds it — a `const` referenced above its own declaration is a
  // temporal dead zone error, and it only ever fired once a run got far
  // enough to build the round file.
  //
  // Every knob that changes the output belongs in here. A round whose
  // reproduce command omits --min-balance regenerates a DIFFERENT list under
  // the default, so the root would not match and the one check that makes this
  // verifiable instead of trusted would fail for an honest run.
  const command = [
    'node tools/airdrop-snapshot.mjs',
    `--token ${cfg.token}`,
    `--total ${cfg.total}`,
    `--from-block ${fromBlock}`,
    `--to-block ${latest}`,
    `--blocks-per-day ${blocksPerDay}`,
    `--min-hold-days ${cfg.minHoldDays}`,
    `--min-balance ${cfg.minBalance}`,
    `--genesis-block ${cfg.genesisBlock}`,
    cfg.minPayout > 0n ? `--min-payout ${cfg.minPayout}` : '',
    // --exclude removes addresses, which renormalises every weight and changes
    // every amount. Leaving it out means a verifier following our own printed
    // instructions rebuilds a DIFFERENT list, gets a different root, and the
    // one check that makes this verifiable instead of trusted accuses an honest
    // round of fabricating its list.
    cfg.extraExclude ? `--exclude ${cfg.extraExclude}` : '',
  ].filter(Boolean).join(' ');

  const dust = cfg.total - rows.reduce((n, r) => n + r.amount, 0n);
  const out = {
    token: cfg.token,
    root,
    total: cfg.total.toString(),
    distributed: (cfg.total - dust).toString(),
    dust: dust.toString(),
    window: { fromBlock, toBlock: latest, days: cfg.days || null, blocksPerDay },
    minHoldDays: cfg.minHoldDays,
    holders: rows.length,
    excluded: [...EXCLUDE],
    minBalance: cfg.minBalance.toString(),
    contractsDropped: contracts,
    generatedFrom: 'Transfer log only.',
    // Filled from --airdrop/--round. Null means the round has nowhere to go
    // yet, and the claim page must refuse to build a transaction rather than
    // send one with an empty `to`.
    airdrop: cfg.airdrop,
    roundId: cfg.roundId,
    payout: cfg.payoutSymbol
      ? { token: cfg.payoutToken, symbol: cfg.payoutSymbol, decimals: cfg.payoutDecimals }
      : null,
    // Run this and you must get the same root. That is what turns "this list
    // hashes to this root" — which a fabricated list also satisfies — into
    // "this list came from the chain".
    reproduceWith: command,
    claims: Object.fromEntries(rows.map((r, i) => [r.address, {
      index: i,
      amount: r.amount.toString(),
      weight: r.weight.toString(),
      balance: r.balance.toString(),
      proof: proofFor(layers, i),
    }])),
  };

  const path = cfg.out || join(ROOT, 'airdrop', `round-${Date.now()}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(out, null, 2));

  console.error('');
  console.error(`holders    ${rows.length}`);
  console.error(`total      ${cfg.total}`);
  console.error(`dust       ${dust}  (rounding, stays in the contract and sweeps at the deadline)`);
  console.error(`root       ${root}`);
  console.error(`written    ${path}`);
  console.error('');
  console.error('Anybody can rebuild this exact file with:');
  console.error(`  ${command}`);
  console.error('');
  console.error('Publish it BEFORE opening the round. Then, from the owner, paste this');
  console.error('rather than retyping any of it — the numbers below are the ones the');
  console.error('list was actually built for, and a round funded with a different');
  console.error('number cannot pay its own list:');
  console.error('');
  const payout = cfg.payoutToken || '<PAYOUT_TOKEN>';
  const at = cfg.airdrop || '<AIRDROP>';
  console.error(`  cast send ${payout} "approve(address,uint256)" ${at} ${cfg.total}`);
  console.error(`  cast send ${at} "openRound(address,bytes32,uint256,uint64,string)" \\`);
  console.error(`    ${payout} ${root} ${cfg.total} <DEADLINE> "<WHERE YOU PUBLISHED IT>"`);
  console.error('');
  console.error('<DEADLINE> is a UNIX time in SECONDS, at least 7 days and at most 365 days');
  console.error('out. Pasting milliseconds there used to lock the unclaimed remainder in the');
  console.error('contract forever; the contract now refuses it, but check the number anyway:');
  console.error(`  date -d @<DEADLINE>     # e.g. ${Math.floor(Date.now() / 1000) + 30 * 86400} is 30 days from now`);
}

// Only when run directly. Importing this from a test must not start a run —
// the test imports the merkle and weighting functions to check them against
// the Solidity side.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const toVerify = arg('verify');
  const run = toVerify ? verify(toVerify) : main();
  run.catch((e) => { console.error('failed:', e.message); process.exit(1); });
}

export { leafOf, pair, buildTree, proofFor, weigh };
