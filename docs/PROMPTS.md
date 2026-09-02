# VENICE PROMPT PACK

Paste these into Venice, or run `node tools/gen-venice.mjs` with a key set.

Image models drift. Ask ten times for "Kevin" and you get ten different
characters — fatal for a meme brand, where the whole asset is the face being
recognisable at a glance. So every prompt is the same locked character block
plus the same style block, and only the situation changes.

**Never paraphrase the character block.** Copy it exactly, every time.

---

## The character — locked

> KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck

## The style — locked

> bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself

There is only one style. Every reference shares the same rendering: bold 2D
cartoon character, heavy black outlines, cel shading, painted detailed
background. What changes between images is the **setting and the light** — a
bright street, a dark neon room, a night sky — and that belongs in the scene
description. Do not add a second style block for mood; it just gives the model
another thing to drift on.

## Negative prompt — paste into every generation

> photorealistic, 3d render, cgi, blurry, soft focus, muddy colours, gradient noise, deformed anatomy, extra limbs, extra fingers, distorted face, asymmetrical mess, watermark, signature, low resolution, jpeg artifacts, misspelled text, garbled lettering, realistic human, horror, gore, sexualised, multiple different character designs, hair parted down one side only, human hair, small eyes, eyes fully inside the muzzle, realistic hands, five fingers, long limbs, tall body, no hood

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
| `qwen-image-3-pro` | clean lines, good text |

Anything with readable signage goes to **nano-banana-pro**, **ideogram-v4** or
**gpt-image-2**. The rest hand you beautiful gibberish on the sign.

`krea-v2-large` and `luma-uni-1*` accept **style reference images** —
`--ref` feeds them from `assets/refs/`. Useful, but at high strength they
drag the reference's own composition into every scene, so keep it under 0.5.

---

## The scenes

### 1. robinhood-hq

**Situation:** Kevin walks confidently up the front path of a large modern glass corporate office building, carrying a battered brown briefcase with the word "KEVIN" stencilled on it in black. A wooden arrow sign on the left reads "HEADQUARTERS". Neat green hedges line the path, small dust puffs kick up behind his feet. He is not looking at the building. He has been walking toward it for sixteen years.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin walks confidently up the front path of a large modern glass corporate office building, carrying a battered brown briefcase with the word "KEVIN" stencilled on it in black. A wooden arrow sign on the left reads "HEADQUARTERS". Neat green hedges line the path, small dust puffs kick up behind his feet. He is not looking at the building. He has been walking toward it for sixteen years. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 2. getaway

**Situation:** Kevin rides in a shopping cart overflowing with cash down a city street, wearing a red cap and black sunglasses, one arm resting on the rim, completely relaxed. A police car chases far behind with its lights on. Dollar bills fly through the air. A large billboard on the right reads "IAMKEVIN.LOL". A green highway sign on the left reads "BIG DREAMS" and "WETH / KEK / GME". Two tiny Kevins on the pavement hold a cardboard sign reading "FREE KEVIN".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin rides in a shopping cart overflowing with cash down a city street, wearing a red cap and black sunglasses, one arm resting on the rim, completely relaxed. A police car chases far behind with its lights on. Dollar bills fly through the air. A large billboard on the right reads "IAMKEVIN.LOL". A green highway sign on the left reads "BIG DREAMS" and "WETH / KEK / GME". Two tiny Kevins on the pavement hold a cardboard sign reading "FREE KEVIN". STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 3. gym

**Situation:** Kevin as an absurdly muscular bodybuilder in a red tank top mid-flex outside a gym, sweating, holding a black shaker bottle. A huge sign over the building reads "KEVIN'S GYM" in red block letters, with a banner beneath reading "NO PAIN, ONLY KEVIN". Other small Kevins struggle under barbells in the background. A speech bubble reads "LEG DAY? MORE LIKE LEG YAY".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin as an absurdly muscular bodybuilder in a red tank top mid-flex outside a gym, sweating, holding a black shaker bottle. A huge sign over the building reads "KEVIN'S GYM" in red block letters, with a banner beneath reading "NO PAIN, ONLY KEVIN". Other small Kevins struggle under barbells in the background. A speech bubble reads "LEG DAY? MORE LIKE LEG YAY". STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 4. the-no

**Situation:** A dim 2009 school computer lab at dusk. On a chunky beige CRT monitor is a crude MS Paint drawing of Kevin on a bright yellow background. A grey Windows dialog box on screen reads "Save changes to Untitled?" with Yes, No and Cancel buttons, and the mouse cursor hovers over "No". The chair is empty, the room is empty, the clock on the wall reads 3:41. Kevin inside the screen is looking out at the empty chair.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: A dim 2009 school computer lab at dusk. On a chunky beige CRT monitor is a crude MS Paint drawing of Kevin on a bright yellow background. A grey Windows dialog box on screen reads "Save changes to Untitled?" with Yes, No and Cancel buttons, and the mouse cursor hovers over "No". The chair is empty, the room is empty, the clock on the wall reads 3:41. Kevin inside the screen is looking out at the empty chair. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 5. receipts

