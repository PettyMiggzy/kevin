# Kevin's Card Room

Texas Hold'em at `iamkevin.lol/poker`, playable in a browser with no install and
no account. Play money for now.

## What is here

| File | Does |
|---|---|
| `js/cards.js` | Deck, shuffle, hand evaluation |
| `js/holdem.js` | The rules — no UI in it, so it can be tested or run on a server |
| `js/characters.js` | Who can sit down. **This is the seam the NFTs plug into.** |
| `js/main.js` | The single-player table: you at seat 0, bots everywhere else, run entirely in the browser |
| `js/tableView.js` | The felt itself — seats, board, pot, controls — shared by both multiplayer screens below so there is one rendering codebase, not two |
| `js/multiplayer.js` | The practice table: same felt, but every action goes to `server/` and every card comes back from it |
| `js/lobby.js` | The lobby: lists open tables and tournaments (`GET /lobby`) and creates new ones — the front door, not a third game mode |
| `js/tournament.js` | The tournament table: registration, then the same felt, plus a blind-level/standings bar `js/multiplayer.js` doesn't need |
| `server/` | The WebSocket server that runs `holdem.js` for real, for both single tables and tournaments — see `server/README.md` |

`index.html` is the single-player room. `lobby.html` is the front door for
everything else: it lists open **practice** tables (play money, same as
phase 1) and **tournaments** (multi-table, blinds that go up, one winner —
see `server/README.md`'s tournament section), and creates new ones. `mode`
on a table is the seam a future real-money table plugs into later — nothing
reads it as anything but a label yet. `table.html?t=<code>` (share the link,
whoever opens it sits at that table) still works exactly as it did in phase
1; the lobby is a nicer way to arrive at a table, not the only way. All of
these are static pages that import from `js/`; none of them gates another.

## Adding characters — the NFT path

A character is data, not code:

```js
{ id: 'kevin-suit', name: 'Suit Kev', art: '…/kevin-great.png', style: 'shark' }
```

Nothing in the game reaches past `ROSTER`, so a minted playable character means
adding a row — or returning rows from `ownedBy(wallet)`, which is already
stubbed with the right shape and returns an empty list until the collection
exists. The table cannot tell a built-in seat from a minted one, which is the
whole point of putting the seam here rather than in the UI.

`style` picks how the seat plays, and each one is a real strategy rather than a
difficulty slider: `rock` folds anything weak and punishes you when it doesn't,
`caller` pays you off, `shark` plays fewer hands than it looks and bets them
hard, `maniac` raises with anything and gives it all back.

## The engine is separate on purpose

`holdem.js` imports nothing but `cards.js` and touches no DOM, so it runs
headless. That is what let it be fuzzed — 5,000 random-action hands across ten
tables, asserting after every single hand that the chips in play still add up
to what was bought in.

That caught three real bugs that no amount of playing it would have surfaced
reliably:

1. **A side pot whose eligible players had all folded was skipped**, and its
   chips left the game. It happens whenever two players build a side pot on the
   flop and both give up later.
2. **After a street change the turn was handed to the first seat left of the
   button without checking whether they had folded.** Play stalled there
   forever with the pot still on the table.
3. **Hand evaluation was called on two cards** when everyone folded before the
   flop, where there is no five-card hand to name.

Side pots are computed properly — split at every all-in level, each pot paid
only to players who could cover it, odd chips to the first winner left of the
button. Get that wrong and a short stack wins money nobody put in.

The shuffle draws from `crypto.getRandomValues` with modulo rejection. Not
because anything here is adversarial yet, but a shuffle people bet against
should not be reproducible from a timestamp, and unbiasing it costs nothing.

## Multiplayer

`server/` is that server: real players, joined over a WebSocket, playing a
real `holdem.js` game against each other instead of against
`characters.js`'s bots. It holds the deck; the browser holds only its own
hole cards and, once a hand reaches a genuine multi-way showdown, whatever
everyone still in has to show. See `server/README.md` for the protocol, the
disconnect rules, and — worth reading before anything real depends on it —
exactly what this phase does and does not defend against.

A **tournament** (`tournament.html`) is many of these tables at once, run
by `server/tournament.mjs`: everyone buys in for the same starting stack,
gets seated across however many tables that takes, and tables rebalance as
players bust — standard multi-table-tournament mechanics, not a single
table with a bigger cap. Blinds rise on a schedule instead of staying
fixed, and the whole thing ends with one winner and a finishing position
for everyone else. Still entirely play money; see `server/README.md`'s own
section on it.

## Not done yet

- **Real stakes.** Chips are a number in a page (or, for multiplayer, a
  number in a server process's memory — see `server/README.md`'s "What
  phase 2 needs"). Nothing is on chain and nothing should be until there is
  a server that holds the deck, because a client that knows every card is a
  client that can read them. There now is one; buy-in and payout on top of
  it are the next phase, not this one. A table's `mode` (`'practice'` today)
  is where a future `'real'` mode plugs in — see `server/README.md`.
- **A reconnect that proves you are the same player coming back.** The
  lobby (`lobby.html`) now solves "how do I find a game" — there is a real
  list of open tables and tournaments. What it still does not solve is "how
  does the server know a new WebSocket is the same person who just dropped
  one" — that is still a session-token problem, deferred to the same phase
  2 that adds real stakes (see `server/README.md`'s "What phase 2 needs").

## The seats

Each character is a row in `js/characters.js` — an id, a name, a play style, and
a slug that resolves to two files: a cut-out still for the seat at rest and the
rigged loop for whoever is acting. Nothing in the game reaches past that
registry, so a minted character is a new row, not a new code path.

**Art comes in pre-cut.** This used to download eight 1024px stills on flat
brand yellow and flood-fill the backdrop off each one in JavaScript before the
table could be dealt — about eight million pixels of fill on the main thread,
for 3.9MB of PNG. `tools/build-static-stickers.mjs` does that same cut ahead of
time now and writes 512px WebP with real alpha, so the roster is 267KB and
arrives ready to draw. Same fill, one place instead of two.

**One seat moves at a time.** Every character has a rigged animation as well as
a still, but running all six would have a phone decoding six video streams to
fill six 78-pixel circles. Exactly one plays: whoever the table is waiting on.
That is also the read the player wants — the seat that is moving is the seat it
is on. If the clip will not start (codec, data saver, a policy that ignores
muted autoplay) the still stays put rather than leaving a hole in the seat.
