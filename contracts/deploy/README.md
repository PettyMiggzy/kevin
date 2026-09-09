# Ready-to-broadcast bytecode

## Already deployed, chain 4663

| what | address | state |
|---|---|---|
| KevinAirdrop | `0x37F93dAFF688120d6C7793833cACd830A988A971` | owner = treasury, `roundCount()` 0 — holds nothing |
| KevinFloorV4 (KEVIN/WETH) | `0xd7309Cc9383Feb44d09202764A72951B962a25Ab` | configured but deliberately not driven; its operator key was lost, so repoint it before any use |
| KevinFloorV4 (KEVIN/KEK) | `0x47Dd22f76129d4AeC0c93668b905BC360657A29C` | **LIVE** — driven by the keeper, sold its first 2,000,000 KEVIN, holds a ~677,000 KEK war chest |

## Built but NOT deployed: KevinLock

`KevinLock.create.hex` is ready to broadcast and was driven end to end against a
fork of this chain — deployed, wired with `setLockbox`, funded with 3,000,000
$KEVIN, and dripped. The accrual was exact at 6h (75,052), 30h (375,052) and
capped correctly at the 3-day bank (900,000), and `release()` succeeded when
called from an unrelated wallet, which is the permissionless behaviour it is
supposed to have.

It was not deployed, on purpose. The owner needs to be able to pull supply back
on short notice, and this contract exists to make that hard: tokens leave only
through the drip, or through `requestExit()` and a public countdown that cannot
be shortened after deploy. Worse, `setLockbox` on the floor is ONE SHOT and
PERMANENT, and it changes `sweep()` so $KEVIN can never again be swept anywhere
but the lockbox. Setting it would trade away exactly the flexibility that was
asked for.

Deploy it when the goal is the opposite: convincing holders the treasury
*cannot* dump. Not before.

**THE CONSTRUCTOR ARGUMENTS ARE BAKED INTO THIS HEX.** Rebuild it if any of
them should differ:

| arg | value in the artifact |
|---|---|
| `token_` | `0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A` ($KEVIN) |
| `floor_` | `0x47Dd22f76129d4AeC0c93668b905BC360657A29C` (the KEK market maker) |
| `beneficiary_` | `0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf` (treasury) |
| `ratePerDay_` | 300,000 $KEVIN |
| `exitDelay_` | 604800 (7 days) |
| `exitWindow_` | 172800 (2 days) |

`ratePerDay` can only ever be LOWERED after deploy, via `slowDown()`. `floor`,
`beneficiary` and `exitDelay` are immutable. sha256 of the artifact:
`300233cd67f7b65b47ff59ff1c019fdc3ca1d3e0266e23a0c7a89af5f69694b0`.

Both verified against the chain rather than the receipt. The airdrop's runtime
bytecode is a byte-exact match for the compiled artefact. The keeper has
immutables, so its runtime differs from the artefact only inside the 39 slots
the compiler declares for them, and everything outside those slots matches
exactly — its `poolId()` is the live KEVIN/WETH pool, and
`MAX_OBSERVATION` (3600) and `MAX_FLOOR_DECAY_BPS` (3000) are present, which
is what proves the deployed code is the post-audit version rather than the one
the audit found the clock bug in.

Both keeper blobs are now spent. Rails are per-pool and NOT interchangeable:
the WETH pool is priced in fractions of an ETH, the KEK pool in millions of
KEK, and the same figures in the wrong one would be off by nine orders of
magnitude.

Measured off the live pools:

| | KEVIN/WETH | KEVIN/KEK |
|---|---|---|
| one 2.5% poke sells | 1,562,341 KEVIN | 1,916,064 KEVIN |
| raising | 0.0055 WETH | 784,946 KEK |
| pushing 23.5% into the bid band costs an attacker | 0.055 WETH | 7,822,383 KEK |
| so maxQuotePerTrade (~18% of that) | 0.01 WETH | 1,400,000 KEK |


