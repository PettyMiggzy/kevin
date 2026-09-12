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

Two deployments exist — use the second one, it supersedes the first:

| | v1 (liquidity only) | v2 (liquidity + swap) — **use this one** |
|---|---|---|
| address | `0xaeDaf778ee15e8746C2BcA256bC901340Fa03249` | `0xf5b0498bceAac2e891a66a3C40ae73eFc9eA4160` |
| deploy tx | `0xf3432ef1803b33d1197312735692c3aaa9502cc3eb4b1a58dc602df2569794c2` | `0x3c720701b245ff5e398dbe280e37699881c966cc44c1b9227ae591d8c99c48d2` |
| creation blob sha256 | `a5836c8c49e6d323c340397053cfc8005eda356cb3b81f4a23f29ad20ab48bfb` | `2ec58c074cc5ae578227800826e2b87bb19bc67a62e995a010db1d57b4ef59fc` |

Both: owner `0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf` (treasury), manager
`0x8366a39CC670B4001A1121B8F6A443A643e40951` (the chain's v4 PoolManager).
v2 added `swap()` — same onlyOwner pattern, lets a tiny real trade get pushed
through a freshly-seeded pool (see "Pools seeded" below for why that matters).

Reuse `0xf5b0498bceAac2e891a66a3C40ae73eFc9eA4160` for every future marketing
pool — no need to redeploy. To seed a new one: `initialize()` the pool on the
PoolManager directly (plain EOA call, no unlock needed), `approve()` both
tokens to the seeder, call `PoolSeeder.modifyLiquidity(key, params, "")`, then
`approve()` a small extra amount of one token and call `PoolSeeder.swap(...)`
for a real trade before expecting it to show up indexed.

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
