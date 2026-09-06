# KEVIN'S GYM

*No pain, only Kevin.*

A playable prototype. Open `gym/index.html` over http (not `file://` — it uses
ES modules) and press **Open the doors**.

```
python3 -m http.server 8899   # then http://127.0.0.1:8899/gym/
```

WASD or the on-screen stick to move, **E** or the button to work a station.

## Three worlds, and they are actually separate

**Kevin's Crib** is home and the hub — first person, with the card table in it
and a telly that takes you anywhere. **Kevin's Gym** is the gym, inside and out.
**McKevin's** is the fry house, with a car park, a drive-thru lane, picnic
tables and a pylon sign around it.

They are joined by doors, not a menu: the crib's front door puts you on the
gym's forecourt, the far end of that forecourt goes to McKevin's, and both have
a way back. Each swap happens behind a fade — the worlds really are torn down
and rebuilt between those two frames, and a hitch you can see reads as a bug
while a hitch behind a fade reads as a door. The Worlds button is still there as
a shortcut.

They are separate in the way that matters: **one is loaded at a time.** Entering
a world builds it, leaving it *disposes* it — geometry, materials and textures
freed, not merely hidden. Hiding a mesh saves you a draw call and nothing else;
its buffers stay on the GPU and its textures stay in memory, and the ceiling
that matters here is a phone's. Building and tearing down means detail added to
one room costs nothing in the other two, which is the whole reason to split
them. Bouncing between all three repeatedly returns to the same mesh count each
time, so nothing is being left behind.

`worlds.js` has the two pieces. `disposeWorld` walks a world and frees it, with
one trap worth knowing: props are loaded once, cached and `clone()`d per world,
and a clone SHARES its source's geometry — dispose that and the next world to
spawn the prop gets an empty box. Anything cloned off the cache is flagged and
its geometry is left alone. `captureInto` lets the existing builders keep
calling `scene.add` as they always did: note what was there, run the builder,
adopt the difference.

### Why the crib is first person

Because a house is a room you stand in, and a chase camera cannot be in one. It
has to see past a near wall and down through a roof, and a house has both — the
first version of the crib had a roof you stared at from inside and a front wall
you vanished behind on the way in. In first person neither problem exists, so
the walls go full height and the lid goes on. Look is drag, not pointer lock:
lock needs a click to arm, some embedded webviews refuse it, and it does nothing
at all on a phone — and this has to work in a Telegram browser first.

The card room is `/poker` in a frame rather than a link. It is a whole page that
works standing alone, so the crib borrows it; navigating away would drop the
scene, the walk back and the save.

## What is actually here

**Three worlds you walk between**, each built and torn down on entry so detail
in one costs nothing in the others:

- **Kevin's Crib** (24 x 11 over two rooms, first person, 399 meshes) — a card
  room with a green felt table under a chandelier, a slot machine, prize wheel
  and claw machine down one wall, a six-monitor trading desk running $KEVIN
  candles, a fitted kitchen, and through the arch a bedroom with his office in
  the back of it. His own face framed on the walls, the contract address over
  the bed, and no wall left bare in the band you actually look at
- **Kevin's Gym** (32 x 24, 877 meshes) — painted zones (a wooden lifting
  platform, a turf lane with metre marks, a cardio deck, a changing end), an
  exposed steel truss with fifteen strip lights and banners, five ceiling lamps
  that give the room zones you can tell apart across it, and a boxing ring in
  the corner with the bags. Supplements and water are stalls on the street
  outside now, not six metres of counter across the near end of the room
- **McKevin's** (24 x 16, 297 meshes) — a restaurant you work a shift inside:
  kitchen line, counter with three tills and three different menu boards, dining
  room, drive-thru window, and a car park with a pylon sign. Lit by its own
  lamps — cold over the dining room, warm over the line, and heat lamps over the
  pass, which is the only orange light in the building

**And in them:**

- Twelve people using the gym, seated at the equipment from the first frame,
  with actual weights in their hands at the spots that call for one
- 111 props at 5.4MB total, from four sources — a Sketchfab CC-BY gym pack, two
  CC0 Kenney kits, a diner kit, and six pieces authored to fit — all flattened
  to one flat toon material by `normalise()` on load, which is what lets four
  hands read as one
- Kevin, whose body scales with a single muscle number, and who can be a
  billboard of Todd's hand-drawn walk cycles instead (`?sprite`)
- Seven stations that work: bench, dumbbells, lat pulldown and squat rack feed
  strength, treadmill, rower and exercise bike feed stamina — each with its own
  sweep speed and timing window, so the squat is the slowest and tightest thing
  in the building and the bike is the most forgiving
- Exponential decay with a cap, a streak, and earnable freezes
- **A shop with eighteen things in it**: three consumables, eight colourways,
  and seven skins cut out of the contract address itself
- Touch controls, a mobile layout, sound, and saved progress

## Skins, and why six of them are the contract address

An Ethereum address is 40 hex characters and a hex colour is six, so the CA is
six colours with four left over. Chop `0x63D7fa...9e284A` into sixes and you get
`#63D7FA #990227 #94F594 #F724E7 #C38FF0 #BE3F9E` — anyone can check that, which
is the point. They are the only skins in the game whose colour nobody has to
take on trust. The four left over wrap onto the first two to make a seventh that
is not for sale at any price: it unlocks when the other six are owned.

That is not decoration. `js/config.js` publishes the address before trading
opens so the group memorises the real one while things are calm and recognises
the fakes on launch day. Collecting these makes somebody read the real address,
in order, for an hour. A cosmetic that teaches the CA does more anti-scam work
than a warning nobody reads.

