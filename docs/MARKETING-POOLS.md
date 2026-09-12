# Marketing pools — KEVIN paired against other real projects

Not trading infrastructure. The point of these pools is visibility: when someone
pastes a big project's contract address into DexScreener, KEVIN shows up as one
of its pairs. Real, tiny liquidity — enough to register as a legitimate pool,
not enough to matter as a trading venue. See the chat history around
2026-09-12 for the reasoning (checked against real DexScreener data — base/quote
side does not affect whether a pool shows up in search, only which name reads
first; thin pools do still appear in the raw API).

## The tool: PoolSeeder

`contracts/src/PoolSeeder.sol` — one reusable, owner-only contract for adding
(or later removing) liquidity on any v4 pool. Built because Uniswap's own
`PoolModifyLiquidityTest` (vendored in `lib/v4-core`) is unauthenticated by
design — a position it holds is keyed to the router's own address, not the
depositor, so anyone could call it to walk off with liquidity someone else
paid for. Same settlement logic, gated `onlyOwner`.

Three deployments exist — use the third, it supersedes the other two:

| | v1 (liquidity only) | v2 (liquidity + swap, broken) | v3 (liquidity + swap) — **use this one** |
|---|---|---|---|
| address | `0xaeDaf778ee15e8746C2BcA256bC901340Fa03249` | `0xf5b0498bceAac2e891a66a3C40ae73eFc9eA4160` | `0x6D4450017F66878DDF217e265Af913ac1a22D8f7` |
| deploy tx | `0xf3432ef1803b33d1197312735692c3aaa9502cc3eb4b1a58dc602df2569794c2` | `0x3c720701b245ff5e398dbe280e37699881c966cc44c1b9227ae591d8c99c48d2` | (v3 deploy tx) |
| creation blob sha256 | `a5836c8c49e6d323c340397053cfc8005eda356cb3b81f4a23f29ad20ab48bfb` | `2ec58c074cc5ae578227800826e2b87bb19bc67a62e995a010db1d57b4ef59fc` | `616007f144238cfc8c209dfd6a961aa29526bb973b4c0a0f8702ca218b1b953a` |

