<!--
  Produced by a fifteen-agent research sweep: seven dimensions researched
  independently, each fact-checked by a second agent against primary sources,
  then synthesised. Licences and URLs were verified rather than assumed — the
  full per-dimension verification transcript is in gym-research-raw.json.

  Nothing here is built yet. This is the plan, and the parts it says are
  unverified really are unverified.
-->

# KEVIN'S GYM — BUILD PLAN

**Verdict up front:** commit. This is buildable in roughly three months by one developer. The technology risk is low and well-understood; the two real risks are the character pipeline and whether the art actually looks hand-drawn. Both are testable in week one, cheaply, before you spend money on art. If you take one thing from this document, take the week-one plan in §5.

---

## 1. THE STACK

### Engine: three.js, pinned to exactly `0.185.1` (MIT)

Not a preference — the other three options each fail on something specific:

| | Download (gzipped) | Fatal problem |
|---|---|---|
| **three.js 0.185.1** | **159 KB** | none |
| Babylon.js 9.23.0 | 801 KB | its only cel-shading material provably cannot render a morphing character |
| PlayCanvas 2.21.4 | 494 KB | ships no toon material and no cartoon outline at all; editor costs $15/mo |
| Godot 4.7.2 | ~10 MB | 63× the payload, inside a Telegram webview, before a single asset |

The Babylon point is the decisive one and it is not a judgment call. Its `CellMaterial` shader contains the string "morph" exactly zero times. Babylon's one built-in cartoon material physically cannot be applied to a character whose body shape changes — which is the entire product. three.js is the only engine of the four whose shipped toon material **and** shipped outline effect both already follow morphing, skinned geometry. As Kevin inflates, his black ink line inflates with him, for free.

Pin the exact version, no `^` range. The outline code lives in three.js's `examples/jsm` folder, which carries no compatibility guarantee between releases.

**No React Three Fiber. No Rapier. No ammo.js. No WebAssembly physics.** For a one-room game this is pure overhead, and WASM threading needs security headers (COOP/COEP) that would block Telegram's own SDK script, which is served without the header that would let it through. Copy the movement code from three.js's own `examples/games_fps.html` instead — Octree collision plus a capsule player, ~15 KB of plain JavaScript, MIT, proven. It has no touch input; you write the joystick (borrow the joystick→store→controller wiring pattern from **pmndrs/ecctrl**, MIT, actively maintained as of Aug 2026).

### Assets: a CC0-first policy

**Ship no attribution-required assets in v1 if you can avoid it.** One CC BY asset in the build obligates you to a permanent, real credits panel with author name, link, and a note that you modified the work — forever, on every build. That's a shipping requirement, not a formality.

| Role | Pack | License | Size |
|---|---|---|---|
| **Gym equipment** | *One More Rep: Gym & Fitness Props* (The SideQuest Shop, itch.io) | CC0 1.0, no attribution | 21 props, 15,214 tris, GLB + FBX, name-your-price |
| **Room shell & clutter** | *Kenney Furniture Kit* | CC0 | 140 models, GLB-native, 5.13 MB |
| **Modular walls/floors + gap-fill** | *3D LowPoly Gym Game Assets* (andre4cale, itch.io) | Custom: commercial OK, no credit required, no redistribution | 31 models, native glTF, 772 kB, **$5** |
| **Protein tub** | *Kenney Food Kit* — retexture `can.glb` or `barrel.glb` | CC0 | 4.61 MB |

Spend the $5. It ships native glTF (zero conversion), includes four floor tiles and four modular walls, and asks nothing of you legally.

**One caution that matters:** One More Rep's CC0 claim, and Kenney's, are asserted on store pages that the author can edit tomorrow. Download each pack, check for a LICENSE file inside the zip, and archive a dated screenshot of the page before you ship. This takes ten minutes and is the difference between a defensible position and a hopeful one.

**Fallbacks if the CC0 route leaves a hole** (accepting a credits screen): VNB-Leo's *Low Poly Gym Set [+70 Models]* (CC BY 4.0, 70+ models, FBX only) is the largest gym set found; 3DLAND's 19-piece *FREE LowPoly Crossfit* series (all CC BY, all verified downloadable) fills specific gaps.

