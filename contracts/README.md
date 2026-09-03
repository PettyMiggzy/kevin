# KEVIN STAKING

> I put the tokens in the machine. The machine gives me more tokens later. I do
> not know why this works. It is on the whiteboard.

Solidity contracts for the $KEVIN staking pool. One contract, `KevinStaking`,
plus the scripts that deploy and configure it.

---

## What it does

Holders stake $KEVIN and earn $KEVIN out of a pot the owner funds. Staking a
KEVIN'S CREW NFT alongside your tokens raises the weight your stake carries in
the pool — it does not create new rewards, it moves a bigger slice of a fixed
pot to you and a smaller slice to everyone else.

- **Rewards** use the Synthetix accumulator (`rewardPerTokenStored` /
  `userRewardPerTokenPaid`). Nothing ever iterates over stakers, so cost per
  action does not grow with the number of people in the pool.
- **Boost** comes from NFTs. Each token id has a tier; each tier is worth a
  number of basis points; a staker's boost is the sum of their staked NFTs'
  tiers, capped at `MAX_BOOST_BPS` = 20 000 bps (3x effective balance).
- **Emissions** run over a fixed period. The owner can start a new period once
  the last one has ended, or top up the running one — but topping up cannot move
  the end date, and starting a new one cannot happen early. There is no path
  that silently lengthens a period stakers have already priced in.
- **Principal always comes out.** There is a pause, it blocks deposits only, and
  no exit path reads it.

### Files

```
src/KevinStaking.sol            the contract
script/Deploy.s.sol             step 1 - put it on chain
script/derive-tiers.mjs         step 2 - traits -> tiers, off chain, reproducible
script/Configure.s.sol          step 3 - publish the tier table
test/KevinStaking.t.sol         63 unit + fuzz tests
test/KevinStaking.invariant.t.sol   7 invariants over random action sequences
test/Configure.t.sol            3 tests that actually run the deploy script
test/mocks/                     mock ERC-20, ERC-721, and a re-entering token
test/fixtures/tiers.json        the plan derived from the current 20 minted
```

Deployed size: 11 400 bytes runtime, well under the 24 576 limit.

---

## The boost design, and why it is this one

The requirement was that the multiplier comes from NFT traits and that the
mapping stays owner-settable after deploy, because the crew grows. Two shapes
satisfy that. This contract uses **tokenId → tier → bps**, not
**(traitCategory, traitValue) → bps**.

The reason is that neither shape gets traits for free. KEVIN'S CREW is
trait-layered — 8 layers, 8 128 512 reachable combinations, append-only tables —
and the traits live in `assets/crew/crew.json`, off chain. The ERC-721 does not
expose them. So under either shape the owner has to publish per-token data on
chain. Given that:

| | storage per token | cold SLOADs to read one NFT's boost | 5 NFTs |
|---|---|---|---|
| trait pairs | 8 words | 8 (traits) + up to 8 (table) | ~168k gas |
| **tiers** | **1 word** | **2** | **~21k gas** |

Tiers are ~8x cheaper to publish and ~8x cheaper to read, and they do not get
worse when a ninth trait layer is added next month. The trait decision still
happens — it happens in `script/derive-tiers.mjs`, which reads the manifest,
scores each member on a fixed points-per-trait table, and buckets the score into
a tier. That script is in this repo so a holder can re-run it and compare its
output against what the contract actually stores. What stays settable on chain,
which is the actual requirement, is `setTierBoost`: what a tier is worth can be
retuned any time, and a brand new trait just means a new tier id. **No trait
name appears anywhere in the contract.**

The cost of choosing this is stated plainly in the security section below: the
tier assignment is a claim by the owner, and the chain cannot check it.

### When a boost change takes effect

The accumulator is only sound while `totalEffectiveSupply` equals the sum of
every `effectiveBalanceOf`. Applying a retuned tier to everybody at once would
mean walking every staker, which is the thing this pattern exists to avoid.

So a boost change is **not retroactive**. It lands on an account the next time
that account is synced: any stake, withdraw or claim, or a call to
`syncBoost(account)`, which **anyone may call for anyone**. Both sides of the
invariant move in the same transaction, so the accounting is exact at every
block. Rewards already earned are never re-priced.

