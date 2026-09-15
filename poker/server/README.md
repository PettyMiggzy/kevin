# Kevin's poker server

The piece poker/README.md's "Not done yet" section named: a server that holds
the deck, so real people can play a hand of Texas Hold'em against each other
instead of against `js/characters.js`'s bots.

One Node process, one dependency (`ws`, already in the repo's root
`package.json`), no database — every table lives in memory and is gone on
restart. That is fine for play money and is the first thing phase 2 (buy-in
and payout) will need to change; see "What phase 2 needs" below.

## What is here

| File | Does |
|---|---|
| `table.mjs` | One table: seats, joins, disconnects, and — the whole point — a per-viewer redacted view of the game so nobody's browser ever holds a card that is not theirs |
| `index.mjs` | The WebSocket server: routes `/ws/<table id>` to a `table.mjs` table, wires messages to it, serves `/health` |
| `kevin-poker.service` | The systemd unit |
| `test/table.test.mjs` | Fuzzes `table.mjs` directly with fake sockets — random joins, actions and disconnects, asserting the redaction rule holds and chips are never leaked or duplicated |
| `test/integration.test.mjs` | The same story over a real `ws` connection against the real server, including a real mid-hand disconnect, so a bug in the wire format or in `index.mjs`'s wiring has somewhere to show up |

`table.mjs` runs `poker/js/holdem.js` completely unmodified — that file was
written with no UI in it specifically so a server could run it one day (read
its own first comment). This is that day. `table.mjs` never changes a rule;
it only decides who is allowed to see what.

## Running it

```bash
node poker/server/index.mjs              # listens on :8788
PORT=9000 node poker/server/index.mjs
```

Point the client at it with `window.KEVIN_POKER_WS = 'ws://localhost:8788'`
(see `poker/js/multiplayer.js`) if you are not serving `poker/table.html`
from `localhost` or `127.0.0.1`, which is the only case it defaults to
without that override.

```bash
node poker/server/test/table.test.mjs         # fast, no network, ~1s
node poker/server/test/integration.test.mjs   # real sockets, a real server, ~5s
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

- No accounts and no session tokens. A table id in the URL (`?t=abc123`) is
  the entire "lobby" — anyone who has the link can sit down, and a dropped
  connection cannot prove it is the same person coming back, so
  reconnecting is a fresh seat with a fresh stack next hand, not a resumed
  one. Fine for play money; not something to build buy-in on top of as-is.
- No rate limiting on join/action messages beyond a 32KB frame cap. A single
  bad actor spamming a table they are seated at cannot see anything they
  should not, but could make that table annoying to play at.
- Table ids are guessable 6-character strings, not secrets. Do not put
  anything behind one that a competitor finding it by luck would matter.

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
      "connected": true, "mine": true, "hole": ["5c", "5s"], "result": null },
    { "seat": 1, "name": "Bob", "chips": 1990, "bet": 10, "folded": false,
      "connected": true, "mine": false, "hole": [null, null], "result": null }
  ],
  "log": ["Bob posts 10, Alice posts 20", "Bob calls 10", "Alice checks"]
}
```

`{ "type": "error", "message": "not your turn" }` on a rejected action, sent
only to whoever sent it.

## Disconnects and the lobby, deliberately simple

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
- **Nothing is persisted.** A server restart loses every table. Chips a
  disconnected player still had are simply not carried into the next hand
  they are dealt into — see `table.mjs` — because there is no wallet for
  them to be worth returning to yet.

## Putting it on the internet

Same shape as `server/README.md`'s scores service: a Caddy reverse proxy on
a subdomain in front of plain Node, so the browser only ever speaks TLS.

```
poker.iamkevin.lol {
  reverse_proxy 127.0.0.1:8788
}
```

`poker/js/multiplayer.js` defaults to `wss://poker.iamkevin.lol` for any
non-localhost host, overridable with `window.KEVIN_POKER_WS` if that
subdomain is not the one actually in use.

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
   converted back to anything.
3. **A buy-in step that runs before `handleJoin` seats anyone** — verifying
   whatever `contracts/` ends up specifying, converting it into a starting
   stack, and only then handing the seat to `tryStartHand`.
4. **A cash-out step that runs on `handleLeave`/`handleDisconnect` instead
   of forfeiting the stack** — right now a disconnected player's chips are
   simply excluded from the next hand; that is the one behavior in this
   file that is fine for play money and not for real money.
5. Table ids that are **capability tokens, not guessable strings**, once
   sitting at a table means something is at stake — see "What this phase
   does NOT defend against" above.

None of that is started here on purpose — it is a different, harder problem
(what does "the server holds the deck" have to mean when the deck is worth
something), and mixing it into the networking layer would have made both
halves harder to get right.
