# Grok kit for Kevin

If you want to hand a model the character directly, this is what to give it.

## Reference image

Attach **`assets/refs/16-kevin-idle.png`** — one clean full-body Kevin on white,
cut from Todd's pose sheet. Do not attach the pose sheet itself: with fourteen
characters in frame, models keep several of them.

For a full turnaround, attach `assets/refs/14-todd-walkcycles.jpg` as a second
image, which shows him from front, back, both sides and three-quarter.

## The character description

Paste this verbatim. Every clause in it is there because a model got that
specific thing wrong at least once:

> Keep the character IDENTICAL to the reference. He is drawn SIMPLE and FLAT:
> solid red all over with NO clothes, NO shoes, NO gloves and NO muscles. Red
> hair swept over the top of his head and down ONE side in a sheet with ragged
> torn ends. TWO ENORMOUS white oval eyes that touch in the middle, tilted, one
> bigger, each with one black oval pupil. A big pale cream face patch across the
> lower half of his head, carrying on as a narrow cream strip down his front. A
> tiny black dot nose and ONE SMALL SOLID BLACK TRIANGLE for a mouth — never
> open, never lips, teeth or a tongue. Thin noodle arms and legs with simple
> mitten hands and plain oval feet. Heavy black outlines, flat colour, NO
> shading or gradients. Keep the whole character in frame, centred, with margin
> all round on a COMPLETELY FLAT single-colour background — no gradient, no
> texture, NO SHADOW under him and no shadow anywhere.

Then add one line for what you actually want, e.g. *"He is sitting at a poker
table holding two cards."*

## Two things that will bite

**Emphasis gets drawn.** A coin came back reading "KEK KEK", so the prompt was
changed to say "ONCE ONLY, never repeat the word" — and the model rendered
*that* onto the coin as "KEK ONCE ONY". Say what you want plainly; do not
argue with it in the prompt.

**Backgrounds come back with shadows.** Whatever the prompt says, expect a soft
gradient and a drop shadow under his feet. `node tools/flatten-bg.mjs <png>`
fixes it deterministically — region-grows from the frame edge and repaints flat
brand yellow, which is also what the sticker keyer needs.

## And the honest note

Every image you generate this way is a slightly different Kevin. Fine for a
one-off. Not fine for 500 of them — see `docs/PFP-COSTS.md`.
