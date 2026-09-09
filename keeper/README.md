# The floor keepers

One program, one instance per pool driven. **Today that is the KEK pool only.**

| Pool | Contract | State |
|---|---|---|
| KEVIN / KEK | `0x47Dd22f76129d4AeC0c93668b905BC360657A29C` | **live and trading** — funded, floor walking up, selling |
| KEVIN / WETH | `0xd7309Cc9383Feb44d09202764A72951B962a25Ab` | deployed and tuned, **not driven** — no keeper, holds nothing |

The WETH floor is inert by construction rather than by promise: `poke()` is
`onlyOperator`, so with no keeper process running, nothing calls it. It also
holds no $KEVIN and no war chest, so a poke would revert even if something did.
Leaving it deployed costs nothing and keeps the option open.

The keeper holds no money and decides nothing that matters. Every limit that
protects the treasury lives in the contract, where the keeper cannot reach it.
The worst a compromised keeper can do is trade inside the rails, at the wrong
moment, until it runs out of daily allowance.

## Running it

A pool is driven only if you created its file. `setup.sh` does not seed them:
that is the difference between "installed" and "running", and it should be a
decision, not a default.

```sh
cp keeper/floor-kek.env.example /etc/kevin/floor-kek.env   # the KEK pool, and only it
./setup.sh
journalctl -fu 'kevin-floor@kek'
```

To drive the WETH pool later, copy `floor-weth.env.example` the same way and
re-run `setup.sh`. Until that file exists, no WETH keeper is installed, enabled
or started.

It starts in **dry run**: it prints what it would do and sends nothing. `LIVE=1`
in that pool's env file turns that pool on, and no other.

## Before LIVE=1

A poke reverts unless the contract has something to trade with, so turning it
on early just burns gas on failures. The keeper refuses to poke into that now —
it says so instead — but the fix is funding, not the guard:

1. **ETH to the operator** `0x539a943BddB3E8dcba611cc665Cae0Fcbd2717c3`, for
   gas. This is also the address a price chart will label as the trader: the
   contract holds the money and is the swap `sender` the PoolManager records,
   but the operator is `tx.from`, and most chart tools attribute by that.
   Measured on a fork of the
   real chain at 0.1919 gwei: a poke is 176k–213k gas, a ratchet 64k–98k, so
   0.01 ETH is roughly 400 pokes. The keeper stops sending below 0.002 ETH.
2. **$KEVIN to the floor contract** so it has something to sell. Read the
   sizing note below before choosing the amount — it will sell what you send.
3. **KEK via `fundWarChestToken()`** so it has something to buy with. That
   function uses `transferFrom`, so `approve()` the floor first. A plain
   transfer does not count: the war chest is a number the contract keeps, and
   only that function credits it.

### One key, or two

Both floors currently name the same operator. If you ever drive both pools at
once, give the second one its own hot key and `setOperator()` it: two processes
signing from one address pick the same nonce and one transaction is silently
lost. Demonstrated against anvil — the second send fails with "nonce provided
is lower than the current nonce" and never lands. Driving one pool, as now,
this does not arise.

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

Measured twice, at different times of day, and the chain's own busyness moves
the number a lot:

| | quiet sample | busy sample |
|---|---|---|
| rate | 358 KB/s | 493 KB/s |
| per day | 31.7 GB | 43.6 GB |
| per month, one keeper | ~950 GB | ~1,310 GB |

There is no compression to hope for: the socket negotiates no
`permessage-deflate`, so wire bytes and payload bytes come out identical,
ratio 1.00. A basic droplet includes 1 TB, so a single keeper on this feed
ranges from eating most of the month's allowance to **exceeding it outright**.

It does not make the keeper any more correct — the timer already covers it.
Turn it on when seconds of latency are worth a bigger droplet.

## Reading the log

One line per tick, whether or not anything happened. A keeper that only logs
when it acts is indistinguishable from a keeper that has died. Repeated notes
are said once and then every twentieth tick, so a quiet hour is a line or two.

## The two addresses to publish

| address | what it is | what to call it |
|---|---|---|
| `0x47Dd22f76129d4AeC0c93668b905BC360657A29C` | the contract. Holds the $KEVIN and the war chest, and is the `sender` the v4 PoolManager records on every swap. | KEVIN Market Maker |
| `0x539a943BddB3E8dcba611cc665Cae0Fcbd2717c3` | the operator. Signs every trade and pays the gas, holds nothing. | KEVIN Market Maker Bot |

Publish both. The contract is the honest answer to "where is the money", but
price charts label a trade by `tx.from`, which is the operator — so that is the
one that shows up in a "wallets that traded" view. Confirmed on the first live
sale, transaction `0xb608ee00…4b51`: the PoolManager's `Swap` names the
contract as sender, while `tx.from` is the operator.

Rotating the operator key changes the second address, and any chart tag on it
goes stale. The contract address never changes.
