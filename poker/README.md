# Kevin's Card Room

Texas Hold'em at `iamkevin.lol/poker`, playable in a browser with no install and
no account. Play money for now.

## What is here

| File | Does |
|---|---|
| `js/cards.js` | Deck, shuffle, hand evaluation |
| `js/holdem.js` | The rules — no UI in it, so it can be tested or run on a server |
| `js/characters.js` | Who can sit down. **This is the seam the NFTs plug into.** |
| `js/main.js` | The table, and the bots that sit at it |

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

## Not done yet

- **Multiplayer.** Everything is local; the bots are local. `holdem.js` is
  deliberately UI-free so the same file can run on a server when there are real
  opponents, but that server does not exist.
- **Real stakes.** Chips are a number in a page. Nothing is on chain and
  nothing should be until there is a server that holds the deck, because a
  client that knows every card is a client that can read them.
