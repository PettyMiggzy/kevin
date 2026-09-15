# Kevin's poker server

The piece poker/README.md's "Not done yet" section named: a server that holds
the deck, so real people can play a hand of Texas Hold'em against each other
instead of against `js/characters.js`'s bots.

One Node process, one dependency (`ws`, already in the repo's root
`package.json`) for the tables themselves — no database, every table lives
in memory and is gone on restart. That is fine for play money and is the
first thing phase 2 (buy-in and payout) will need to change; see "What
phase 2 needs" below. The one exception is a small SQLite leaderboard (see
"Bots and the leaderboard" below) that deliberately DOES survive a
restart — it is a scoreboard of who has won and lost past hands, not a
wallet, and does not change anything about a table itself: a disconnected
player's chips still are not carried into the next hand they're dealt.

## What is here

| File | Does |
|---|---|
| `table.mjs` | One table: seats, joins, disconnects, and — the whole point — a per-viewer redacted view of the game so nobody's browser ever holds a card that is not theirs |
| `bots.mjs` | The bot AI a practice table's computer-controlled seats use to decide their actions — see "Bots and the leaderboard" below |
| `db.mjs` | The leaderboard's own SQLite storage (WAL mode, one small file) — see "Bots and the leaderboard" below |
| `tournament.mjs` | One multi-table tournament: registration, seating players across several `table.mjs` tables, rebalancing, blind-level escalation, bust-outs and final standings — see "Tournaments" below |
| `index.mjs` | The HTTP+WebSocket server: the lobby endpoints, `/ws/<table id>`, `/tournament/<id>`, `/health` |
| `kevin-poker.service` | The systemd unit |
| `test/table.test.mjs` | Fuzzes `table.mjs` directly with fake sockets — random joins, actions and disconnects, asserting the redaction rule holds and chips are never leaked or duplicated |
| `test/integration.test.mjs` | The same story over a real `ws` connection against the real server, including a real mid-hand disconnect, so a bug in the wire format or in `index.mjs`'s wiring has somewhere to show up |
| `test/multitable.test.mjs` | Many tables at once — fake sockets fuzzing 20 concurrent `table.mjs` tables with interleaved actions, then a real server run with several real tables and real clients in lockstep — asserting no broadcast ever crosses a table boundary |
| `test/tournament.test.mjs` | Fuzzes a whole tournament (fake sockets) to one winner, checking the redaction rule across every table a player is ever moved to, and chip conservation against the tournament's own ledger on every tick |
| `test/tournament.integration.test.mjs` | The real server, real HTTP for `/tournaments`/`/lobby`, real `ws` clients — registers a field, starts it, and plays it down through real bust-outs, a real table merge, and a real blind increase to one real winner |
| `test/bots.test.mjs` | Fuzzes bot legality directly against `options()`, then drives a real server through a real lone-human-plus-bots hand, a mid-hand-plus-disconnect timer-cleanup check, and a leaderboard chip-conservation check against the SQLite file itself |

`table.mjs` runs `poker/js/holdem.js` completely unmodified — that file was
written with no UI in it specifically so a server could run it one day (read
its own first comment). This is that day. `table.mjs` never changes a rule;
it only decides who is allowed to see what. `tournament.mjs` sits entirely
above `table.mjs` and never changes a rule either — see "Tournaments" below.

## Running it

```bash
node poker/server/index.mjs              # listens on :8788
PORT=9000 node poker/server/index.mjs
```

Point the client at it with `window.KEVIN_POKER_WS = 'ws://localhost:8788'`
(see `poker/js/multiplayer.js`) and `window.KEVIN_POKER_HTTP = 'http://localhost:8788'`
(see `poker/js/lobby.js`) if you are not serving the poker pages from
`localhost` or `127.0.0.1`, which is the only case either defaults to
without that override.

```bash
node poker/server/test/table.test.mjs                   # fast, no network, ~1s
node poker/server/test/integration.test.mjs              # real sockets, a real server, ~5s
node poker/server/test/multitable.test.mjs                # fake + real sockets, many tables, ~10s
node poker/server/test/tournament.test.mjs                # fast, no network, ~2s
node poker/server/test/tournament.integration.test.mjs   # real server, a real 7-player tournament, ~10-30s
node poker/server/test/bots.test.mjs                     # fake sockets + a real server, ~10-20s
```

## The security model, stated plainly