This means a UI has to call `syncBoost` after a retune, or holders keep earning
at their old boost until they next touch their position. It also means a boost
*cut* can be forced onto you immediately by any stranger. Those two are the same
mechanism and it is symmetric on purpose.

---

## Deploy order

Prerequisites: the $KEVIN ERC-20 and the KEVIN'S CREW ERC-721 are deployed and
you have both addresses. Ideally `STAKING_OWNER` is a multisig — read the owner
powers below before deciding it is an EOA.

```sh
export PRIVATE_KEY=0x...
export KEVIN_TOKEN=0x...        # $KEVIN ERC-20
export CREW_NFT=0x...           # KEVIN'S CREW ERC-721
export STAKING_OWNER=0x...      # who will own the pool
export REWARDS_DURATION=2592000 # optional, default 30 days
export ROBINHOOD_RPC_URL=https://...
```

**1. Deploy the pool.**

```sh
forge script script/Deploy.s.sol --rpc-url robinhood --broadcast
```

Constructor is `(stakingToken, rewardToken, crew, rewardsDuration, owner)`. The
script passes `KEVIN_TOKEN` for both token slots — stake $KEVIN, earn $KEVIN.
Ownership is set in the constructor, so there is no window where the deployer
owns it.

**2. Derive the tier plan from the manifest.**

```sh
node script/derive-tiers.mjs --out tiers.json
```

Prints the score and reasoning for every minted crew member and writes the plan.
Commit `tiers.json` next to the deploy record — it is the receipt for what the
next step publishes.

**3. Publish the tier table.** Run as the **owner**, not the deployer.

```sh
STAKING=0x... TIERS_JSON=tiers.json \
  forge script script/Configure.s.sol --rpc-url robinhood --broadcast
```

This calls `setTierBoost(tier, bps, label)` for each tier, then
`setTokenTiers(tokenIds, tier)` for each tier's token ids.

**4. Move the reward tokens into the pool.** A plain ERC-20 transfer. The
contract does not pull them and `notifyRewardAmount` will refuse to start a
period it cannot pay.

```sh
cast send $KEVIN_TOKEN "transfer(address,uint256)" $STAKING 5000000000000000000000000 \
  --rpc-url robinhood --private-key $PRIVATE_KEY
```

**5. Start emissions.** Owner only.

```sh
cast call $STAKING "freeRewardBalance()(uint256)" --rpc-url robinhood   # check first
cast send $STAKING "notifyRewardAmount(uint256)" 5000000000000000000000000 \
  --rpc-url robinhood --private-key $PRIVATE_KEY
```

**6. Verify.**

```sh
cast call $STAKING "periodFinish()(uint256)"     --rpc-url robinhood
cast call $STAKING "rewardRate()(uint256)"       --rpc-url robinhood
cast call $STAKING "tierBoostBps(uint16)(uint16)" 1 --rpc-url robinhood
```

### What the owner must call before it works

| If this is not called | What happens |
|---|---|
| `setTierBoost` | Every tier is worth 0 bps. NFTs stake fine and boost nothing. |
| `setTokenTiers` | Every token is tier 0, which is permanently worth 0. Same result. |
| ERC-20 transfer in, then `notifyRewardAmount` | Nothing accrues. Staking works; `earned()` stays 0 forever. |

None of these are failure states. The pool is never *wrong* before it is
configured, only plain — an untiered NFT is inert rather than accidentally
valuable, which is the safe default when the collection keeps growing.

### Ongoing, as the crew grows

New mints are tier 0 until someone tiers them.

```sh
node script/derive-tiers.mjs --out tiers.json     # re-derive, thresholds are fixed
cast send $STAKING "setTokenTiers(uint256[],uint16)" "[21,22,23]" 2 ...
```

Because `derive-tiers.mjs` scores fixed points per trait and buckets on fixed
thresholds — never percentiles — minting more crew members never re-tiers an
existing one. That mirrors the manifest's own rule that minted traits are
frozen. If a genuinely new trait appears, add a line to `POINTS`, and if it
needs a new tier, `setTierBoost` it before assigning any token to it.

---

## Building and testing

```sh
forge build
forge test
forge test --match-path test/KevinStaking.invariant.t.sol -vv
```

73 tests, all passing at the time of writing: 63 unit and fuzz tests, 7
invariants over randomised action sequences, 3 tests that execute the real
configure script against the real derived plan.

