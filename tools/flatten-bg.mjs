#!/usr/bin/env node
// Flatten a still's backdrop to one solid colour.
//
//   node tools/flatten-bg.mjs assets/stickers/stills/*.png
//
// The pack becomes transparent by colour-keying the backdrop out of the
// finished clip, and that only works if the backdrop is genuinely ONE colour.
// It used to be, because the source reference was flat brand yellow. Sourcing
// from 13-kevin-canon.jpg — which has Kevin in a cloud of smoke — the model
// gives him a soft grey gradient and a drop shadow under his feet instead,
// however plainly the prompt asks for flat. A gradient keys ragged and a drop
// shadow survives as a grey smear round his shoes.
//
// So it is done here rather than asked for. Region-grow from the frame edge
// comparing each pixel to ITS OWN NEIGHBOUR, not to the seed: a gradient moves
// a level or two per pixel so the fill walks the whole of it, and a drop shadow
// too, while the character's heavy black outline is a cliff the fill cannot
// cross. Then paint the lot flat.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const BRAND_YELLOW = '#FFE500';
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node tools/flatten-bg.mjs <png...>');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

for (const file of files) {
  const name = file.split('/').pop().padEnd(18);
  try {
    const src = 'data:image/png;base64,' + (await readFile(file)).toString('base64');
    const out = await page.evaluate(async ([dataUri, flat]) => {
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

      // TWO tests, and it needs both. Neighbour-relative alone walks a gradient
      // beautifully and then keeps walking: one still had the fill step through
      // a soft edge into Kevin and flatten his whole body, leaving an outline
      // drawing on yellow. So a pixel also has to stay in the same colour
      // FAMILY as the frame edge. A grey-to-white backdrop stays well inside
      // that; saturated red is two hundred levels outside it and stops the fill
      // dead at his outline.
      const edgeCols = [];
      for (let x = 0; x < W; x += 7) { edgeCols.push(x, (H - 1) * W + x); }
      for (let y = 0; y < H; y += 7) { edgeCols.push(y * W, y * W + W - 1); }
      const median = (ch) => {
        const v = edgeCols.map((k) => p[k * 4 + ch]).sort((a, b) => a - b);
        return v[v.length >> 1];
      };
      const base = [median(0), median(1), median(2)];
      const FAMILY = 75;
      const STEP = 14;
      const inFamily = (k) =>
        Math.abs(p[k * 4] - base[0]) <= FAMILY &&
        Math.abs(p[k * 4 + 1] - base[1]) <= FAMILY &&
        Math.abs(p[k * 4 + 2] - base[2]) <= FAMILY;
      const near = (a, b) =>
        Math.abs(p[a * 4] - p[b * 4]) <= STEP &&
        Math.abs(p[a * 4 + 1] - p[b * 4 + 1]) <= STEP &&
        Math.abs(p[a * 4 + 2] - p[b * 4 + 2]) <= STEP;

      const bg = new Uint8Array(W * H);
      const st = [];
      for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
      for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
      for (const k of st) bg[k] = 1;
      while (st.length) {
        const k = st.pop();
        const x = k % W;
        const y = (k / W) | 0;
        const go = (nk) => { if (!bg[nk] && inFamily(nk) && near(k, nk)) { bg[nk] = 1; st.push(nk); } };
        if (x > 0) go(k - 1);
        if (x < W - 1) go(k + 1);
        if (y > 0) go(k - W);
        if (y < H - 1) go(k + W);
      }

      // Ground shadows. The model draws Kevin standing on a soft grey ellipse
      // that is not the backdrop colour, so the fill above leaves it — and the
      // keyer then leaves it too, and the sticker ships with a grey smudge
      // under his shoes. It is an island of grey floating in backdrop, so:
      // anything wholly ringed by backdrop, small, and colourless goes.
      const seen = new Uint8Array(W * H);
      for (let k0 = 0; k0 < W * H; k0++) {
        if (bg[k0] || seen[k0]) continue;
        const st2 = [k0];
        seen[k0] = 1;
        const px2 = [];
        let touchesEdge = false;
        let sat = 0;
        while (st2.length) {
          const k = st2.pop();
          px2.push(k);
          const x = k % W;
          const y = (k / W) | 0;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
          const r = p[k * 4];
          const g = p[k * 4 + 1];
          const b = p[k * 4 + 2];
          sat += Math.max(r, g, b) - Math.min(r, g, b);
          const go = (nk) => { if (!seen[nk] && !bg[nk]) { seen[nk] = 1; st2.push(nk); } };
          if (x > 0) go(k - 1);
          if (x < W - 1) go(k + 1);
          if (y > 0) go(k - W);
          if (y < H - 1) go(k + W);
        }
        if (touchesEdge) continue;
        if (px2.length > W * H * 0.06) continue;      // that is the character
        if (sat / px2.length > 30) continue;          // coloured: his, not a shadow
        for (const k of px2) bg[k] = 1;
      }

      let n = 0;
      for (let k = 0; k < W * H; k++) if (bg[k]) n++;
      // If the fill took nearly everything it has crossed into the character.
      // Say so rather than hand back a solid rectangle.
      if (n > W * H * 0.88) return { skipped: `fill took ${(n / (W * H) * 100).toFixed(0)}% — left alone` };

      // And check he is still there. The character sits in the middle of the
      // frame, so if the centre band came out as backdrop the fill has been
      // through him — which is exactly the failure the percentage guard let
      // past at 85%.
      let centre = 0;
      for (let y = (H * 0.35) | 0; y < H * 0.65; y++) {
        for (let x = (W * 0.35) | 0; x < W * 0.65; x++) if (bg[y * W + x]) centre++;
      }
      const centreCells = ((H * 0.3) | 0) * ((W * 0.3) | 0);
      if (centre > centreCells * 0.8) return { skipped: 'fill went through the character — left alone' };

      const r = parseInt(flat.slice(1, 3), 16);
      const g = parseInt(flat.slice(3, 5), 16);
      const b = parseInt(flat.slice(5, 7), 16);
      for (let k = 0; k < W * H; k++) {
        if (!bg[k]) continue;
        p[k * 4] = r; p[k * 4 + 1] = g; p[k * 4 + 2] = b; p[k * 4 + 3] = 255;
      }
      x2d.putImageData(d, 0, 0);
      return { data: c.toDataURL('image/png'), pct: (n / (W * H) * 100).toFixed(0) };
    }, [src, BRAND_YELLOW]);

    if (out.skipped) console.log(`  ${name} ${out.skipped}`);
    else {
      await writeFile(file, Buffer.from(out.data.split(',')[1], 'base64'));
      console.log(`  ${name} flattened ${out.pct}% of the frame to ${BRAND_YELLOW}`);
    }
  } catch (e) {
    console.log(`  ${name} FAILED — ${String(e.message).slice(0, 70)}`);
  }
}
await browser.close();