Skins are a **palette swap, never a hue rotation** (`skins.js`) — Todd's art is
four flat colours and hue-rotating flat colour that has been through JPEG turns
his red to mud. They apply to whichever body is standing there: the sprite gets
a recoloured atlas, the built body gets its materials classified by hue and
repainted, each keeping its own offset from the kit red so the shadow red stays
darker than the body red in every colourway.

## The two decisions worth knowing about

**The character IS the NFT.** `js/voxel.js` extrudes a KEVIN'S CREW avatar
straight out of its 32×32 grid into a playable body — the token somebody owns
is the character they walk around as, with one art pipeline instead of two.

This started as a convenience and turned out to delete the riskiest item in the
whole plan. The character pipeline was budgeted at 8–15 days and rated highest
risk, because of two things that can force a redo of weeks of work: an
auto-rigger that may simply refuse a stylised body, and glTF's rule that every
morph target must share vertex count *and ordering* with the base primitive —
so a separately-modelled skinny Kevin and buff Kevin do not merely look bad
together, they will not load.

A voxel body assembled from separate groups has no skeleton, no skin weights
and no shared-topology rule. There is nothing to rig and nothing to refuse.
Animation is rotating a group. Muscle is `group.scale`, and the head
deliberately does not grow — that is what sells the rest of him getting bigger.

Heads merge to a single draw call: same-coloured cells in a row become one box
before anything reaches the GPU.

**The props are normalised, not used as delivered.** Tripo returns photoreal
PBR at ~500,000 triangles and 2048px maps — about 11MB a prop, 154MB for a gym.
`tools/optimize-props.mjs` takes that to ~1,500 triangles and 772KB total, and
`normalise()` in `main.js` then throws away every material property that says
"renderer" and rebuilds each one as a flat toon material with an outline. That
second pass is not polish. Twelve models from twelve prompts read as an asset
flip without it; it is the thing that makes them read as one hand.

## Decay, and why the numbers are what they are

The whole product is one question: *do you open this tomorrow because Kevin
will visibly shrink if you don't?* So the numbers in `js/save.js` matter more
than anything else in the build.

- **Exponential, ~5.2%/day, capped at 45%.** A linear drain takes everything
  from somebody who went away for a fortnight, and they never come back. This
  shape takes a lot on day one and progressively less after.
- **The bar to keep your streak is one set.** Deliberately trivial. Decoupling
  streak-keeping from the ambitious daily goal is the single change with the
  best measured retention effect in this genre.
- **Freezes are earned, never bought with real money.** A paid streak restore
  in a crypto game invites exactly the conversation you do not want.
- **No confirmshaming.** "Are you really going to give up now?" costs more than
  it earns.

## What is deliberately NOT in here

Multiplayer, leaderboards, wallet connect, achievements, quests.

**No crypto either, and that is on purpose.** $KEVIN in the shop is a score. It
touches no wallet and no chain — the contract address appears in the game only
as six colours and a framed picture, never as something to transact with.
Adding a token to v1 turns a game problem into a compliance and security
problem before anyone knows whether the game works.

**No golden arches.** McKevin's is a fry house with a red-and-yellow fascia and
a pylon sign, and it will stay one. The name is fine; the mark is the line, and
`tools/scrub-logo.mjs` exists because an early sticker set crossed it.

## Known limits, stated plainly

- **Progress is `localStorage` and `Date.now()`.** Change the device clock and
  you can farm it. Fine for a prototype; the moment real $KEVIN or an NFT boost
  touches this, decay has to move to server time — stored as last-checkpoint
  plus value, derived lazily on read, with the client sending intents ("I used
  the bench") rather than results ("my muscle is 90"). `save.js` says the same
  thing where somebody changing it will read it.
- **Sprite Kevin is still behind `?sprite`.** Todd's drawings are the only
  thing that is exactly on model, but the walk atlas is one build — there is no
  lean/fit/swole set yet — so `applyMuscle` can only scale the whole drawing
  16%, which is a poor substitute for a torso that actually inflates. The built
  body stays the default until those sheets exist.
- **Only the head extrudes from the NFT grid.** The body is procedural boxes
  coloured by the shirt trait, because the avatar is a portrait and stops at
  the shoulders.
- **Seven props ship without being placed** (~510KB of the repo, not of any
  player's download — props are fetched by name on demand). They are ingested
  spares waiting for a home, not dead code, but they are not free either. Two
  byte-identical duplicates were deleted rather than kept as spares.
- `raw/` is 294MB and gitignored. `state.json` beside it is the paid-work cache
  and IS committed — a cached task id is the difference between re-downloading
  a model and buying it a second time. Never delete `raw/` without checking it.

## Regenerating the assets

```
node tools/gen-props.mjs --dry                     # what it would cost, spends nothing
node tools/gen-props.mjs                           # generate anything not cached
node tools/ingest-props.mjs --from ~/some-kit --dry # match a bought kit to our names
node tools/optimize-props.mjs                      # 294MB -> 5.4MB, 57x
node tools/slice-sprites.mjs --sheet <png> --out <dir>   # cut a walk sheet
```

`optimize-props.mjs` flags anything over a 20,000-triangle budget rather than
raising the budget to hide it. Nothing is over it today.

`gym/assets/props/state.json` is the paid-work cache and is **committed on
purpose** — a cached task id is the difference between re-downloading a model
and buying it a second time. `raw/` holds the unoptimised originals and is
gitignored; never delete it without checking `state.json` first.

Licences live in `gym/assets/props/licences/` and the attribution every CC-BY
source requires is in `gym/assets/props/CREDITS.txt`. Read it before shipping
anywhere new: CC-BY is free, not unattributed.
