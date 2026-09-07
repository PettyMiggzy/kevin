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
  out: arg('out', null),
  chunk: Number(arg('chunk', '9000')),
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

async function rpc(method, params) {
  const r = await fetch(cfg.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const hexToBig = (h) => BigInt(h);
const addrOf = (topic) => getAddress('0x' + topic.slice(26));

/** Every Transfer the token has ever emitted, oldest first. */
async function allTransfers(latest) {
  const out = [];
  let from = 0;
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
    if (j.token && r.token.toLowerCase() === j.token.toLowerCase()) {
      problems.push('the payout token is the same as the snapshot token — check that is intended');
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
    .map(([address, w]) => ({ address, weight: w, balance: bal.get(address) ?? 0n }));

  const totalWeight = rows.reduce((n, r) => n + r.weight, 0n);
  if (totalWeight === 0n) {
    console.error('nobody qualifies. Nothing written.');
    process.exit(1);
  }
  for (const r of rows) r.amount = (cfg.total * r.weight) / totalWeight;
  rows = rows.filter((r) => r.amount > cfg.minPayout && r.amount > 0n);
  // Biggest first, so the index order is stable and readable.
  rows.sort((a, b) => (b.amount === a.amount ? (a.address < b.address ? -1 : 1) : b.amount > a.amount ? 1 : -1));

  const leaves = rows.map((r, i) => leafOf(i, r.address, r.amount));
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];

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
    generatedFrom: 'Transfer log only.',
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

  // The exact command that regenerates this file. Anybody can run it.
  const command = [
    'node tools/airdrop-snapshot.mjs',
    `--token ${cfg.token}`,
    `--total ${cfg.total}`,
    `--from-block ${fromBlock}`,
    `--to-block ${latest}`,
    `--blocks-per-day ${blocksPerDay}`,
    `--min-hold-days ${cfg.minHoldDays}`,
    cfg.minPayout > 0n ? `--min-payout ${cfg.minPayout}` : '',
  ].filter(Boolean).join(' ');

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
  console.error(`  cast send <PAYOUT_TOKEN> "approve(address,uint256)" <AIRDROP> ${cfg.total}`);
  console.error(`  cast send <AIRDROP> "openRound(address,bytes32,uint256,uint64,string)" \\`);
  console.error(`    <PAYOUT_TOKEN> ${root} ${cfg.total} <DEADLINE> "<WHERE YOU PUBLISHED IT>"`);
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
