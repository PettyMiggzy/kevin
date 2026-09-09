#!/usr/bin/env bash
# Install or update both services on the droplet.
#
#   cd /opt/kevin && ./setup.sh
#
# Safe to run again after every git pull — it re-installs the unit files, keeps
# every key it finds, and only generates one that does not exist yet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  ok  %s\n' "$*"; }
bad() { printf '  !!  %s\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { bad "run as root"; exit 1; }

# --- keys -------------------------------------------------------------------
say "Keys"
for f in bot/.groq.key bot/.telegram.key; do
  if [ -s "$f" ]; then ok "$f"; else bad "$f is missing — the bot will not start"; fi
done

if [ -s server/.admin.key ]; then
  ok "server/.admin.key (kept)"
else
  openssl rand -hex 32 > server/.admin.key
  ok "server/.admin.key (generated)"
fi
chmod 600 server/.admin.key bot/.groq.key bot/.telegram.key 2>/dev/null || true
ADMIN_KEY="$(cat server/.admin.key)"

# --- the scores service ------------------------------------------------------
say "Scores service"
mkdir -p server/data
install -m 644 server/kevin-scores.service /etc/systemd/system/kevin-scores.service
ok "unit installed"

# --- the bot -----------------------------------------------------------------
say "Bot"
install -m 644 bot/kevin-bot.service /etc/systemd/system/kevin-bot.service

# A drop-in rather than editing the unit: `git pull` replaces the unit file, and
# anything written into it would be lost on the next update. This survives.
mkdir -p /etc/systemd/system/kevin-bot.service.d
cat > /etc/systemd/system/kevin-bot.service.d/local.conf <<EOF
# Written by setup.sh. Edit setup.sh, not this.
[Service]
Environment=KEVIN_SCORES_URL=http://127.0.0.1:8787
Environment=KEVIN_ADMIN_KEY=${ADMIN_KEY}
Environment=KEVIN_BOT=${KEVIN_BOT:-Iamkevinzbot}
EOF
chmod 600 /etc/systemd/system/kevin-bot.service.d/local.conf
ok "unit + drop-in installed (bot talks to scores over localhost)"

# --- the floor keepers -------------------------------------------------------
# One systemd template unit, one instance per pool driven. Installed always,
# started only for a pool you have written a file for. They are the only
# services here that can spend money, so they do not come up by accident.
#
# Today that is the KEK pool only. The WETH floor is deployed and tuned but
# deliberately not driven, and with no /etc/kevin/floor-weth.env it never
# starts — the contract holds nothing and nothing pokes it.
say "Floor keepers"

install -m 644 'keeper/kevin-floor@.service' '/etc/systemd/system/kevin-floor@.service'
mkdir -p /etc/kevin
ok "template unit installed"

# The single kevin-floor.service this replaces. Left running it would be a
# second keeper on the same contract, pulling against the new one.
if [ -e /etc/systemd/system/kevin-floor.service ]; then
  systemctl disable --now kevin-floor >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/kevin-floor.service
  bad "the old single kevin-floor service was stopped and removed"
  if [ -s /etc/systemd/system/kevin-floor.service.d/local.conf ]; then
    bad "  its settings are still at kevin-floor.service.d/local.conf — move"
    bad "  anything you want kept into /etc/kevin/floor-weth.env by hand."
    bad "  LIVE is NOT carried over: the new keepers start in dry run."
  fi
fi

# viem is the keeper's only dependency and the first one this repo has ever had
# at runtime, so a droplet that has only ever pulled will not have it.
if [ ! -d node_modules/viem ]; then
  say "  installing node dependencies (viem)"
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
    && ok "viem installed" || bad "npm install failed — the keeper will not start"
else
  ok "viem present"
fi

if [ -s keeper/.operator.key ]; then
  chmod 600 keeper/.operator.key
  ok "keeper/.operator.key (kept)"
else
  bad "keeper/.operator.key is missing — the keeper can only dry-run"
fi

# One instance per pool, and A POOL IS ONLY DRIVEN IF YOU CREATED ITS FILE.
#
# This used to seed /etc/kevin/floor-<pool>.env from the example, which meant a
# single ./setup.sh silently started a keeper on EVERY pool that has a contract
# deployed — including one the owner had decided not to run. That is exactly
# the "does not come up by accident" rule this section claims to follow, broken
# by the thing meant to be convenient. Copying one file is not a hardship.
KEEPER_POOLS=""
for pool in weth kek; do
  envf="/etc/kevin/floor-$pool.env"
  if [ ! -e "$envf" ]; then
    ok "$pool: no $envf, so not driving that pool (this is the default)"
    continue
  fi
  if grep -qE '^FLOOR_ADDRESS=0x[0-9a-fA-F]{40}' "$envf"; then
    KEEPER_POOLS="$KEEPER_POOLS $pool"
    if grep -qE '^LIVE=1' "$envf"; then
      bad "$pool: LIVE=1 — this keeper SENDS TRANSACTIONS"
    else
      ok "$pool: dry run (no LIVE=1)"
    fi
  else
    bad "$pool: $envf has no FLOOR_ADDRESS, so not starting it"
  fi
done

if [ -z "$KEEPER_POOLS" ]; then
  bad "no pool is being driven. To drive the KEK pool:"
  cat >&2 <<'EOF'
        cp keeper/floor-kek.env.example /etc/kevin/floor-kek.env
        ./setup.sh
EOF
fi

# --- the buy watch -----------------------------------------------------------
# Reads the chain, posts with the bot token the bot already uses. It holds no
# key that can spend anything.
say "Buy watch"

BUYWATCH_DROPIN=/etc/systemd/system/kevin-buywatch.service.d/local.conf
install -m 644 keeper/kevin-buywatch.service /etc/systemd/system/kevin-buywatch.service
ok "unit installed"

BUYWATCH_READY=0
if [ -s "$BUYWATCH_DROPIN" ] && grep -q BUY_CHAT_ID "$BUYWATCH_DROPIN"; then
  BUYWATCH_READY=1
  ok "configured: $BUYWATCH_DROPIN"
  grep -q "LIVE=1" "$BUYWATCH_DROPIN" && ok "LIVE — it will post to the group" || bad "dry run — it will post nothing"
else
  bad "not configured, so not starting. Write $BUYWATCH_DROPIN:"
  cat >&2 <<'EOF'
        [Service]
        Environment=BUY_CHAT_ID=-100...
        Environment=ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
        Environment=LIVE=1
EOF
fi

# --- the burn watch ----------------------------------------------------------
# A timer, not a daemon: a burn is a rare deliberate act and the public RPC
# rate-limits, so polling harder buys nothing.
say "Burn watch"

BURNWATCH_DROPIN=/etc/systemd/system/kevin-burnwatch.service.d/local.conf
install -m 644 keeper/kevin-burnwatch.service /etc/systemd/system/kevin-burnwatch.service
install -m 644 keeper/kevin-burnwatch.timer /etc/systemd/system/kevin-burnwatch.timer
ok "unit + timer installed"

BURNWATCH_READY=0
if [ -s "$BURNWATCH_DROPIN" ] && grep -q BURN_CHAT_ID "$BURNWATCH_DROPIN"; then
  BURNWATCH_READY=1
  ok "configured: $BURNWATCH_DROPIN"
  grep -q "LIVE=1" "$BURNWATCH_DROPIN" && ok "LIVE — burns get announced" || bad "dry run — it will post nothing"
else
  bad "not configured, so not starting. Write $BURNWATCH_DROPIN:"
  cat >&2 <<'EOF'
        [Service]
        Environment=BURN_CHAT_ID=-100...
        Environment=LIVE=1
EOF
fi

# --- start them --------------------------------------------------------------
say "Starting"
systemctl daemon-reload
systemctl enable --now kevin-scores >/dev/null 2>&1 || true
systemctl restart kevin-scores
systemctl enable --now kevin-bot >/dev/null 2>&1 || true
systemctl restart kevin-bot
for pool in $KEEPER_POOLS; do
  systemctl enable --now "kevin-floor@$pool" >/dev/null 2>&1 || true
  systemctl restart "kevin-floor@$pool"
done
if [ "$BUYWATCH_READY" = "1" ]; then
  systemctl enable --now kevin-buywatch >/dev/null 2>&1 || true
  systemctl restart kevin-buywatch
fi
if [ "$BURNWATCH_READY" = "1" ]; then
  systemctl enable --now kevin-burnwatch.timer >/dev/null 2>&1 || true
  systemctl restart kevin-burnwatch.timer
fi

sleep 2

# --- did it work -------------------------------------------------------------
say "State"
UNITS="kevin-scores kevin-bot"
for pool in $KEEPER_POOLS; do UNITS="$UNITS kevin-floor@$pool"; done
[ "$BUYWATCH_READY" = "1" ] && UNITS="$UNITS kevin-buywatch"
for unit in $UNITS; do
  if systemctl is-active --quiet "$unit"; then ok "$unit running"; else
    bad "$unit is NOT running — journalctl -u $unit -n 30 --no-pager"
  fi
done

if health="$(curl -fsS --max-time 5 http://127.0.0.1:8787/health 2>/dev/null)"; then
  ok "scores answering: $health"
else
  bad "scores did not answer on 8787"
fi

say "Done"
cat <<'EOF'
  journalctl -u kevin-bot -f        watch the bot
  journalctl -u kevin-scores -f     watch the scores service
  journalctl -u 'kevin-floor@*' -f  watch both floor keepers
  journalctl -u kevin-buywatch -f   watch the buy watch
  journalctl -u kevin-burnwatch -f  watch the burn watch

  In Telegram: /link  -> the bot DMs you a code
  Then: /top and /shifts read the board.

  The board is empty until the game submits scores, which is the next change.
EOF
