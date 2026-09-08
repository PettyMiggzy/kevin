# When you're home

Ordered by what unblocks the most. Nothing here needs me — but say the word
and I'll do the writing for any of it.

---

## 0 · Adam Sheldon — $350, YouTube + X

The site is ready for an audience now: burn counter, fee receipts, docs page
and roadmap are all live and all chain-verified.

- [ ] **Burn some supply BEFORE the video goes out.** This is the sequencing
      that matters. The counter is live and honest, which means right now it
      reads **zero**, because zero is true. If his video says supply is being
      burned and a viewer clicks through to a counter reading zero, that is
      worse than having no counter at all. Burn first, let the row land, then
      he films.
- [ ] Send him **`https://www.iamkevin.lol/kit`** — the marketing kit. Pitch,
      live numbers, the verifiable facts, every asset downloadable, the voice
      guide, and the four things not to claim. One link, everything on it.
- [ ] `docs/BRIEF.md` is the same thing as a file if he wants it in writing,
      including the rule that protects him: **if he was paid in $KEVIN, he
      says so, once, in the post.**
- [ ] Send him `assets/png/kevin-gme-1080.png` for the thumbnail or the X post
- [ ] Agree what he is NOT saying: no price, no targets, no floor, no airdrop
      date. That list is in the brief — point at it rather than trusting memory.

## 1 · DEX Screener — finish the submission

You were mid-form. Everything you need is in `docs/DEXSCREENER.md`.

- [ ] **Supply Description** — paste the block from `DEXSCREENER.md §1`
- [ ] **Locked Addresses** — add exactly one: `0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383`
- [ ] **Header image** — `assets/png/header-1500x500.png` (3:1, 55 KB)
- [ ] **Links** — use the `www.` versions, the apex 308-redirects and gets rejected:
      - `https://www.iamkevin.lol`
      - `https://www.iamkevin.lol/docs`
      - `https://x.com/Iamkevinonrh`
      - `https://t.me/kevinRBH`

Cost is $299. **Check first whether Kekfun already pushes metadata that
DEX Screener ingests for free** — if the profile fills itself, that $299 buys
nothing.

## 2 · GeckoTerminal — same links, free

GeckoTerminal indexes the pools already. Submitting token info there is free
and it feeds CoinGecko later, which is the listing actually within reach
(CMC is not — see below).

- [ ] Submit token info: same logo, same four links, same description
- [ ] Do this **before** paying DEX Screener, so you can see what a free
      listing gets you first

## 3 · FOMO — the real one

FOMO is ~35% of all Robinhood Chain terminal volume and went from <10k to
80–100k daily traders between June and August. On this chain it is a bigger
deal than CMC.

- [ ] Transfer tokens to the wallet (whatever their listing requires)
- [ ] Submit the thesis — **draft is written, see below**
- [ ] Confirm what format they want it in (their form, a tweet, a doc?)

## 4 · Narrative — somebody asked

Draft written below. It is the same story the site and docs already tell,
compressed into something a stranger can repeat.

---

## Not now

- **CoinMarketCap.** Liquidity is ~$5k against a bar around $400k. It is not
  a form problem and a better application will not fix it. Revisit when
  volume holds and liquidity is six figures.
- **Anyone offering a guaranteed CMC or CoinGecko listing for a fee.** Both
  applications are free and neither guarantees anything. That pitch shows up
  exactly when a founder starts asking this question.

## 5 · The GME airdrop contract

`contracts/src/KevinAirdrop.sol` is written with 22 passing tests. It is a
Merkle distributor: publish one root, everyone claims their own share, anybody
can verify their entry. Nothing is deployed.

To actually airdrop GME, in order:

- [ ] Deploy `KevinAirdrop`
- [ ] Publish the snapshot block **in advance**, so it cannot look chosen
      after the fact
- [ ] Take the snapshot, excluding the pools, the factory escrow, the burn
      addresses and the treasury — otherwise contracts get a share
- [ ] Build the Merkle tree; publish the root **and** the full list
- [ ] Fund the round with GME
- [ ] Only then say anything publicly

**Until it is funded and dated, `js/config.js` keeps `airdrop.confirmed:
false`, and nobody — you, the bot, or Adam — says a date, an amount, or "hold
to qualify". That last one is telling people to buy.**

## Still open from today

- [ ] The liquidity depth problem — ~$5k across three pools is behind the 12%
      slippage, the arb bots, and CMC being out of reach. You now have
      3.4M KEVIN + the quote tokens from the fee claim to do something about
      it. Say the word and I'll work out the exact tick range and size.
- [ ] Turn on the buy bot (`BUY_CHAT_ID` + `LIVE=1`, then `git pull && ./setup.sh`)
- [ ] Rotate the Groq and Telegram keys — still outstanding, flagged repeatedly
- [ ] Nothing in `contracts/` is deployed. 229 tests pass. No addresses.