`forge` needs `contracts/lib/` — v4-core, OpenZeppelin, forge-std — which is
gitignored and 27MB of Solidity to compile. On a 1 vCPU / 1GB droplet that
build is likely to run out of memory, and there is no reason to run it there:
the deployment is one transaction and the bytecode is already fixed.

So the creation calldata is committed here, and deploying needs only `cast`.

## KevinAirdrop

`KevinAirdrop.create.hex` — creation bytecode with the constructor argument
already appended, `owner = 0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf`.

    sha256  834c4471702838180dcf02f31f288021a3d1e507e4d19639be5af5b506cf2974

Verified on a local chain before publishing: deploys with status 1, `owner()`
returns the treasury, `roundCount()` is 0, `MIN_WINDOW()` is 604800.
About 1,494,913 gas — roughly 0.00034 ETH at the current price.

    curl -sL https://raw.githubusercontent.com/PettyMiggzy/kevin/claude/kevin-crypto-art-website-ymq79j/contracts/deploy/KevinAirdrop.create.hex -o /tmp/airdrop.hex
    sha256sum /tmp/airdrop.hex   # must match the hash above

    export PRIVATE_KEY=0x...
    cast send --private-key "$PRIVATE_KEY" \
      --rpc-url https://rpc.mainnet.chain.robinhood.com \
      --create "$(cat /tmp/airdrop.hex)"

`cast` alone is enough — `curl -L https://foundry.paradigm.xyz | bash && foundryup`.

## Check what you deployed, before funding it

    A=0x<the contractAddress from the receipt>
    cast call $A 'owner()(address)'    --rpc-url https://rpc.mainnet.chain.robinhood.com
    cast call $A 'roundCount()(uint256)' --rpc-url https://rpc.mainnet.chain.robinhood.com

`owner()` must be the treasury and `roundCount()` must be 0. If either is
wrong, stop and do not send it anything.

## It holds nothing until a round is opened

Deploying is not funding. Opening the GME round is a separate, deliberate
step, and the order matters because the root is permanent the moment it is
set:

1. Regenerate the tree for the EXACT amount being funded — the leaves carry
   absolute amounts, not shares. Fund less than they sum to and the last
   claimants revert with Overdrawn.
2. `node tools/airdrop-snapshot.mjs --verify claim/round.json`
3. Publish that file.
4. `approve()` this contract for the payout token.
5. `openRound(token, root, amount, deadline, uri)`

Publish before opening. Once the round exists the root cannot change, so the
list has to be the one people were given.

## KevinFloorV4

Not here yet. Its constructor takes a PoolKey, so there is one blob per pool
and the pool has to be preflighted first — see `../deploy.sh`.

---

## KevinFloorV4 — one blob per pool

The constructor takes the PoolKey, so the pool is fixed at deploy and cannot
be changed afterwards. Two blobs, both with `owner` = the treasury:

| file | pool | poolId (checked against the live pool) |
|---|---|---|
| `KevinFloorV4.weth.create.hex` | KEVIN / WETH | `0xd3ca7f46…83af63` |

sha256 `d09154aae3c3b251b7cf88cb22e7adf084dd153ce25f62343685c77c2e9b211a` (weth)
and `14ed9593893d4c6d4494a2c3ef0c5cf4e7f1aad0e17e7b654dc9620091ee0f43` (kek).
Check before broadcasting.

| `KevinFloorV4.kek.create.hex`  | KEVIN / KEK  | `0x2d36afcd…dfd05b` |

Both were deployed on a local chain first and read back: owner, currency0,
currency1, fee 3000, tickSpacing 60, hooks `0xFEf8e780…`, `upIsUp` false —
and `poolId()` equal to the id preflighted against the live pool. That last
check is the one that matters: a v4 pool IS the hash of those five fields, so
a matching id is proof the contract points at the real pool rather than an
uninitialised one that would look healthy and do nothing.

    curl -sL https://raw.githubusercontent.com/PettyMiggzy/kevin/claude/kevin-crypto-art-website-ymq79j/contracts/deploy/KevinFloorV4.weth.create.hex -o /tmp/mm.hex
    ~/.foundry/bin/cast send --private-key "$PRIVATE_KEY" --rpc-url https://rpc.mainnet.chain.robinhood.com --create "$(cat /tmp/mm.hex)"

