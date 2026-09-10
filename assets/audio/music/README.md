# Music

Generated with ElevenLabs Music. Every track here is original: written for this
project from a description of instruments, tempo and mood, with lyrics composed
for Kevin's own story. Nothing is derived from an existing recording.

Music DOES draw on the ElevenLabs character balance, despite the counter
lagging far enough behind a render to suggest otherwise. Measured across 385
seconds of audio: about **825 characters per minute of music**, so a 3 minute
song is roughly 2,500. Test a style at 90 seconds before committing to a full
one — two 3 minute songs were rendered in a style that missed, which is 5,000
characters spent learning something 1,200 would have taught.

## Genre sampler

The same story told once per genre, each with its own lyric written to fit —
not one lyric pasted across four beats. All 90 seconds, so a style can be
judged before committing to a full track.

| file | genre | sound |
|---|---|---|
| `kevin-on-the-chain.mp3` | rap | 140 bpm trap, 808 slides, dark piano, ad-libs |
| `kevin-country.mp3` | country | pedal steel, fiddle on the chorus, 88 bpm drawl |
| `kevin-rock.mp3` | rock | chugging guitars, gang vocals, 152 bpm |
| `kevin-rnb.mp3` | R&B | funk bass as the hook, clav, horn stabs, 100 bpm |

## Everything else

| file | length | what it is |
|---|---|---|
| `kevin-still-here.mp3` | 3:00 | REJECTED. Slow-burn R&B. The band came out almost inaudible under the vocal and the singing did not land. Kept only as the record of what not to prompt |
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

## What went wrong the first time, so it does not go wrong again

The first two songs described the instruments and let the model decide the
balance. It buried them: the complaint was "has no music", and it was right.
Every prompt here now opens by saying the band must be loud, full and present
from the first bar, and that it is a record with a singer on it rather than a
vocal with something faint underneath. On the R&B track the bass line is
specified as the hook itself rather than as a bed.

## Re-cutting

    curl -X POST https://api.elevenlabs.io/v1/music \
      -H "xi-api-key: $ELEVENLABS_KEY" -H 'content-type: application/json' \
      --data-binary @assets/audio/music/still-here.json -o out.mp3

Change `music_length_ms` for a radio edit; a 60 second cut is the useful one
for video. Ask for "instrumental, no vocal" in the prompt for a bed that can
sit under a voiceover without fighting it.