Coverage of the things that matter:

- stake / withdraw / exit, and the boundary cases (zero, over-balance, dust)
- reward accrual over time, linear and to the wei
- two and three stakers splitting emissions by weight, including a late arrival
- boost changing mid-stake, three ways: the owner retunes a tier up, the owner
  cuts a tier to zero, the holder stakes an NFT part way through
- the cap actually capping a stack of three max-tier NFTs
- reward-period expiry, and that a second period starts cleanly after the first
- that a running period cannot be restarted, and a top-up cannot move its end
- that staked principal cannot be spent as rewards even though it is the same
  token, and that rewards already owed cannot fund the next period
- emergency withdraw: principal out, rewards forfeited, other stakers unaffected
- reentrancy, four ways, using an ERC-777-shaped token that calls back into the
  pool mid-transfer — with an assertion that the attack actually fired, so the
  test cannot pass by silently not attacking
- withdrawals, claims and NFT withdrawals all working while deposits are paused
- swap-and-pop NFT removal from the middle of a list, then draining the rest
- that the owner cannot recover principal or committed rewards

**Dependencies.** `lib/forge-std` and `lib/openzeppelin-contracts` (v5.4.0) are
vendored into the repo rather than installed as git submodules, because the
environment this was built in could not reach github.com. On a normal checkout
the equivalent is:

```sh
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts@v5.4.0
```

`remappings.txt` points at `lib/` either way, so nothing else changes. If your
environment cannot reach github.com either, the Foundry binaries are also on npm
as `@foundry-rs/forge-linux-amd64`, and forge-std ships through the Soldeer
registry (`forge soldeer install forge-std~1.16.2`) rather than GitHub.

**`evm_version = "paris"`** in `foundry.toml` is deliberate and conservative:
Robinhood Chain (4663) is new and this repo has not confirmed which fork it runs.
Paris emits no PUSH0 and no MCOPY, so the bytecode runs on anything post-Merge.
Raise it after checking the chain, not before.

---

## Security

Read this part.

### What has not been done

- **No audit.** No third party has looked at this. No formal verification. No
  bug bounty.
- **Never deployed.** Not to Robinhood Chain, not to a testnet, not to anywhere.
  Every line of evidence in this repo comes from the Foundry EVM.
- **Never run against the real tokens.** The tests use mock ERC-20 and ERC-721
  contracts. The real $KEVIN and the real KEVIN'S CREW contracts are not in this
  repo and have not been read. If either does anything non-standard, the
  assumptions below are wrong.
- **Chain assumptions unverified.** `evm_version = "paris"` is a cautious guess,
  not a checked fact about chain 4663. Gas costs, opcode support and reorg
  behaviour on that chain have not been examined.
- **`script/Deploy.s.sol` has never broadcast anything.** It compiles.
  `script/Configure.s.sol` is exercised in tests, but only against a mock pool
  in the Foundry EVM.
- Tests are written by the same party that wrote the contract, which is the
  weakest form of assurance there is.

### What an owner can still do to holders

The owner is not a spectator. Assume the key is a live risk and put it behind a
multisig.

1. **Set every tier boost to zero.** Your NFT stops boosting. Any stranger can
   then force that onto your position with `syncBoost`.
2. **Re-tier your specific token** to a worse tier, or to tier 0.
3. **Never fund another period.** Emissions simply stop when `periodFinish`
   passes. Nothing in the contract obliges the owner to fund anything, ever.
4. **Pause deposits indefinitely.** Nobody new can stake and nobody can add to a
   position. Existing holders can always leave — the pause does not reach any
   exit path — but the pool can be frozen shut.
5. **Sweep the free reward balance** with `recoverERC20`. "Free" excludes staked
   principal and rewards already owed, but it *includes* rewards forfeited by
   people who used `emergencyWithdraw`, and rewards that accrued while the pool
   was empty. Those can be taken rather than re-emitted.
6. **Raise the emission rate mid-period** with `topUpCurrentPeriod`, changing
   everyone's yield without notice. Only upwards, and `periodFinish` cannot move.
7. **Move any ERC-721 sitting in the contract with no recorded depositor**, via
   `rescueERC721`. A staked NFT is refused by the function, not by policy.
