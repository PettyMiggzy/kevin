# KEVIN AIRDROP

> The GME the pools earn, going back to people who held $KEVIN — weighted by
> how much and how long, against a list anybody can check.

Two halves. `tools/airdrop-snapshot.mjs` decides who gets what and publishes it.
`KevinAirdrop.sol` holds the money and pays against a Merkle root.

---

## What "held for a while, weighted by holdings" actually means

For every address, over a block window: **balance × time held**, summed. Then
each address's share of the total.

That is one number that carries both halves of what was asked for. Somebody
holding a lot for an hour and somebody holding a little for a month can score
the same; somebody who bought the block before the snapshot scores almost
nothing.

**Time weighting alone does NOT stop a funded sniper**, and it is worth being
precise about that rather than assuming it does. A wallet holding 100× the
balance for 1/100th of the window scores *exactly the same* as one that held
the whole way — the product is identical. There is a test that asserts this
(`tools/test/airdrop.test.mjs`), because anyone who assumes otherwise will set
the next parameter wrongly.

The parameter that actually excludes them is **`--min-hold-days`**, which drops
any address that did not hold for that long, whatever its weight. It defaults
to 1. Set it against how long the window is, not by feel.

## What is excluded, and why it matters more than it sounds

The pools hold most of the float. The v4 `PoolManager` holds every pool's
liquidity on the whole chain. The launchpad's contracts hold what has not
vested. Paying any of them is paying yourself and calling it a community
airdrop, and it is the easiest thing to get wrong here because those addresses
look exactly like large holders in the Transfer log.

The list is in the tool and printed into every round file. Add more with
`--exclude 0x...,0x...`. **Once `KevinLock` and `KevinFloorV4` are deployed,
add them too** — they hold the treasury's own tokens.

## Running one

```bash
# 1. build the list
node tools/airdrop-snapshot.mjs --total 1000000000000000000000 --days 14 --min-hold-days 3

# 2. check it, with the same tool anybody else will use
node tools/airdrop-snapshot.mjs --verify airdrop/round-<n>.json

# 3. PUBLISH that file. Then, from the owner:
cast send <airdrop> "openRound(address,bytes32,uint256,uint64,string)" \
  <gme> <root> <amount> <deadline> "<where the file is>"
```

**Publish before opening, not after.** The root is fixed the moment the round
exists and there is no `setRoot` — so if the published file and the root
disagree, the file is the thing that was wrong, and everybody can see it.

## What the owner cannot do

| | |
|---|---|
| change a live round's list | there is no `setRoot`, and no cancel |
| take the money back early | `sweepExpired` only works after the deadline |
| shorten the claim window | `extendDeadline` moves it later only |
| open a round it has not funded | `openRound` pulls the tokens in the same call |
| open a round nobody could claim in | `MIN_WINDOW` is 7 days |
| reach into another round's money | `sweepExpired` is bounded by that round's own unclaimed remainder |

That last one has a test (`test_sweepingOneRoundCannotTakeAnothersMoney`),
because rounds share a contract but must not share a balance — otherwise
letting an old round lapse would be a way to end a live one early.

## What is trusted, and what is checked

**Checked by anyone:** the list, the root, every proof, and the total. Run
`--verify` on the published file and compare its root to the one the contract
stores. A file with a doctored amount fails on three separate grounds — the
root, the proofs, and the sum.

**Trusted:** that the published file is the one the root was built from, and
that the window, `--min-hold-days` and the exclusion list were chosen before
the data was looked at rather than after. Nothing on chain binds the `uri` to
the root, and nothing binds the parameters at all.

**So publish the parameters with the round, not just the file.** They are the
part nobody can check, which is exactly why saying them out loud in advance is
worth something.

## Tests

22 Solidity tests and 34 in JS. The important one is
`test_everyLeafInTheOffChainTreeClaimsOnChain`: the fixture it claims against is
built by the *same code* that will build the real list, so the JS tree and the
Solidity verifier are checked against each other rather than each against its
own idea of a leaf. If they disagreed by one hashing decision — sorted pairs,
double-hashed leaves, the exact `abi.encode` — every claim would revert with
the tokens already sent.
