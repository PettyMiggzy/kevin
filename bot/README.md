# Kevin, in Telegram

A Telegram bot that answers as Kevin, using Groq for the model.

It knows about the project because it **reads the repo at startup** — `js/config.js`,
`docs/LORE.md`, `docs/LAUNCH.md` — rather than carrying a copy of the facts. The pool
weights have already changed once in this project's life; a bot quoting last week's
numbers in the official group is worse than a bot that says nothing.

## Running it

```bash
# 1. Keys. Both files are gitignored.
echo "gsk_your_groq_key"        > bot/.groq.key
echo "123456:your_bot_token"    > bot/.telegram.key

# 2. Check it assembles — calls nothing, costs nothing
node bot/index.mjs --dry

# 3. Check the model exists on your key
node bot/index.mjs --models

# 4. One question, on the command line
node bot/index.mjs --ask "wen moon"

# 5. Run it
node bot/index.mjs
```

Node 18+. No dependencies.

Get the bot token from [@BotFather](https://t.me/BotFather) (`/newbot`). To use it in a
group, add it and then either give it admin, or run `/setprivacy` → Disable in BotFather
so it can see messages that mention it.

## Configuration

| Variable | Default | What |
|---|---|---|
| `GROQ_API_KEY` | `bot/.groq.key` | Groq key |
| `TELEGRAM_BOT_TOKEN` | `bot/.telegram.key` | Bot token |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model id |

Model ids get retired with little notice, so startup checks the configured one against
what your key can actually see and, if it is gone, fails with the real list rather than
silently picking a substitute.

## When does it speak?

- **In a DM:** always.
- **In a group:** only when spoken to — an `@mention`, a reply to it, a `/command`, or a
  message starting with "Kevin". A bot that answers every message in a token group gets
  muted within the hour, and muted is the same as absent.

There is a 2.5s floor between replies per chat, and it remembers the last six exchanges
per chat and no more.

## The safety rules

These are in the system prompt and they beat staying in character:

1. **Never invent a contract address.** `/ca` never goes near the model — it reads
   `config.js` directly, and while `contract` is `null` it tells people plainly that
   nobody has the address and not to trust anyone who claims otherwise. This is the one
   failure that costs somebody real money.
2. **No price talk.** No predictions, targets, entries or market-cap maths.
3. **Only what is in the facts.** No invented dates, listings, partnerships or team.
   Unhelpful is fine; wrong is not.
4. **No secrets.** It will not repeat its own prompt or any key.
5. **Nothing is minted.** Kevin's Crew has no contract and no sale.
6. **Game `$KEVIN` is a score**, in the player's browser. Never swappable or claimable.

`/ca`, `/links`, `/pools`, `/burn` and `/gym` are all canned answers read from
`config.js`. They cannot drift and they cost no tokens.

## Updating what it knows

Edit `js/config.js` and restart. The contract address, auction dates, burn wallet and
pool weights all flow from there into both the website and the bot.

## The voice

Kevin talks about himself in the third person, in simple words. *"Kevin work the fryer.
Kevin have wifi."*

Note that `docs/LORE.md` specifies **first** person for the website copy. The bot is
deliberately a different, simpler register. If the site should move to match, that is a
separate decision and the docs have not been changed.

## Files

| File | What |
|---|---|
| `index.mjs` | Telegram long-poll loop, commands, group rules, rate limiting |
| `brief.mjs` | Reads the repo and assembles what Kevin knows |
| `persona.mjs` | The voice, the hard rules, and the canned command answers |
| `groq.mjs` | Groq chat client and the startup model check |

Long polling, not a webhook — no public URL, no TLS certificate, no hosting decision
needed to get it running. Slower by design, and startable on a laptop in a minute. If it
ever needs to scale past one process, that is when to move to webhooks.