8. **Renounce ownership**, freezing the tier table and ending emissions
   permanently. Withdrawals and claims keep working after that.
9. **Lie about tiers.** This is the real one. The contract cannot check that
   token #4 has a Crown; it stores whatever the owner says. Nothing stops an
   owner assigning tier 5 to a wallet they control. The mitigation is that
   `derive-tiers.mjs` is public and deterministic, so anyone can re-run it and
   compare — but it is a social mitigation, not an on-chain one.

### What an owner cannot do

Stated as design intent, not as a promise about unfound bugs:

- **Take staked principal.** `recoverERC20` subtracts `totalStaked` before
  checking its limit, including when the staking and reward token are the same
  token, and it is the only path that moves an ERC-20 out to the owner.
  `rescueERC721` explicitly refuses `stakingToken` and `rewardToken`, because
  `transferFrom(address,address,uint256)` is the *same* 4-byte selector on
  ERC-721 and ERC-20: without that guard, calling `rescueERC721` on the staking
  token with an amount in the `tokenId` slot executes
  `stakingToken.transferFrom(address(this), to, amount)`, which succeeds on any
  ERC-20 that skips the allowance check when `from == msg.sender`
  (DSToken/DAI-shaped tokens and many others) and drains 100% of principal.
  This was a live hole in the first cut of this contract; the guard and a
  regression test for it are in `test/Adversarial.t.sol`.
- **Take rewards already owed.** `rewardsCommitted` is subtracted the same way.
- **Take a staked NFT.** `rescueERC721` refuses any id with a depositor.
- **Block a withdrawal, a claim, or an emergency withdrawal.** The pause flag is
  read by `stake` and `stakeNfts` and by nothing else.
- **Raise the boost cap.** `MAX_BOOST_BPS` is a `constant`. The worst dilution an
  unboosted staker can suffer is fixed at deploy time.
- **Mint.** There is no mint function.
- **Extend a running period's end date.**

### Other risks, not owner powers

1. **Fee-on-transfer or rebasing tokens break this.** The free reward balance is
   derived from `balanceOf(address(this))` minus what is owed. $KEVIN is a plain
   ERC-20; do not point this contract at anything that is not.
2. **A boost raise is not automatic.** Somebody has to call `syncBoost`. If the
   front end does not, holders quietly earn at their old rate. This is a
   product-operations obligation, not a bug, but it will bite if nobody owns it.
3. **Truncation dust is permanently locked.** `rewardRate = reward / duration`
   truncates, so `reward - rewardRate * duration` stays counted as committed
   forever. That is under one wei per second of period length — well under
   0.000000000003 KEVIN for a 30-day period — and it is not recoverable.
4. **32 NFTs per address**, hard. A larger holder must split across addresses.
   The boost is capped anyway, so the cap costs nothing in practice, but it is a
   hard revert and not a graceful one.
5. **Retuning the tier table makes everyone's next transaction more expensive.**
   A tier write bumps a global epoch and invalidates every cached boost; each
   account then pays for one recompute, up to 32 storage reads. An owner
   retuning constantly is a gas nuisance. It is not a fund risk.
6. **Rewards emitted into an empty pool pay nobody** for those seconds. They are
   tracked in `unallocatedRewards` and released back to the free balance at the
   next `notifyRewardAmount` — but only then, and see owner power 5 for what can
   happen to a free balance.
7. **`syncBoost` is permissionless in both directions.** That is the point, but
   it does mean a cut reaches you the moment somebody bothers to push it.
8. **The crew NFT address is trusted.** It is immutable and set at construction,
   but a malicious contract at that address could grief NFT staking. This does
   not put staked $KEVIN at risk — `emergencyWithdraw` deliberately does not
   touch NFTs, precisely so a broken ERC-721 can never stand between a holder and
   their principal.
9. **No lock-up and no cooldown.** Stake, claim, leave. That is intended, and it
   means emissions are farmable by capital that has no interest in Kevin.
10. **Reentrancy is guarded, not proven absent.** `nonReentrant` on every
    external state-changing entry point, effects before interactions everywhere,
    and four tested attack paths using a token that calls back mid-transfer. That
    is evidence, not a proof.

### If you find something

Do not open a public issue for anything that lets someone take tokens. There is
no formal disclosure process yet, which is itself a gap worth naming.

---

*Launching as soon as my shift is over.*
