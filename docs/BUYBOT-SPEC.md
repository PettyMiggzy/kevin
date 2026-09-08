# Buy bot spec — $KEVIN on Robinhood Chain

Hand this to whoever is building the bot. It is written from a working
implementation (`keeper/buywatch.mjs` in this repo) and from three false
alerts that happened on launch morning, each of which made a real person
think they had been robbed.

---

## The problem with the obvious design

The obvious bot subscribes to Swap events on a pool and announces each one.
On this token that produces **wrong alerts**, and here is exactly how it
failed on day one:

1. **An arbitrage bot got announced as a buyer.** It bought 5,733,486 KEVIN
   in the WETH pool and sold every one of them into the KEK pool *in the same
   transaction*. A per-pool watcher sees hop one and shouts "BUY". Net tokens
   to that wallet: **zero**.
2. **A routed buy got reported as a fragment.** A 0.06 ETH buy went
   WETH → KEK → KEVIN. Watching one pool shows one leg, so the alert said
   0.021 ETH. The buyer saw it, concluded he had been given a third of what
   he paid for, and said so publicly.
3. **Two buys read as one.** Somebody bought twice in one transaction and saw
   only the smaller number.

There are **three pools** (WETH, KEK, GME) and they are all live. Any bot
that watches one pool, or watches pools at all, will reproduce all three
failures.

---

## The rule that fixes all three

> **Net the whole transaction, per wallet. Announce only when a real wallet
> ends up holding MORE $KEVIN than it started with. Report every wei of ETH
> that left, across every hop and every pool.**

Do not watch pools. Watch **where the tokens ended up**.

- An arb nets to zero, so it can never produce an alert. No blacklist to
  maintain, no address list to keep current — it is structurally impossible.
- A routed buy reports the full 0.06 because you summed the whole tx.
- A double buy produces one line with the total.

This also means new pools need no code change. A fourth pool opening tomorrow
is handled automatically, because the bot was never pool-aware.

---

## How to implement it

For each new block (or block range):

1. `eth_getLogs` for ERC-20 `Transfer` on the **$KEVIN token address only**.
   Topic0 = `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`
2. Group the logs **by `transactionHash`**.
3. For each transaction, build a map of `address -> net KEVIN delta`
   (subtract when it is the `from`, add when it is the `to`).
4. Do the same for WETH deltas, to know what was paid.
5. **Drop the plumbing** from that map — these are not buyers:

   ```
   PoolManager     0x8366a39CC670B4001A1121B8F6A443A643e40951
   PositionManager 0x58daec3116aae6D93017bAAea7749052E8a04fA7
   UniversalRouter 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99
   sell router     0x8876789976dEcBfCbBbe364623C63652db8C0904
   launchpad router 0xcae82a0059cb441d263170743b82a62e2499c378
   factory         0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383
   locker          0x506200532B0a5A7B9d1e7C50D0014680FC3B5b13
   permit2         (whatever the chain's is)
   burn            0x000000000000000000000000000000000000dEaD  and  0x0
   ```

6. Anything left with a **positive** net is a buyer. What they paid is
   `tx.value` if it was native ETH, otherwise the WETH they gave up.
7. Anything left with a **negative** net is a seller.
8. Below a minimum size, say nothing. 0.001 ETH is a sane floor.

---

## The thing that will catch him out

**Most sells never touch the PoolManager directly.** They go through a
router, which takes the tokens, sells them, and forwards the proceeds. That
first hop looks exactly like an innocent wallet-to-wallet transfer.

`0x8876789976dEcBfCbBbe364623C63652db8C0904` is that router on this chain.
It is a contract, it holds zero KEVIN, and 36 distinct unrelated wallets have
sent it tokens — every one of which it forwarded straight into the pools.

If he treats "sold" as "transferred to the PoolManager", his bot will report
real sellers as holders. Sending to that router **is** selling.

The same mistake in reverse ruins cluster analysis: crawling outward *through*
a shared router stops tracing one group and starts tracing the whole chain.
It once produced a reading of "342,181,980 sold" for a group that had sold
nothing — that was the router's total throughput for all 36 of its users.

---

## Chain facts he needs

```
chain            Robinhood Chain, id 4663
rpc              https://rpc.mainnet.chain.robinhood.com
explorer         https://robinhoodchain.blockscout.com/tx/

$KEVIN           0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A   18dp
WETH             0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
KEK              0x5a3544a0328afD50A9979e03404F35c555B88c00
GME              0x1b0E319c6A659F002271B69dB8A7df2F911c153E

pools (Uniswap v4, poolIds not addresses — tokens live in the PoolManager)
  KEVIN/WETH  0xd3ca7f46595df4eb7a3af7c12fdc0d7bd5bf7a2b98f1369282a278ef8283af63
  KEVIN/KEK   0x2d36afcddd3abe0f09a560a45e19e6f709bcfd49d249116c2c471c0091dfd05b
  KEVIN/GME   0x3af7e5d7ef962f99c4bfa54285ee705c61e11ecbd42cf1ddaea240c4acf49743

PoolKey: fee 3000, tickSpacing 60, hooks 0xFEf8e78090697C808116c56A9E81fC83d4f76000
The hook is BEFORE_INITIALIZE only — it never touches swaps.
WETH is an ERC-20 here, NOT native. Quote side is a token.
```

---

## Two practical gotchas

1. **viem's `getLogs()` silently drops a hand-built `topics` array** and scans
   every log on the chain instead. The node rejects that at 50,000 matches.
   Call `eth_getLogs` through `publicClient.request()` directly.
2. **The public RPC rate-limits bursts**, and a scan is a burst by nature.
   Back off and retry — a run that dies halfway leaves stale output with no
   sign anything is wrong, which is the worst failure available to a bot
   nobody is watching.

Use 2 confirmations. Persist the last processed block so a restart does not
re-announce.

---

## Working reference

`keeper/buywatch.mjs` in this repo already does all of the above, and
`keeper/test/buywatch.test.mjs` tests it against **real receipts pulled from
the chain**, including the arb that caused failure #1. The strongest
assertion in there: netting the two-buy wallet reproduces that address's
`balanceOf()` to the wei.

He is welcome to read it, port it, or ignore it — but the netting rule is not
optional. Every alternative design reproduces the three failures above.
