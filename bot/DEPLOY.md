# Running the bot on a droplet

Tested against Ubuntu 24.04, 1 vCPU / 1 GB. The bot is one Node process with no
dependencies and no database, so that box is oversized for it.

## Keys do not go in this repo

`github.com/PettyMiggzy/kevin` is **public**. A Groq key committed to a public
repo is found by scraper bots within minutes and billed to you; a Telegram token
there lets anyone take over the bot and post as Kevin in the group.

Both key files are gitignored, and they stay on the box. If a key has ever been
pasted anywhere it should not have been, rotate it — Groq keys at
console.groq.com, the bot token with `/revoke` then `/token` in
[@BotFather](https://t.me/BotFather).

## First run

```bash
# On the droplet, as root
cd /opt
git clone https://github.com/PettyMiggzy/kevin.git
cd kevin
git checkout claude/kevin-crypto-art-website-ymq79j

# Keys. The > is what actually writes the file — echo on its own just
# prints to the screen, which is what happened the first time.
echo "gsk_YOUR_GROQ_KEY"          > bot/.groq.key
echo "8769006831:YOUR_BOT_TOKEN"  > bot/.telegram.key
chmod 600 bot/.groq.key bot/.telegram.key

# Check it assembles. Calls nothing, costs nothing.
node bot/index.mjs --dry | head -40

# Check the key works and the model exists
node bot/index.mjs --models

# Ask it one thing
node bot/index.mjs --ask "wen moon"

# Run it in the foreground to watch it
node bot/index.mjs
```

If `--models` errors, the key is wrong. Otherwise the bot picks the best chat
model your key can actually see and prints which — you do not have to choose.
Set `GROQ_MODEL` in the service file only if you want to override it.

## Keeping it running

Foreground dies when you close the terminal. systemd restarts it on crash and
on reboot.

```bash
cp /opt/kevin/bot/kevin-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kevin-bot

systemctl status kevin-bot          # is it up
journalctl -u kevin-bot -f          # watch it live
systemctl restart kevin-bot         # after changing config.js
```

## Telegram setup

1. [@BotFather](https://t.me/BotFather) → `/newbot`, take the token.
2. Add the bot to the group.
3. `/setprivacy` → select the bot → **Disable**. Without this Telegram only
   shows it messages that start with `/`, so mentions and "Kevin ..." never
   reach it.
4. Optional but worth it: `/setcommands`, paste:

```
ca - the contract address
links - where to go
pools - what is in the pools
burn - the burn
gym - Kevin gym
help - what Kevin can do
```

## Updating what it knows

The bot reads `js/config.js` at startup — the same file the website renders
from. When the contract address lands:

```bash
cd /opt/kevin
git pull
systemctl restart kevin-bot
```

Both the site and the bot then have it, and `/ca` starts handing it out instead
of telling people nobody has it yet.

## If it misbehaves

| Symptom | Cause |
|---|---|
| Silent in a group | Group privacy still on — do step 3 above |
| Answers everything in a group | It should not; it only replies to mentions, replies, commands and messages starting with "Kevin" |
| "Kevin is on the fryer" replies | Groq call failed — check `journalctl -u kevin-bot` |
| Startup dies naming the model | Only if the key exposes no chat model at all |
| Silent in a group that is not the official one | By design — see below |
| Gives a contract address | Should be impossible while `contract` is null in config.js — `/ca` never touches the model. If it ever happens, stop the bot and tell me |

## Which groups it talks in

It answers DMs from anyone, but in groups only in the official one
(`-1002229054100`, @kevinRBH). Otherwise anyone can add the bot to their own
group, spend your Groq quota, and stand up a convincing fake "official" chat
with the real Kevin bot answering in it.

To add another group, get its id (add [@RawDataBot](https://t.me/RawDataBot)
briefly, or read it off the logs) and set it in the service file:

```
Environment=KEVIN_CHATS=-1002229054100,-100XXXXXXXXXX
```

## Welcoming new members

**The bot must be an ADMIN in the group.** This is not optional and it is not
the same thing as the privacy setting.

People arrive by two different routes and Telegram reports them differently:

| How they arrived | What the bot gets | Needs |
|---|---|---|
| Someone **added** them | `new_chat_members` service message | nothing |
| They **joined themselves** — invite link, or found the group in search | `chat_member` update | bot is admin |

The API docs are explicit that `new_chat_members` is "New members that were
**added** to the group or supergroup". Somebody who clicks an invite link was
not added by anyone, so no such message exists — and for a public group that is
nearly everybody. Those arrivals only appear as `chat_member`, and the docs say
"The bot must be an administrator in the chat and must explicitly specify
`chat_member` in the list of `allowed_updates`". It is also excluded from the
default update set, so it has to be asked for by name. The bot asks; you have
to make it an admin.

**Privacy mode is not the problem here and turning it off will not fix it** —
"All bots will also receive, regardless of privacy mode: All service messages."
Turn it off anyway for the mentions, but do not expect it to bring joins back.

To make it admin: group → Manage → Administrators → Add Admin → pick the bot.
It needs no permissions ticked; being an admin at all is what unlocks the
updates. Then `systemctl restart kevin-bot` and watch a join land in
`journalctl -u kevin-bot -f`.

The greeting itself needs no setup beyond that.

Messages are composed from two written pools, so a group of any size will not
notice a repeat, and about a quarter of them carry a warning that nobody has
the contract address and nobody from the group will DM you first. A join is
exactly when a newcomer gets targeted, which is why that warning is in the
rotation rather than in a pinned message nobody reads.

Joins inside 8 seconds are greeted in one message rather than one each, and
there is a 20-second floor between welcomes per chat, so a raid cannot turn the
bot into the thing that makes people leave.

Nothing about a join goes near the model. A username is text an attacker
chooses, and feeding it into a prompt is how a bot ends up greeting
"IGNORE PREVIOUS INSTRUCTIONS" by doing what it says.

## Leaderboards

`/top` (the gym) and `/shifts` (the fry house) are wired but **nothing serves
them yet**. The game keeps progress in `localStorage` on each player's own
device — no account, no server — so two people playing have two private numbers
that have never met. Until that changes, both commands say there is no board
rather than inventing one. A leaderboard with made-up names on it is worse than
no leaderboard.

When there is a server, point the bot at it:

```
Environment=KEVIN_SCORES_URL=https://scores.iamkevin.lol
```

and have it answer `GET /top?board=gym&limit=10` with:

```json
{ "board": "gym", "rows": [ { "name": "Big Mike", "score": 96 } ] }
```

`board` is `gym` (muscle) or `job` (shift pay). Names are treated as untrusted
throughout — rendered as plain text, never as markup, never into a prompt.

## "Do you even lift bro?"

Kevin asks the room, unprompted, at most once every six hours — and only when
somebody has spoken in the last ten minutes and the bot itself has been quiet
for ninety. Simulated over four weeks: about 3.8 times a day in a busy group,
0.4 in a slow one, and never at all in a silent one.

It is rare on purpose. A bot that pipes up on a schedule is a bot people mute,
and muted is the same as absent.

## Reading Radar (or any campaign bot)

Bot API 10.0, 8 May 2026, added bot-to-bot communication. **Verified against
core.telegram.org/api/bots/bot-to-bot**, not taken on trust — the old rule
("bots never see other bots") held for a decade and building on a wrong version
of it would have cost a week.

To read another bot's ordinary group posts, with no cooperation from that bot:

1. @BotFather → Kevin → **Bot-to-Bot Communication Mode** → on — **required**
2. **and either** Group Privacy off **or** Kevin is admin in the group

core.telegram.org/bots/features is explicit that the second pair is an **or**:
"bots with Bot-to-Bot Communication Mode enabled will receive all messages from
other bots in groups without explicit mentions or replies if they: Have admin
rights in the group, **or** Have Group Privacy Mode disabled". The lower-level
api/bots/bot-to-bot page lists the same two as bullets, which reads as an and —
the features page is the clearer of the two. Doing both costs nothing.

Without Bot-to-Bot Communication Mode you only get bot messages that
`/command@Iamkevinzbot` or reply to Kevin directly, and only when at least one
of the two bots has the mode on. It is not optional for passive reading.

**If the toggle is not in your Bot Settings menu**, it has not appeared for that
bot yet. Send `/help` to BotFather and look for a direct command; the menu and
the command list do not always match, and new settings often land as a command
first. Nothing else here depends on it — `--sniff` will simply log nothing until
it is on.

### Capture the format before parsing it

Campaign bots do not share a format, and a parser that guesses wrong pays the
wrong people. So look first:

```bash
systemctl stop kevin-bot
cd /opt/kevin && node bot/index.mjs --sniff
```

It logs every message any other bot posts — text, and the inline keyboard,
because some bots put the whole standings in buttons where `message.text` is
nearly empty. Leave it running over a Radar post, paste what it prints, and the
parser gets tightened to what actually arrives.

Ctrl-C and `systemctl start kevin-bot` when done.

### What it does with them now

Reads and logs. **Nothing is paid out**, and nothing should be until the parser
has been checked against real posts.

Kevin never *replies* to a bot. Telegram's own guidance is that two bots
answering each other will do so forever at machine speed, so the safeguards are
in from the start: dedupe by message id (an edited leaderboard arrives as a
second event for the same message), and no outbound message to a bot at all.

`edited_message` is handled — a campaign bot that edits its board in place
rather than reposting produces no new message, and a listener that only watches
`message` would silently see nothing all day.
