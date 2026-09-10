# Music

Generated with ElevenLabs Music. Every track here is original: written for this
project from a description of instruments, tempo and mood, with lyrics composed
for Kevin's own story. Nothing is derived from an existing recording.

Music generation does **not** draw on the ElevenLabs character balance — that
stayed put across all of these — so re-cutting a track is effectively free and
there is no reason to keep a take nobody likes.

| file | length | what it is |
|---|---|---|
| `kevin-still-here.mp3` | 3:00 | the song. Slow-burn R&B, male lead with harmony stacks on the chorus |
| `kevin-theme.mp3` | 1:30 | instrumental theme — greasy funk bass, dusty drums, a feral jingle hook |
| `gym-loop.mp3` | 1:00 | `/gym` — heavy 808s, trap hats, an iron clang on the downbeat |
| `arcade-loop.mp3` | 0:45 | the DOS game — chiptune, square lead, ~140 bpm |

## The song

"I'm still here." Written around the one thing about this project that is
actually true and actually unusual: it is all written down where anyone can
check it. The verses are the night shift — two in the morning, the fryer still
on, everybody else clocked out. The second verse turns to the receipts. The
bridge drops to almost nothing before the last chorus opens up.

It is deliberately not a song about a ticker. Nobody shares one of those.

The full lyric and the generation prompt are in `still-here.json` next to this
file, so the track can be re-cut with a different vocal, tempo or arrangement
without rewriting it from scratch.

## Re-cutting

    curl -X POST https://api.elevenlabs.io/v1/music \
      -H "xi-api-key: $ELEVENLABS_KEY" -H 'content-type: application/json' \
      --data-binary @assets/audio/music/still-here.json -o out.mp3

Change `music_length_ms` for a radio edit; a 60 second cut is the useful one
for video. Ask for "instrumental, no vocal" in the prompt for a bed that can
sit under a voiceover without fighting it.
