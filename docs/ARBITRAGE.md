# Is there an arbitrage on KEVIN?

No. Measured 10 September 2026. Re-run it yourself:

    node tools/arb/check.mjs

Every price gap between KEVIN's three pools, and between KEK's four, is
smaller than the fees you would pay to close it.

## How the pools were found

Not by guessing fee tiers. An earlier pass checked four standard fees against
two hook addresses, found nothing, and concluded the KEK/WETH pool did not
exist. It does. "None found" was never the same as "none exists."

The right method is to ask the chain. The PoolManager's `Initialize` event
indexes `currency0` and `currency1`, so filtering on those topics finds every
pool a token is in at **any** fee, spacing or hook:

    topics: [INITIALIZE_TOPIC, null, TOKEN]        // token is currency0
    topics: [INITIALIZE_TOPIC, null, null, TOKEN]  // token is currency1

Currencies sort by address, so a token can be on either side. Check both.

One thing that bit twice: when a log range fails and the error is swallowed,
the pool in it disappears silently and the result looks like a clean negative.
Retry every range, and count the ones that never came back.

## The venues

All of them are on the same Uniswap v4 PoolManager,
`0x8366a39CC670B4001A1121B8F6A443A643e40951`. KEK is not on a separate
factory — there is one singleton on this chain.

| pool | fee | depth | pool id |
|---|---|---|---|
| WETH / KEVIN | 0.30% | $1,942 | `0xd3ca7f46595df4eb7a3af7c12fdc0d7bd5bf7a2b98f1369282a278ef8283af63` |
| KEK / KEVIN | 0.30% | $2,082 | `0x2d36afcddd3abe0f09a560a45e19e6f709bcfd49d249116c2c471c0091dfd05b` |
| GME / KEVIN | 0.30% | $466 | `0x3af7e5d7ef962f99c4bfa54285ee705c61e11ecbd42cf1ddaea240c4acf49743` |
| WETH / KEK | 0.30% | $8,690 | `0x1a2170d9ba519e87b90132d6443b16de6a4a2237c7a38ae89c81d4fc255e7ed3` |
| ETH / KEK | 0.90% | $3,901 | `0x5516075a46017cae65a9b5da18e99aad9f160e8baf9c7e47f033b3e9166f8fc6` |
| KEK / USDG | 0.90% | $1,893 | `0xfa87fe8ba525adb96b45b74539d0b97b1e7b97ad47e4c56bf8e8f59ba7e66f2f` |

KEK is also in a CULT pool and three dead USDG pools with zero liquidity.

Depth is the full-range equivalent of the pool's `liquidity`, which
over-states a concentrated position. That bias favours finding arbitrage.
A negative result under it is a real negative result.

## What the loops pay

ETH was $2,437 on chain when this ran.

| loop | edge |
|---|---|
| KEVIN: buy via KEK, sell on WETH | +0.009% |
| KEVIN: buy on WETH, sell via GME | +0.069% |
| KEK: buy wrapped, sell native | -0.153% |
| KEK: buy on WETH, sell on USDG | -0.584% |
| KEVIN: buy on WETH, sell via KEK | -1.804% |
| KEK: buy on USDG, sell on WETH | -1.905% |
| KEK: buy native, sell wrapped | -2.344% |
| KEVIN: buy via GME, sell on WETH | -3.097% |

The two positive rows peak at four cents and thirteen cents of input. That is
the optimiser finding the point where the gap has not yet been eaten by price
impact, not an opportunity.

The KEVIN triangle is 0.93% wide against 0.90% in fees. The two KEK venues are
1.26% apart against 1.20% in fees. Every one of them sits on the fee floor,
which is what an arbitraged market looks like. Six days earlier the KEVIN
triangle was 3.05% wide. It closed on its own.

## The rest of the launchpad

694,216 pools on this PoolManager across 435,465 tokens. 36,821 of those
tokens are quoted against two or more of ETH, WETH, USDG, GME and KEK, which
is the whole surface where a cross-venue gap could live.

Sweeping the busiest 60 turned up one candidate: a token called PONS showing a
19% spread. Both sides of that spread were pools with **zero swaps in 500,000
blocks**. Its six deepest pools agree within 0.9%. A wide quote on a pool
nobody trades is not an opportunity, and this is the shape most of them take.

Before sizing any gap this tool reports, check the pool has recent `Swap`
events. A pool with liquidity and no trades cannot be exited.

## Why this matters for the WETH plan

KEVIN's price does move with KEK, and the loop above is how. The transmission
is live and fast enough to hold the gap under 1%. Trading against it is not
the fix — the gap is already closed. Depth on the WETH side is the fix. See
`docs/LIQUIDITY.md`.
