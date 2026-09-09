# Ready-to-broadcast bytecode

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
