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