## It cannot trade until you tune it, and that is deliberate

Fresh out of the constructor `maxTokensPerTrade` is 0, so every poke reverts.
Nothing can happen by accident between deploying and deciding the limits.

Four owner calls, in this order. `$MM` is the address from the receipt.

**1. The operator — a NEW key, never the treasury.** It signs from a hot box
every few minutes. If it is the owner key, a keeper compromise stops being a
capped incident and becomes total loss, and every published ceiling in the
contract turns decorative because the thief can just call `setPolicy`.

    ~/.foundry/bin/cast wallet new
    ~/.foundry/bin/cast send $MM 'setOperator(address)' $HOT --private-key "$PRIVATE_KEY" --rpc-url $RPC

**2. The rails.** Quantities, and the ones worth being conservative about.
`maxQuotePerTrade` is the real defence against somebody farming the bid: if
one bite is small relative to what it costs to push the price into the buy
band, dumping to trigger it is not profitable. The band alone does not do it.

    ~/.foundry/bin/cast send $MM 'setRails(uint256,uint256,uint256,uint256,uint256)' \
      250000000000000000000000 <MAX_QUOTE> 2000000000000000000000000 <DAY_QUOTE> 300 \
      --private-key "$PRIVATE_KEY" --rpc-url $RPC

THE QUOTE FIGURES ARE IN THE QUOTE TOKEN. For the WETH pool they are WETH;
for the KEK pool they are KEK, and a number that made sense for WETH will be
nonsense there.

THERE IS NO SUCH NUMBER AS "NO CAP". `setRails` has no upper bound, so it takes
`type(uint256).max` without complaint — and then every poke reverts. `_tick()`
drains the bucket by `cap * elapsed / 86400`, and that multiplication overflows
for any elapsed time above one second. Verified on a fork of this chain: the
call succeeded, and a poke an hour later failed with an arithmetic overflow
panic. Calling `setRails` again with a sane number recovers it, but until then
the contract cannot trade at all.

For a rail that is unlimited in every practical sense, use the token's whole
supply — `1000000000000000000000000000`, which is 1e27 wei, a billion tokens.
Nothing can ever exceed it, and the drain has about fifty orders of magnitude
of headroom before it overflows. Also verified: rails set to the full supply
survived a simulated year with no trade and then poked normally.

**3. The policy.** `1000` is the 10% bid band.

    ~/.foundry/bin/cast send $MM 'setPolicy(uint256,uint256,uint256,uint256,uint256)' \
      1500 500 1000 3000 250 --private-key "$PRIVATE_KEY" --rpc-url $RPC

Those two dials COMPOUND. The floor sits 15% under spot and the band is
measured from the floor, so nothing is bid until the price is about 23.5%
under the level the floor was set at — not 10%.

**4. Arm the floor.** Nothing trades before this; `floorSqrtPriceX96` is 0
and every poke reverts `NoFloorYet`.

    ~/.foundry/bin/cast send $MM 'setFloorFromSpot(uint256)' 1500 --private-key "$PRIVATE_KEY" --rpc-url $RPC

## Funding it

- **$KEVIN** — a plain transfer to `$MM`. This is what it sells.
- **The quote** (WETH or KEK) — `approve($MM, amount)` on the quote token,
  then `fundWarChestToken(amount)`. This is what it bids with.
- **ETH** — none. Neither side of these pools is native, so the contract has
  no use for it. Gas comes from the OPERATOR wallet; keep a little there.

Send a small amount first and drive one `poke` before sending anything real.
