# KEVIN'S GYM

*No pain, only Kevin.*

A playable prototype. Open `game/index.html` over http (not `file://` — it uses
ES modules) and press **Open the doors**.

```
python3 -m http.server 8899   # then http://127.0.0.1:8899/game/
```

WASD or the on-screen stick to move, **E** or the button to work a station.

## What is actually here

- One room, toon-shaded, with black inverted-hull outlines
- Twelve props generated with Tripo and normalised to one art direction
- Kevin, built from primitives, whose body scales with a single muscle number
- Three stations: bench and dumbbells feed strength, treadmill feeds stamina
- Exponential decay with a cap, a streak, and earnable freezes
- A three-item supplement shop paid for in earned $KEVIN
- Touch controls, a mobile layout, and saved progress

## The two decisions worth knowing about

**Muscle is bone scale, not a morph target.** The obvious approach — model a
skinny Kevin and a buff Kevin and blend between them — cannot work. The glTF
spec requires every morph target to have the same vertex count *and ordering*
as the base primitive, so two separately-authored meshes will not load, never
mind look bad. Scaling limbs on one body has no such constraint and is one
number. `applyMuscle()` is four lines, and the head deliberately does not scale
— that is what sells the rest of him getting bigger.

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
- **Kevin is primitives, not a rigged character.** Good enough to prove the
  loop and the look. A real rig is the next real piece of work.
- `plate-tree` is over the 6,000-triangle budget at 7,302. The optimiser flags
  it rather than raising the budget to hide it.
- No sound at all.

## Regenerating the assets

```
node tools/gen-props.mjs --dry      # what it would cost, spends nothing
node tools/gen-props.mjs            # generate anything not cached
node tools/optimize-props.mjs       # 154MB -> 772KB
```

`game/assets/props/state.json` is the paid-work cache and is **committed on
purpose** — a cached task id is the difference between re-downloading a model
and buying it a second time. `raw/` holds the unoptimised originals and is
gitignored; never delete it without checking `state.json` first.
