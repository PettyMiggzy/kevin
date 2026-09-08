#!/usr/bin/env node
// Cut the favicon and the nav badge from a piece of real Kevin art.
//
//   node tools/make-favicon.mjs                       # from assets/memes/face.jpg
//   node tools/make-favicon.mjs assets/memes/you.jpg
//
// The old assets/art/favicon.svg (and assets/art/logo.svg, byte-identical to
// it) was an off-model head: cropped so the hood ran off one side, half the
// badge empty cream, no yellow showing at all. At 16px in a browser tab it was
// a red and cream smudge, and it was the first thing anybody saw of the
// project. It also was not the character the rest of the site draws.
//
// So the badge is cut from art that IS him. Circle, brand yellow behind, one
// heavy black ring — the same weight as every other outline on the site — and
// the head scaled to fill the disc rather than sit in a corner of it.
//
// Writes: assets/png/favicon-512.png, -180.png, -32.png and assets/art/logo.png
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || 'assets/memes/face.jpg';

const py = `
from PIL import Image, ImageDraw
import os

import numpy as np
src = Image.open(os.path.join(${JSON.stringify(ROOT)}, ${JSON.stringify(SRC)})).convert('RGB')
w, h = src.size

# Centre on the CHARACTER, not on the canvas. The art is drawn on flat brand
# yellow with the head off to one side, so a plain centre crop leaves an empty
# quarter of the disc — which at 16px is what makes a favicon look like a
# mistake rather than a mark.
a = np.asarray(src).astype(int)
subject = ~((a[:,:,0] > 235) & (a[:,:,1] > 200) & (a[:,:,2] < 90))   # not the yellow ground
ys, xs = np.nonzero(subject)
cx, cy = int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2)
side = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 1.14)     # a little air
side = min(side, w, h)
x0 = max(0, min(w - side, cx - side // 2))
y0 = max(0, min(h - side, cy - side // 2))
src = src.crop((x0, y0, x0 + side, y0 + side))

N = 512
RING = 26                      # the site's outline weight, at this size
YELLOW = (255, 229, 0)
INK = (11, 11, 11)

art = src.resize((N - RING * 2, N - RING * 2), Image.LANCZOS)

badge = Image.new('RGBA', (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(badge)
d.ellipse([0, 0, N - 1, N - 1], fill=INK)                       # the ring
d.ellipse([RING, RING, N - RING - 1, N - RING - 1], fill=YELLOW + (255,))

# clip the art to the inner disc
mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).ellipse([RING, RING, N - RING - 1, N - RING - 1], fill=255)
layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
layer.paste(art.convert('RGBA'), (RING, RING))
badge = Image.composite(layer, badge, mask)

out = []
for name, size in [('assets/png/favicon-512.png', 512),
                   ('assets/png/favicon-180.png', 180),
                   ('assets/png/favicon-32.png', 32),
                   ('assets/art/logo.png', 512)]:
    p = os.path.join(${JSON.stringify(ROOT)}, name)
    badge.resize((size, size), Image.LANCZOS).save(p, optimize=True)
    out.append(f'{name}  {size}x{size}  {os.path.getsize(p):,} bytes')
print('\\n'.join('  ' + o for o in out))
`;
console.log(execFileSync('python3', ['-c', py]).toString().trimEnd());