**Situation:** Kevin stands in a vast archive room lit by a single hanging bulb, in front of towering filing cabinets stretching into the dark, every drawer labelled with a date. He holds one paper receipt up to the light with both hands, expression flat and unbothered. Loose receipts drift across the floor. A stencilled sign on the wall reads "RECEIPTS".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin stands in a vast archive room lit by a single hanging bulb, in front of towering filing cabinets stretching into the dark, every drawer labelled with a date. He holds one paper receipt up to the light with both hands, expression flat and unbothered. Loose receipts drift across the floor. A stencilled sign on the wall reads "RECEIPTS". STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 6. three-pools

**Situation:** Kevin stands with his back to the viewer at the edge of three glowing liquid pools set into a dark stone floor, each with a carved stone marker: the left pool silver-blue labelled "WETH", the middle pool bright green labelled "KEK", the right pool deep red labelled "GME". Shafts of light come down from above. He is looking at the red one.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin stands with his back to the viewer at the edge of three glowing liquid pools set into a dark stone floor, each with a carved stone marker: the left pool silver-blue labelled "WETH", the middle pool bright green labelled "KEK", the right pool deep red labelled "GME". Shafts of light come down from above. He is looking at the red one. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 7. the-burn

**Situation:** Kevin stands calmly beside a flaming steel oil drum on a night city rooftop, feeding a thick stack of banknotes into the fire one at a time, completely expressionless. Embers rise into the dark. The city glitters behind him. A small hand-painted sign wired to the drum reads "MINE".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin stands calmly beside a flaming steel oil drum on a night city rooftop, feeding a thick stack of banknotes into the fire one at a time, completely expressionless. Embers rise into the dark. The city glitters behind him. A small hand-painted sign wired to the drum reads "MINE". STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 8. gta-wait

**Situation:** Kevin sits alone on a worn couch in a dark living room lit only by a TV, holding a game controller with both hands, surrounded by an enormous pile of torn-off calendar pages reaching his knees. A thick layer of dust sits on his shoulders. The TV shows only the words "COMING SOON". He has not moved in years.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin sits alone on a worn couch in a dark living room lit only by a TV, holding a game controller with both hands, surrounded by an enormous pile of torn-off calendar pages reaching his knees. A thick layer of dust sits on his shoulders. The TV shows only the words "COMING SOON". He has not moved in years. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 9. courtroom

**Situation:** Kevin stands at a wooden courtroom podium in a tiny red suit, sliding a single sheet of paper across to a huge intimidating judge, calm and unbothered. The gallery is packed with hundreds of identical small Kevins. A brass sign on the bench reads "ORDER".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin stands at a wooden courtroom podium in a tiny red suit, sliding a single sheet of paper across to a huge intimidating judge, calm and unbothered. The gallery is packed with hundreds of identical small Kevins. A brass sign on the bench reads "ORDER". STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 10. billboard-city

**Situation:** A huge illuminated billboard high above a busy night city intersection shows a giant close-up of Kevin's face with the text "IAMKEVIN.LOL" beneath it. Rain-slick streets, neon reflections, traffic streaking below. A tiny real Kevin stands on the pavement far below, looking up at himself.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: A huge illuminated billboard high above a busy night city intersection shows a giant close-up of Kevin's face with the text "IAMKEVIN.LOL" beneath it. Rain-slick streets, neon reflections, traffic streaking below. A tiny real Kevin stands on the pavement far below, looking up at himself. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 11. pfp

**Situation:** Tight head-and-shoulders portrait of Kevin, centred, filling the frame, against a flat bright yellow background with no scenery at all. Clean crisp edges suitable for a profile picture.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Tight head-and-shoulders portrait of Kevin, centred, filling the frame, against a flat bright yellow background with no scenery at all. Clean crisp edges suitable for a profile picture. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 12. diner

**Situation:** Kevin sits alone in a red vinyl booth of a bright 1950s American diner at night, a burger and a milkshake untouched in front of him, staring flatly at the empty seat across the table. Neon signage glows outside the window. A laminated menu on the table reads "STILL HERE".

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin sits alone in a red vinyl booth of a bright 1950s American diner at night, a burger and a milkshake untouched in front of him, staring flatly at the empty seat across the table. Neon signage glows outside the window. A laminated menu on the table reads "STILL HERE". STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 13. toxic-lab

