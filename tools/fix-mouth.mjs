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
  const isPink = (k) => {
    const r = p[k * 4];
    const g = p[k * 4 + 1];
    const b = p[k * 4 + 2];
    return r > 190 && g > 100 && g < 200 && b > 110 && b < 210 && r - g > 40 && b > g;
  };

  const island = (seed, mark, ok) => {
    const st = [seed];
    mark[seed] = 1;
    const px = [];
    while (st.length) {
      const k = st.pop();
      px.push(k);
      const x = k % W;
      const y = (k / W) | 0;
      const go = (nk) => { if (!mark[nk] && ok(nk)) { mark[nk] = 1; st.push(nk); } };
      if (x > 0) go(k - 1);
      if (x < W - 1) go(k + 1);
      if (y > 0) go(k - W);
      if (y < H - 1) go(k + W);
    }
    return px;
  };

  // One pass PER MOUTH, not one pass over every pink pixel at once. Some of
  // these have two characters in them — Kevin spotting a smaller Kevin — and
  // seeding both mouths together averages their positions into one triangle
  // drawn on neither of them.
  const seenPink = new Uint8Array(W * H);
  const mouths = [];
  for (let k = 0; k < W * H; k++) {
    if (seenPink[k] || !isPink(k)) continue;
    const px = island(k, seenPink, isPink);
    if (px.length >= 60) mouths.push(px);
  }
  // Not every bad mouth has a tongue in it — a flat open O, or one with a
  // mouthful of coins in the way, has none. Fall back to dark islands that sit
  // almost wholly inside the cream of the face: that is what a mouth is, and
  // what an eye's pupil, sitting in its own white, is not.
  if (!mouths.length) {
    const dark = (k) => p[k * 4] < 90 && p[k * 4 + 1] < 90 && p[k * 4 + 2] < 90 && p[k * 4 + 3] > 128;
    const seenDark = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      if (seenDark[k] || !dark(k)) continue;
      let cream = 0;
      let other = 0;
      const px = island(k, seenDark, (nk) => {
        if (dark(nk)) return true;
        if (isCream(nk)) cream++; else other++;
        return false;
      });
      if (px.length < 400) continue;
      if (cream < (cream + other) * 0.92) continue;
      mouths.push(px);
    }
  }
  if (!mouths.length) return { results: [{ skipped: 'no mouth found' }] };

  const results = [];
  for (const tongue of mouths) {
    // Grow out from the tongue to the cream that rings the mouth.
    const mark = new Uint8Array(W * H);
    for (const k of tongue) mark[k] = 1;
    let blob = [];
    const st = [...tongue];
    let escaped = false;
    while (st.length) {
      const k = st.pop();
      blob.push(k);
      // A mouth is a fifth of a face. Anything this big has broken out through
      // the head's own outline — the mouth's black line and the jaw's black
      // line meet, and from there "not cream" reaches the entire drawing.
      if (blob.length > W * H * 0.02) { escaped = true; break; }
      const x = k % W;
      const y = (k / W) | 0;
      const go = (nk) => { if (!mark[nk] && !isCream(nk)) { mark[nk] = 1; st.push(nk); } };
      if (x > 0) go(k - 1);
      if (x < W - 1) go(k + 1);
      if (y > 0) go(k - W);
      if (y < H - 1) go(k + W);
    }
    if (escaped) { results.push({ skipped: 'mouth runs into the jaw outline' }); continue; }

    let minY = H;
    let maxY = -1;
    for (const k of blob) { const y = (k / W) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    // Centre on the lower two thirds: the blob takes the nose with it, and
    // averaging the whole of it drags the new mouth up his face.
    const lo = minY + Math.round((maxY - minY) / 3);
    let sx = 0;
    let sy = 0;
    let m = 0;
    for (const k of blob) {
      const y = (k / W) | 0;
      if (y < lo) continue;
      sx += k % W; sy += y; m++;
    }
    const cx = Math.round(sx / m);
    let cy = Math.round(sy / m);

    // Width of the face on the mouth's OWN row. The whole cream area also takes
    // in his chest, and sizing off that makes the triangle enormous.
    const onFace = (x) => isCream(cy * W + x) || mark[cy * W + x];
    let x0 = cx; while (x0 > 0 && onFace(x0)) x0--;
    let x1 = cx; while (x1 < W - 1 && onFace(x1)) x1++;
    const runW = x1 - x0;

    // Dilate before erasing: the fill stops at the first cream-ish pixel and
    // leaves a ring of half-and-half anti-aliasing that ghosts the old mouth's
    // outline back in.
    const gone = new Uint8Array(W * H);
    for (const k of blob) gone[k] = 1;
    for (let pass = 0; pass < 3; pass++) {
      const grow = [];
      for (const k of blob) {
        const x = k % W;
        const y = (k / W) | 0;
        const edge = (nk) => { if (!gone[nk]) { gone[nk] = 1; grow.push(nk); } };
        if (x > 0) edge(k - 1);
        if (x < W - 1) edge(k + 1);
        if (y > 0) edge(k - W);
        if (y < H - 1) edge(k + W);
      }
      blob = blob.concat(grow);
    }
    for (const k of blob) {
      p[k * 4] = CREAM[0]; p[k * 4 + 1] = CREAM[1]; p[k * 4 + 2] = CREAM[2]; p[k * 4 + 3] = 255;
    }
    x2d.putImageData(d, 0, 0);

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
    // Take the edit back into the pixel buffer so the next mouth in the same
    // image reads the repaired state rather than the original.
    const fresh = x2d.getImageData(0, 0, W, H);
    p.set(fresh.data);
    results.push({ w, h, cx, cy, erased: blob.length });
  }

  return { data: c.toDataURL('image/png'), results };
}, dataUri);

for (const file of files) {
  const name = file.split('/').pop().padEnd(18);
  try {
    const src = 'data:image/png;base64,' + (await readFile(file)).toString('base64');
    const out = await repair(src);
    const fixed = out.results.filter((r) => !r.skipped);
    const notes = out.results.filter((r) => r.skipped).map((r) => r.skipped);
    if (fixed.length && out.data) await writeFile(file, Buffer.from(out.data.split(',')[1], 'base64'));
    const done = fixed.map((r) => `${r.w}x${r.h} at ${r.cx},${r.cy}`).join(', ');
    console.log(`  ${name} ${fixed.length} fixed${done ? ` (${done})` : ''}${notes.length ? ` | ${notes.join('; ')}` : ''}`);
  } catch (e) {
    console.log(`  ${name} FAILED — ${String(e.message).slice(0, 70)}`);
  }
}

await browser.close();
