#!/usr/bin/env bash
# Bring the KEVIN/WETH market maker online.
#
#   cd /opt/kevin && ./keeper/setup-weth-pool.sh
#
# WHY THIS EXISTS. The kekfun LP lock is permanent, so the KEK pool's share of
# price discovery can never be reduced by moving liquidity out of it. The only
# lever left is where NEW depth and NEW volume land, and the first step is
# making WETH the pair the project itself operates on.
#
# This script does the parts that need no private key, and stops with exact
# instructions at each part that does. It never asks for the treasury key.
set -uo pipefail
RPC=https://rpc.mainnet.chain.robinhood.com
CAST=~/.foundry/bin/cast
MM=0xd7309Cc9383Feb44d09202764A72951B962a25Ab      # KevinFloorV4, KEVIN/WETH
KEVIN=0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
TREASURY=0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf
KEY=/opt/kevin/keeper/.operator-weth.key

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  ok  %s\n' "$*"; }
todo(){ printf '  >>  %s\n' "$*"; }

say "1. Where the WETH market maker stands"
echo "  operator on chain  $($CAST call $MM 'operator()(address)' --rpc-url $RPC)"
echo "  KEVIN it holds     $($CAST call $KEVIN 'balanceOf(address)(uint256)' $MM --rpc-url $RPC | cut -d' ' -f1)"
echo "  war chest (WETH)   $($CAST call $MM 'warChest()(uint256)' --rpc-url $RPC | cut -d' ' -f1)"
echo "  paused             $($CAST call $MM 'paused()(bool)' --rpc-url $RPC)"

say "2. Operator key for this pool"
# A SEPARATE KEY FROM THE KEK KEEPER, ON PURPOSE. Two processes signing from one
# address pick the same nonce and one transaction is silently lost — proved
# against anvil earlier. One key per keeper, always.
if [ -s "$KEY" ]; then
  ok "already have one: $($CAST wallet address --private-key "$(cat $KEY)")"
else
  OUT=$($CAST wallet new 2>&1)
  printf '%s\n' "$OUT" | awk '/Private key:/{print $3}' > "$KEY"
  chmod 600 "$KEY"
  NEW=$(printf '%s\n' "$OUT" | awk '/Address:/{print $2}')
  unset OUT
  ok "created $NEW  (key written to $KEY, never printed)"
  todo "point the contract at it, from the treasury:"
  echo "        $CAST send $MM 'setOperator(address)' $NEW \\"
  echo "          --private-key \"\$PRIVATE_KEY\" --rpc-url $RPC"
  todo "then send that address about 0.01 ETH for gas"
fi

say "3. Its environment file"
if [ -s /etc/kevin/floor-weth.env ]; then
  ok "/etc/kevin/floor-weth.env exists, leaving it alone"
else
  mkdir -p /etc/kevin
  cp /opt/kevin/keeper/floor-weth.env.example /etc/kevin/floor-weth.env
  ok "seeded /etc/kevin/floor-weth.env — starts in DRY RUN"
fi

say "4. What it still needs before it can do anything"
todo "KEVIN to sell:  $CAST send $KEVIN 'transfer(address,uint256)' $MM <amount> ..."
todo "WETH to bid with, and note this one is NOT a plain transfer:"
echo "        $CAST send $WETH 'approve(address,uint256)' $MM <amount> ..."
echo "        $CAST send $MM 'fundWarChestToken(uint256)' <amount> ..."
echo
echo "  The treasury holds $($CAST balance $TREASURY --rpc-url $RPC) wei of ETH and"
echo "  $($CAST call $WETH 'balanceOf(address)(uint256)' $TREASURY --rpc-url $RPC | cut -d' ' -f1) wei of WETH."
echo "  The bid side does nothing until there is WETH in the war chest."

say "5. Start it"
todo "./setup.sh    (it will pick up floor-weth.env and start kevin-floor@weth in dry run)"
todo "watch:  journalctl -fu 'kevin-floor@weth'"
todo "when happy:  echo 'LIVE=1' >> /etc/kevin/floor-weth.env  &&  ./setup.sh"
