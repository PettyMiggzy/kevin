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

# A Telegram chat id is a number, optionally negative. The examples printed by
# this script use "-100..." as a placeholder, and pasting that verbatim is the
# obvious mistake — it satisfies a grep for the variable name, so the service
# starts, reports itself configured, and then fails on every single post. Check
# the VALUE, not just the presence of the key.
# Install a unit file and say whether it CHANGED. Re-running this script to
# configure a watcher used to restart the bot and the scores service too, every
# time — which meant kicking a running Telegram bot mid-conversation for a
# change that had nothing to do with it. Three runs in five minutes while
# setting up the watchers looked exactly like a bot that had stopped working.
# Restart what changed, leave the rest alone.
install_unit() {
  local src="$1" dst="$2"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    return 1   # unchanged
  fi
  install -m 644 "$src" "$dst"
  return 0     # changed
}

chat_id_ok() {
  local line v
  line=$(grep -E "^[[:space:]]*Environment=$2=" "$1" 2>/dev/null | tail -1)
  [ -n "$line" ] || return 1
  v=${line#*=}          # MAKER_CHAT_ID=-1001234567890
  v=${v#*=}             # -1001234567890
  v=${v%\"}; v=${v#\"}
  # A chat id is digits, optionally with one leading minus. Anything else —
  # empty, a placeholder with dots, an angle bracket — is not one.
  case "$v" in
    ''|*[!0-9-]*) return 1 ;;
    -) return 1 ;;
    *) return 0 ;;
  esac
}
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
SCORES_CHANGED=0
install_unit server/kevin-scores.service /etc/systemd/system/kevin-scores.service && SCORES_CHANGED=1
[ "$SCORES_CHANGED" = "1" ] && ok "unit installed (changed)" || ok "unit unchanged"

# --- the bot -----------------------------------------------------------------
say "Bot"
BOT_CHANGED=0
install_unit bot/kevin-bot.service /etc/systemd/system/kevin-bot.service && BOT_CHANGED=1

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
if ! cmp -s /etc/systemd/system/kevin-bot.service.d/local.conf.prev \
            /etc/systemd/system/kevin-bot.service.d/local.conf 2>/dev/null; then
  BOT_CHANGED=1
fi
cp /etc/systemd/system/kevin-bot.service.d/local.conf \
   /etc/systemd/system/kevin-bot.service.d/local.conf.prev 2>/dev/null || true
chmod 600 /etc/systemd/system/kevin-bot.service.d/local.conf.prev 2>/dev/null || true
[ "$BOT_CHANGED" = "1" ] && ok "unit + drop-in installed (changed, will restart)" \
                         || ok "unit + drop-in unchanged (bot left alone)"

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
if [ -s "$BUYWATCH_DROPIN" ] && chat_id_ok "$BUYWATCH_DROPIN" BUY_CHAT_ID; then
  BUYWATCH_READY=1
  ok "configured: $BUYWATCH_DROPIN"
  grep -q "LIVE=1" "$BUYWATCH_DROPIN" && ok "LIVE — it will post to the group" || bad "dry run — it will post nothing"
else
  bad "no usable BUY_CHAT_ID (a real one is a number, not -100...). Write $BUYWATCH_DROPIN:"
  cat >&2 <<'EOF'
        [Service]
        Environment=BUY_CHAT_ID=-100...
        Environment=ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
        Environment=LIVE=1
EOF
fi

# --- the market maker watch --------------------------------------------------
# Separate from the buy watch on purpose: a bid from the floor keeper looks
# exactly like a stranger buying to anything that nets ERC-20 transfers, and
# announcing the treasury's own bot as "Somebody buy KEVIN" is the sort of
# thing that is indistinguishable from lying.
say "Market maker watch"

MAKERWATCH_DROPIN=/etc/systemd/system/kevin-makerwatch.service.d/local.conf
install -m 644 keeper/kevin-makerwatch.service /etc/systemd/system/kevin-makerwatch.service
ok "unit installed"

MAKERWATCH_READY=0
if [ -s "$MAKERWATCH_DROPIN" ] && chat_id_ok "$MAKERWATCH_DROPIN" MAKER_CHAT_ID; then
  MAKERWATCH_READY=1
  ok "configured: $MAKERWATCH_DROPIN"
  grep -q "LIVE=1" "$MAKERWATCH_DROPIN" && ok "LIVE — trades get announced" || bad "dry run — it will post nothing"
else
  bad "no usable MAKER_CHAT_ID (a real one is a number, not -100...). Write $MAKERWATCH_DROPIN:"
  cat >&2 <<'EOF'
        [Service]
        Environment=MAKER_CHAT_ID=-100...
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
if [ -s "$BURNWATCH_DROPIN" ] && chat_id_ok "$BURNWATCH_DROPIN" BURN_CHAT_ID; then
  BURNWATCH_READY=1
  ok "configured: $BURNWATCH_DROPIN"
  grep -q "LIVE=1" "$BURNWATCH_DROPIN" && ok "LIVE — burns get announced" || bad "dry run — it will post nothing"
else
  bad "no usable BURN_CHAT_ID (a real one is a number, not -100...). Write $BURNWATCH_DROPIN:"
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
if [ "$SCORES_CHANGED" = "1" ] || ! systemctl is-active --quiet kevin-scores; then
  systemctl restart kevin-scores; ok "kevin-scores restarted"
else
  ok "kevin-scores left running (nothing changed)"
fi
systemctl enable --now kevin-bot >/dev/null 2>&1 || true
if [ "$BOT_CHANGED" = "1" ] || ! systemctl is-active --quiet kevin-bot; then
  systemctl restart kevin-bot; ok "kevin-bot restarted"
else
  ok "kevin-bot left running (nothing changed) — it keeps its Telegram poll"
fi
for pool in $KEEPER_POOLS; do
  systemctl enable --now "kevin-floor@$pool" >/dev/null 2>&1 || true
  systemctl restart "kevin-floor@$pool"
done
if [ "$BUYWATCH_READY" = "1" ]; then
  systemctl enable --now kevin-buywatch >/dev/null 2>&1 || true
  systemctl restart kevin-buywatch
fi
if [ "$MAKERWATCH_READY" = "1" ]; then
  systemctl enable --now kevin-makerwatch >/dev/null 2>&1 || true
  systemctl restart kevin-makerwatch
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
[ "$MAKERWATCH_READY" = "1" ] && UNITS="$UNITS kevin-makerwatch"
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
  journalctl -u kevin-makerwatch -f watch the market maker announcer

  In Telegram: /link  -> the bot DMs you a code
  Then: /top and /shifts read the board.

  The board is empty until the game submits scores, which is the next change.
EOF
