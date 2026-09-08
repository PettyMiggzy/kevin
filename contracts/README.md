# KEVIN CONTRACTS

Three contracts. **None of them are deployed.** There is no address for any of
this on Robinhood Chain or anywhere else, and the only broadcast records in
this repo are chain `31337` — a local anvil. Say "built", never "live".

118 tests, all passing.

```
forge build
forge test
```

---

## What is here

### `src/KevinAirdrop.sol` — 294 lines, 31 tests

Pays a token out to $KEVIN holders against a published Merkle root. Built for
the GME the pools earn going back to the people who held.

**Why a root and not a loop.** "Airdrop to everyone who held" is a loop over an
unbounded list. It does not fit in a block, and it gets more expensive the more
successful the token is. A root is one storage word whether there are fifty
holders or fifty thousand, holders pay their own claim gas, and the full list
is published so anybody can rebuild the root and check their own row — a
stronger guarantee than trusting a spreadsheet nobody outside the team sees.

Rounds are separate pots. A round can never spend another round's money, which
three of its tests exist specifically to prove: they started life as an audit's
demonstration that it could, and are kept inverted so they must keep failing.

A deadline is bounded at both ends — at least `MIN_WINDOW` (7 days) and at most
`MAX_WINDOW` (365 days). The ceiling is not decoration: `extendDeadline` only
ever moves a deadline later and `sweepExpired` needs it to pass, so a
millisecond timestamp pasted where seconds belong used to lock the unclaimed
remainder until roughly the year 56,000.

The list generator and verifier is `tools/airdrop-snapshot.mjs`. The claim page
is `claim/`.

### `src/KevinFloorV4.sol` — 779 lines, 61 tests

Sells $KEVIN into strength and buys it back into weakness, against a floor the
pool itself refuses to cross.

**The one idea it is built on.** Uniswap v4's swap takes a `sqrtPriceLimitX96`,
and the pool stops filling when the price reaches it — not reverts, *stops*,
having filled what fit and consumed only that much of the input. So "sell into
buy pressure but never wreck the chart" is not a heuristic and does not depend
on a keeper guessing a size. Offer the pool more than you think it can take
with the limit set at the floor, and it sells exactly as much as fits above the
floor and hands the rest back.

### `src/KevinLock.sol` — 276 lines, 24 tests

Holds the treasury's bag and can only let it out at a published rate, through
the floor keeper, which cannot sell below the floor.

**What it is actually for.** A large holder with a vesting schedule is the
single most bearish fact about a young token, and it is bearish *before they
sell anything*. Every buyer can see the wallet, everyone knows roughly when the
unlocks land, and the rational move for all of them is to sell into that
wallet's shadow first. You do not have to dump to be dumped on; you only have
to be able to.

---

## Files

```
src/KevinAirdrop.sol            merkle claim distributor
src/KevinFloorV4.sol            the floor keeper
src/KevinLock.sol               the treasury lock

script/DeployAirdrop.s.sol      deploy the distributor
script/DeployFloorV4.s.sol      deploy the floor keeper
script/DeployLock.s.sol         deploy the lock
script/LocalFloor.s.sol         floor + lock, against a local anvil
script/LocalPump.s.sol          drive a local pool, for eyeballing behaviour
script/Preflight.s.sol          read a live pool's state before pointing anything at it

test/                           118 tests
test/fixtures/airdrop.json      a real round, used by both the Solidity and JS sides
```

---

## Deploy order, when there is one

Nothing here is deployed and nothing should be until somebody has decided it
should be. When that happens, the order that works:

1. **Preflight.** `forge script script/Preflight.s.sol` against the real pool
   first. It reads the live state and prints it. Deploying a floor keeper
   against a pool whose key you guessed is how you fund somebody else's
   arbitrage.
2. **KevinLock**, then **KevinFloorV4** pointed at it — the lock takes the
   keeper's address, so the keeper exists first in any ordering that is not
   circular; read `LocalFloor.s.sol`, which does the whole dance locally.
3. **KevinAirdrop** is independent of both. Deploy it, fund a round, and only
   then fill `airdrop` and `roundId` in `claim/round.json`. Until that file has
   a real address the claim page refuses to build a transaction, which is
   deliberate: a claim sent with no `to` is a contract deployment, and every
   claimant would have paid gas to deploy their own calldata.

---

## Security

**What has not been done.** No third-party audit. No formal verification. No
bug bounty. The tests include attacks written by trying to break these on
purpose, and three of them are audit findings kept as tests, but that is not
the same thing as an audit and must not be described as one.

**What an owner can still do.** Open a round with any root they like, including
one that pays themselves — which is why the list is published before the round
is opened and why `tools/airdrop-snapshot.mjs --verify` exists and is
advertised. Set the floor. Move the lock's rate within its own bounds. Read
each contract's own header for the exact list; none of them can take a funded
round's money back before its deadline.

**What an owner cannot do.** Mint. Pause. Blacklist. Take a claimant's claim.
Sell below the floor through the keeper. Pull a deadline in.

**If you find something**, say so in the Telegram group or open an issue.
Nothing here is deployed, so there is nothing at risk yet and everything to
gain from hearing it early.

---

## What was removed

`KevinStaking` and its commitment layer used to live here — 1,180 lines and 111
tests. It took a `KEVIN'S CREW` ERC-721 in its constructor, and that collection
does not exist: there is art and a trait manifest in `assets/crew/`, but no NFT
contract, no mint, and no date for one. A contract that cannot be deployed
without a dependency nobody has built is not part of "what is built", so it is
out of the tree rather than sitting in it inflating a number.

It is in the git history if it is ever wanted back.
