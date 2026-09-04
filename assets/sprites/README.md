# Sprites

Cut from `assets/refs/14-todd-walkcycles.jpg` by `tools/slice-sprites.mjs`.
Rerun it any time; nothing here is hand-edited.

```
walk-atlas.png    9 columns x 5 rows, 158x176 per cell
walk-atlas.json   cell size, row order, and every frame's x/y/w/h
walk/<dir>-NN.png the same frames individually
```

Directions: `front`, `back`, `left`, `right`, `diagonal` — 9 frames each, 45 in
total. 12fps loops well.

These are **real hand-drawn animation**, not a sprite moved around. That matters
because the alternative — taking one still and translating or squashing it — is
what "vibrating" looks like, and no amount of easing fixes it.

## What the slicer is actually doing

Finding the grid is the easy part. Two things are not:

**Alignment.** Trimming each frame to its own bounding box and packing the
results gives a walk cycle that jitters, because every frame's box is a
different size — the swinging arm alone moves the box edge several pixels a
frame. Frames are anchored on the horizontal **centre of mass** (not of the
bounding box, which that arm drags around) and on the lowest inked row, which
is the ground he stands on. Every cell is the same size, so frames are
interchangeable and the engine never special-cases.

**Getting the paper off.** The sheet is a JPEG, so every black outline is ringed
with compression noise a few levels off white. Two obvious approaches both fail
and both were tried:

- A tight colour key leaves the ring behind, and at sprite size it reads as a
  dirty grey halo.
- A loose colour key punches holes through his face, because his eyes are white
  and his muzzle is cream — both lighter than any threshold that catches the
  halo.

What works is a flood fill inward from the cell border plus one pixel of
erosion. The paper touches the frame edge and his face does not, and that is the
only difference that reliably separates them. The fill also has to treat
transparent padding as passable — the frame is drawn into the middle of a larger
cell, so seeding on light pixels alone finds nothing and leaves the paper as a
white box.

## Native resolution, on purpose

Cells are 158x176 because that is roughly what Todd's frames actually are. They
are not upscaled. Blown up to 512 for a sticker they go soft, which is a real
limit of the source and not something code fixes — for anything larger, ask
Todd for the frames at full size.