**Plainly: none of these already look like your target.** There is no open-licensed gym environment in a bold cartoon style — the only genuine modular gym found is 167,500 triangles of semi-realistic student work, usable as a layout reference and nothing else. Confirmed CC0 gym geometry outside the One More Rep pack amounts to one 340-triangle dumbbell and one exercise bike. You are kit-bashing from mixed sources and unifying them yourself. Budget that as real work; see §2.

Write **one headless Blender script** that ingests everything: strip materials, apply your shared palette, decimate anything over a hard face budget and *fail loudly* if it can't, bake smoothed normals, export meshopt-compressed GLB. Do not convert models by hand.

### Character: MPFB2 → Blender → Mixamo → shape key → glTF

**MPFB2** (MakeHuman Plugin For Blender 2) generates the base body. Its assets are **CC0** — public domain, commercial, closed-source, no attribution. The plugin itself is GPL, which does not encumber what you export. Requires Blender ≥ 4.2.

**A finding worth the whole research effort:** I verified in MPFB2's source that it ships a `muscle` macro — `{"type":"float","name":"muscle","description":"The muscularity of the character","label":"Muscle","default":0.5}` — as a 0.0–1.0 slider alongside gender, age, weight, height and proportions, implemented by interpolating shape keys on a single fixed basemesh. It also ships per-limb targets (`l-upperarm-muscle-incr`, `r-lowerarm-muscle-decr`, and so on).

**This means you get the muscle morph nearly for free, on guaranteed-identical topology, without sculpting.** Generate Kevin at muscle=0.2, generate him at muscle=0.9, and because both are the same basemesh with different shape-key mixes, the vertex count and order are identical by construction — which is exactly what the morph system requires and exactly what a hand-sculpted or AI-generated approach cannot guarantee. You will still need one standard Blender step to bake the difference between the two into a single clean shape key named `Muscle` (Shape Key from Mix / Join as Shapes). That is a menu operation, not an art skill.

**Animation: Mixamo.** Free, royalty-free for commercial games, bipedal humanoids only, exports FBX (so Blender is mandatory as the converter). Pipeline: character FBX with no animation; each clip downloaded *without skin*; import all into Blender with Automatic Bone Orientation; export one glTF.

**Honest flag:** Adobe's Mixamo FAQ page returned HTTP 503 to every automated fetch across two independent attempts. The royalty-free commercial grant is corroborated through multiple sources quoting that page and I would plan on it — but **have a human open it in a browser and screenshot it before launch.** This is the licence the entire animation dimension rests on. Three claims commonly repeated about Mixamo (an Enterprise/Federated-ID restriction, a China country-code restriction, "stores only the last uploaded character") could not be sourced at all. Do not plan around them.

**No AI mesh generation on the critical path.** Tripo AI is excluded entirely: its licence page, its terms, and its own feature page all return HTTP 403 to every request. Nothing about it — not the licence, not the limits, not the pricing — is verifiable from a primary source, and its marketing saturates the neutral search results you'd use to check it. Meshy is usable but its Terms of Use state that on the **free plan Meshy owns all right, title and interest in the output** and licenses it back to you only under CC BY 4.0, requiring a visible "Model created with Meshy" credit. For a memecoin whose character *is* the brand, that is disqualifying. Paid plans grant ownership. If you use Meshy at all, pay. Better: use the CC0 MakeHuman base and own everything from line one.

### Backend: one $12 droplet

