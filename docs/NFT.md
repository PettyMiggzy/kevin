# The Kevin collection

1,000 PFPs, generated locally from Todd's drawing. No image model touches them,
which is the whole reason they are all recognisably the same character —
generating a thousand through Grok or Venice gives a thousand different Kevins,
and at that scale it cannot be fixed afterwards.

Regenerate the entire collection, byte for byte:

```bash
node tools/gen-pfp.mjs --count 1000 --seed 20260907
```

The PNGs are gitignored — 228MB of output that a seed reproduces exactly is
not worth carrying in a public repo. The metadata, the rarity table and the
tier assignments ARE committed, because those are the parts you cannot
regenerate from nothing once a mint has happened.

## Traits

Six categories, weighted. Every one of the 1,000 has a unique combination.

| Category | Options | Notable |
|---|---|---|
| Background | 8 | Rays 3%, Gold Rush 1% |
| Fur | 7 | Classic Red 50%, Gold 2% |
| Hat | 8 | None 38%, Horns and Halo ~4-5% each |
| Eyes | 7 | Normal 43%, Visor Shades 2% |
| Mouth | 5 | Triangle 56%, Gold Tooth 5% |
| Aura | 5 | None 70%, Rainbow 1% |

Tiers are assigned by **combination** rarity, not by any single trait: each
token scores the sum of 1/frequency across its six traits, and the ranking is
cut 25 / 75 / 200 / 300 / 400. So a Legendary is legendary because the whole
card is unlikely, which is much harder to game than "has the gold fur".

## Mint: burn, not buy

Minting does not pay into treasury. It burns $KEVIN — straight to the dead
address `burnwatch.mjs` already tracks — and hands back one of that tier's
token ids. Every mint is therefore a permanent, on-chain-checkable cut to
circulating supply, stacked on top of whatever else gets burned. This
replaces the earlier USD-priced design entirely; there is no dollar price
anywhere in this contract.

The contract is `contracts/src/KevinNFT.sol`. The shape:

- **Tier population is fixed before mint ever opens.** `loadTier()` assigns
  the exact token ids from `assets/pfp/tiers.json` to each tier; `lockTiers()`
  is a one-shot that hard-checks every tier landed at its exact committed
  count (400/300/200/75/25) and then permanently disables both functions.
  Nobody, including the owner, can change which id is in which tier, or
  re-price a tier, after that call.
- **Price is a % of circulating supply, not a flat KEVIN number.** A flat
  number picked today means something completely different once the chart
  moves or more supply burns elsewhere. `tools/mint-model-burn.mjs` prices
  each tier as basis points of *current* circulating supply (read live from
  `data/burns.json`), geometric across tiers so Legendary is disproportionately
  harder than Common — matching how much rarer the slot itself already is (25
  vs 400 available). Run it for the live numbers:

  ```bash
  node tools/mint-model-burn.mjs
  ```

  The shipped ladder burns 20% of circulating supply on a full sellout — a
  real, checkable ceiling. Common is a genuine impulse burn at today's price;
  Legendary alone is roughly 0.18% of the entire current market cap. Neither
  tier is meant to sell out immediately; if nothing moves past
  Common/Uncommon after a real mint window, re-run the model with a smaller
  `--base`/`--step` rather than leaving stale pricing live.

- **Deploying and arming are separate steps, on purpose**, same split
  `KevinFloorV4`'s own deploy script uses between "on chain" and "funded and
  live":
  1. `forge script script/DeployKevinNFT.s.sol --broadcast` — puts the bare
     contract on chain. Nothing priced, nothing loaded.
  2. `node tools/load-nft-tiers.mjs --set-prices --load` — prices all five
     tiers from `mint-model-burn.mjs`'s current output and loads all 1,000
     token ids, chunked to stay under the block gas limit. Idempotent: safe
     to re-run if a transaction fails partway.
  3. Read `remaining(tier)` back for all five tiers by hand. They must read
     exactly 400/300/200/75/25 before the next step.
  4. `lockTiers()`, by hand, from the owner. Irreversible.
  5. `openMint()`, by hand, from the owner.

  Both scripts were proven end-to-end against a local anvil fork — full
  deploy, price, load, lock, open, and a real mint that burned exactly the
  priced amount and decremented the tier's remaining count — before either
  was committed.

## Perks

Perks have to be things we actually control, or they are just a promise.

| Perk | Where it lives | Tier |
|---|---|---|
| Share of 100% of the KEK and WETH LP fees | below | All, scaling by tier |
| Playable seat in Kevin's Card Room | `poker/js/characters.js` — the registry has the seam, `ownedBy()` is still a stub pending a deployed contract address | All |
| Character in Kevin's Gym | `gym/` character picker | Uncommon+ |
| Holder tag in the Telegram group | bot, on a verified wallet | All |
| Trait-matched sticker | the sticker pipeline already builds these | Epic+ |

