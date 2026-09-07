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

# 3. PUBLISH that file. Then paste the cast commands step 1 printed —
#    do not retype the numbers.
```

**Do not hand-type the total.** Step 1 prints the exact `approve` and
`openRound` calls carrying the root and the total the list was actually built
for. A round funded with a different number than its list adds up to cannot pay
its own list, and with one signer there is nobody between "typed 9000 instead of
10000" and a holder whose claim reverts.

**Publish before opening, not after.** The root is fixed the moment the round
exists and there is no `setRoot` — so if the published file and the root
disagree, the file is the thing that was wrong, and everybody can see it.

Then anyone can check it against the chain rather than against itself:

```bash
node tools/airdrop-snapshot.mjs --verify round-<n>.json --airdrop <addr> --round <id>
```

## What the owner cannot do

| | |
|---|---|
| change a live round's list | there is no `setRoot`, and no cancel |
| take the money back early | `sweepExpired` only works after the deadline |
| shorten the claim window | `extendDeadline` moves it later only |
| open a round it has not funded | `openRound` pulls the tokens in the same call |
| open a round nobody could claim in | `MIN_WINDOW` is 7 days |
| reach into another round's money | every claim is bounded by its own round's funding, and `sweepExpired` by its own remainder |
| reopen a round it already swept | a swept round is closed forever; `extendDeadline` refuses it |

## The bug an audit found here

The last two rows were not true when this was written, and it was the whole
ballgame.

Rounds of the same token share one contract balance, and **a Merkle root
commits to a list but not to a sum**. `claim` had no bound against its round's
funding — so a round whose leaves added up to more than it held paid the
difference out of its neighbours, and an honest holder of a fully funded round
later found their claim reverting on money that was not there. Once
`claimed > total`, `remaining()` and `sweepExpired()` panicked on the underflow
permanently, so the round's leftovers were unrecoverable too.

Three things made that worse than a typo:

- **A fee-on-transfer payout token manufactures it.** `total` records what
  arrived, which is less than the list was built for. No operator error needed.
- **It broke the contract's central promise.** The owner could open a one-wei
  round with a root paying themselves, and take the whole contract balance in
  the same block — so "a funded round is irrevocable" was simply untrue.
- **`extendDeadline` reopened a swept round.** Its bitmap still held whatever it
  held, so pushing the deadline forward re-paid its entire list out of a live
  round. One transaction that reads exactly like the benign "give people
  longer" the function is for.

Fixed with `if (r.claimed + amount > r.total) revert Overdrawn()` and a `swept`
flag. `test/AirdropOverdraw.t.sol` is the audit's own proof-of-concept, kept and
inverted: each test now asserts the round fails on its own last claim and takes
nothing from anybody.

## What is trusted, and what is checked

**Checked by anyone.** Every round file records the exact command that
regenerates it — token, block window, blocks-per-day, min-hold-days, total. Run
it and you must get the same root.

That distinction is the whole thing. `--verify` on its own proves *this list
hashes to this root*, which a **fabricated list satisfies just as well**. It is
re-running the command from the recorded window that proves the list came off
the Transfer log at all. That is why the window is an input (`--from-block`,
`--to-block`, `--blocks-per-day`) and not just something the tool picked from
wherever the chain head happened to be — anchored to a live head, nobody
outside the team could ever reproduce the root.

`--verify --airdrop <addr> --round <id>` then reads the round the contract
actually holds and compares the root, the token and the funded total. Publishing
one list while opening a round against a different root fails there, loudly.

The snapshot also refuses to write a file at all unless every replayed balance
adds up to `totalSupply()`. `eth_getLogs` on a public endpoint can silently cap
its results, and a single dropped Transfer corrupts every balance downstream
while leaving the file perfectly self-consistent — the worst kind of failure,
because it looks like it worked.

**Still trusted:** that the window and `--min-hold-days` were chosen before the
data was looked at rather than after, and that the exclusion list is complete.
Announce those before you run it. They are the part nobody can check, which is
exactly why saying them out loud in advance is worth something.

## Tests

22 Solidity tests and 34 in JS. The important one is
`test_everyLeafInTheOffChainTreeClaimsOnChain`: the fixture it claims against is
built by the *same code* that will build the real list, so the JS tree and the
Solidity verifier are checked against each other rather than each against its
own idea of a leaf. If they disagreed by one hashing decision — sorted pairs,
double-hashed leaves, the exact `abi.encode` — every claim would revert with
the tokens already sent.
