# KEVIN FLOOR

> Sells $KEVIN into strength, buys it back into weakness, and cannot push the
> price through the floor — because the pool will not let it.

`KevinFloorV4` holds $KEVIN and ETH against one Uniswap v4 pool. You send it
tokens; it sells them into buy pressure and never below a floor that ratchets up
with the chart. A share of every sale is kept back and spent bidding when the
price falls under that floor.

---

## The one idea it is built on

Uniswap v4's swap takes a `sqrtPriceLimitX96`, and the pool **stops filling**
when the price reaches it. Not reverts — stops, having filled what fit and
consumed only that much of the input.

So *"sell into buy pressure but never wreck the chart"* is not a heuristic here
and does not depend on a keeper guessing a size:

> Offer the pool more than you think it can take, with the limit set at the
> floor. It sells exactly as much as fits above the floor and hands the rest
> back. Buyers push the price up, room opens, the next poke sells into it.

Nobody has to measure volume, and no bad estimate can hurt you. The price cannot
be pushed below the floor **by this contract**, because the pool refuses. That
is a guarantee, not a setting, and it is the whole reason this is worth being a
contract instead of a script with a hot wallet.

`test_theFloorHolds_evenIfYouOfferItEverything` mints it five million tokens,
removes the cooldown, and pokes it twelve times with `type(uint256).max`. The
price ends at the floor and not one tick past it. The tests run against a real
`PoolManager` and a real initialised pool, not a mock, because a claim the pool
enforces has to be checked against the pool.

## It is two-sided, and you should leave it that way

A contract that only ever sells is a distribution bot. Calling one a floor
keeper is the sort of gap between a name and a net flow that gets found — every
fill is an event on a public chain and the address is one click from the chart.

So: `buybackBps` (default 30%) of every sale's proceeds is held back in a
`warChest` and spent buying $KEVIN when the price falls `buyBandBps` under the
floor. Set it to zero and you have a pure distribution bot, which is your call.
Leave it where it is and the thing does what its name says, the sells fund the
bids, and anyone can audit the whole of it from the `Sold` and `Bought` events.

**Whatever you choose, publish the address and the rule.** It costs nothing
today. It is the difference between "the treasury runs a disclosed rebalancer"
and someone finding an unexplained sell wallet on the explorer in week three,
which is a much worse day and always arrives at the worst possible moment.

## What it does not do

**Selling into buy pressure is still selling.** The floor stops wicks; it does
not stop the drag. If your allocation is a meaningful share of daily volume then
the chart rises more slowly than it would if you were not selling, and it stalls
wherever your supply outweighs demand. That is arithmetic. What this contract
changes is *how* you sell — no wicks, no red candles with your name on them,
never below a level you set — not *whether* selling costs the chart something.

Two things follow, and they are the levers that actually matter:

- **`floorGapBps` sets how much of the rise you give up.** A tight floor sells
  more, sooner, and caps the chart harder. A wide one sells less and lets it run.
- **The daily cap is the real dial.** If a few million tokens a day is a large
  share of volume, feed it less than you receive and hold the rest.

## Which way is up

v4 prices a pool as **currency1 per currency0**, and native ETH is `address(0)`,
which sorts below every token. So in an ETH pool:

| | |
|---|---|
| currency0 | ETH |
| currency1 | $KEVIN |
| pool price | $KEVIN per ETH — the **inverse** of $KEVIN's price |
| a rising $KEVIN | a **falling** sqrtPrice |
| `upIsUp` | **false** |

Getting that backwards makes the contract sell into every dip and call it
strength. It is decided once in the constructor and everything else asks
`_isBetter`. It *was* backwards in the first draft, and `test_knowsWhichWayIsUp`
plus every ratchet test caught it immediately — which is why they are the first
tests in the file. **The deploy script prints `upIsUp`. Read it. In an ETH pool
it must be false.**

## The rails

The operator is a hot key on a server. Assume it leaks.

| Rail | What it stops |
|---|---|
| operator names no pool, no path, no recipient | swapping your bag for a token it just deployed |
| `maxTokensPerTrade` / `maxQuotePerTrade` | one transaction spending everything |
| `dailyTokenCap` / `dailyQuoteCap`, rolling 24h | a bad day costing more than a day |
| `cooldown` | the daily cap going in one block |
| `floorSqrtPriceX96` as the swap's own limit | the price ever going through the floor |
| `pause()` | everything, immediately, from the owner |

`test_dailyCapBoundsALeakedKey` pokes twenty times with the operator key and
asserts what left is at most one day's allowance.

**What the owner can still do to you:** `sweep()` takes everything. Stated here
rather than hidden behind a timelock nobody would wait out. Use a multisig.

## Suggested settings

```
floorGapBps    1500    the floor sits 15% under spot
ratchetBps      500    and climbs at most 5% per call
buyBandBps      800    bid once spot is 8% under the floor
buybackBps     3000    30% of every sale is kept to bid with

MAX_TOKENS_PER_TRADE  250_000e18
DAILY_TOKEN_CAP     2_000_000e18   under one day's allocation, on purpose
MAX_QUOTE_PER_TRADE     0.05 ether
DAILY_QUOTE_CAP          0.5 ether
COOLDOWN                       300
```

## Deploying

The pool has to exist and be trading first.

```bash
export PRIVATE_KEY=...
export KEVIN_TOKEN=0x...
export POOL_MANAGER=0x8366a39cc670b4001a1121b8f6a443a643e40951
export QUOTE=0x0000000000000000000000000000000000000000   # native ETH
export POOL_FEE=3000        # must match the pool exactly
export TICK_SPACING=60      # must match the pool exactly
export POOL_HOOKS=0x0000000000000000000000000000000000000000
export FLOOR_OWNER=0x...    # multisig
export FLOOR_OPERATOR=0x...

forge script script/DeployFloorV4.s.sol --rpc-url robinhood --broadcast
```

> **Check the PoolManager address on the explorer first.** It comes from
> Uniswap's deployment docs for chain 4663, not from the chain. And the fee,
> tick spacing and hooks must match the live pool exactly — a v4 pool is the
> hash of all five fields, so one wrong number is not an error, it is a
> different and probably uninitialised pool.

Then, from the owner:

1. `setOperator(...)` and `setRails(...)` if the deployer was not the owner.
2. `setFloorFromSpot(1500)` — **it does nothing at all until a floor is set.**
3. Send it tokens.

Send a fraction of one day's allocation first and watch a fill land before the
rest.

## Other v4 addresses on Robinhood Chain (4663)

From Uniswap's docs; verify before use.

| | |
|---|---|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
