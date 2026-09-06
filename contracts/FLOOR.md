# KEVIN FLOOR

> Sells $KEVIN into strength, buys it back into weakness, and cannot push the
> price through the floor — because the pool will not let it.

## Never call this a floor in public

Read this before writing a single word of announcement copy.

**What this contract actually guarantees is one-sided:** it will not sell below
a level, no single sale will move the chart more than `sellStopBps`, and it
cannot exceed a published daily rate. Those are real, they are enforced by the
pool and by the bytecode, and they are worth saying.

**What it does not guarantee is a price.** The bid side is `warChest`, which is
a fraction of what has already been sold. Against these pools that is a small
number, and a motivated seller walks through it. Anyone who wants to can spend
well under an ETH and exhaust it permanently.

So publish the mechanism and the numbers — the contract address, the daily cap,
the sell stop, the amount actually sitting on the bid, `lockbox()`, `locked()`.
All of that is checkable and all of it survives contact with reality. Say
"seeded liquidity" and "a published sell policy".

If you say "floor" and 0.35 ETH is the whole of it, the day it breaks is the day
your holders conclude you lied to them — and they will be right, because you
will have. The file is called FLOOR.md because the contract is called
KevinFloorV4; that is an internal name for a rate limiter, not a promise to
make to anybody.

Three things that draw real trouble, none of which this does by construction,
and all of which are easy to drift into: **wash trading** (being both sides to
manufacture volume for a trending rank), **spoof walls** (showing depth you
intend to pull), and **guaranteed-floor claims**. Stay off all three.

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

## The floor and the sell stop are not the same level

The first version used one number for both, and driving it against a live pool
made the mistake obvious: with the floor 15% under spot, every sale walked the
price 15% down to reach it. That is precisely the chart-wrecking this exists to
prevent.

They are different jobs and they want opposite values:

| | wants to be | because |
|---|---|---|
| `floorGapBps` — the level you **defend** | **wide** | a floor 1% under spot is not a floor, it is a rounding error |
| `sellStopBps` — how far one sale may **walk the price** | **narrow** | this is the "never wreck my chart" dial, and it is the only one |

Every sale takes the tighter of the two as its price limit. So the floor can sit
a long way down and still be worth something, while no individual sale moves the
chart more than a couple of percent. `test_oneSaleCannotWalkThePriceFurtherThan-
TheStop` offers it five million tokens against a 15% floor and asserts the price
moved 2.5% and not a basis point more.

## The keeper ratchets before it sells, and the order is the whole point

A sale stops exactly at the limit, so after every sale spot and floor are within
`sellStopBps` of each other. Sell first and the floor can never climb — the
price is dragged back down to it every time and "a floor that rises with the
market cap" quietly becomes "a floor pinned to launch day". The keeper takes the
rise first and sells into what is left.

That was also found by driving it: the first version sold into a 30 ETH pump and
left the floor exactly where it started.

## The bug an audit found, which is the most important thing in this file

`ratchet()` was permissionless, and the argument for that was written down
right above it: the floor only moves in the direction that makes this contract
sell *less*, "which costs an attacker money and saves us none."

That is false, because **freezing the distribution is the attacker's goal.**

`ratchetBps` capped the move per CALL, with the ceiling recomputed from the
freshly-written floor each time — so thirty calls compounded 1.05 thirty times.
`nonReentrant` does not help; it releases between top-level calls. One
transaction: pump the price, loop `ratchet()`, dump back out, same block.
Measured against a pool deeper than any of ours, it cost **0.0153 ETH** and put
the floor permanently above the market. The floor never comes down, so the
contract could never sell again — 20% of supply with nowhere to go but a
`sweep()`, which is precisely the thing [`KevinLock`](./LOCK.md) exists to stop.

Two changes, both needed:

- **`onlyOperator`.** Nobody else ever had a reason to call it, and the argument
  for letting them was the false one above.
- **`ratchetCooldown`,** so `ratchetBps` bounds the floor's movement per unit of
  *time* rather than per call. That is what bounds the one caller left — a
  leaked operator key.

`test_theAttackNoLongerWorks` runs the original attacker contract unchanged and
asserts it is refused. `test_ratchetCannotBeWalkedUpInOneBlock` gives the
attacker the operator key anyway and asserts that thirty calls buy exactly one
5% step. Both live in `test/RatchetGrief.t.sol`, kept rather than deleted.

## The ceilings a stolen owner key cannot raise

A stolen owner key does not need `sweep()` to hurt you. Two transactions that
move zero tokens — `sellStopBps = 9999` and `cooldown = 0` — would turn "no sale
may move the chart more than 2.5%" into no guarantee at all, quietly, with
nothing on chain that looks like a theft until the candle prints.