v2's `swap()` was missing `payable` — any swap sending native ETH as input
reverted outright (empty "0x" revert, no reason string). v3 fixes that and is
the only one that should still be called. All three: owner
`0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf` (treasury), manager
`0x8366a39CC670B4001A1121B8F6A443A643e40951` (the chain's v4 PoolManager).

Reuse `0x6D4450017F66878DDF217e265Af913ac1a22D8f7` for every future marketing
pool — no need to redeploy. To seed a new one: `initialize()` the pool on the
PoolManager directly (plain EOA call, no unlock needed), `approve()` both
tokens to the seeder, call `PoolSeeder.modifyLiquidity(key, params, "")`, then
`approve()` a small extra amount of one token and call `PoolSeeder.swap(...)`
for a real trade before expecting it to show up indexed.

**Known bug, not yet fixed**: the swap price limit used so far
(`sqrtPriceLimitX96` set to essentially MIN/MAX, i.e. "no limit") is unsafe on
thin real pools — a tiny buy can consume all in-range liquidity and crash the
pool to its price floor/ceiling, delivering ~0 tokens despite the tx reporting
success. This is what happened to BEAR/COIN/I below. Needs a real slippage
bound before any further scripted buys.

**Pair-count cap discovered while seeding PONS**: DexScreener's
`tokens/{address}` API returns at most ~30 pairs per token, sorted by
liquidity descending. A brand-new, tiny pool cannot appear in a heavily-pooled
token's own pair list without clearing the current smallest-liquidity pair on
that list — confirmed via PONS (30 pairs before and after seeding, ours never
displaced anything). This is why the strategy shifted from "any high-mcap
target" to "high mcap but under ~20-25 existing pairs."

## Pools seeded

### KEVIN / PONS

PONS: `0x39dBED3a2bd333467115dE45665cC57F813C4571` — real project, ~$435M
market cap at seed time, main pool (v3, Uniswap) has $6.8M liquidity. Verified
on-chain before seeding (18 decimals, 1B supply, real deployed contract).

| | |
|---|---|
| pool key | currency0 `0x39dBED3a2bd333467115dE45665cC57F813C4571` (PONS) · currency1 `0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A` (KEVIN) · fee 3000 · tickSpacing 60 · hooks `0x0` |
| poolId | `0x9fa4b7cd63dc08a0977d0eb56765e1d97a72b975c0116026eaafc80ae05bd497` |
| seeded | 4,249.53 KEVIN + 0.0398 PONS (~5 cents total, split at the real price ratio on 2026-09-12: KEVIN $0.000005883, PONS $0.6286) |
| position | full range, ticks -887220 to 887220, liquidity `13000300650951435218` |
| initialize tx | `0x6ce7857c249c6ef5e2ea3e906c749c8c95b09f28d984baadd6f31e46acbfeac4` |
| seed tx | `0x87c484b3f0150dcf94f46a0cd44e86bc506c86b12ac60270c7129544224d9030` |
| test swap tx | `0x6bdc92dca054020410af891615d8bd9235b395a9a7d18037650c7d905cf6bfa0` (10 KEVIN → PONS, run right after seeding since the pool sat un-indexed for ~25 min with liquidity alone; showed up on DexScreener shortly after this swap went through — timing suggests a trade may be what triggers indexing here, not proven, but cheap enough to just always do going forward) |
| status | **live, indexed** — renders as KEVIN / PONS, $0.04 liquidity, confirmed via both the DexScreener website and the raw API |

Sizing math: token amounts computed from live DexScreener prices, sqrtPriceX96
derived directly from the same ratio (so pool price matches the real market
rate at seed time, not an arbitrary guess an arb bot immediately eats).
Liquidity delta computed with the standard Uniswap `getLiquidityForAmount0` /
`getLiquidityForAmount1` formulas (full-range approximation) — the two sides
came out within 1,573 of each other on a ~1.3e19 value, i.e. consumes very
close to the full approved amount on both tokens.

### KEVIN / HOOD

HOOD: `0xDAA8f3f54c66E9BE2c44C1B6b566cBD07229CED3` — real project on Robinhood
Chain, low existing pair count (well under the ~30 cap).

| | |
|---|---|
| pool key | currency0 `0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A` (KEVIN) · currency1 `0xDAA8f3f54c66E9BE2c44C1B6b566cBD07229CED3` (HOOD) · fee 3000 · tickSpacing 60 · hooks `0x0` |
| poolId | `0x6425ced12cdb191727452099166b078f678241ca6cc069c074ab65833ebd7c24` |
| seeded | 4285.9591976684387… KEVIN + 0.47106251 HOOD, full range |
| position | ticks -887220 to 887220, liquidity `44932779765014324569` |
| status | **live** — seeded successfully with the v3 (payable-fixed) seeder |

### KEVIN / APE

APE: `0x8f86a15EC17cb3369d8b3E666dAdBC11daA82b79` — real project, low pair
count. Pool was accidentally initialized in an earlier, pre-payable-fix
attempt at a price that didn't match the later successful buy's real fill —
the first seed attempt panicked (arithmetic underflow, Panic(17)) because the
liquidity math assumed the wrong current price. Fixed by reading the pool's
real on-chain state directly (`extsload`) and recomputing liquidity anchored
to the actual locked-in price instead of the stale estimate.

| | |
|---|---|
| pool key | currency0 `0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A` (KEVIN) · currency1 `0x8f86a15EC17cb3369d8b3E666dAdBC11daA82b79` (APE) · fee 3000 · tickSpacing 60 · hooks `0x0` |
| poolId | `0x872d57fe8f6678660d429d3256959dcde51dfe0db8c0d9905785c4633f0bc8b6` |
| real price at seed time | sqrtPriceX96 `517536893453813944636407808`, tick `-100626` |
| seeded | 4285.959197668439 KEVIN + 0.182882223799999997 APE (confirmed via Transfer logs), full range |
| position | ticks -887220 to 887220, liquidity `27996888205400038101` |
| seed tx | `0x4fb0298a976aae38bb8a46a32d8fffe90d300c7b3bac241e6b05fae05e67da73` |
| status | **live** — seeded successfully with the v3 seeder after the price-mismatch fix |

### BEAR, COIN, I — written off

`0x4A7243856A18012999f7E51607eeC3cc6A67e719` (BEAR), `0x21F4748a24D683B412B736Ae6E065e6DEb217777` (COIN),
`0x6B2bC4075a9D88021900191F98aCBD17F7aA1e18` (I) — pools were initialized and
a buy was attempted on each, but every buy delivered **0 tokens** (confirmed:
treasury balance is 0 for all three). Root cause was the unbounded swap price
limit (see "Known bug" above) combined with genuinely thin real liquidity on
these pools. There is nothing to seed with until either more ETH is put
toward a properly slippage-bounded retry, or these are dropped from the list.

## Adding another one

1. Get the target's real contract address and confirm it's actually on
   Robinhood Chain (not a same-ticker token on another chain — this has
   already almost happened once).
2. Pull live prices for KEVIN and the target from DexScreener.
3. Decide a total dollar amount, split by price ratio into exact token amounts.
4. Sort addresses to get currency0/currency1, compute sqrtPriceX96 from the
   amount ratio, simulate `initialize()` via `eth_call` before broadcasting.
5. `initialize()`, `approve()` both tokens to `0xf5b0498bceAac2e891a66a3C40ae73eFc9eA4160`,
   then `PoolSeeder.modifyLiquidity(...)`.
6. `approve()` a small extra amount of one side and call `PoolSeeder.swap(...)`
   for one real trade — pool sat un-indexed until this happened on the PONS
   pool, so treat it as a required step, not optional polish.
7. Record it in the table above.