- **DigitalOcean Basic**, Ubuntu 24.04: 1 vCPU / 2 GiB / 50 GB SSD / 2 TB transfer — $12/mo (verified against live pricing). That's ~130,000 cold loads of a 15 MB bundle, and your bundle should be a fraction of that.
- **Caddy 2** (Apache-2.0) — automatic HTTPS, automatic renewal, Let's Encrypt with ZeroSSL failover. Serves the static game too.
- **Node.js 24 LTS** + **Fastify 5.12.1** (MIT)
- **better-sqlite3 13.0.3** (MIT) in WAL mode. One file. (Node's built-in `node:sqlite` is close but still Release Candidate; use better-sqlite3.)
- **Litestream v0.5.x** (Apache-2.0) streaming continuous backups to DigitalOcean Spaces.
- **systemd**, not PM2. PM2 is AGPL-3.0 — avoidable copyleft sitting next to a commercial product, for a job the operating system already does.
- **Auth: `@tma.js/init-data-node` 2.0.8** (MIT). ⚠️ The package most guides name — `@telegram-apps/init-data-node` — **is deprecated**; npm attaches "This package is not supported anymore" to it. Same author, same repo, renamed. Set `expiresIn` explicitly to 3600; the default is 86,400 seconds.
- **jose 6.2.10** (MIT) for session tokens, **zod 4.5.4** (MIT) for request validation.
- Skip an ORM for v1. Numbered `.sql` migration files and a `schema_version` row.
- **Shell:** fork `Telegram-Mini-Apps/reactjs-template` (MIT). Its three sibling templates have **no licence file at all** — avoid all three.

The Telegram signature check is the one place hand-rolling goes wrong, and the reason is specific: the secret key is an HMAC-SHA-256 of **the bot token as the message** with the literal string `WebAppData` **as the key**. Almost everyone reverses those two. Use the library.

---

## 2. HOW IT LOOKS LIKE THE ART

Two techniques, both shipping in three.js already, both mobile-cheap.

**The black line: inverted-hull outlines via `three/addons/effects/OutlineEffect.js`.** It draws each object a second time, slightly fattened along its surface normals, in flat black, with the front faces culled — so a black shell peeks out from behind the silhouette. Its shader gives you *constant screen-space thickness*, meaning the line reads the same weight whether Kevin is near or far. Default is 0.003; go 0.006–0.010 for a bold Borderlands weight. Turn outlines off on floors and walls (`material.userData.outlineParameters = { visible: false }`) or the room becomes a cage.

**The flat colour: `MeshToonMaterial` with an explicit `gradientMap`.** A 2- or 3-pixel texture with nearest-neighbour filtering. Two or three pixels = two or three hard bands of colour with a razor edge between them. One directional light, flat ambient, no PBR, no shadow maps, no reflections.

**Do not skip the gradientMap.** If you leave it null, three.js falls back to a soft ramp from 70% to 100% brightness — washed-out and gradient-y, the opposite of the target. This is the single most common way people conclude "toon shading in three.js looks bad."

**No post-processing.** Screen-space edge detection is rejected on the merits: luminance-based Sobel misses same-colour silhouettes and draws lines on texture detail; depth+normal outlines are scale-sensitive and their reference demo is dead. More importantly, adding *any* post-processing pass in three.js silently disables free hardware anti-aliasing on mobile GPUs. Render straight to the screen with `{ antialias: true }` and cap pixel ratio at 2.

### The known limits — say these out loud before anyone is surprised

1. **Split normals will make your first outline test look catastrophically broken.** Hard-edged low-poly models duplicate vertices at every crease. The inflated black shell tears open at every corner. It looks like the technique doesn't work. It does — the fix is a build step: weld duplicate vertices, recompute smooth normals, bake them into a spare vertex slot, and read them only in the outline shader. **Budget two days and expect one bad day.** If your developer doesn't know this is coming, they will abandon the technique.

2. **The shade band cannot change hue.** three.js's toon shader multiplies the base colour by a single brightness value. Cream shades to darker cream — it cannot shade to warm red. If your art direction requires coloured shadows (and bold cartoon often does), you must move to the MToon material (`@pixiv/three-vrm-materials-mtoon`, MIT, 680 KB). **Decide this in week one**, because it sits underneath every material in the game.

3. **Line weight won't read uniform across mixed-source props out of the box.** A per-material thickness tuning pass is real work. One day.

4. **No mesh instancing.** The outline effect has a confirmed defect with instanced geometry — the outline detaches from the object. For a one-room gym this costs nothing. If you later want 100 identical dumbbells on a rack, you write a ~40-line replacement shader then, copying MToon's formula.

---

## 3. THE CHARACTER

### How muscle growth actually works

One number, one line of code:

```js
mesh.morphTargetInfluences[mesh.morphTargetDictionary['Muscle']] = muscleStat;
```

`muscleStat` is 0 to 1. The mesh smoothly inflates. Name the shape key `Muscle` in Blender and it is addressable by that string in JavaScript automatically.

### The one decision you cannot undo

The glTF specification is explicit: **"All morph target accessors MUST have the same `count` as the accessors of the original primitive."** A morph target is a list of per-vertex nudges applied to a *fixed* vertex ordering.

**Therefore you cannot build the muscle system from two separately-created models.** Skinny Kevin and buff Kevin as two independent AI generations, or two sculpts, or two commissions, have unrelated topology and will never blend into each other. Not "will look bad" — cannot be loaded.

One base mesh. The buff version derived from that same mesh with zero vertices added, deleted or reordered. This is exactly why MPFB2 is the right starting point: its muscle macro deforms one fixed basemesh, so identical topology is guaranteed by construction rather than by discipline.

**Order of operations, and it matters:** finalise base mesh → auto-rig → import the rigged file into Blender → **then** create the Muscle shape key → export glTF. Skinning and morphing coexist happily on one mesh, but only if the morph is authored after the FBX round-trip, which cannot be trusted to preserve shape keys.

**Compression: use meshopt, not Draco.** This is a silent trap. Draco — the compression everyone reaches for by default — does not handle morph targets at all; the word "morph" does not appear in its specification. It would ship your muscle deltas uncompressed and give you no error. Use `gltfpack`/`EXT_meshopt_compression`, which explicitly covers morph target data and recommends narrow quantized storage for it. Target 8–15k triangles. In the Blender exporter: enable Shape Keys, enable "Use Sparse Accessor if better", disable Shape Key Tangents.

### Does auto-rigging work on a cartoon body? Honest answer: yes, *if you constrain the design before the art exists.*

The line is specific, not vague, and two independent vendors state it identically:

- **Exaggerated muscle mass is fine.** Auto-riggers do not care that the deltoids are twice life-size.
- **Deformed proportions are not.** Mixamo requires a humanoid with distinguishable head/body/arms/legs, no large extra appendages, a neutral pose, and — critically — **no spaces between parts**. Meshy's docs independently require "proportions close to standard human body to avoid severe limb deformation" and "keep limbs separated."
- **Practical line: a head at roughly ¼ to ⅓ of body height rigs. A true chibi at ½ body height with stub limbs does not.**
- **The bodybuilder trap is real and specific:** big lats bring the arms flush against the torso, which violates the no-gaps rule. **Bind Kevin in a wide A-pose with visible air between his arms and his body.** If the mesh self-intersects at bind time you get garbage skin weights and no error message telling you why.

So: write "stylized but riggable — head ¼ to ⅓ body height, wide A-pose, arms clear of torso" into the art brief **before** commissioning anything. Then rig-test a deliberately ugly greybox at those proportions. That test costs an afternoon. Discovering the problem after the art is final costs the art budget.

**If the auto-rigger refuses him:** Blender's **Rigify** is free, bundled, GPL, and metarig-based, so it handles proportions auto-riggers reject. Budget 1–3 days of learning for someone who has never rigged. **Auto-Rig Pro** is $40 if you want it smoother. **Reallusion AccuRIG** is a third option — its EULA explicitly grants the right to export models and animations and embed them in games.

---

## 4. WHAT SHIPS FIRST

**The fun is not in the rep. The fun is the fear of shrinking.** v1 must test exactly one hypothesis: *do people open this tomorrow because Kevin will visibly shrink if they don't?* Everything that does not serve that hypothesis is cut.

**One room.** Six modular wall/floor pieces, a mirror, a rug, a plant, a speaker. Static. No doors that open, no second room, no windows.

**Three visible stations, two code paths.** Bench press and dumbbell rack both feed *strength* (different animation, same reward function). Treadmill feeds *stamina*. That's it.

**Interaction: walk over, tap, watch a 4-second animation, a number goes up.** **No minigame in v1.** No timing bar, no tapping rhythm. The minigame is a v2 hypothesis about session depth; v1 is a hypothesis about return rate. Don't confound them.

**Three UI screens, all HTML overlay on top of the 3D — never 3D text.**
1. **HUD** — muscle bar, streak, currency. Tiny, always on.
2. **Stats screen** — strength, stamina, streak, and *"you will lose X by tomorrow."* This screen is where the entire product lives. Give it the most design attention of anything in the build.
3. **Shop** — exactly three supplements: one session booster, one decay-slower ("protein shake" = a streak freeze), one cosmetic.

**Currency is earned from workouts only.** No wallet, no token, no purchases. Adding crypto to v1 converts a game problem into a compliance and security problem before you know whether the game works.

**Character: one model, one morph target, four animation clips** (idle, bench, treadmill, walk). No customization, no clothing, no colours.

**Explicitly not in v1:** multiplayer, leaderboards, wallet connect, NFTs, second room, minigames, achievements, quests, NPCs, sound.

**The one thing v1 must nail:** open inside Telegram on a real iPhone, in under three seconds on 4G, and show a Kevin who is visibly smaller than he was two days ago.

---

## 5. EFFORT

One competent full-stack developer who can find their way around Blender but is not a 3D artist. Calendar weeks.

| Piece | Time | Risk |
|---|---|---|
| Telegram shell, auth, droplet, Caddy, Fastify, SQLite, Litestream | 4–6 days | **Low.** Pure assembly; every part verified. |
| Asset acquisition + the one headless Blender normalisation script | 4–5 days | Medium |
| Room build & kit-bash so mixed sources read as one hand | 5–8 days | Medium — this is art direction time |
| Toon material, gradient ramp, outline, split-normal fix, thickness pass | 5–8 days | **High** |
| Character: MPFB2 → stylize → rig → Muscle shape key → export | 8–15 days | **Highest** |
| Mixamo clips → Blender → one glTF → animation state machine | 3–4 days | Low–medium |
| Movement, touch joystick, station proximity triggers | 4–5 days | Low |
| Decay maths, streak, server clock, grace mechanisms | 4–5 days | Low to code, **high to tune** |
| UI: HUD, stats, shop | 5–6 days | Low |
| Mobile performance pass on real devices inside Telegram | 4–6 days | Medium–high |

**Total: 10–14 weeks. Call it three months.** If someone quotes you six weeks, they have not done the character.

### Week one, before anything else

**Build a deliberately ugly greybox Kevin all the way through the pipeline** — MPFB2 → Mixamo → Muscle shape key → meshopt glTF → three.js → a slider that inflates him, running inside Telegram on a physical iPhone. In parallel, put **one** gym prop on screen with the toon ramp and the black outline, on that same phone, and have a human look at it and say whether it reads as the reference art.

Both of those are afternoons. Together they retire the two risks that can kill the project, before a single dollar of art is committed. Do not skip them, and do not let them slip to week four.

### The three real risks, ranked

1. **The character pipeline** — the only piece where a week-2 decision forces you to redo weeks 3–6. The topology lock and the rig-before-shape-keys ordering are effectively irreversible.
2. **The look** — nothing you can buy already looks like the target, and "does it look right" is not a test you can automate. The unification pass is not polish; **it is the thing that makes a mixed-source gym read as one hand instead of an asset flip.**
3. **Split normals** — narrow, technical, and it will make you think the outline technique is broken.

**Not a risk, despite feeling like one: the backend.** One droplet, one SQLite file, continuous backup. It will absorb far more traffic than a token launch will send it.

---

## 6. WHAT WOULD KILL THIS

**1. The look never arrives and you ship an asset flip.** Most likely killer. Three months of engineering, no 3D artist, and the entire pitch is "it looks like a cartoon." If the shading pass slips to the end, it slips forever, and you ship generic low-poly with a gym theme — indistinguishable from a hundred free demos and worthless as a brand asset. *Avoid it by inverting the order: shading in week one, on a phone, judged by a human.*

**2. The character can't be rigged, discovered in month two.** You commission a chibi Kevin because chibi reads well as a mascot, the auto-rigger refuses him, you hand-rig, and then discover your two Kevin meshes have incompatible topology and cannot morph. *Avoid it with the week-one greybox and the proportion constraint written into the art brief.*

**3. Punishing decay churns the audience.** The instinct to make the punishment harsh is exactly wrong. A crypto audience opening the app after a bad week to find a stick figure will close it forever, and your most engaged users become your loudest detractors.
- **Set the bar to keep your muscle absurdly low — one set on one machine.** Track the ambitious workout as a separate rewarded layer on top. Duolingo's measured result from decoupling streak-keeping from the ambitious daily goal: **+3.3% day-14 retention, +1% daily actives, +19% streak rate.**
- **Use an exponential curve, not linear.** Loop Habit Tracker's shipped formula gives ~5.2% loss per idle day and a 13-day half-life — a missed week costs ~31%, not everything. Read the GPL source, extract the maths, reimplement it clean, and keep a note recording that you did.
- **Cap damage per absence** so a two-week trip isn't fourteen separate punishments.
- **Ship 1–2 earnable "protein shake" freezes.** Duolingo measured +0.38% daily actives from allowing two.
- **Earn-back through effort, never through payment.** A paid streak restore in a crypto game invites exactly the conversation you don't want.
- No confirmshaming. "Are you really going to give up now?" costs more than it earns.

**4. A server outage silently deletes everyone's muscle.** One bad night and every player wakes to a body they didn't lose — unrecoverable in a community that already assumes you'll rug them. **Ship a global decay-suspension kill switch and a retroactive forgiveness window in v1, not v2.** Precedent: Duolingo's "Big Red Button" has protected over two million streaks; Habitica ships the same thing. Half a day of work, buys you the ability to survive your own downtime.

**5. Client-side decay, cheatable in ten seconds.** Change the phone clock, get infinite muscle. **All decay computed from server time**, stored as last-checkpoint plus value, derived lazily on read. The client sends *intents* ("I used the bench"), never results.

**6. A licence lands in the build you can't ship.** Every one of these is a click off the recommended path:
- **CC0 on itch.io is an author's self-declaration on an editable page.** Archive dated captures.
- **sousinho's Sketchfab account mixes licences** — the gym models are CC BY, but other models on the same account are under Sketchfab "Free Standard," which is not Creative Commons.
- **Sketchfab's "Gym Equipment" carries an explicit NoAI flag** barring use in or as input to generative AI programs.
- **`brunosimon/my-room-in-3d`** — the beautiful reference everyone copies — declares `"license": "UNLICENSED"`. Study the technique, copy nothing.
- **Habitica's art is CC-BY-NC-SA 3.0** — non-commercial — separately from its GPL code.
- **PM2 is AGPL-3.0.** Three Telegram sibling templates have no licence at all. `@telegram-apps/init-data-node` is deprecated.
- Policy: **CC0 or paid-with-clear-terms only.** If even one CC BY asset ships, build the credits panel on day one. Retrofitting attribution after launch is how projects get caught.

**7. Scope creep from the token community.** The pattern is predictable: leaderboard, then wallet connect, then NFT skins, then battle mode — and the founder says yes because the community *is* the marketing. Each is a month, none tests the core loop. **Ship the loop first.** The token integration goes far better on top of a game people already open daily, and it is a compliance problem you want to meet once, not twice.

**8. Nobody tests on a real phone inside Telegram until week ten.** Desktop browsers lie about memory ceilings, GPU behaviour, touch, and how the Telegram SDK initialises. Test on a physical iPhone inside Telegram in week one and every week after.

---

## WHERE THE RESEARCH IS THIN — stated plainly

- **Mixamo's licence could not be fetched.** Adobe's FAQ returned HTTP 503 to every attempt across two independent sessions. Corroborated secondhand and high-confidence, but get a human screenshot before launch. This is the licence all animation rests on.
- **Tripo AI is completely unverifiable** — licence, terms and feature page all 403. Excluded, not evaluated.
- **Poly Pizza is completely unverifiable** — site 403, model pages 403, API 401. It may be a fine source; we simply cannot say. Worth ten minutes of a human with a browser.
- **No reference game exists** for this exact combination (Telegram Mini App + cartoon 3D + continuous body morph + real-time decay). There is nothing to fork. Every individual piece is demonstrated — three.js ships working morph-target examples — but nobody has assembled this shape. That's the opportunity and the risk in the same sentence.
- **No open-licensed cartoon gym environment exists.** You will kit-bash. Budget it.
- **CC0 gym equipment barely exists.** If One More Rep's CC0 claim doesn't survive inspection of the actual download, you fall back to CC BY plus a credits screen, or lean harder on the $5 pack.
- **Whether tap-and-watch is fun enough is untested and untestable without shipping.** That is what v1 is for.
