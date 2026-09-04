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

## Mint ladder

Run `node tools/mint-model.mjs` to re-price. Both shapes discussed:

| Tier | Supply | Option A | Option B |
|---|---|---|---|
| Common | 400 | $9.99 | $5 |
| Uncommon | 300 | $14.99 | $8 |
| Rare | 200 | $19.99 | $11 |
| Epic | 75 | $24.99 | $14 |
| Legendary | 25 | $29.99 | $17 |
| **Sellout** | **1,000** | **$15,115** | **$8,075** |

Prices are quoted in USD and settled in KEVIN at spot. Quote the tier in KEVIN
instead and tier five becomes cheaper than tier one the moment the chart moves.

A raises about double. B is the easier first mint: a $5 floor is an impulse buy,
and a sold-out cheap mint markets better than a half-sold expensive one — the
unsold half is the part people notice.

## Perks

Perks have to be things we actually control, or they are just a promise.

| Perk | Where it lives | Tier |
|---|---|---|
| Playable seat in Kevin's Card Room | `poker/js/characters.js` — the registry already takes minted characters | All |
| Character in Kevin's Gym | `gym/` character picker | Uncommon+ |
| Holder tag in the Telegram group | bot, on a verified wallet | All |
| Higher weight in the GME distribution | below | All, scaling by tier |
| Trait-matched sticker | the sticker pipeline already builds these | Epic+ |

The poker registry was built with this seam in it: a character is data — id,
name, art, style — and nothing in the game reaches past `ROSTER`, so a minted
character sits down the same way a built-in one does.

## The GME pool

The launch puts 15% into GME. Distributing what that becomes to holders is the
part with real-world consequences, so the mechanics are written down and the
maths is a script anyone can rerun.

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

Two smaller things that follow from the same caution: the snapshot block should
be announced **after** it is taken, or people buy in to farm it, and the
allocation output should be published in full so anyone can check their own row.