**`table.mjs`'s `viewFor` is the only place in the whole system that decides
what a browser is allowed to see, and it is checked by both test files on
every single broadcast.** The rule: a seat's hole cards go out as real card
strings only when the socket asking IS that seat, or when the hand reached
a genuine multi-way showdown (more than one player still in when the last
bet was called or checked through) and that seat did not fold. A player who
wins because everyone else folded is never forced to show, the same as at a
real table. The remaining deck — `game.deck` — is never read by `viewFor` at
all, because the remaining deck **is** the next cards to be dealt; the surest
way to never leak it is code that never looks at it.

Everything else — chip counts, bets, the pot, the board, whose turn it is,
even who is connected — is ordinary public poker information and goes out
to everyone untouched.

**What this phase does NOT defend against**, worth being honest about before
anything real rides on it:

- No accounts and no session tokens. The lobby (below) lists tables and
  tournaments, but anyone who has a table's or tournament's id can still
  join it directly — that was never the weak point being fixed. A dropped
  connection cannot prove it is the same person coming back, so
  reconnecting to a practice table is a fresh seat with a fresh stack next
  hand, and reconnecting to a tournament is simply not possible (see
  "Tournaments" below) — not something to build buy-in on top of as-is.
- No rate limiting on join/action messages beyond a 32KB frame cap, and none
  on `POST /tables` or `POST /tournaments` either. A single bad actor
  spamming a table they are seated at cannot see anything they should not,
  but could make that table annoying to play at, or fill the lobby list
  with junk tables.
- Table ids are guessable 6-character strings, not secrets, and tournament
  ids are the same shape. Do not put anything behind one that a competitor
  finding it by luck would matter.

## The protocol

Everything is JSON over one WebSocket per browser tab, at `/ws/<table id>`.
The table is created the first time anyone connects to a given id and lives
until every socket that ever touched it disconnects.

**Client → server**

| `type` | fields | |
|---|---|---|
| `join` | `name` | Sit down (or rejoin the waiting list after a disconnect). Chips reset to the table's starting stack. |
| `action` | `action` (`fold`\|`check`\|`call`\|`bet`\|`raise`), `amount` | Only valid on your own turn, for an action `options()` actually allows — see `table.mjs`'s `handleAction`. |
| `leave` | | Sit out of future hands without closing the socket. |

**Server → client**, always a broadcast to everyone at the table, each copy
independently redacted for its recipient:

```jsonc
{
  "type": "state",
  "you": 1,              // your seat index, or null while you are waiting to be dealt in
  "phase": "playing",    // "idle" | "playing"
  "street": "flop",      // "idle" | "preflop" | "flop" | "turn" | "river" | "showdown" | "over"
  "board": ["Qd", "As", "5d"],
  "pots": [{ "amount": 40, "eligible": [0, 1] }],
  "turn": 0,
  "seats": [
    { "seat": 0, "name": "Alice", "chips": 1980, "bet": 20, "folded": false,
      "connected": true, "bot": false, "mine": true, "hole": ["5c", "5s"], "result": null },
    { "seat": 1, "name": "Sleepy Kev", "chips": 1990, "bet": 10, "folded": false,
      "connected": true, "bot": true, "mine": false, "hole": [null, null], "result": null }
  ],
  "log": ["Bob posts 10, Alice posts 20", "Bob calls 10", "Alice checks"]
}
```

`{ "type": "error", "message": "not your turn" }` on a rejected action, sent
only to whoever sent it.

## The lobby (HTTP)

Plain JSON over plain HTTP, on the same port as the WebSocket server —
`poker/js/lobby.js` is the only client, but it is nothing more than these
four endpoints:

| Method + path | Body | Returns |
|---|---|---|
| `GET /lobby` | | `{ tables: [...], tournaments: [...] }` — every table's `table.mjs`-side `summarizeTable()` (id, name, `mode`, phase, seat counts, blinds, player names — never a hole card, there is nothing in this summary `viewFor` would need to redact) and every tournament's `tournament.mjs`-side `summarizeTournament()` (id, name, status, counts, blind level, standings once done) |
| `GET /leaderboard` | | `{ players: [{ name, hands, wins, net_chips }, ...] }`, top players sorted by `net_chips` — see "Bots and the leaderboard" below |
| `POST /tables` | `{ name?, smallBlind?, bigBlind?, startChips?, bots? }` | `{ id, name }` — creates a practice table with a real id up front (the lobby lists it immediately) instead of waiting for the first `/ws/<id>` connection to invent one. `bots` (0-5, default 0) seats that many computer-controlled players before anyone else joins — see "Bots and the leaderboard" below |
| `POST /tournaments` | `{ name?, startChips?, seatsPerTable?, minPlayers?, maxPlayers?, levels? }` | `{ id, name }` — creates a tournament in `'registering'` status; `levels` overrides the default blind schedule (see "Tournaments" below) |

