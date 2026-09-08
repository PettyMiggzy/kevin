# kevin-story — how the promo was built

`assets/video/kevin-story-*.mp4`, 2:27. Four cuts from one master.

| file | use |
|---|---|
| `kevin-story-1080p.mp4` | 1920×1080 master, crf 17. Archive + YouTube |
| `kevin-story-web.mp4` | same frame, crf 25 capped at 1.3 Mbps. The site, and anywhere with a size limit |
| `kevin-story-vertical.mp4` | 1080×1920. TikTok / Reels / Shorts |
| `kevin-story-square.mp4` | 1080×1080. The X timeline |

## The voice

`vo-script.json` is the exact spoken text, in 14 segments.

Generated with ElevenLabs, voice **Will** (`bIHbv24MWmeRgasZH58o` — young, American,
conversational), model `eleven_multilingual_v2`:

```
stability        0.85     high, because DEADPAN IS LOW VARIANCE
similarity_boost 0.80
style            0.00     any performance at all kills the joke
```

Those settings are the whole trick and they are counter-intuitive. The instinct
is to lower stability for "personality"; that produces an excited read, which is
the one thing Kevin never is. If a take sounds like an advert, raise stability
rather than trying to direct around it.

**Re-generating will not reproduce the master byte for byte.** TTS is not
deterministic, so the audio in `assets/video/` is the artifact, not a build
output. That is why the mp4s are committed rather than gitignored.

## The timing

`timeline.tsv` — segment, start, speech duration, pause after, total.

The pauses are authored per line, not uniform: ~0.7s after a plain fact, 1.3–1.8s
after a punchline. That spacing is doing as much work as the words. Changing a
line means re-cutting the picture to match, because the shots are built to these
exact durations.

## The picture

24 shots, hard cuts, no transitions — transitions would be trying too hard for
this character.

- Stills get a blurred-fill background plus a slow Ken Burns push, so square
  memes sit on a 16:9 frame without letterbox bars.
- **Title cards are static.** Zooming type makes it shimmer, and on a title card
  the type is the entire point.
- Social cuts **pad, never crop**. A 9:16 centre-crop of a 16:9 card cuts the
  words in half.

Cards are in `cards/`, rendered from the real brand fonts — `luckiest-guy-400.woff2`
converted to TTF with fontTools, not substituted with a lookalike.

## What is deliberately not in it

No price, no target, no market cap, no chart, no rocket. No "hold to qualify"
and no date for the airdrop — the snapshot window has closed, so linking holding
to the drop would be telling people to buy onto a list they cannot join. It ends
on "I am not going to tell you to buy anything."

Those are not stylistic choices. They are the lines `js/config.js` already draws,
and `docs/VIDEO-BRIEF.md` carries the full list.

## Footage that was excluded

14 memes are kept out of the pool: the 10 in the `HELD` map in
`tools/index-memes.mjs` that carry a real chain's arches or wordmark, plus
`another-castle`, `the-og`, `the-original` and `when-i-grow-up`. A trademark in a
paid-campaign video is a different order of risk from one on a meme wall.
