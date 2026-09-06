// The JS Merkle tree and the Solidity verifier have to agree exactly, or every
// claim on chain reverts with BadProof and the whole airdrop is dead on
// arrival. This builds a tree and writes it to a fixture that
// contracts/test/KevinAirdrop.t.sol then claims against for real — so the two
// halves are checked against each other rather than each against its own idea
// of what a leaf is.
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, encodeAbiParameters, getAddress } from 'viem';
import { leafOf, pair, buildTree, proofFor, weigh } from '../airdrop-snapshot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ok = [];
const fail = [];
const show = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const check = (name, got, want) => {
  const g = show(got);
  const w = show(want);
  (g === w ? ok : fail).push(`${g === w ? 'ok  ' : 'FAIL'} ${name}${g === w ? '' : `: got ${g}, wanted ${w}`}`);
};

// --- the leaf must be what the contract computes ---------------------------
const A = getAddress('0x1111111111111111111111111111111111111111');
check('leaf is the double hash of abi.encode(index,account,amount)',
  leafOf(0, A, 5n),
  keccak256(keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], [0n, A, 5n]))));

// --- pairs must be sorted, the way OpenZeppelin hashes them ----------------
const x = '0x' + 'aa'.repeat(32);
const y = '0x' + 'bb'.repeat(32);
check('pair hashing is commutative', pair(x, y), pair(y, x));

// --- proofs verify against the root, for every leaf, at every size ----------
function verify(leaf, proof, root) {
  let h = leaf;
  for (const p of proof) h = pair(h, p);
  return h === root;
}
for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 16, 33, 100]) {
  const rows = Array.from({ length: n }, (_, i) => ({
    address: getAddress('0x' + (i + 1).toString(16).padStart(40, '0')),
    amount: BigInt((i + 1) * 1e9),
  }));
  const leaves = rows.map((r, i) => leafOf(i, r.address, r.amount));
  const layers = buildTree(leaves);
  const root = layers[layers.length - 1][0];
  const allGood = rows.every((r, i) => verify(leaves[i], proofFor(layers, i), root));
  check(`every proof verifies with ${n} leaves`, allGood, true);
  // And a leaf that is not in the tree must not verify.
  const bogus = leafOf(0, getAddress('0xdead000000000000000000000000000000000000'), 1n);
  check(`a leaf outside the tree fails with ${n} leaves`, verify(bogus, proofFor(layers, 0), root), false);
}

// --- the weighting is time-weighted, not a snapshot -------------------------
{
  const Z = '0x0000000000000000000000000000000000000000';
  const early = '0x00000000000000000000000000000000000000e1';
  const late = '0x00000000000000000000000000000000000000e2';
  // Both end holding 100. One held it for the whole window, one for a tenth.
  const { weight } = weigh([
    { block: 0, from: Z, to: early, value: 100n },
    { block: 90, from: Z, to: late, value: 100n },
  ], 0, 100);
  check('holding all window beats holding a tenth of it', weight.get(early) > weight.get(late) * 9n, true);
  check('the late buyer is not zero, just small', weight.get(late) > 0n, true);
}
{
  // THE LIMIT OF TIME WEIGHTING, WRITTEN DOWN.
  //
  // A sniper who buys 100x the balance for 1/100th of the window scores
  // EXACTLY the same as somebody who held the whole way: balance x time is the
  // same product. So time weighting alone does not stop a well funded sniper,
  // it only makes them pay 100x for the privilege. Anyone who assumes
  // otherwise will size the minimum-hold filter wrongly.
  //
  // The filter is what actually excludes them, which is why min-hold-days
  // defaults to a day rather than to zero.
  const Z = '0x0000000000000000000000000000000000000000';
  const sniper = '0x00000000000000000000000000000000000000ff';
  const holder = '0x00000000000000000000000000000000000000aa';
  const { weight, heldFor, bal } = weigh([
    { block: 0, from: Z, to: holder, value: 10n },
    { block: 99, from: Z, to: sniper, value: 1000n },
  ], 0, 100);
  check('a snapshot would hand the sniper 100x the holder', bal.get(sniper) > bal.get(holder) * 99n, true);
  check('time weighting alone only levels them, it does not beat them',
    weight.get(sniper), weight.get(holder));
  check('but the sniper held for one block', heldFor.get(sniper), 1n);
  check('and the holder for the whole window', heldFor.get(holder), 100n);
  check('so a min-hold of ten blocks excludes the sniper and keeps the holder',
    [heldFor.get(sniper) >= 10n, heldFor.get(holder) >= 10n], [false, true]);
}
{
  // Selling mid-window stops earning from the moment of the sale.
  const Z = '0x0000000000000000000000000000000000000000';
  const held = '0x00000000000000000000000000000000000000b1';
  const sold = '0x00000000000000000000000000000000000000b2';
  const { weight } = weigh([
    { block: 0, from: Z, to: held, value: 100n },
    { block: 0, from: Z, to: sold, value: 100n },
    { block: 50, from: sold, to: held, value: 100n },
  ], 0, 100);
  check('selling halfway earns half', weight.get(sold), 100n * 50n);
  check('and the buyer earns the rest', weight.get(held), 100n * 100n + 100n * 50n);
}

// --- write the fixture the Solidity test claims against ---------------------
const rows = [
  { address: getAddress('0x00000000000000000000000000000000000000a1'), amount: 1_000n * 10n ** 18n },
  { address: getAddress('0x00000000000000000000000000000000000000b2'), amount: 250n * 10n ** 18n },
  { address: getAddress('0x00000000000000000000000000000000000000c3'), amount: 125n * 10n ** 18n },
  { address: getAddress('0x00000000000000000000000000000000000000d4'), amount: 1n },
  { address: getAddress('0x00000000000000000000000000000000000000e5'), amount: 999n * 10n ** 18n },
];
const leaves = rows.map((r, i) => leafOf(i, r.address, r.amount));
const layers = buildTree(leaves);
const fixture = {
  note: 'Generated by tools/test/airdrop.test.mjs. Claimed for real in KevinAirdrop.t.sol.',
  root: layers[layers.length - 1][0],
  total: '0x' + rows.reduce((n, r) => n + r.amount, 0n).toString(16),
  accounts: rows.map((r) => r.address),
  // Hex, because forge's parseJsonUintArray is unambiguous about hex and these
  // numbers are far past what JSON can hold as a number.
  amounts: rows.map((r) => '0x' + r.amount.toString(16)),
  amountsDecimal: rows.map((r) => r.amount.toString()),
  proofs: rows.map((_, i) => proofFor(layers, i)),
};
await mkdir(join(ROOT, 'contracts/test/fixtures'), { recursive: true });
await writeFile(join(ROOT, 'contracts/test/fixtures/airdrop.json'), JSON.stringify(fixture, null, 2));
check('fixture has a root', /^0x[0-9a-f]{64}$/.test(fixture.root), true);

for (const l of [...ok, ...fail]) console.log('  ' + l);
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