A practice table's `/ws/<id>` still auto-creates on first connection exactly
like phase 1 did — a typed or shared URL with a made-up code still works,
the lobby is a nicer way to arrive at one, not the only way. A tournament
has no such auto-create: `/tournament/<id>` for an id nobody `POST`ed closes
the socket (code `4004`) instead of inventing an unconfigured tournament.

## Bots and the leaderboard

A lone visitor should not have to sit at an empty table waiting for a
second human to show up, so `POST /tables`'s `bots` field seats that many
computer players before anyone else joins — `table.mjs`'s existing
`combined.length < 2` gate in `tryStartHand` is then already satisfied by
the human's own `join`, with no separate "solo mode" code path.

The AI itself is not new: it is `poker/js/main.js`'s bot logic (that file's
own `strength()`/`botMove()`, keyed off `poker/js/characters.js`'s
`STYLES`) ported into `poker/server/bots.mjs` with `game` made an explicit
argument instead of a module-level global, so the standalone single-player
room (`poker/index.html`, left completely untouched) and a multiplayer
table's bots play by the same math. A bot seat is otherwise an ordinary
`table.mjs` seat — a `bot: true, style: '...'` pair riding along on the
seat object holdem.js's `createGame` already spreads verbatim (see its own
comment) — with one deliberate wrinkle: its `ws` is a small always-open fake
socket (`{ readyState: 1, send() {} }`) unique per bot instance, which
satisfies this file's own transport contract exactly, so every existing
check that cares who owns a seat (`s.ws === ws`, `isOpen()`, `options()`,
`handleAction`'s turn-ownership check) works on a bot with zero special
cases. A bot's move is computed by `bots.mjs` and then submitted through
`handleAction` — the exact same function, and the exact same
turn-ownership and legality checks, a real WebSocket message goes through —
on a short `setTimeout` (table.mjs's `scheduleBotTurn`, ~0.6-1.4s, the same
"thinking pause" feel `main.js`'s own bots already have) that re-validates
the game has not moved on before acting, and that chains onto itself via
`handleAction`'s own call to `scheduleBotTurn` so a run of consecutive bot
turns needs no extra loop. The moment a table's last real socket
disconnects, `handleDisconnect` marks it `closed` and clears that timer —
otherwise an abandoned all-bot table would play itself out forever on a
droplet that cannot spare the cycles.

Every practice table also gets an optional callback, `onHandSettled`,
called once per concluded hand with each non-bot seat's chip delta —
`table.mjs` computes the diff itself but never touches storage; wiring it
to an actual database is `index.mjs`'s job (closing over its own SQLite
handle from `db.mjs`), because `table.mjs`'s whole point is running
headless against a fake socket with no I/O at all (see its own top
comment) — importing `node:sqlite` there would break exactly the property
that makes it testable the way `test/table.test.mjs` tests it. `db.mjs`
tracks each name's hands played, hands won, and net chips in a `leaderboard`
table, plus an append-only `hand_results` log for the same reason the
sibling scores service's `server/db.mjs` keeps one: a leaderboard that pays
out needs an answer better than "the number says so". This system has no
accounts — a chosen name is the only identity a seat has anywhere in it —
so `leaderboard` is keyed by name and two different people typing the same
one share a row, the same pre-existing "no account needed" property this
system has always had, not a new gap. `tournament.mjs`'s own chip movements
are never recorded here: its economy is separate and self-contained on
purpose (see its own file comment), and it never adds bots either — bots
are practice-table-only, and `tournament.mjs` is untouched.

## Disconnects, deliberately simple

- **A hand always starts once two people are at the table**; there is no
  "ready up" step. A third join mid-hand waits (spectating, in the `seats:
  []`/`you: null` sense — they get every broadcast, just not a seat) until
  the current hand ends.
- **A disconnect mid-hand auto-folds** the seat the moment it is next their
  turn (checking instead, if that costs nothing) — see `table.mjs`'s
  `autoActForDisconnected`. The rest of the table is never blocked on a
  closed tab.
- **The button keeps rotating normally across a stable seating** and only
  resets (to a fresh `createGame`, same as a brand new table) on a hand
  where who is seated actually changed — see `tryStartHand`'s comment for
  why that is a deliberate phase 1 simplification rather than tracking a
  button seat through arbitrary joins and leaves.
- **Nothing about a table itself is persisted.** A server restart loses
  every table. Chips a disconnected player still had are simply not carried
  into the next hand they are dealt into — see `table.mjs` — because there
  is no wallet for them to be worth returning to yet. (The leaderboard is
  the one thing in this system that does survive a restart — see "Bots and
  the leaderboard" above — but it only remembers who won and lost past
  hands, not a stack a disconnected player could be handed back.)

## Tournaments

`tournament.mjs` owns registration, one or more `table.mjs` tables (created
internally — never registered under `/ws/<id>`, so they are unreachable
except through the tournament's own socket), the blind-level clock, and
bust-out/standings tracking. It never changes a poker rule and never
touches `viewFor`; it decides which table a player's socket is plugged
into, using `table.mjs`'s own `handleJoin`/`handleDisconnect` to do the
plugging — the same functions a real join and a real disconnect use — so
there is no separate code path here that could copy a hole card between
tables. See the file's own header comment for the full argument.

**One WebSocket for the whole tournament**, at `/tournament/<id>`, opened
once at registration and never re-pointed: as `tournament.mjs` moves a
player between its internal tables, it reseats this same socket, so
`type:'state'` messages arriving on it can be for a different `table.mjs`
table than the last one (tagged by that table's own `tableId`, exactly like
a practice table's broadcasts). There is no reconnect: a closed tournament
socket is simply the end of that player's run (their seat plays on by
auto-folding, same as any disconnect — see "Disconnects" above — until they
bust), because phase 1.5 still has no session token to prove a new socket
is the same person coming back.

**Client → server**

| `type` | fields | |
|---|---|---|
| `register` | `name` | Buy in (play money) while the tournament is `'registering'`. Refused once it has started. |
| `unregister` | | Withdraw a registration — only while still `'registering'`. |
| `start` | | Any registered player can start the tournament once `minPlayers` have registered. |
| `action` | `action`, `amount` | Routed to whichever table this player is currently seated at — same rules as a practice table's `action`, checked by that table's own `handleAction`. |

**Server → client**, broadcast to every registrant (seated, waiting to be
reseated, or already eliminated — the "rail") on every registration, start,
bust-out, rebalance, and blind-level change:

```jsonc
{
  "type": "tournament",
  "status": "running",        // "registering" | "running" | "done"
  "level": 1, "smallBlind": 25, "bigBlind": 50,
  "levelEndsAt": 1700000030000,   // ms epoch, or null on the final (non-expiring) level
  "playersRemaining": 5, "totalPlayers": 8,
  "tables": [{ "id": "abcxyz-tbl0", "players": 3 }, { "id": "abcxyz-tbl1", "players": 2 }],
  "standings": null,          // filled in only once status is "done": [{ id, name, position, chips }, ...]
  "you": { "id": "...", "name": "Alice", "chips": 640, "tableId": "abcxyz-tbl0", "eliminated": false, "position": null }
}
```

`type:'state'` messages (the exact shape `table.mjs`'s `viewFor` sends a
practice table) arrive on the same socket once seated, tagged with whatever
table the player is on right now — draw them exactly like a practice
table's; `poker/js/tableView.js` is the shared renderer both screens use.

**Seating and rebalancing.** On start, registrants are shuffled and dealt
round-robin onto `ceil(players / seatsPerTable)` tables. Between hands
(never during one — see below), `tournament.mjs`'s `rebalance()`:

1. Fixes any table stuck below two real players (from a bust, or a
   previous rebalance) by emptying it entirely — a table that cannot deal
   is never left standing, because `table.mjs` only ever drops a
   disconnected seat's stale chip count from its own bookkeeping when it
   rebuilds a game for two-or-more real players, so a permanent 1-player
   stub would otherwise sit there holding real chips forever.
2. Otherwise, once the surviving field fits into fewer tables than are
   currently running, breaks the table with the fewest players and spreads
   its players onto whichever other tables have room — "move players off
   the shortest table" in the task's own words.
3. Otherwise, if one table has run two or more players ahead of the
   shortest, moves exactly one across.

Every move only ever pulls a player OUT of a table that just finished a
hand (`phase === 'idle'`) — moving someone out mid-hand would fold a hand
they never chose to fold, so nothing here does that; an unbalanced table
with a hand still in flight just waits for the next pass. There is no such
restriction on the destination: joining a table's `waiting` queue is
exactly what a spectator does while a hand runs there, and is safe at any
time — see `table.mjs`'s own disconnect/join functions.

**Blinds** rise on a level schedule — `[{ smallBlind, bigBlind, durationMs }, ...]`,
defaulting to a ten-level, roughly-doubling structure at ten minutes a
level (`tournament.mjs`'s `DEFAULT_LEVELS`), overridable per tournament via
`POST /tournaments`'s `levels`. The final level holds forever. A table's
live game re-reads its blinds from `table.smallBlind`/`bigBlind` every hand
(a small `table.mjs` change from phase 1, where they were only read once at
table creation) specifically so a level change reaches a hand in progress
on a seating that has not otherwise changed.

**Elimination and standings.** A seat's chips hitting zero is the whole
rule — checked only once a hand has actually finished (`table.mjs`'s
`settleIfDone` flips a table to `'idle'` the instant it does), never while
a table is still `'playing'`: `chips` also reads 0 for a player who is
merely all-in with the hand still live, and eliminating them on the spot
could pull someone clean out of a hand they were about to win. A busted
player is assigned their finishing position immediately — the same "you
finished 6th" a real tournament tells you the moment you're out — and is
then pulled off their table for good. The tournament ends the moment one
player is left; the winner is position 1, and `standings` (sent to
everyone, players still in the rail included) covers every registrant.

## Putting it on the internet

Same shape as `server/README.md`'s scores service: a Caddy reverse proxy on
a subdomain in front of plain Node, so the browser only ever speaks TLS.

```
poker.iamkevin.lol {
  reverse_proxy 127.0.0.1:8788
}
```

`poker/js/multiplayer.js` and `poker/js/tournament.js` default to
`wss://poker.iamkevin.lol` for any non-localhost host (overridable with
`window.KEVIN_POKER_WS`), and `poker/js/lobby.js` to `https://poker.iamkevin.lol`
(overridable with `window.KEVIN_POKER_HTTP`) — same subdomain, since the
lobby's `GET`/`POST` and the WebSocket upgrade are served by the same
`httpServer` in `index.mjs`.

```bash
cp poker/server/kevin-poker.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now kevin-poker
```

Not yet wired into `setup.sh` — that script installs and restarts the other
services on every `git pull`, and adding a fourth one is a deliberately
separate change rather than something to fold in quietly here.

## What phase 2 (buy-in and payout) needs from this

This phase is explicitly play money — no KEVIN, no wallets, no on-chain
anything, per poker/README.md's own rule that nothing goes on chain until a
server holds the deck. Now one does. Phase 2 building on it will need, in
roughly the order they block each other:

1. **An identity a reconnect can prove**, before any real stake can survive
   a dropped connection — a session token issued at buy-in and presented on
   reconnect, not just "a new WebSocket showed up."
2. **A ledger outside the in-memory table** — `table.mjs`'s `chips` are
   currently just a number that evaporates on restart or disconnect;
   real stakes need every chip movement to land somewhere durable (this
   repo's existing pattern is SQLite — see `server/db.mjs`) before it can be
   converted back to anything. `poker/server/db.mjs`'s leaderboard (see
   "Bots and the leaderboard" above) is SQLite too, but it is a scoreboard
   fed by a one-way callback after the fact, not an authoritative ledger
   anything is converted back out of — this is still a different, harder
   problem.
3. **A buy-in step that runs before `handleJoin` seats anyone** — verifying
   whatever `contracts/` ends up specifying, converting it into a starting
   stack, and only then handing the seat to `tryStartHand`.
4. **A cash-out step that runs on `handleLeave`/`handleDisconnect` instead
   of forfeiting the stack** — right now a disconnected player's chips are
   simply excluded from the next hand; that is the one behavior in this
   file that is fine for play money and not for real money.
5. Table AND tournament ids that are **capability tokens, not guessable
   strings**, once sitting at either means something is at stake — see
   "What this phase does NOT defend against" above.
6. For tournaments specifically: a **real registration/reconnect identity**
   before a real buy-in can survive one player's dropped connection without
   either stranding their stake or letting a second socket claim it — right
   now a dropped tournament socket is simply the end of that run (see
   "Tournaments" above), which is fine when nothing is at stake and is not
   something to build a real buy-in on top of as-is.

None of that is started here on purpose — it is a different, harder problem
(what does "the server holds the deck" have to mean when the deck is worth
something), and mixing it into the networking layer would have made both
halves harder to get right.