The poker registry was built with this seam in it: a character is data — id,
name, art, style — and nothing in the game reaches past `ROSTER`, so a minted
character sits down the same way a built-in one does. `ownedBy()` stays a stub
returning `[]` until there is a real mainnet contract address for it to read
against — wiring it against nothing would be untestable in the way the deploy
and load scripts were actually proven.

**The NFTs do not touch the GME pool.** That pool's revenue share is a
promise to $KEVIN token holders generally, decided before this collection
existed, and stays exactly that — see below. Giving NFT holders a second,
overlapping claim on the same pool was the original plan; it was deliberately
dropped so the two promises never compete for the same money.

## The KEK/WETH fee share

Holding a Kevin NFT earns a share of two of this project's three LP pools —
KEK and WETH, not GME. `KevinNFT.sol` implements it as a standard
MasterChef-shaped accumulator, doubled for two reward tokens:

```
weight = Common 1 · Uncommon 2 · Rare 4 · Epic 8 · Legendary 16   (same ladder as GME's, reused)
your share of a deposit = deposit × (your token's weight ÷ total weight of all minted tokens)
```

`depositFees(kekAmount, wethAmount)` is permissionless — anyone can top the
pool up, most likely a keeper sweeping LP fees on some cadence (weekly, per
the original ask). It credits only what actually arrives (delta-accounted,
fee-on-transfer safe), matching `KevinFloorV4`'s `fundWarChestToken` idiom.
Holders `claim()` what has accrued to their specific token id at any time —
gas is the only cost. A token minted after a deposit already landed owes
nothing from that deposit; a token that changes hands keeps whatever it had
already accrued, so the entitlement transfers with the NFT on a sale, not
with whoever originally minted it.

The Foundry suite (`contracts/test/KevinNFT.t.sol`) covers the properties
that actually matter here: proportional splitting by tier weight, no
retroactive claims, claim entitlement surviving a transfer, delta-accounted
deposits under a fee-on-transfer token, and a fuzz test that the sum of every
token's claimable balance can never exceed what was actually deposited.

**Before this is promoted publicly, get it in front of a securities lawyer.**
This is the part of the design most likely to read as a security, more so
than the GME pool below: it is a direct, ongoing revenue share — a cut of
real trading fees — paid out in proportion to holding a specific numbered
asset that was itself paid for by burning value. That shape (pay in, receive
a pro-rata cut of revenue this project generates) is close to the textbook
definition regulators use for an investment contract, and marketing the fee
share as a reason to mint is exactly the part that draws attention. That is
not a reason to not build it — the contract is built and tested — it is a
reason the terms someone can be shown before minting need to be reviewed by
someone who does this for a living, in the jurisdiction this actually runs
in, before `openMint()` is ever called against a public audience.

## The GME pool

The launch puts 15% into GME. Distributing what that becomes to $KEVIN
holders generally — unrelated to this NFT collection — is the part with
real-world consequences, so the mechanics are written down and the maths is a
script anyone can rerun.

**Formula.** Eligibility is a floor of **10,000,000 KEVIN** at a published
snapshot block. Weight is the sum of the tiers you hold:

```
Common 1 · Uncommon 2 · Rare 4 · Epic 8 · Legendary 16
your share = pool × (your weight ÷ total eligible weight)
```

`tools/allocate-gme.mjs` computes it from a snapshot CSV. It uses
largest-remainder rounding, so the shares handed out always sum to exactly the
pool — plain rounding either invents shares or quietly loses them. Fuzzed over
400 random snapshots: every share distributed, no ineligible wallet ever paid.

```bash
node tools/allocate-gme.mjs --snapshot holders.csv --shares 1200 --out alloc.csv
node tools/allocate-gme.mjs --demo          # see the shape without a snapshot
```

**Before this ships, get it in front of a securities lawyer.** Handing holders
real equity — or the proceeds of real equity — in proportion to how much of a
token and how many NFTs they hold is the shape regulators treat as a securities
distribution, and marketing it as a reason to buy is the part that draws
attention. That is not a reason to drop it; it is a reason for the mechanism to
be designed by someone who does this for a living, in the jurisdiction you are
actually in, before any of it is promised publicly. Everything else in this
document is ours to decide. This part is not.

Two smaller things that follow from the same caution: the snapshot block
should be announced **after** it is taken, or people buy in to farm it, and
the allocation output should be published in full so anyone can check their
own row.

The weight formula above ("Common 1 · Uncommon 2 · ... Legendary 16") is
shared verbatim with the KEK/WETH fee share on purpose — one ladder, two
pools, instead of inventing a second scheme with its own edge cases.
