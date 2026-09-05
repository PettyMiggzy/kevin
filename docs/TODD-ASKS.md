# What Todd needs to draw

Everything here is a drawing job. None of it can be done in code, and where I
have tried, it has been wrong — this file exists so the same ground is not
covered again.

## The rule

**Animation means the drawing changes between frames.** One drawing moved,
tilted, squashed or bobbed is not animation, it is rocking, and it reads as
rocking however it is dressed up. Two attempts proved it:

1. Whole sprite translated and scaled → "these are just vibrating"
2. Head split off and rocked against the body → "that's not animated that's
   rocking"

Both were right. The only stickers on the site that are genuinely animated are
the five walk cycles, and that is because Todd drew nine frames of each.

## Priority 1 — frames for actions

Same nine-frame treatment as the walk cycles, in whichever directions matter:

| Action | Why |
|---|---|
| **Idle / breathing** | Every game needs it, and it is the default sticker |
| **Lifting** | The gym is half the project |
| **Fry station** | The shift is the other half |
| **Cheer / celebrate** | The one people actually send |
| **Laugh** | Ditto |

Nine frames each is enough — that is what the walk cycles use and they read
fine at 12fps. Twelve or sixteen would be smoother.

## Priority 2 — heads

A head library is what makes 1,000 NFTs playable without 1,000 sprite sets. One
head per direction, per variant:

- plain, shades, cap, crown, gold tooth, angry, sleepy

They drop into `assets/sprites/parts/head/` and **every body animation
inherits them automatically**. This is the highest-leverage thing on the list:
seven heads times every action he has drawn, for the cost of seven drawings per
direction.

## Priority 3 — resolution

His frames are about 158x176. Fine for game sprites at native size; a 2.9x
upscale for a 512 sticker, which holds but is soft. If stickers matter more
than filesize, the frames at 2x or larger would fix it permanently.

## What is already handled in code

So he does not draw any of this:

- **Colours.** Eight colourways by palette swap, exact and crisp. He only ever
  draws red.
- **Cutting out.** Paper comes off automatically, however he lays the sheet out.
- **Alignment.** Frames are anchored on centre of mass and the ground line, so
  he does not need to register them.
- **Head/body split.** Automatic, at the muzzle.
- **Sticker encoding.** Sizes, alpha, Telegram's limits, all checked.

A photo of a sheet is enough. `tools/slice-sprites.mjs` and
`tools/slice-poses.mjs` take it from there.