So the settings have ceilings, and the ceilings are `constant`s in the deployed
bytecode rather than storage the owner can move:

| | ceiling |
|---|---|
| `MAX_SELL_STOP_BPS` | 500 — no sale may ever move the price more than 5% |
| `MAX_FLOOR_GAP_BPS` | 3 000 |
| `MAX_RATCHET_BPS` | 2 000 |
| `MAX_BUY_BAND_BPS` | 3 000 |
| `MIN_COOLDOWN` | 60 seconds |

**This, and not a multisig, is the real answer to running one key.** Anybody can
read the ceilings off the contract and know that no key can exceed them.

## What this does NOT protect you from

**Other people's selling.** Read that again before relying on any of this.

`KevinFloorV4` is a rule about *its own* trading. It cannot stop anyone else
hitting the bid, and its floor is not a wall — it is a limit on where this
contract will sell, not a promise to buy everything offered below it. The only
thing that absorbs somebody else's sell is money sitting on the bid, and on day
one that is 0.35 ETH.

So, honestly ranked, what actually helps:

**1. Remove the reason people sell you: the overhang.** A 20% holder with a
30-day vest is the most bearish fact about this token, and it works on the
chart *before* you sell anything, because the rational move for everybody else
is to front-run your unlocks. `KevinLock` — see [LOCK.md](./LOCK.md) — makes
the drip a contract instead of a promise: at most `ratePerDay` out, only ever
into the floor keeper, and any real withdrawal announces itself two weeks in
advance. **This costs nothing, needs no money, and is worth more than any bid
you could afford to put up.** Do this one.

**2. Bids funded by fees, not by your wallet.** If the treasury owns the LP
position, trading fees accrue in both tokens, and the ETH side of them can be
collected and pushed into `fundWarChest()`. That is a bid that grows with
volume instead of with your bank balance, and it is the only sustainable
buy-side any of this can have. **Whether it is available depends on whether
kekfun leaves you the LP position or burns it — find out in the morning,
because if you do own it this is the second thing to build and if you do not,
it is not buildable at all.**

**3. `fundWarChest()` is payable and permissionless.** Anyone can put ETH
behind the bid — you, the treasury, anyone who wants the floor defended. It is
already there and it costs nothing to publish.

**4. A visible buy wall.** A single-sided ETH concentrated-liquidity range just
under spot is a public limit bid that earns fees while it waits. **Place it by
hand in the Uniswap interface. Do not let me build it** — it is one position
you will adjust a handful of times, and a contract to manage it would be more
risk than the thing it manages.

What none of these do is create demand. Nothing does. They remove reasons to
sell and put a bid under the ones that remain.

## Three pools split your liquidity three ways

If it launches into WETH, KEK and GME pools, each of them is separately thin
and separately drainable, and 0.35 ETH divided three ways is not depth in any
of them.

**Run the floor keeper against the deepest pool and let arbitrage carry the
others.** The contract holds one `PoolKey` and defends one pool by design;
pointing three instances at three pools would have them selling into each
other. Arbitrageurs will keep the thin pools in line with the deep one as long
as the deep one holds, which is exactly where you want the defence
concentrated.

## What if the price never comes back?

It sells anyway, eventually, and this is the part worth reading twice.

A floor that only ratchets up stops working the first time the chart makes a
high it does not revisit. The floor climbs under the top, the market drifts
down and sits there, and the contract waits for a price that is not coming
while the tokens it is supposed to be distributing pile up. The floor becomes
a ceiling on its own activity.

So the floor is a **high-water mark, not a promise**. While the price is under
it, it holds for `patience`, and then eases toward the market at
`decayBpsPerDay` a day, and never further than `maxDecayBps` below the mark.

```
patience         3 days    hold at full height first
decayBpsPerDay      150    then give up 1.5% a day looking for the market
maxDecayBps       3_000    and stop at 30% under the mark, whatever happens
```

Three things make this safe to have:

- **Waiting only counts while the market is actually gone.** The clock measures
  time since the price was last at or above the floor — not time since the last
  sale, and not time since the last ratchet. A quiet fortnight with a healthy
  chart costs nothing, and neither does a keeper outage: the first call the
  keeper makes puts the floor back to full height *before* it decides whether
  to sell.
- **One tick at the floor undoes all of it.** The moment the price comes back,
  the yielding resets to zero and the floor is whole again.
