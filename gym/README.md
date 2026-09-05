# KEVIN'S GYM

*No pain, only Kevin.*

A playable prototype. Open `gym/index.html` over http (not `file://` — it uses
ES modules) and press **Open the doors**.

```
python3 -m http.server 8899   # then http://127.0.0.1:8899/gym/
```

WASD or the on-screen stick to move, **E** or the button to work a station.

## Three worlds, one street

You start at home. **Kevin's Crib** is the hub: the card table is in it, and the
telly is a map that will drop you at either of the other two. **Kevin's Gym** is
down the street, and **McKevin's** is at the far end. It is one continuous
street, so all of it can be walked — the map is a shortcut, not a loading screen.

The crib gets its own camera instead of the chase cam. The chase cam sits behind
and above the player and pulls further back the further up the street you are,
which is right for a forecourt and wrong for a room six metres deep: from inside
the crib it ends up outside the back wall, filling the screen with it. The room
is small enough to frame whole, so it is framed whole. Its front wall is cut to
waist height for the same reason — the dollhouse trick, because at full height
the near wall stands between the shot and the player and you vanish behind your
own house.

The card room is `/poker` in a frame rather than a link. It is a whole page that
works standing alone, so the crib borrows it instead of reimplementing it;
navigating away would drop the scene, the walk back and the save, and returning
would cost a full reload of the gym.

## What is actually here

- One room, toon-shaded, with black inverted-hull outlines
- Twelve props generated with Tripo and normalised to one art direction
- Kevin, built from primitives, whose body scales with a single muscle number
- Three stations: bench and dumbbells feed strength, treadmill feeds stamina
- Exponential decay with a cap, a streak, and earnable freezes
- A three-item supplement shop paid for in earned $KEVIN
- Touch controls, a mobile layout, and saved progress

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

Multiplayer, leaderboards, wallet connect, NFTs, a second room, a minigame,
achievements, quests, NPCs, sound. v1 tests return rate; a minigame would
confound that with whether the minigame is fun.

**No crypto either, and that is on purpose.** $KEVIN in the shop is a score. It
touches no wallet and no chain. Adding a token to v1 turns a game problem into
a compliance and security problem before anyone knows whether the game works.

## Known limits, stated plainly

- **Progress is `localStorage` and `Date.now()`.** Change the device clock and
  you can farm it. Fine for a prototype; the moment real $KEVIN or an NFT boost
  touches this, decay has to move to server time — stored as last-checkpoint
  plus value, derived lazily on read, with the client sending intents ("I used
  the bench") rather than results ("my muscle is 90"). `save.js` says the same
  thing where somebody changing it will read it.
- **The props and the character are two art directions.** Props come from
  Tripo and are smooth; the character is blocky. It reads acceptably as toys in
  a room, but it is a real decision and not yet made: voxelise the props, or
  keep the contrast deliberately.
- Only the head extrudes from the grid. The body is procedural boxes coloured
  by the shirt trait, because the avatar is a portrait and stops at the
  shoulders.
- `plate-tree` is over the 6,000-triangle budget at 7,302. The optimiser flags
  it rather than raising the budget to hide it.
- No sound at all.

## Regenerating the assets

```
node tools/gen-props.mjs --dry      # what it would cost, spends nothing
node tools/gen-props.mjs            # generate anything not cached
node tools/optimize-props.mjs       # 154MB -> 772KB
```

`gym/assets/props/state.json` is the paid-work cache and is **committed on
purpose** — a cached task id is the difference between re-downloading a model
and buying it a second time. `raw/` holds the unoptimised originals and is
gitignored; never delete it without checking `state.json` first.
