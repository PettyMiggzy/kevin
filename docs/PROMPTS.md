# VENICE PROMPT PACK

Paste these straight into Venice, or run `node tools/gen-venice.mjs` with a key
set and it fires the whole batch.

Image models drift. Ask ten times for "Kevin" and you get ten different
characters — which is fatal for a meme brand, because the whole asset is *the
face being instantly recognisable*. So every prompt below is the same locked
character block plus the same style block, and only the situation changes.
**Do not paraphrase the character block.** Copy it exactly, every time.

---

## The character — locked

> KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes

## The style — locked

> 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality

## Negative prompt — paste into every generation

> photorealistic, 3d render, cgi, blurry, soft focus, muddy colours, gradient noise, deformed anatomy, extra limbs, extra fingers, distorted face, asymmetrical mess, watermark, signature, low resolution, jpeg artifacts, misspelled text, garbled lettering, realistic human, horror, gore, sexualised, multiple different character designs

---

## Which model

| Model | Use it for |
|---|---|
| `ideogram-v4` | best at readable signage and lettering |
| `gpt-image-2` | excellent text, clean cartoon linework |
| `nano-banana-pro` | strong all-rounder, huge prompt budget |
| `seedream-v5-pro` | punchy saturated illustration |
| `flux-2-max` | crisp detail, weaker at long text |
| `krea-v2-large` | supports style_references — use to lock the character |

Anything with readable signage — billboards, shop fronts, placards, cereal
boxes — should go to **ideogram-v4**, **gpt-image-2** or **nano-banana-pro**.
The others will hand you beautiful gibberish on the sign.

Two models, `krea-v2-large` and `luma-uni-1`, accept **style reference
images**. Once you have one Kevin you love, feed it back as a reference and the
rest of the set stays on-model. That is the single highest-leverage thing you
can do for consistency.

---

## The scenes

### 1. robinhood-hq

**Situation:** Kevin walks confidently up the front path of a large modern glass corporate office building, carrying a battered brown briefcase with the word "KEVIN" stencilled on it in black. A wooden arrow sign on the left reads "HEADQUARTERS". Neat green hedges line the path, small dust puffs kick up behind his feet. He is not looking at the building. He has been walking toward it for sixteen years.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin walks confidently up the front path of a large modern glass corporate office building, carrying a battered brown briefcase with the word "KEVIN" stencilled on it in black. A wooden arrow sign on the left reads "HEADQUARTERS". Neat green hedges line the path, small dust puffs kick up behind his feet. He is not looking at the building. He has been walking toward it for sixteen years. STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 2. getaway

**Situation:** Kevin rides in a shopping cart overflowing with cash down a city street, wearing a red cap and black sunglasses, one arm resting on the rim, completely relaxed. A police car chases far behind with its lights on. Dollar bills fly through the air. A large billboard on the right reads "IAMKEVIN.LOL". A green highway sign on the left reads "BIG DREAMS" and "WETH / KEK / GME". Two tiny Kevins on the pavement hold a cardboard sign reading "FREE KEVIN".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin rides in a shopping cart overflowing with cash down a city street, wearing a red cap and black sunglasses, one arm resting on the rim, completely relaxed. A police car chases far behind with its lights on. Dollar bills fly through the air. A large billboard on the right reads "IAMKEVIN.LOL". A green highway sign on the left reads "BIG DREAMS" and "WETH / KEK / GME". Two tiny Kevins on the pavement hold a cardboard sign reading "FREE KEVIN". STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 3. gym

**Situation:** Kevin as an absurdly muscular bodybuilder in a red tank top mid-flex outside a gym, sweating, holding a black shaker bottle. A huge sign over the building reads "KEVIN'S GYM" in red block letters, with a banner beneath reading "NO PAIN, ONLY KEVIN". Other small Kevins struggle under barbells in the background. A speech bubble reads "LEG DAY? MORE LIKE LEG YAY".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin as an absurdly muscular bodybuilder in a red tank top mid-flex outside a gym, sweating, holding a black shaker bottle. A huge sign over the building reads "KEVIN'S GYM" in red block letters, with a banner beneath reading "NO PAIN, ONLY KEVIN". Other small Kevins struggle under barbells in the background. A speech bubble reads "LEG DAY? MORE LIKE LEG YAY". STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 4. the-no

**Situation:** A dim 2009 school computer lab at dusk. On a chunky beige CRT monitor is a crude MS Paint drawing of Kevin on a bright yellow background. A grey Windows dialog box on screen reads "Save changes to Untitled?" with Yes, No and Cancel buttons, and the mouse cursor hovers over "No". The chair is empty, the room is empty, the clock on the wall reads 3:41. Kevin inside the screen is looking out at the empty chair.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: A dim 2009 school computer lab at dusk. On a chunky beige CRT monitor is a crude MS Paint drawing of Kevin on a bright yellow background. A grey Windows dialog box on screen reads "Save changes to Untitled?" with Yes, No and Cancel buttons, and the mouse cursor hovers over "No". The chair is empty, the room is empty, the clock on the wall reads 3:41. Kevin inside the screen is looking out at the empty chair. STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 5. receipts