- **It bounds the rate, exactly.** In a market with no buyers at all, the most
  this contract can put the price below the high-water mark is
  `decayBpsPerDay` per day — because a day of waiting is all the room a day of
  waiting opens, and a sale stops dead at that room's edge. A 1.5%-a-day drip
  with a hard bottom, not a dump. `test_inADeadMarketItCannotWalkTheChart-
  FasterThanTheDecay` offers it twenty million tokens every day for forty days
  with no cooldown and checks that bound on every one of them.

`sellStopBps` is untouched by any of this and still caps every individual sale
at 2.5%, so the yielding never shows up as a candle.

Set `decayBpsPerDay` to zero and the floor never yields — which is a real
choice, and `test_zeroDecayMeansItHoldsOutForever` is there to show you what it
costs. `setFloorFromSpot()` is the manual override either way: one call from
the owner re-anchors the floor to the current price.

## Every percentage here is a PRICE percentage

`floorGapBps`, `sellStopBps`, `ratchetBps`, `buyBandBps` and the decay are all
moves in the **price of $KEVIN**, which is not the same as a move in the sqrt
price — a 2.5% move in sqrt space is a 5.06% move in price.

The first version applied the bps straight to the sqrt price, so every number
in this file, and every number you would have set after reading it, meant about
twice what it said. On `sellStopBps` — the one dial that carries "never wreck
my chart" — that is not a rounding difference. The conversion now happens in
one place, `_worseBy`/`_betterBy`, and `test_theFloorGapIsAPricePercentage`,
`test_theBuyBandIsAPricePercentage` and `test_ratchet_isCappedPerCall` assert it
in price terms so it cannot drift back.

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

## If your pool is quoted in a token, not in ETH

WETH, KEK and GME pairs are all quoted in an ERC-20, which changes two code
paths: the swap settles by sync-transfer-settle instead of sending value, and
the war chest is denominated in that token. Every test in this repo used to run
against a native ETH pool, so the case least likely to be deployed had all the
coverage and the likely one had none. `test/KevinFloorV4Erc20.t.sol` now covers
it — and also the entire `upIsUp == true` branch, which nothing else reaches.

It found a real bug: `sweep()` only ever adjusted `warChest` on the *native*
branch. Against a token-quoted pool that is backwards both ways — sweeping
stray ETH debited a chest denominated in the quote token, and sweeping the
quote token itself removed the backing while leaving the number untouched,
after which every bid reverted trying to settle tokens the contract no longer
held. It now debits whatever the quote actually is.

`fundWarChest()` is payable and only works on an ETH pool. Use
`fundWarChestToken(amount)` on the other two. Both are permissionless: anyone
may back the bid.

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
| `maxDecayBps` | the yielding ever becoming a way out |
| `pause()` | everything, immediately, from the owner |
| `ratchetCooldown` | the floor being walked up in one block |
| `MAX_SELL_STOP_BPS` and friends | the owner turning the guarantees off |
| `lockbox`, once set | $KEVIN being swept anywhere but back to the lockbox |

`test_dailyCapBoundsALeakedKey` pokes twenty times with the operator key and
asserts what left is at most one day's allowance.

**What the owner can still do to you:** `sweep()` takes everything in this
contract, instantly, with one key. Stated here rather than hidden behind a
timelock nobody would wait out.

That is the reason to keep this contract's balance to a few days' worth of drip
and hold the rest in [`KevinLock`](./LOCK.md), where the same key cannot do the
same thing — a withdrawal there announces itself two weeks in advance and cannot
be hurried. Small working balance here, the bag over there.

## Suggested settings