**Situation:** Kevin stands with his arms folded in a dark underground control room, wearing an oversized black puffer jacket covered in acid-yellow "KEVIN" tags and paint splatter. Enormous dripping graffiti letters spelling "KEVIN" cover the wall behind him. Glowing screens show green charts climbing. Tipped-over paint buckets leak acid-yellow across the floor. A cardboard box beside him reads "100X KEVIN GAINS". Lit only by the screens — acid yellow-green glow against deep black, wet paint drips catching the light, heavy shadow, gritty texture on every surface.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin stands with his arms folded in a dark underground control room, wearing an oversized black puffer jacket covered in acid-yellow "KEVIN" tags and paint splatter. Enormous dripping graffiti letters spelling "KEVIN" cover the wall behind him. Glowing screens show green charts climbing. Tipped-over paint buckets leak acid-yellow across the floor. A cardboard box beside him reads "100X KEVIN GAINS". Lit only by the screens — acid yellow-green glow against deep black, wet paint drips catching the light, heavy shadow, gritty texture on every surface. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 14. toxic-throne

**Situation:** Kevin sits slouched on a scrapyard throne welded out of server racks and oil drums in a dark neon-lit warehouse, one arm draped over the armrest. Acid-yellow graffiti reading "TOLD NO" drips down the concrete wall behind him, screens flickering on either side. Dark warehouse lit in acid yellow-green and black, hard rim light down one side of him, deep shadows everywhere else.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin sits slouched on a scrapyard throne welded out of server racks and oil drums in a dark neon-lit warehouse, one arm draped over the armrest. Acid-yellow graffiti reading "TOLD NO" drips down the concrete wall behind him, screens flickering on either side. Dark warehouse lit in acid yellow-green and black, hard rim light down one side of him, deep shadows everywhere else. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 15. moon-run

**Situation:** Kevin sprints straight at the camera in wide-angle terror, mouth open in a scream, arms flung out, as an enormous cratered moon fills the entire sky behind him and crashes toward the road. Rocks and debris streak past. Shot from a low wide-angle lens with heavy foreshortening, sharp radial speed lines, debris streaking past the camera. Night sky, stars, moonlit dust.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin sprints straight at the camera in wide-angle terror, mouth open in a scream, arms flung out, as an enormous cratered moon fills the entire sky behind him and crashes toward the road. Rocks and debris streak past. Shot from a low wide-angle lens with heavy foreshortening, sharp radial speed lines, debris streaking past the camera. Night sky, stars, moonlit dust. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>

### 16. candle-surf

**Situation:** Kevin rides a colossal green candlestick chart bar upward like a surfboard, wind tearing at him, arms out for balance, mouth open in a yell, the city shrinking far below and red candles collapsing behind him. Extreme wide-angle from below, speed lines tearing past, dramatic sunset light.

<details><summary>Full prompt (copy this)</summary>

```
KEVIN is a bold cartoon character built like this, and these proportions are the whole character — do not restyle them: HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides of his head like a snug helmet or balaclava, with several THICK BLUNT DREADLOCK SPIKES flaring outward and downward from the sides of the hood, longer and heavier on his left, each spike ending in a rounded point. EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set high on the face, tilted slightly toward each other, and CUTTING UP INTO THE RED HOOD so the white breaks the hood outline; each eye has a thick black outline and one small black oval pupil. FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and bulges downward and forward over the mouth, outlined in thick black, like a rounded snout with no nose. MOUTH — a wide open black mouth with a pink tongue when he is loud, or one small solid black triangle when he is not. HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, much bigger than you would expect for his size. BODY — a small rounded red body, far too small for the head, with short red arms and tiny red feet. LINE — heavy uniform black outlines everywhere, flat bright cel-shaded colour, no nose, no eyebrows, no teeth, no visible neck. SCENE: Kevin rides a colossal green candlestick chart bar upward like a surfboard, wind tearing at him, arms out for balance, mouth open in a yell, the city shrinking far below and red candles collapsing behind him. Extreme wide-angle from below, speed lines tearing past, dramatic sunset light. STYLE: bold 2D cartoon illustration, heavy black outlines on the character, flat cel shading with one clear light source, saturated colours, crisp clean linework, richly painted detailed background behind him, strong contrast between character and environment, dynamic cinematic composition, poster quality, no gradients on the character himself.
```

</details>


---

## Making more

The recipe: **locked character → `SCENE:` → one situation → `STYLE:` →
locked style.** Describe the situation like you are describing a photograph to
somebody on the phone — what he is doing, what is around him, what the signs
say, and crucially **where the light comes from**. The light is what makes one
scene feel like a bright street and the next feel like a neon basement.

Write it in character. "Kevin sits in a diner staring at the empty seat across
from him" is a Kevin meme. "Kevin looks happy" is stock art.

Add to `SCENES` in `tools/venice-prompts.mjs`, then
`node tools/gen-venice.mjs --list` to confirm it registered.
