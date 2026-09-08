# KEVIN — video brief for ElevenLabs

Self-contained on purpose. The tool cannot open iamkevin.lol, so everything it
needs is in this file. Paste **Part 1** in as the brand/context prompt, then use
**Part 2** as the voice script and **Part 3** as the shot list.

---

## PART 1 — paste this as the context prompt

> You are making a short social video for **$KEVIN**, a memecoin on Robinhood
> Chain. Read this whole brief before writing anything.
>
> **The character.** Kevin works at a fast food restaurant. He is on the fryer.
> He has WiFi, a phone, and a plan. The plan is written on a whiteboard in what
> he calls his office, which is a corner of a storeroom. Three of the four boxes
> are already ticked. He ticked them himself.
>
> **The whole joke is the gap** between what he has and what he is certain is
> about to happen. He is not deluded. He is early. He would like you to
> understand the difference.
>
> **The voice — this is the part that matters most.** Kevin states absurd things
> in the flat tone of someone reading out a rota. He does not hype. He does not
> sell. He never says "we", "fam", "guys", or "let's go". He reports his
> situation, his situation is insane, and he has not noticed.
>
> - First person. Present tense. Short sentences.
> - Enormous ambitions are treated as scheduled admin.
> - The bigger the claim, the flatter the delivery.
> - No exclamation marks.
> - Never wink at the camera. Never explain the joke. He is not in on it.
>
> The test for any line: **would he say this to his shift manager in the same
> voice?** If it only works as a tweet, it is not Kevin.
>
> **Look.** Hand-painted, slightly wonky 2D cartoon. Thick black outlines, flat
> fills, visible brush texture — closer to a skate sticker than to corporate
> vector art.
>
> **Kevin is not a human being.** He is a red cartoon creature: a rounded head
> with a swept-back crest of thick red spikes, two very large white oval eyes
> with small black pupils, a pale cream muzzle, and a simple black triangle of
> a mouth. Flat red body, no visible clothing in the base form. He is drawn
> deliberately crude — the wonkiness is the style, not a mistake.
>
> Do NOT draw him as a person, and do not put him in a crew uniform or a paper
> hat. He works at a fast food restaurant, but he is a red cartoon creature who
> works at a fast food restaurant. The reference images are
> `assets/memes/face.jpg` (the canonical head) and `assets/video/kevin-promo.mp4`
> (the animated, glossier version). Feed one of those in if the tool accepts an
> image; describing him in words alone will not get you there.
>
> Brand colours, use these exactly:
> - Background yellow `#FFE500`
> - Ink black `#0B0B0B`
> - Red `#E8232B`
> - Cream `#FFF6C8`
>
> **Never show:** golden arches, any real restaurant chain's name, logo, or
> trade dress, or any real company's branding. The restaurant is generic and
> unnamed. This is not negotiable — it is the one thing that gets the video
> pulled.

---

## PART 2 — the voice script

Read **flat**. Deadpan. This is a man reading a rota, not a trailer voiceover.
Pauses matter more than emphasis.

### 45-second cut (primary)

```
I am Kevin. I work the fryer.
I have WiFi.
One of these is going to work out.

        [pause 1s]

I launched a coin. It is called KEVIN.
A billion of them. I kept none.

That was not generosity. The factory would not let me.

        [pause 0.5s]

Forty percent went to auction, over four days.
Sixty percent went into locked liquidity.
Zero percent came to me.

You do not have to believe that. It is on the chain. People have checked.

        [pause 1s]

I built a website on my break.
There is a gym on it. And a card room. And the place where I work.
You can walk around inside it.

        [pause 0.5s]

The pools earn fees.
I took a snapshot of who was holding, and I published the list.

        [pause 1s]

I am not going to tell you to buy anything.
I am on shift.

        [pause 1s]

iamkevin.lol
```

**Runtime:** ~45s at a slow, flat read. Do not speed it up. The pauses are the
joke.

### 15-second cut (for the hook / pre-roll)

```
I am Kevin. I work the fryer. I have WiFi.
One of these is going to work out.

        [pause 1s]

I launched a coin. A billion of them. I kept none.
The factory would not let me.

        [pause 0.5s]

I am not going to tell you to buy anything. I am on shift.

iamkevin.lol
```

### Voice settings

| Setting | Value | Why |
|---|---|---|
| Voice type | Young adult male, plain, unremarkable, light American | He is a regular guy on a fryer, not a narrator |
| **Stability** | **High (~75–85%)** | Deadpan is *low* variance. Low stability adds emotion, which kills the joke |
| Similarity | High (~80%) | |
| **Style exaggeration** | **Very low (0–15%)** | Any performance at all ruins it |
| Speed | Slightly slow | |

If a take sounds excited, energetic, or like an advert — reject it and raise
stability. The correct read sounds almost bored.

---

## PART 3 — shot list

You already own all of this footage. Nothing needs generating from scratch.

| Line | On screen | File in this repo |
|---|---|---|
| "I am Kevin. I work the fryer." | Kevin at the fryer, arms folded | `assets/video/kevin-promo-web.mp4` |
| "I have WiFi." | Phone in hand, one bar | `assets/memes/` (69 stills) |
| "A billion of them. I kept none." | The whiteboard, three boxes ticked | meme wall |
| "Forty / sixty / zero percent" | Three numbers, big, on brand yellow | on-screen text |
| "It is on the chain." | Block explorer, real page | `robinhoodchain.blockscout.com` |
| "I built a website on my break." | The painted world, walking around | screen-record `iamkevin.lol/world/` |
| "There is a gym on it." | The gym | `iamkevin.lol/gym/` |
| "And a card room." | The card room | `iamkevin.lol/poker/` |
| "I am on shift." | Back at the fryer, unbothered | `assets/video/kevin-loop.mp4` |
| "iamkevin.lol" | URL on brand yellow, black text | end card |

**Aspect ratios:** 9:16 vertical for TikTok / Reels / Shorts, 1:1 for the X
timeline. There is already a square master at
`assets/video/kevin-promo-square.mp4`.

**End card:** brand yellow `#FFE500`, black text, `iamkevin.lol`, ticker
`$KEVIN`, chain `Robinhood Chain`. No price. No chart. No rocket.

---

## PART 4 — the do-not-say list

These are not style notes. Some of them are the difference between a meme and a
problem, and two of them are lines this project has already drawn in its own
config file.

**Never say, in any cut:**

- **Anything that tells someone to buy.** No "get in", "don't miss", "last
  chance", "you're early".
- **Any price, target, prediction, market cap, or return.** None. Not even
  jokingly, not even as a number on screen.
- **"Hold to qualify"** — or any phrasing that links holding to getting the
  airdrop. The snapshot window has already closed; buying now cannot put
  anyone on the list, and implying otherwise is telling people to buy.
- **Any date or promise for the airdrop.** It is not funded and not deployed.
  You may say the snapshot was taken and the list is published, because both
  are true and checkable. Nothing further.
- **"Utility", "roadmap", "ecosystem", "revolutionary", "to the moon".** Kevin
  does not have a marketing vocabulary because Kevin does not know he is a brand.
- **Any real restaurant chain's name, logo, arches, or uniform.**

**One line to swap later.** Once the GME round is actually open and funded,
`"I took a snapshot of who was holding, and I published the list"` can become
`"The pools earn fees. Those fees are going back to people who held."` **Not
before.** An airdrop that is announced and does not happen is worse than one
that was never mentioned.