```
floorGapBps    1500    the floor sits 15% under spot
ratchetBps      500    and climbs at most 5% per call
buyBandBps      800    bid once spot is 8% under the floor
buybackBps     3000    30% of every sale is kept to bid with
sellStopBps     250    no single sale may walk the price more than 2.5%

patience     3 days    hold at full height before yielding to a gone market
decayBpsPerDay  150    then 1.5% a day, which is also the most it can bleed
maxDecayBps    3000    and never more than 30% under the high-water mark

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
export FLOOR_OWNER=0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf   # the owner wallet
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
3. `setPatience(...)` if you want something other than 3 days / 1.5% / 30%.
4. `setLockbox(<the KevinLock address>)` — **one shot, and do not skip it.**
   Until it is called, $KEVIN sitting here can be swept anywhere by one key with
   no notice, and these pools are small enough that inventory *will* sit here.
5. Send it tokens.

Send a fraction of one day's allocation first and watch a fill land before the
rest.

## The keeper

`keeper/floor.mjs` is the loop that drives it. Zero risk by design: it holds no
money and decides nothing that matters, because every limit that protects the
treasury is enforced on-chain. The worst a compromised keeper can do is waste one
day's allowance on badly-timed but legal trades.

```bash
node keeper/floor.mjs             # dry run: reads, decides, sends nothing
LIVE=1 node keeper/floor.mjs      # actually sends
```

**Dry run is the default and it has to be told to send.** Run it that way for a
day first — it prints the decision it would have made on every tick, so you can
watch it think before it has any money.

  FLOOR_ADDRESS       the contract
  ROBINHOOD_RPC_URL   your RPC
  TICK_MS             how often to look, default 45s
  MIN_GAS_WEI         stop sending under this operator balance, default 0.002 ETH
  keeper/.operator.key    the hot key, chmod 600, gitignored

`keeper/kevin-floor.service` is the systemd unit, and it starts in dry run.

It has been driven end to end against a local anvil with a real v4 PoolManager,
a real pool and real liquidity, through the whole cycle: it sold into the room
above the floor and stopped there to the wei, honoured the cooldown, ratcheted
under a rising price, went quiet when the market walked away, started yielding
after its patience ran out, sold into the room that opened, and reset the whole
of the yielding the moment the price came back — selling after that reset
against the *full* floor and moving the chart exactly 2.50%, which is the sell
stop to four figures.

`contracts/script/LocalFloor.s.sol` builds that world in one command (set
`PATIENCE` to a couple of minutes so the yielding is visible in a rehearsal),
and `LocalPump.s.sol` moves the price either way — `ETH_IN` buys, `KEVIN_IN`
sells. Two bugs in this file were found that way and could not have been found
any other way: it was reading its own system clock instead of the chain's, and
it was checking the cooldown before the ratchet, so a pump arriving in the five
minutes after a sale was neither ratcheted under nor reset.

## Robinhood Chain 4663, read off the chain rather than off a docs page

RPC `https://rpc.mainnet.chain.robinhood.com` — answers `eth_chainId` with
`0x1237`. (The value that used to be in the keeper, `rpc.robinhood.com`, does
not resolve at all.) Explorer: `robinhoodchain.blockscout.com`.

Everything below was read from the chain by following the launchpad factory
that made `0x94B579b6650d80f836B3146e5196b769Bf77a589`, not copied from
documentation.

| | | |
|---|---|---|
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | matches the docs |
| PositionManager | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` | matches |
| Quoter | `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94` | matches |
| StateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | matches |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | matches |
| Universal Router | `0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99` | **the docs value was wrong** |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | |
| KEK | `0x5a3544a0328afd50a9979e03404f35c555b88c00` | |

### The launchpad

| | |
|---|---|
| factory | `0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383` |
| token implementation | `0x0094cD52CA12Cdc6E7620084B594a1392095D459` (each token is a 45-byte EIP-1167 clone) |
| router | `0xcae82a0059cb441d263170743b82a62e2499c378` |
| liquidity manager | `0xeb0226f992f959b7fa2ac7c3dafc712915310fea` |
| locker | `0x506200532B0a5A7B9d1e7C50D0014680FC3B5b13` |
| owner / fee recipient | `0x08cDab8b049D2A42125C3A2bf1bF1E2f619C4e01` |

### The PoolKey, which is the thing that has to be exactly right

Read off the live WETH/CULT pool made by this factory:

```
currency0    0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73   WETH
currency1    <$KEVIN>
fee          3000
tickSpacing  60
hooks        0xFEf8e78090697C808116c56A9E81fC83d4f76000
```

Three things in there are not what this repo originally assumed:

- **The quote is WETH, an ERC20 — not native ETH.** So `fundWarChest()` reverts
  and `fundWarChestToken()` is the one that works, and the swap settles by
  sync-transfer-settle rather than by sending value. That is the path
  `test/KevinFloorV4Erc20.t.sol` exists to cover.
- **There is a hook.** A `PoolKey` with `hooks = address(0)` hashes to a pool
  that does not exist, and a keeper pointed at one looks perfectly healthy while
  doing nothing at all.
- **The fee is 3000 and `lpFee` reads back as 3000**, so liquidity in these
  pools does earn the 0.3%.

The hook's permissions are encoded in the low 14 bits of its address:
`0xFEf8…6000 & 0x3FFF = 0x2000`, which is `BEFORE_INITIALIZE` and nothing else.
**It runs once when the pool is created and never touches a swap or a liquidity
change.** So it cannot tax this contract's trades, cannot block anyone from
adding liquidity, and needs no special handling — it just has to be in the key.

Two pools per token, not three: WETH and KEK. No native-ETH pool, and no GME
pool for the reference token.

**Run `script/Preflight.s.sol` before deploying anything.** It rebuilds the
PoolKey from the same env vars the deploy script uses, reads the pool back, and
refuses if it is not initialised or has no liquidity.
