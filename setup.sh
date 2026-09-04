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

# --- start them --------------------------------------------------------------
say "Starting"
systemctl daemon-reload
systemctl enable --now kevin-scores >/dev/null 2>&1 || true
systemctl restart kevin-scores
systemctl enable --now kevin-bot >/dev/null 2>&1 || true
systemctl restart kevin-bot

sleep 2

# --- did it work -------------------------------------------------------------
say "State"
for unit in kevin-scores kevin-bot; do
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

  In Telegram: /link  -> the bot DMs you a code
  Then: /top and /shifts read the board.

  The board is empty until the game submits scores, which is the next change.
EOF
