#!/usr/bin/env node
// Cut Todd's pose sheet into individual poses.
//
//   node tools/slice-poses.mjs
//
// The walk sheet is a clean grid; this one is not — the poses are laid out
// loosely and some overlap the row above. So they are found as connected
// ISLANDS of ink rather than by dividing the sheet up, which also means the
// tool keeps working when he adds more.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, 'assets/refs/15-todd-poses.jpg');
const OUT = join(ROOT, 'assets/sprites/poses');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
const src = 'data:image/jpeg;base64,' + (await readFile(SHEET)).toString('base64');

const out = await page.evaluate(async (dataUri) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H), p = d.data;
  const ink = (k) => !(p[k*4] > 230 && p[k*4+1] > 230 && p[k*4+2] > 230);

  // Grow islands with an 8-neighbour reach so a pose whose arm is a thin line
  // does not split into two pieces at a compression artefact.
  const seen = new Uint8Array(W*H);
  const islands = [];
  for (let k0 = 0; k0 < W*H; k0++) {
    if (seen[k0] || !ink(k0)) continue;
    const st = [k0]; seen[k0] = 1;
    let n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    while (st.length) {
      const k = st.pop(); n++;
      const cx = k % W, cy = (k / W) | 0;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny*W + nx;
        if (!seen[nk] && ink(nk)) { seen[nk] = 1; st.push(nk); }
      }
    }
    // A whole character, not a stray speck or a caption.
    if (n > 3000 && x1 - x0 > 60 && y1 - y0 > 60) islands.push({ n, x0, y0, x1, y1 });
  }

  // Reading order: top to bottom, then left to right, with a row tolerance so
  // poses that sit slightly high are not sorted into the wrong row.
  islands.sort((a, b) => (Math.abs(a.y0 - b.y0) > 90 ? a.y0 - b.y0 : a.x0 - b.x0));

  const cut = [];
  for (const is of islands) {
    const w = is.x1 - is.x0 + 1, h = is.y1 - is.y0 + 1;
    const pad = Math.round(Math.max(w, h) * 0.06);
    const cw = w + pad*2, ch = h + pad*2;
    const cell = document.createElement('canvas');
    cell.width = cw; cell.height = ch;
    const cc = cell.getContext('2d', { willReadFrequently: true });
    cc.drawImage(c, is.x0, is.y0, w, h, pad, pad, w, h);
    // Paper off by flood fill from the border, treating the transparent pad as
    // passable — a colour key punches holes through his white eyes and cream
    // muzzle, which are lighter than the JPEG halo it has to catch.
    const cd = cc.getImageData(0, 0, cw, ch), cp = cd.data;
    const light = (k) => cp[k*4+3] === 0 ||
      (cp[k*4] > 208 && cp[k*4+1] > 208 && cp[k*4+2] > 208);
    const clear = new Uint8Array(cw*ch);
    const st2 = [];
    const seed = (k) => { if (!clear[k] && light(k)) { clear[k] = 1; st2.push(k); } };
    for (let i = 0; i < cw; i++) { seed(i); seed((ch-1)*cw + i); }
    for (let j = 0; j < ch; j++) { seed(j*cw); seed(j*cw + cw-1); }
    while (st2.length) {
      const k = st2.pop(), cx = k % cw, cy = (k / cw) | 0;
      if (cx > 0) seed(k-1);
      if (cx < cw-1) seed(k+1);
      if (cy > 0) seed(k-cw);
      if (cy < ch-1) seed(k+cw);
    }
    const edge = [];
    for (let k = 0; k < cw*ch; k++) {
      if (clear[k]) continue;
      const cx = k % cw, cy = (k / cw) | 0;
      if ((cx > 0 && clear[k-1]) || (cx < cw-1 && clear[k+1]) ||
          (cy > 0 && clear[k-cw]) || (cy < ch-1 && clear[k+cw])) edge.push(k);
    }
    for (const k of edge) clear[k] = 1;
    for (let k = 0; k < cw*ch; k++) if (clear[k]) cp[k*4+3] = 0;
    cc.putImageData(cd, 0, 0);
    cut.push({ w: cw, h: ch, data: cell.toDataURL('image/png') });
  }
  return cut;
}, src);

await mkdir(OUT, { recursive: true });
const NAMES = ['idle','cheer','shades-point','thinking','kick','lying-think','phone',
               'laughing','finger','smoking','lying-front','running','money'];
const index = [];
for (let i = 0; i < out.length; i++) {
  const name = NAMES[i] || `pose-${String(i).padStart(2, '0')}`;
  await writeFile(join(OUT, `${name}.png`), Buffer.from(out[i].data.split(',')[1], 'base64'));
  index.push({ name, w: out[i].w, h: out[i].h });
}
await writeFile(join(OUT, 'poses.json'), JSON.stringify(index, null, 2));
await browser.close();
console.log(`${out.length} poses cut into assets/sprites/poses/`);
for (const p of index) console.log(`  ${p.name.padEnd(13)} ${p.w}x${p.h}`);
