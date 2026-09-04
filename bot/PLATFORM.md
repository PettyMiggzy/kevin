# What Telegram actually offers us

Checked against core.telegram.org on 2026-09-04, not from memory. Where a thing
is quoted it is quoted; where I could not get the page to give me the exact
wording I have said so rather than fill the gap in.

## Sound in stickers: no

Not in any sticker format, and not a thing that changed in 2026. The sticker
requirements say it in one line:

> **Video must have no audio stream.**

That is the video sticker spec (`.WEBM` / VP9 / one side exactly 512px / 3
seconds / 256KB / up to 30fps). Animated stickers are `.TGS` Lottie — vector,
512x512, 3 seconds, 64KB, 60fps — and there is no audio in that format either.
Custom emoji use the same technology at 100x100.

So a sticker of Kevin cannot make a noise, and nothing in 10.0 through 10.3
changes that.

**If we want Kevin to have a voice, it is a different message type.**
`sendVoice` and `sendAudio` carry sound. A voice note from Kevin in reply to a
mention is a real option and would cost a TTS call per message — worth doing
deliberately if at all, because a bot that talks out loud unprompted is a bot
people mute. I did not manage to get the API page to hand me the exact one-line
descriptions of `sendAnimation` and `sendVideoNote`, so before building on
either, confirm whether they carry audio rather than taking it from me.

## What 2026 did add that is worth having

Four things, in the order I would do them.

### 1. Ephemeral messages — Bot API 10.2, 14 July 2026

> Introduced support for Ephemeral Messages, allowing bots to send group
> messages and receive commands that are visible only to a specific user and
> the bot.

This is the best fit of anything here. Right now every `/ca`, `/pools` and
`/top` answer lands in front of the whole group, so the bot is either useful or
quiet and cannot be both. Ephemeral replies mean somebody can ask Kevin
anything, as often as they like, without the room seeing it — which also
removes most of the reason for the rate limit that currently makes the bot
ignore people.

The changelog describes a receiver-user parameter added to `sendMessage`,
`sendPhoto` and `sendVideo`. I did not get the exact parameter name out of the
page cleanly, so check it against the method docs before writing the call.

### 2. Streaming replies — Bot API 10.1, 11 June 2026

> Added the method sendRichMessage, allowing bots to send rich messages.
> Added the method sendRichMessageDraft, allowing bots to stream partial rich
> messages.

Kevin's replies come from Groq, which means a pause and then a wall of text.
`sendRichMessageDraft` streams it as it generates, which for a character bot is
most of the difference between "a bot answered" and "Kevin is typing to you".
Rich messages also carry structured blocks — tables, lists, collages,
slideshows, audio, video — which the leaderboard commands would use well once
there is a board to render.

### 3. A Kevin custom emoji pack

Custom emoji are the same pipeline as the stickers, at 100x100, and we already
have the art and the tooling. Anyone can create a set; using one needs Premium.
Cheap distribution from work already done: the KEK coin, the triangle mouth,
the flex.

### 4. Join Request Queries — Bot API 10.1

> Added the field supports_join_request_queries to the class User.
> Added the method answerChatJoinRequestQuery.
> Added the method sendChatJoinRequestWebApp.

Guard-bot functionality: the bot gets to answer a join request rather than
watch it happen. Worth a look before launch day, when the group is the target
rather than the audience.

## Also in 2026, less relevant to us

- **Live photos** (10.0) — a photo with a short video attached.
- **Polls** (10.0) — multiple correct answers, revoting, shuffling, media in
  options including stickers, and a minimum of one option instead of two.
- **Communities** (10.2, 10.3) — linked supergroups and channels.
- **Gifts** (10.3) — text, entities and privacy settings on gifts.
- **Rich Messages additions** (10.3) — buttons, expandable block quotations,
  document support.
