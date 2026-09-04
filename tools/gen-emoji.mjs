#!/usr/bin/env node
// Cut a Kevin custom-emoji set out of the sticker stills.
//
//   node tools/gen-emoji.mjs
//   node tools/gen-emoji.mjs kek-power gym-flex
//
// Custom emoji are 100x100 and use the same technology as stickers, so the art
// already exists. Crucially these come from the STILLS, not the animations:
// the stills are the character as Todd drew him, and the video stage rewrites
// him. Nothing here touches a model, so nothing here can drift.
//
// At 100px the character is about the size of a word, so the crop is tight to
// his silhouette rather than the sticker's framing — a 512px sticker padded
// down to 100 leaves him a smudge in the middle of a lot of nothing.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STILLS = join(ROOT, 'assets/stickers/stills');
const OUT = join(ROOT, 'assets/emoji');
const SIZE = 100;

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = (await readdir(STILLS))
  .filter((f) => f.endsWith('.png'))
  .filter((f) => !only.length || only.includes(f.replace('.png', '')))
  .sort();

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

let made = 0;
for (const f of files) {
  const slug = basename(f, '.png');
  try {
    const src = 'data:image/png;base64,' + (await readFile(join(STILLS, f))).toString('base64');
    const out = await page.evaluate(async ([dataUri, size]) => {
      const img = new Image();
      img.src = dataUri;
      await img.decode();
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x2d = c.getContext('2d', { willReadFrequently: true });
      x2d.drawImage(img, 0, 0);
      const d = x2d.getImageData(0, 0, W, H);
      const p = d.data;
      const bg = [p[4 * (4 * W + 4)], p[4 * (4 * W + 4) + 1], p[4 * (4 * W + 4) + 2]];
      const near = (k, t) =>
        Math.abs(p[k * 4] - bg[0]) <= t && Math.abs(p[k * 4 + 1] - bg[1]) <= t &&
        Math.abs(p[k * 4 + 2] - bg[2]) <= t;

      // Flood in from the frame edge. The stills are already flattened to one
      // flat colour by flatten-bg, so this is the easy case — but it still has
      // to be a fill and not a key, because his eyes are white and the KEK coin
      // carries colours a loose key would eat.
      const gone = new Uint8Array(W * H);
      const st = [];
      for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
      for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
      for (const k of st) if (near(k, 30)) gone[k] = 1; else st[st.indexOf(k)] = -1;
      const stack = st.filter((k) => k >= 0 && gone[k]);
      while (stack.length) {
        const k = stack.pop();
        const x = k % W;
        const y = (k / W) | 0;
        const go = (nk) => { if (!gone[nk] && near(nk, 30)) { gone[nk] = 1; stack.push(nk); } };
        if (x > 0) go(k - 1);
        if (x < W - 1) go(k + 1);
        if (y > 0) go(k - W);
        if (y < H - 1) go(k + W);
      }
      // One pass of erosion takes the half-and-half ring between ink and
      // backdrop, which at 100px would otherwise read as a dirty outline.
      const edge = [];
      for (let k = 0; k < W * H; k++) {
        if (gone[k]) continue;
        const x = k % W;
        const y = (k / W) | 0;
        if ((x > 0 && gone[k - 1]) || (x < W - 1 && gone[k + 1]) ||
            (y > 0 && gone[k - W]) || (y < H - 1 && gone[k + W])) edge.push(k);
      }
      for (const k of edge) gone[k] = 1;
      for (let k = 0; k < W * H; k++) if (gone[k]) p[k * 4 + 3] = 0;
      x2d.putImageData(d, 0, 0);

      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let k = 0; k < W * H; k++) {
        if (p[k * 4 + 3] === 0) continue;
        const x = k % W;
        const y = (k / W) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (x1 < 0) return { skipped: 'nothing left after the cut' };

      // Square on the longer side so nothing is squashed, then fit with a
      // hair of margin.
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const side = Math.max(w, h);
      const o = document.createElement('canvas');
      o.width = o.height = size;
      const ox = o.getContext('2d');
      ox.imageSmoothingQuality = 'high';
      const scale = (size * 0.96) / side;
      ox.drawImage(c, x0, y0, w, h,
        (size - w * scale) / 2, (size - h * scale) / 2, w * scale, h * scale);
      return { data: o.toDataURL('image/png'), from: `${w}x${h}` };
    }, [src, SIZE]);

    if (out.skipped) { console.log(`  ${slug.padEnd(14)} ${out.skipped}`); continue; }
    await writeFile(join(OUT, `${slug}.png`), Buffer.from(out.data.split(',')[1], 'base64'));
    console.log(`  ${slug.padEnd(14)} ${out.from} -> ${SIZE}x${SIZE}`);
    made++;
  } catch (e) {
    console.log(`  ${slug.padEnd(14)} FAILED — ${String(e.message).slice(0, 60)}`);
  }
}
await browser.close();
console.log(`\n${made} emoji in assets/emoji/`);
