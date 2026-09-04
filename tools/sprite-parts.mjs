#!/usr/bin/env node
// Split the sprites into HEAD and BODY, and recolour them by palette swap.
//
//   node tools/sprite-parts.mjs                 # split every walk frame
//   node tools/sprite-parts.mjs --preview       # and render a few variants
//
// This is the seam that makes 1,000 playable NFTs affordable. If a token varies
// by head and colour, you do not need 1,000 sprite sets — you need ONE body set,
// a library of heads, and a palette. Every animation Todd draws from now on
// (lifting, idle, fry) costs one body set and inherits every head and colour
// automatically.
//
// Recolouring is an exact PALETTE SWAP, not a hue rotation. Hue-rotating flat
// art that has been through JPEG turns his clean red into mud — that is what
// made the PFP variants look brown and wrong. Todd's art is a handful of flat
// colours, so mapping those colours to new ones keeps every edge crisp.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/sprites/walk');
const OUT = join(ROOT, 'assets/sprites/parts');

/** Todd's palette, measured off the sprites rather than guessed. */
export const PALETTE = {
  red:    [216, 28, 36],
  cream:  [250, 240, 205],
  white:  [250, 250, 250],
  ink:    [16, 12, 12],
};

/** Colourways. `red` is the only channel a variant changes; ink stays ink. */
export const COLOURWAYS = {
  'Classic Red': [216, 28, 36],
  'Fryer Orange': [232, 116, 24],
  'Kek Green':   [40, 168, 84],
  'Cold Blue':   [42, 108, 214],
  'Grape':       [138, 62, 190],
  'Bubblegum':   [236, 88, 160],
  'Gold':        [226, 176, 34],
  'Void':        [64, 64, 72],
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

const files = (await readdir(SRC)).filter((f) => f.endsWith('.png')).sort();
await mkdir(join(OUT, 'head'), { recursive: true });
await mkdir(join(OUT, 'body'), { recursive: true });

// Pass one: where is the muzzle in each frame?
const measured = [];
for (const f of files) {
  const src = 'data:image/png;base64,' + (await readFile(join(SRC, f))).toString('base64');
  const faceBottom = await page.evaluate(async ([dataUri, pal]) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const p = x.getImageData(0, 0, W, H).data;
    const near = (k, col, t) =>
      p[k*4+3] > 40 && Math.abs(p[k*4]-col[0]) <= t &&
      Math.abs(p[k*4+1]-col[1]) <= t && Math.abs(p[k*4+2]-col[2]) <= t;
    // Largest cream ISLAND, so his chest strip does not count as face.
    const seen = new Uint8Array(W*H);
    let bottom = 0, best = 0;
    for (let k0 = 0; k0 < W*H; k0++) {
      if (seen[k0] || !near(k0, pal.cream, 34)) continue;
      const st = [k0]; seen[k0] = 1;
      let n = 0, low = 0;
      while (st.length) {
        const k = st.pop(); n++;
        const cx = k % W, cy = (k / W) | 0;
        if (cy > low) low = cy;
        const go = (nk) => { if (!seen[nk] && near(nk, pal.cream, 34)) { seen[nk] = 1; st.push(nk); } };
        if (cx > 0) go(k-1);
        if (cx < W-1) go(k+1);
        if (cy > 0) go(k-W);
        if (cy < H-1) go(k+W);
      }
      if (n > best) { best = n; bottom = low; }
    }
    return best > 200 ? bottom : 0;   // 0 means no muzzle visible
  }, [src, PALETTE]);
  measured.push({ file: f, dir: basename(f, '.png').split('-')[0], faceBottom });
}

// ONE cut line per direction. Within a walk cycle the head barely moves, so a
// per-FRAME cut makes the head jump height between frames — the composite then
// shears at the neck. The back-facing frames have no muzzle at all, so they
// borrow the median of the directions that do.
const median = (a) => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0;
const withFace = measured.filter((m) => m.faceBottom > 0).map((m) => m.faceBottom);
const fallback = median(withFace);
const byDir = {};
for (const m of measured) (byDir[m.dir] ??= []).push(m.faceBottom);
const cutFor = {};
for (const [dir, list] of Object.entries(byDir)) {
  const seen = list.filter((v) => v > 0);
  cutFor[dir] = (seen.length ? median(seen) : fallback) + 3;
}

// Pass two: split on that line.
const cuts = [];
for (const m of measured) {
  const src = 'data:image/png;base64,' + (await readFile(join(SRC, m.file))).toString('base64');
  const r = await page.evaluate(async ([dataUri, cut]) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const c = mk();
    c.getContext('2d').drawImage(img, 0, 0);
    const head = mk(), body = mk();
    head.getContext('2d').drawImage(c, 0, 0, W, cut, 0, 0, W, cut);
    body.getContext('2d').drawImage(c, 0, cut, W, H - cut, 0, cut, W, H - cut);
    return { head: head.toDataURL('image/png'), body: body.toDataURL('image/png') };
  }, [src, cutFor[m.dir]]);
  const name = basename(m.file, '.png');
  await writeFile(join(OUT, 'head', `${name}.png`), Buffer.from(r.head.split(',')[1], 'base64'));
  await writeFile(join(OUT, 'body', `${name}.png`), Buffer.from(r.body.split(',')[1], 'base64'));
  cuts.push({ name, cut: cutFor[m.dir] });
}

await writeFile(join(OUT, 'parts.json'), JSON.stringify({
  palette: PALETTE, colourways: COLOURWAYS,
  note: 'head/<name>.png over body/<name>.png reassembles the original frame exactly; both are full-size so they composite at 0,0.',
  cuts, cutByDirection: cutFor,
}, null, 2));

console.log(`${files.length} frames split`);
for (const [dir, cut] of Object.entries(cutFor)) console.log(`  ${dir.padEnd(9)} cut at ${cut}px`);
console.log(`  assets/sprites/parts/head/  and  /body/`);
console.log(`  ${Object.keys(COLOURWAYS).length} colourways defined in parts.json`);
await browser.close();
