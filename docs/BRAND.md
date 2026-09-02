# KEVIN — BRAND RULES

The short version: **draw it slightly wrong, and mean it.**

---

## Colour

| Role | Hex | Notes |
|---|---|---|
| The void | `#FFE500` | Yellow. Not gold, not amber, not "warm cream". Yellow. |
| Void deep | `#F5C400` | Texture lines, shadows on yellow |
| Kevin red | `#E8232B` | Body, hair, accents |
| Red dark | `#B0141B` | Shadow only |
| Cream | `#FFF6C8` | The muzzle. Also section backgrounds |
| Ink | `#0B0B0B` | Every outline, every time |
| KEK green | `#2FBF4A` | Pool only |
| WETH grey | `#8A92B2` | Pool only |

Outlines are always ink, always heavy, never a lighter tint of the fill. There
is no gradient anywhere in this brand and there never will be — it was made
with a bucket tool.

## Type

- **Display:** Luckiest Guy. Headlines, buttons, numbers, stat labels.
- **Body:** Space Mono. Everything else. Mono reads as *receipts*, which is the
  entire point.
- Both are self-hosted in `assets/fonts/` as latin-subset woff2. Do not add a
  Google Fonts link — no third-party requests on this site.
- In-art lettering uses the marker stroke-font in `tools/lib/letters.mjs`, so
  it never depends on a font being installed.

## The character

Rules that are not negotiable:

1. **The wonk is load-bearing.** His eyes are different sizes. The right one is
   bigger and sits higher. Do not fix this. Every attempt to fix it has made
   him worse.
2. **He is looking left of you.** Pupils sit left of centre in both eyes,
   always. He is never making eye contact and he is never going to explain it.
3. **No knees.** Legs are two straight lines. He has never had knees and is not
   getting them now.
4. **No shading.** Flat fills, hard outlines. No gradients, no rim light, no
   ambient occlusion, no "3D render of Kevin".
5. **He is not that other guy.** Never name the character he was a bad drawing
   of. Never imply him. Kevin stands alone — legally, spiritually and
   anatomically.

## Voice

Short. Flat. Deadpan. He never raises his voice because he has never once
needed to.

- **Do:** state the fact and stop. "Noted." "He remembers." "Still here."
- **Do:** cite dates. Pettiness is precise. Vague grievance is just whining.
- **Do:** undersell. "It went well" beats "WE'RE MOONING".
- **Don't:** use exclamation marks. He has never been excited about anything in
  front of witnesses.
- **Don't:** explain the grudge. Explained, it's a complaint. Unexplained, it's
  a legend.
- **Don't:** promise anything. Price talk, targets, "guaranteed" — none of it.
  Kevin exists; the chart is a rumour about him.
- **Don't:** punch down. Institutions, exchanges, market makers and your own
  past self are fair game. Somebody's kid, somebody's job and somebody's bag
  size are not.

## Assets

| What | Where | Use |
|---|---|---|
| Logo badge | `assets/art/logo.svg` | Avatars, favicons, nav |
| Wordmark | `assets/art/wordmark.svg` | Headers, merch, end cards |
| PFP | `assets/png/pfp-1000.png` | X / Telegram profile |
| Banner | `assets/png/banner-1500x500.png` | X header |
| Link card | `assets/png/og-1200x630.png` | Link previews |
| Pool coins | `assets/art/coin-{weth,kek,gme}.svg` | Pool UI, charts |
| Stickers | `assets/stickers/*.png` | Telegram, 512×512 transparent |
| Animated | `assets/stickers/animated/*.webm` | Telegram video stickers |
| Spot | `assets/video/kevin-spot.mp4` | Launch announcement |

Never re-export a raster and edit it by hand — change the generator in
`tools/` and re-run, so the whole set stays consistent.