**Situation:** Kevin stands in a vast archive room lit by a single hanging bulb, in front of towering filing cabinets stretching into the dark, every drawer labelled with a date. He holds one paper receipt up to the light with both hands, expression flat and unbothered. Loose receipts drift across the floor. A stencilled sign on the wall reads "RECEIPTS".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin stands in a vast archive room lit by a single hanging bulb, in front of towering filing cabinets stretching into the dark, every drawer labelled with a date. He holds one paper receipt up to the light with both hands, expression flat and unbothered. Loose receipts drift across the floor. A stencilled sign on the wall reads "RECEIPTS". STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 6. three-pools

**Situation:** Kevin stands with his back to the viewer at the edge of three glowing liquid pools set into a dark stone floor, each with a carved stone marker: the left pool silver-blue labelled "WETH", the middle pool bright green labelled "KEK", the right pool deep red labelled "GME". Shafts of light come down from above. He is looking at the red one.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin stands with his back to the viewer at the edge of three glowing liquid pools set into a dark stone floor, each with a carved stone marker: the left pool silver-blue labelled "WETH", the middle pool bright green labelled "KEK", the right pool deep red labelled "GME". Shafts of light come down from above. He is looking at the red one. STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 7. the-burn

**Situation:** Kevin stands calmly beside a flaming steel oil drum on a night city rooftop, feeding a thick stack of banknotes into the fire one at a time, completely expressionless. Embers rise into the dark. The city glitters behind him. A small hand-painted sign wired to the drum reads "MINE".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin stands calmly beside a flaming steel oil drum on a night city rooftop, feeding a thick stack of banknotes into the fire one at a time, completely expressionless. Embers rise into the dark. The city glitters behind him. A small hand-painted sign wired to the drum reads "MINE". STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 8. gta-wait

**Situation:** Kevin sits alone on a worn couch in a dark living room lit only by a TV, holding a game controller with both hands, surrounded by an enormous pile of torn-off calendar pages reaching his knees. A thick layer of dust sits on his shoulders. The TV shows only the words "COMING SOON". He has not moved in years.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin sits alone on a worn couch in a dark living room lit only by a TV, holding a game controller with both hands, surrounded by an enormous pile of torn-off calendar pages reaching his knees. A thick layer of dust sits on his shoulders. The TV shows only the words "COMING SOON". He has not moved in years. STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 9. courtroom

**Situation:** Kevin stands at a wooden courtroom podium in a tiny red suit, sliding a single sheet of paper across to a huge intimidating judge, calm and unbothered. The gallery is packed with hundreds of identical small Kevins. A brass sign on the bench reads "ORDER".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin stands at a wooden courtroom podium in a tiny red suit, sliding a single sheet of paper across to a huge intimidating judge, calm and unbothered. The gallery is packed with hundreds of identical small Kevins. A brass sign on the bench reads "ORDER". STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 10. billboard-city

**Situation:** A huge illuminated billboard high above a busy night city intersection shows a giant close-up of Kevin's face with the text "IAMKEVIN.LOL" beneath it. Rain-slick streets, neon reflections, traffic streaking below. A tiny real Kevin stands on the pavement far below, looking up at himself.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: A huge illuminated billboard high above a busy night city intersection shows a giant close-up of Kevin's face with the text "IAMKEVIN.LOL" beneath it. Rain-slick streets, neon reflections, traffic streaking below. A tiny real Kevin stands on the pavement far below, looking up at himself. STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 11. pfp

**Situation:** Tight head-and-shoulders portrait of Kevin, centred, filling the frame, against a flat bright yellow background with no scenery at all. Clean crisp edges suitable for a profile picture.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Tight head-and-shoulders portrait of Kevin, centred, filling the frame, against a flat bright yellow background with no scenery at all. Clean crisp edges suitable for a profile picture. STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>

### 12. diner

**Situation:** Kevin sits alone in a red vinyl booth of a bright 1950s American diner at night, a burger and a milkshake untouched in front of him, staring flatly at the empty seat across the table. Neon signage glows outside the window. A laminated menu on the table reads "STILL HERE".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a small simple cartoon character: a rounded red creature whose head is covered by a smooth red hood-like shape that hangs down the left side in thick blunt red dreadlock points; a pale cream oval face fills the lower right of the head; two very large white oval eyes sit high and close together, the right eye noticeably bigger than the left, each with a small black pupil looking slightly off to the left, never at the camera; a tiny solid black triangular open mouth below them; a small red body, short red arms and two thin straight red legs with no knees and simple red shoes. SCENE: Kevin sits alone in a red vinyl booth of a bright 1950s American diner at night, a burger and a milkshake untouched in front of him, staring flatly at the empty seat across the table. Neon signage glows outside the window. A laminated menu on the table reads "STILL HERE". STYLE: 2D cartoon illustration in a clean western comic style, bold uniform black outlines, flat cel shading with one clear light source, bright saturated colours, crisp vector-like edges, detailed painted background, bright blue sky with fluffy white clouds where outdoors, dynamic wide cinematic composition, high contrast, poster quality.
```

</details>


---

## Making more

Keep the recipe: **locked character block → `SCENE:` → one situation →
`STYLE:` → locked style block.** Write the situation like you are describing a
photograph to somebody on the phone — what he is doing, what is around him,
what the signs say, where the light comes from.

And write the situation *in character*. "Kevin sits in a diner staring at the
empty seat across from him" is a Kevin meme. "Kevin looks happy" is a stock
illustration.

Add new ones to `SCENES` in `tools/venice-prompts.mjs` and re-run
`node tools/gen-venice.mjs --list` to confirm they registered.
