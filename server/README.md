# Kevin scores

The bit that was missing. The game keeps progress in `localStorage` on each
player's own device, so two people playing have two private numbers that have
never met — nothing to rank, and nothing anybody could be paid against.

This is one Node process, no dependencies (SQLite ships inside Node 22), and one
file on disk. It runs on the same droplet as the bot.

## What it fixes, and what it does not

Worth reading before any reward depends on these numbers.

| | |
|---|---|
| **Fixed** | Decay and every total are computed here, from **this machine's clock**. Winding a phone forward a year now does nothing. That was the worst hole and it is closed. |
| **Fixed** | The client reports what it **did** — "a set at the bench, played this well" — never what it is **worth**. The sums happen server-side. Forging the quality field buys 1.37× one good set, not an arbitrary number. |
| **Raised** | Rate limits: no set inside 4 seconds, 90 sets an hour. Farming costs about what playing costs, which removes most of the reason. |
| **Not fixed** | It is still a browser game. Somebody determined can script the endpoints at human speed and climb slowly. Only running the gameplay server-side changes that. |

**So: do not pay out on these numbers without looking at the event log first.**
Every credited event is kept in the `events` table precisely so "why is this
person top" has a better answer than "the number says so".

## Running it

```bash
cd /opt/kevin
openssl rand -hex 32 > server/.admin.key      # shared with the bot
chmod 600 server/.admin.key

node server/index.mjs                          # foreground, to watch it
curl localhost:8787/health

cp server/kevin-scores.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now kevin-scores
journalctl -u kevin-scores -f
```

Then point the bot at it, in `/etc/systemd/system/kevin-bot.service`:

```
Environment=KEVIN_SCORES_URL=http://127.0.0.1:8787
Environment=KEVIN_ADMIN_KEY=<the same key>
Environment=KEVIN_BOT=Iamkevinzbot
```

`systemctl daemon-reload && systemctl restart kevin-bot`, and `/top`, `/shifts`
and `/link` start working.

### Putting it on the internet

The browser game needs to reach it, which the bot does not — the bot talks to
it over localhost. Put a TLS terminator in front rather than exposing Node:

```bash
apt install caddy
# /etc/caddy/Caddyfile
scores.iamkevin.lol {
  reverse_proxy 127.0.0.1:8787
}
```

Point a DNS A record at the droplet, then set `KEVIN_SCORES_URL` in the **game's**
config to `https://scores.iamkevin.lol`. Leave the bot on localhost.

## How somebody gets on the board

1. In Telegram: `/link`. The bot DMs a code — **never** posts it in the group,
   because anybody could take it and attach their own save to your name.
2. In the game: enter the code. That save now belongs to that Telegram account.
3. Their name appears on `/top` and `/shifts`.

Only linked players with at least one set appear. An unlinked save still plays;
it just is not ranked.

## The endpoints

| | |
|---|---|
| `GET /health` | is it up |
| `GET /top?board=gym\|job&limit=10` | the boards, public, no ids |
| `POST /session` | a new game asks for a token |
| `POST /event` | `{type:'set', station, quality}` or `{type:'shift', served, mistakes, walked}` — auth: player token |
| `GET /me` | your row, decay settled to now |
| `POST /link/code` | bot mints a code — auth: **admin key** |
| `POST /link/claim` | game redeems it |

## Backups

One file. `server/data/kevin.db` (plus `-wal`, `-shm`).

```bash
sqlite3 /opt/kevin/server/data/kevin.db ".backup '/root/kevin-$(date +%F).db'"
```

Worth a cron job before any payout depends on it.
