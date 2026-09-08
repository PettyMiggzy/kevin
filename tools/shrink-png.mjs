#!/usr/bin/env node
// Palette-compress a flat-cel PNG without touching its alpha.
//
//   node tools/shrink-png.mjs --check assets/sprites/walk-atlas.png
//   node tools/shrink-png.mjs assets/sprites/walk-atlas.png
//
// WHY
//
// assets/sprites/walk-atlas.png was 1.3 MB of truecolour for art that is flat
// cel shading with heavy black outlines — 63,562 distinct colours describing
// maybe forty. /world loaded it behind a full-screen "loading the world…" and
// on a phone on bad signal the page sat there, because a request that HANGS
// never reaches a catch: it is not the same thing as one that fails.
//
// The page no longer waits for it either way, but a megabyte the reader does
// not need is still a megabyte. 256 colours takes this atlas to 197 KB — 85%
// off — with a mean channel difference of 3.8 on the opaque pixels and not one
// alpha pixel changed, which on flat cel art is invisible at any zoom.
//
// FASTOCTREE, not MEDIANCUT: Pillow refuses median cut on RGBA, and quantising
// the flattened image and re-attaching alpha softens the cutout, which on a
// sprite reads as a halo against the wrong background.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const COLORS = Number((argv.indexOf('--colors') > -1 && argv[argv.indexOf('--colors') + 1]) || 256);
const files = argv.filter((a) => !a.startsWith('--') && a.endsWith('.png'));
if (!files.length) { console.error('give me one or more .png files'); process.exit(1); }

const py = `
import os, json
import numpy as np
from PIL import Image
for path in ${JSON.stringify(files)}:
    im = Image.open(path).convert('RGBA')
    before = os.path.getsize(path)
    q = im.quantize(colors=${COLORS}, method=Image.FASTOCTREE, dither=Image.NONE)
    tmp = path + '.shrink.png'
    q.save(tmp, optimize=True)
    # If the octree moved the cutout, put the original alpha back and save the
    # quantised colours as RGBA instead. A softened edge on a sprite reads as a
    # halo against the wrong background, and no size saving is worth that.
    probe = np.asarray(Image.open(tmp).convert('RGBA')).astype(int)
    orig  = np.asarray(im).astype(int)
    if (np.abs(orig[:,:,3] - probe[:,:,3]) > 0).any():
        r = q.convert('RGBA')
        r.putalpha(im.getchannel('A'))
        r.save(tmp, optimize=True)
    a = np.asarray(im).astype(int)
    b = np.asarray(Image.open(tmp).convert('RGBA')).astype(int)
    solid = a[:,:,3] > 128
    diff = float(np.abs(a[:,:,:3] - b[:,:,:3])[solid].mean()) if solid.any() else 0.0
    alpha_moved = int((np.abs(a[:,:,3] - b[:,:,3]) > 16).sum())
    after = os.path.getsize(tmp)
    print(f'{path}  {before:>9,} -> {after:>9,} bytes  ({100 - after*100//before}% off)  '
          f'mean channel diff {diff:.2f}  alpha pixels moved {alpha_moved}')
    if ${CHECK ? 'True' : 'False'} or after >= before or alpha_moved:
        if after >= before: print('   bigger than the original — left alone')
        if alpha_moved:     print('   alpha still moved after restoring it — left alone')
        os.remove(tmp)
    else:
        os.replace(tmp, path)
        print('   written')
`;
console.log(execFileSync('python3', ['-c', py], { cwd: ROOT }).toString().trim());
