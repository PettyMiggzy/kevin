# Buying art for the gym

The props in the game now were generated one prompt at a time with Tripo. That
is why `normalise()` in `gym/js/main.js` exists and why it throws away every
material property that says "renderer" and rebuilds each prop as a flat toon
material — twelve models from twelve prompts read as an asset flip without it.

A kit fixes that at the source, because a kit is modelled as a set. This is what
to buy and what to do with it.

## What to buy

**A low-poly gym or fitness prop kit, in glTF/GLB, low-poly and untextured or
flat-textured.** The two that fit this game's look:

| | |
|---|---|
| **Synty POLYGON – Gym / Fitness** | The closest match. Flat colours, one shared palette texture, low triangle counts. Ships FBX; export to GLB (below). |
| **Kenney – Sports / Furniture kits** | Free, CC0, even simpler. Fewer gym-specific pieces, so expect gaps. |

**Do not buy a photoreal or PBR pack.** Every one of its material maps gets
thrown away by `normalise()` on the way in, so you would be paying for 2048px
textures to delete them — and the triangle counts that come with that kind of
pack are the thing `optimize-props.mjs` exists to fight.

## What the game asks for

Twenty-two props. Anything missing just does not spawn — the room opens without
it rather than not at all — so a kit that covers most of this is fine.

```
bench  dumbbell-rack  treadmill                      the three playable stations
squat-rack  plate-tree  pullup-rig  kettlebell  dumbbell  medicine-ball
lat-pulldown  cable-machine  leg-press  rowing-machine  punching-bag
locker  water-cooler  towel-bin  protein-tub  bucket  speaker
gym-clock  gym-mirror
```

## Getting it in

If the kit ships FBX, export to GLB first — Blender, **File > Export > glTF 2.0**,
format **glTF Binary (.glb)**, and *one file per prop* rather than one scene
with everything in it.

Then:

```bash
node tools/ingest-props.mjs --from ~/Downloads/gym-kit --dry   # read the matches
node tools/ingest-props.mjs --from ~/Downloads/gym-kit         # copy them in
npm run props:optimize                                         # make them shippable
```

`ingest-props.mjs` matches the kit's names against the game's. Kits name things
`SM_Prop_Gym_LatPulldown_01`; the game asks for `lat-pulldown`. It splits
CamelCase, ignores the noise tokens every kit carries (`SM`, `Prop`, `LOD0`,
`01`), and assigns best-match-first across the whole set rather than in the
order the game lists its props — going in order lets `dumbbell-rack` take the
file `squat-rack` needed and leaves the better match for neither.

**Always `--dry` first.** It prints what matched and how confident it was.
Anything wrong gets corrected in `gym/assets/props/aliases.json`, which is
written on the first real run and is just `"game-name": "file-name.glb"`. A
hand-written alias always beats the matcher.

`optimize-props.mjs` then does the part that decides whether the game opens:
Tripo's bench arrived at 376,675 triangles and 11MB. Simplified it is 6,103
triangles and 124KB, and all twenty-two come in under 800KB together.

## What it will and will not fix

**Will:** the props looking like they came from twelve different places, which
is the thing you can currently see.

**Will not:** the characters. The crew are voxel bodies extruded from their
32x32 NFT grids — no skeleton, no skin weights, and `applyCrewMuscle` scales
groups to make them bigger. That was a deliberate trade (see `gym/README.md`)
and it deleted the riskiest item in the whole build. Prop kits do not touch it.

Going to modelled characters means humanoid rigs and Mixamo animations, and it
means the NFT-is-the-character pipeline has to be replaced with something that
can wear a token's art. That is a fork in the road, not a purchase — worth
deciding before any more art money is spent.
