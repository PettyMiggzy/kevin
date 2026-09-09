# The floor keepers

Two processes, one per pool. Same program, different `FLOOR_ADDRESS`.

| Pool | Contract | State |
|---|---|---|
| KEVIN / WETH | `0xd7309Cc9383Feb44d09202764A72951B962a25Ab` | tuned, floor set, holds no $KEVIN yet |
| KEVIN / KEK | `0x47Dd22f76129d4AeC0c93668b905BC360657A29C` | tuned, floor set, holds no $KEVIN yet |

The keeper holds no money and decides nothing that matters. Every limit that
protects the treasury lives in the contract, where the keeper cannot reach it.
The worst a compromised keeper can do is trade inside the rails, at the wrong
moment, until it runs out of daily allowance.

## Running it

```sh
cp 'keeper/kevin-floor@.service' /etc/systemd/system/
mkdir -p /etc/kevin
cp keeper/floor-weth.env.example /etc/kevin/floor-weth.env
cp keeper/floor-kek.env.example  /etc/kevin/floor-kek.env
systemctl daemon-reload
systemctl enable --now kevin-floor@weth kevin-floor@kek
journalctl -fu kevin-floor@weth -u kevin-floor@kek
```

Both start in **dry run**. They print what they would do and send nothing.
`LIVE=1` in one pool's env file turns that pool on, and no other.

## Before LIVE=1

A poke reverts unless the contract has something to trade with, so turning it
on early just burns gas on failures. The keeper refuses to poke into that now —
it says so instead — but the fix is funding, not the guard:

1. **ETH to the operator** `0x92B129f7…`, for gas. About 0.01 ETH is 170 pokes.
2. **$KEVIN to the floor contract** so it has something to sell.
3. **WETH / KEK via `fundWarChestToken()`** so it has something to buy with.
   A plain transfer does not count — the war chest is a number the contract
   keeps, and only that function credits it.

## What it costs to watch

Reads are free. The only question is how hard it leans on your endpoint.

| | per tick | per day at 45s |
|---|---|---|
| JSON-RPC calls | 3 | ~5,800 |
| HTTP requests | 2 | ~3,800 |

It was 17 calls a tick. The client folds a tick's reads into one Multicall3
`eth_call` (Multicall3 is deployed at the canonical address on this chain) and
the transport puts the rest in one HTTP body. Measured through a counting
proxy, not estimated.

## The sequencer feed, and why it is off

`wss://feed.mainnet.chain.robinhood.com` is the chain's Nitro sequencer feed.
Setting `FEED_URL` makes the keeper wait to be told the pool moved instead of
asking on a timer, and drops the polling tick to `IDLE_MS` (5 min) underneath
as a backstop.

It works. Measured live: **788 messages in 30 seconds, 11 MB**, and the
substring matcher fired correctly on a control address that was trading.

It is off by default because of the bandwidth. That is the whole chain
unfiltered:

| | |
|---|---|
| rate | 358 KB/s |
| per day | 31.7 GB |
| per month, one keeper | ~950 GB |
| per month, both keepers | ~1.9 TB |

A basic droplet includes 1 TB. So the feed buys latency — seconds instead of
up to 45 — at most of a month's transfer allowance, and it does not make the
keeper any more correct. Turn it on when the latency is worth money.

## Reading the log

One line per tick, whether or not anything happened. A keeper that only logs
when it acts is indistinguishable from a keeper that has died. Repeated notes
are said once and then every twentieth tick, so a quiet hour is a line or two.
