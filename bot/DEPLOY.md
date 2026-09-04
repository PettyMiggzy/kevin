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

If `--models` errors, the key is wrong. If it lists models but startup then
complains the configured one is missing, pick one from that list and put it in
the service file below as `GROQ_MODEL`.

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
| Startup dies naming the model | Model retired; pick one from `--models` |
| Gives a contract address | Should be impossible while `contract` is null in config.js — `/ca` never touches the model. If it ever happens, stop the bot and tell me |
