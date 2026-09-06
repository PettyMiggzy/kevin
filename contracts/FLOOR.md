# KEVIN FLOOR

> A contract that buys the dip and cannot do anything else with your money.

`KevinFloor` holds WETH and $KEVIN and trades one Uniswap V2 pair. It buys when
the price is under a ratcheting reference and sells when it is over one, and
every trade is bounded on-chain so that a leaked operator key can waste a day's
allowance but cannot take the balance.

---

## Read this part first: what 0.35 ETH actually does

On a constant-product pair, offsetting a sell of size **S** costs you very
nearly **S**. There is no leverage in a bid. So the honest arithmetic is:

| | |
|---|---|
| Treasury | 0.35 ETH |
| Net selling it can absorb | **0.35 ETH. Once.** |
| Then | it is empty and holding tokens |

If the pad graduates into a pool with ~4 ETH in it, 0.35 ETH is about 9% of the
pool. Spending all of it in one go moves the price roughly +9%. One person
selling 1 ETH's worth moves it about −20%, and you cannot answer that.

**So this is not a floor and nothing written in Solidity makes it one.** What it
is, and these are worth having:

- **a standing bid under the book.** Small sells get absorbed instead of
  printing red candles, which is most of what a chart's first week looks like.
- **an accumulator.** Every dip it buys is $KEVIN bought cheap with treasury
  ETH. If the thing works, that inventory is worth more than the ETH was.
- **a ratchet.** The reference only ever goes up, so the band it defends rises
  with the price instead of anchoring to launch day.
- **a rule instead of a mood.** The reason to automate this is not speed, it is
  that a bot does not panic at 3am and does not double down.

The number that decides whether a floor holds is the size of the treasury. If
you want a real one, the lever is topping this contract up out of the auction
proceeds as they land, not tuning the parameters.

## One pool, not three

$KEVIN opens against three: WETH 45%, KEK 40%, GME 15%. **Put every bit of the
ammunition in the WETH pool.** Three mechanical reasons:

1. The other two are priced in KEK and GME. Buying $KEVIN there needs KEK and
   GME inventory, not ETH — so the ammunition has to be swapped into two thin
   assets first, paying a spread and a fee each way, and then sits in two things
   whose own price swings are bigger than the move it was bought to defend.
2. A third of not-enough is nothing. 0.117 ETH does not move a pool.
3. It is unnecessary. Buying in the deepest pool moves $KEVIN's price there, and
   arbitrage closes the gap in the other two within blocks — paid for by the
   arbitrageur. One pool's fees buy three pools' support.

## The rails, and the threat model

The operator is a hot key on a server. **Assume it leaks.** Everything that
stops a leaked key emptying the contract is enforced in the contract, not in the
script that calls it:

| Rail | What it stops |
|---|---|
| operator names no path, no router, no recipient | the key cannot swap your balance for a token it just deployed |
| `maxWethPerTrade` / `maxTokensPerTrade` | one transaction spending everything |
| `dailyWethCap` / `dailyTokenCap`, rolling 24h | a bad day costing more than a day |
| `cooldown` | the daily cap being spent in one block |
| reserve-derived `minOut`, `maxSlippageBps` | `minOut = 0` handing the balance to a sandwich |
| `minSellPrice` | being talked into selling into a crash |
| `pause()` | everything, immediately, from the owner |

`test_aLeakedKeyCannotTakeMoreThanADay` hands the operator key to an attacker,
lets them poke forty times, and asserts that what left is at most the daily cap.

**What the owner can still do to you:** `sweep()` takes everything. That is
deliberate and it is stated here rather than hidden behind a timelock nobody
would wait out on a treasury this size. The owner should be a multisig.

## Suggested day-one settings

Sized for 0.35 ETH against a ~4 ETH pool. Deliberately timid — you can widen
them in a transaction once you have watched it work, and you cannot un-spend.

```
MAX_WETH_PER_TRADE    0.02 ether     ~0.5% of the pool per buy
DAILY_WETH_CAP        0.08 ether     four bad days before it is gone
MAX_TOKENS_PER_TRADE  0              selling OFF (see below)
DAILY_TOKEN_CAP       0
COOLDOWN              600            ten minutes
MAX_SLIPPAGE_BPS      300            3% off the reserves' own arithmetic
buyBandBps            1200           a dip is 12% under the reference
sellBandBps           2500           a spike is 25% over it
refStepBps            500            the reference climbs at most 5% a poke
```

**The sell side ships switched off.** Buying is the half that supports the
price. Selling treasury tokens into strength is normal treasury management and
plenty of projects do it — but it is the half that needs a decision from you
about what holders have been told, so it does not turn itself on.

If you do turn it on, publish it: the contract address, that it is the
treasury's, and the rule it follows. That costs you nothing today and it is the
difference between "the team runs a disclosed rebalancer" and someone finding an
unexplained sell wallet on the explorer in week three. `reading()` and the
`Bought`/`Sold` events make it auditable by anyone who cares to look, which is
the point of doing it on-chain rather than from a wallet.

## Deploying

The pair has to exist first — it does not exist until the token graduates off
the pad.

```bash
export PRIVATE_KEY=...
export KEVIN_TOKEN=0x...          # once it exists
export WETH=0x...                 # WETH on Robinhood Chain
export V2_FACTORY=0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f
export V2_ROUTER=0x89e5db8b5aa49aa85ac63f691524311aeb649eba
export FLOOR_OWNER=0x...          # multisig
export FLOOR_OPERATOR=0x...       # the hot key

forge script script/DeployFloor.s.sol --rpc-url robinhood --broadcast
```

> **Check those two addresses on the explorer before you send anything.** They
> come from Uniswap's own deployment docs for chain 4663 and they have not been
> verified against `robinhoodchain.blockscout.com` from here. A router address
> that is wrong by one character is a contract that eats the first trade.

Then, from the owner:

1. `setOperator(...)` and `setRails(...)` if the deployer was not the owner.
2. `setReference(spotPrice())` — **it does nothing at all until this is set.**
3. Send it ETH. It wraps on arrival.

Fund it with a slice first — 0.05 ETH — and watch one buy land before you send
the rest.

## What it cannot protect you against

- Somebody selling more than the treasury holds. See the arithmetic at the top.
- The pad's own LP being pulled, if it can be.
- A price that is falling because nobody wants the token. A bid does not create
  demand, it only spends your ETH more slowly than a market order would.
- Your own operator running it into a trend. Bands and caps bound the damage,
  they do not make the call.
