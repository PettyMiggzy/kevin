#!/usr/bin/env bash
#
# KEVIN — guided deploy. Run it from contracts/ with PRIVATE_KEY exported in
# your shell and nowhere else. Nothing here writes a key to disk.
#
#   export PRIVATE_KEY=0x...      # treasury 0xCDD5ff5d...
#   ./deploy.sh preflight         # read-only, proves the pool is there
#   ./deploy.sh floor             # 1. the floor keeper
#   ./deploy.sh lock  <floorAddr> # 2. the lockbox, pointed at it
#   ./deploy.sh bind  <floorAddr> <lockAddr>   # 3. ONE SHOT, do not skip
#   ./deploy.sh airdrop           # 4. the GME distributor
#
# THE ORDER MATTERS. The lock's `floor` is immutable, so the floor has to
# exist first. And until `bind` is done, $KEVIN released by the lock sits in a
# contract one key can sweep anywhere — which is the lock funnelling the bag
# straight past itself, worse than no lock at all because the claim is public.
set -euo pipefail

# --- verified on chain 4663, 2026-09-08, by script/Preflight.s.sol ----------
# The pool id these five hash to is
#   0xd3ca7f46595df4eb7a3af7c12fdc0d7bd5bf7a2b98f1369282a278ef8283af63
# which matches the KEVIN/WETH pool the launchpad actually created. A v4 pool
# IS the hash of all five fields, so one wrong number is not an error you will
# see — it is a different, uninitialised pool, and a keeper pointed at one
# looks perfectly healthy while doing nothing at all.
export ROBINHOOD_RPC_URL="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
export KEVIN_TOKEN=0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A
export QUOTE=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73          # WETH, not native ETH
export POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
export POOL_FEE=3000
export TICK_SPACING=60
export POOL_HOOKS=0xFEf8e78090697C808116c56A9E81fC83d4f76000     # NOT address(0)
TREASURY=0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf
GME=0x1b0E319c6A659F002271B69dB8A7df2F911c153E

export FLOOR_OWNER="${FLOOR_OWNER:-$TREASURY}"
export FLOOR_OPERATOR="${FLOOR_OPERATOR:-$TREASURY}"
export BENEFICIARY="${BENEFICIARY:-$TREASURY}"
export OWNER="${OWNER:-$TREASURY}"

need_key() { : "${PRIVATE_KEY:?export PRIVATE_KEY first — and only into your shell}"; }
RPC=(--rpc-url robinhood)

case "${1:-}" in
preflight)
  forge script script/Preflight.s.sol "${RPC[@]}"
  ;;

floor)
  need_key
  echo "Deploying KevinFloorV4 at pool ${POOL_HOOKS} / fee ${POOL_FEE} ..."
  forge script script/DeployFloorV4.s.sol "${RPC[@]}" --broadcast
  echo
  echo "NEXT: ./deploy.sh lock <the KevinFloorV4 address printed above>"
  ;;

lock)
  need_key
  FLOOR="${2:?usage: ./deploy.sh lock <floorAddress>}"
  # The lock's floor is immutable. Prove there is code at it before committing.
  code=$(cast code "$FLOOR" "${RPC[@]}")
  [ "$code" != "0x" ] || { echo "REFUSING: no contract at $FLOOR"; exit 1; }
  export FLOOR_ADDRESS="$FLOOR"
  : "${RATE_PER_DAY:?set RATE_PER_DAY in 18dp wei, at or below the floor dailyTokenCap}"
  export RATE_PER_DAY
  forge script script/DeployLock.s.sol "${RPC[@]}" --broadcast
  echo
  echo "NEXT, AND DO NOT SKIP: ./deploy.sh bind $FLOOR <the KevinLock address>"
  ;;

bind)
  need_key
  FLOOR="${2:?usage: ./deploy.sh bind <floorAddress> <lockAddress>}"
  LOCK="${3:?usage: ./deploy.sh bind <floorAddress> <lockAddress>}"
  # setLockbox is one shot and can never be changed or unset. Check both ends
  # before spending it: a typo here is permanent.
  lcode=$(cast code "$LOCK" "${RPC[@]}")
  [ "$lcode" != "0x" ] || { echo "REFUSING: no contract at $LOCK"; exit 1; }
  lockFloor=$(cast call "$LOCK" 'floor()(address)' "${RPC[@]}")
  [ "${lockFloor,,}" = "${FLOOR,,}" ] || {
    echo "REFUSING: lock at $LOCK points at $lockFloor, not $FLOOR"; exit 1; }
  existing=$(cast call "$FLOOR" 'lockbox()(address)' "${RPC[@]}")
  [ "${existing,,}" = "0x0000000000000000000000000000000000000000" ] || {
    echo "REFUSING: lockbox already set to $existing and cannot be changed"; exit 1; }
  echo "Binding $FLOOR -> lockbox $LOCK. This is permanent."
  cast send "$FLOOR" 'setLockbox(address)' "$LOCK" --private-key "$PRIVATE_KEY" "${RPC[@]}"
  ;;

airdrop)
  need_key
  forge script script/DeployAirdrop.s.sol "${RPC[@]}" --broadcast
  echo
  echo "THEN, to open the GME round — regenerate the tree FIRST if the funded"
  echo "amount is not exactly the treasury's current GME balance, because the"
  echo "leaves carry absolute amounts, not shares:"
  echo "  cast call $GME 'balanceOf(address)(uint256)' $TREASURY --rpc-url robinhood"
  echo "  node ../tools/airdrop-snapshot.mjs --total <that number> ..."
  echo "  node ../tools/airdrop-snapshot.mjs --verify ../claim/round.json"
  echo "  # publish claim/round.json, THEN approve, THEN openRound"
  ;;

*)
  sed -n '2,20p' "$0"; exit 1 ;;
esac
