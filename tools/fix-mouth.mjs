#!/usr/bin/env node
// Put Kevin's mouth back.
//
//   node tools/fix-mouth.mjs assets/stickers/stills/star-power.png
//
// Kevin's mouth is ONE SMALL SOLID BLACK TRIANGLE. It is in the original
// hand-drawn PFP (assets/refs/00-kevin-pfp.png) and it is in the gym poster,
// and it is the single feature that most says "this is him" — the eyes and the
// hair survive a bad generation, the mouth does not.
//
// The image models will not hold it. Across four attempts it came back as an
// open cartoon mouth with lips and a tongue every single time, including when
// the instruction led the prompt in capitals with "never an open mouth, never
// lips, teeth, tongue". Everything else about the generation was right, so
// rather than keep rolling for it, the mouth is repaired here — deterministic,
// free, and identical every run.
//
// This is deliberately NOT wired into gen-stickers-video.mjs. The rest of the
// pack is built from 01-hero-portrait.jpg, whose open shouting mouth IS the
// design of those stickers; running this over them would wreck them.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/fix-mouth.mjs <png> [png...]');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

const repair = async (dataUri) => await page.evaluate(async (dataUri) => {
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

  const CREAM = [253, 247, 185];
  const isCream = (k) =>
    Math.abs(p[k * 4] - CREAM[0]) <= 34 &&
    Math.abs(p[k * 4 + 1] - CREAM[1]) <= 34 &&
    Math.abs(p[k * 4 + 2] - CREAM[2]) <= 34;

  // Seed on the tongue. Its pink appears nowhere else in the drawing — the hair
  // is red, the face cream, the star yellow, the eyes white and black — which
  // makes it a far more reliable handle on the mouth than any coordinate.
  const seeds = [];
  for (let k = 0; k < W * H; k++) {
    const r = p[k * 4];
    const g = p[k * 4 + 1];
    const b = p[k * 4 + 2];
    if (r > 190 && g > 100 && g < 200 && b > 110 && b < 210 && r - g > 40 && b > g) seeds.push(k);
  }
  // Not every bad mouth has a tongue in it — a gritted-teeth strain or a flat
  // open O has none. Fall back to the largest dark island that sits wholly
  // inside the cream of the face, which is what a mouth is and what the eyes,
  // sitting in their own white, are not.
  if (!seeds.length) {
    const dark = (k) => p[k * 4] < 90 && p[k * 4 + 1] < 90 && p[k * 4 + 2] < 90 && p[k * 4 + 3] > 128;
    const seenDark = new Uint8Array(W * H);
    let bestIsland = null;
    for (let k = 0; k < W * H; k++) {
      if (seenDark[k] || !dark(k)) continue;
      const st = [k];
      seenDark[k] = 1;
      const px = [];
      let creamNbr = 0;
      let otherNbr = 0;
      while (st.length) {
        const j = st.pop();
        px.push(j);
        const x = j % W;
        const y = (j / W) | 0;
        const look = (nk) => {
          if (dark(nk)) { if (!seenDark[nk]) { seenDark[nk] = 1; st.push(nk); } }
          else if (isCream(nk)) creamNbr++;
          else otherNbr++;
        };
        if (x > 0) look(j - 1);
        if (x < W - 1) look(j + 1);
        if (y > 0) look(j - W);
        if (y < H - 1) look(j + W);
      }
      // A mouth is ringed by face. An eye's pupil is ringed by white, and the
      // line art is ringed by everything, so both fail this.
      if (creamNbr < (creamNbr + otherNbr) * 0.92) continue;
      if (px.length < 400) continue;
      if (!bestIsland || px.length > bestIsland.length) bestIsland = px;
    }
    if (!bestIsland) return { skipped: 'no mouth found — left alone' };
    seeds.push(...bestIsland);
  }

  // Grow out over everything that is not face, which stops dead at the cream
  // surrounding the mouth. The nose comes along with it and is redrawn below.
  const inMouth = new Uint8Array(W * H);
  const stack = [];
  for (const k of seeds) { inMouth[k] = 1; stack.push(k); }
  while (stack.length) {
    const k = stack.pop();
    const x = k % W;
    const y = (k / W) | 0;
    const push = (nk) => { if (!inMouth[nk] && !isCream(nk)) { inMouth[nk] = 1; stack.push(nk); } };
    if (x > 0) push(k - 1);
    if (x < W - 1) push(k + 1);
    if (y > 0) push(k - W);
    if (y < H - 1) push(k + W);
  }

  let n = 0;
  let minY = H;
  let maxY = -1;
  for (let k = 0; k < W * H; k++) if (inMouth[k]) { n++; const y = (k / W) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  // A fill that escaped the face would swallow the line art. Refuse rather than
  // paint a cream slab across the drawing.
  if (n > W * H * 0.06) return { skipped: `fill escaped (${n} px) — left alone` };

  // Centre on the lower two thirds: the blob includes the nose, and averaging
  // the whole of it drags the new mouth up into the middle of his face.
  const lo = minY + Math.round((maxY - minY) / 3);
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let k = 0; k < W * H; k++) {
    if (!inMouth[k]) continue;
    const y = (k / W) | 0;
    if (y < lo) continue;
    sx += k % W; sy += y; m++;
  }
  const cx = Math.round(sx / m);
  let cy = Math.round(sy / m);

  // Width of the face on the mouth's OWN row. The full cream area also takes in
  // his chest, which inflates it by half and sizes the triangle enormous.
  const facey = (x) => isCream(cy * W + x) || inMouth[cy * W + x];
  let x0 = cx; while (x0 > 0 && facey(x0)) x0--;
  let x1 = cx; while (x1 < W - 1 && facey(x1)) x1++;
  const runW = x1 - x0;

  // Erase, dilated: the fill stops at the first cream-ish pixel, leaving a ring
  // of half-and-half anti-aliasing that ghosts the old mouth's outline back in.
  for (let pass = 0; pass < 3; pass++) {
    const grow = [];
    for (let k = 0; k < W * H; k++) {
      if (inMouth[k]) continue;
      const x = k % W;
      const y = (k / W) | 0;
      if ((x > 0 && inMouth[k - 1]) || (x < W - 1 && inMouth[k + 1]) ||
          (y > 0 && inMouth[k - W]) || (y < H - 1 && inMouth[k + W])) grow.push(k);
    }
    for (const k of grow) inMouth[k] = 1;
  }
  for (let k = 0; k < W * H; k++) {
    if (!inMouth[k]) continue;
    p[k * 4] = CREAM[0]; p[k * 4 + 1] = CREAM[1]; p[k * 4 + 2] = CREAM[2]; p[k * 4 + 3] = 255;
  }
  x2d.putImageData(d, 0, 0);

  // The triangle itself: apex right, a shade under a quarter of the face wide,
  // proportions taken off the PFP.
  const w = Math.round(runW * 0.23);
  const h = Math.round(w * 1.05);
  cy -= Math.round(h * 0.12);
  x2d.fillStyle = '#0A0A0A';
  x2d.beginPath();
  x2d.moveTo(cx - w / 2, cy - h / 2);
  x2d.lineTo(cx - w / 2, cy + h / 2);
  x2d.lineTo(cx + w / 2, cy);
  x2d.closePath();
  x2d.fill();

  return { data: c.toDataURL('image/png'), w, h, cx, cy, erased: n };
}, dataUri);

for (const file of files) {
  const name = file.split('/').pop().padEnd(18);
  try {
    const src = 'data:image/png;base64,' + (await readFile(file)).toString('base64');
    const out = await repair(src);
    if (out.skipped) {
      console.log(`  ${name} ${out.skipped}`);
    } else {
      await writeFile(file, Buffer.from(out.data.split(',')[1], 'base64'));
      console.log(`  ${name} erased ${out.erased}px, drew a ${out.w}x${out.h} triangle at ${out.cx},${out.cy}`);
    }
  } catch (e) {
    console.log(`  ${name} FAILED — ${String(e.message).slice(0, 70)}`);
  }
}

await browser.close();
