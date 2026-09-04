#!/usr/bin/env node
// Cut Todd's walk sheet into a usable sprite atlas.
//
//   node tools/slice-sprites.mjs
//
// These are REAL animation frames — hand drawn, five directions, nine frames
// each — so they need no model and no invention, and at 512 they would be an
// upscale but at their native ~150px they are exactly right for a sprite.
//
// The whole job is alignment. Trimming each frame to its own content and
// packing the results is the obvious approach and it produces a walk cycle
// that jitters: every frame's bounding box is a slightly different size, so
// the character twitches left and right as the legs change the silhouette.
// Frames are aligned on a shared anchor instead — horizontal centre of MASS
// (not of the bounding box, which the swinging arm drags around) and the
// lowest inked row, which is the ground he is standing on.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, 'assets/refs/14-todd-walkcycles.jpg');
const OUT = join(ROOT, 'assets/sprites');
const ROWS = ['front', 'back', 'left', 'right', 'diagonal'];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
const src = 'data:image/jpeg;base64,' + (await readFile(SHEET)).toString('base64');

const result = await page.evaluate(async ([dataUri, rowNames]) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H), p = d.data;
  // JPEG, so "white" is not 255. A hard threshold leaves grey crumbs round
  // every outline, which then count as content and wreck the alignment.
  const ink = (i) => !(p[i*4] > 232 && p[i*4+1] > 232 && p[i*4+2] > 232);

  const groups = (has, min) => {
    const out = []; let s = null;
    for (let i = 0; i <= has.length; i++) {
      if (has[i] && s === null) s = i;
      else if (!has[i] && s !== null) { if (i - s > min) out.push([s, i]); s = null; }
    }
    return out;
  };
  const colHas = [], rowHas = [];
  for (let cx = 0; cx < W; cx++) { let any = false; for (let cy = 0; cy < H; cy += 2) if (ink(cy*W+cx)) { any = true; break; } colHas.push(any); }
  for (let cy = 0; cy < H; cy++) { let any = false; for (let cx = 0; cx < W; cx += 2) if (ink(cy*W+cx)) { any = true; break; } rowHas.push(any); }
  const cols = groups(colHas, 12);
  const rows = groups(rowHas, 12);
  // The left-hand column is the row LABELS ("FRONT WALK"), not a frame.
  const frameCols = cols.length === 10 ? cols.slice(1) : cols;

  const cells = [];
  for (let r = 0; r < rows.length; r++) {
    for (let k = 0; k < frameCols.length; k++) {
      const [x0, x1] = frameCols[k], [y0, y1] = rows[r];
      let minX = x1, maxX = x0, minY = y1, maxY = y0, sumX = 0, n = 0;
      for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) {
        if (!ink(cy*W+cx)) continue;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        sumX += cx; n++;
      }
      if (!n) continue;
      cells.push({ row: rowNames[r] || `row${r}`, i: k, minX, maxX, minY, maxY, cxMass: sumX / n, footY: maxY });
    }
  }

  // One cell size for the whole atlas, from the largest frame plus a margin,
  // so every frame is interchangeable and the engine never has to special-case.
  const wNeed = Math.max(...cells.map((f) => Math.max(f.cxMass - f.minX, f.maxX - f.cxMass))) * 2;
  const hNeed = Math.max(...cells.map((f) => f.footY - f.minY));
  const CW = Math.ceil((wNeed + 8) / 2) * 2, CH = Math.ceil((hNeed + 8) / 2) * 2;

  const out = { cell: { w: CW, h: CH }, rows: {}, frames: [] };
  const atlasCols = 9;
  const byRow = {};
  for (const f of cells) (byRow[f.row] ??= []).push(f);
  const rowKeys = Object.keys(byRow);
  const atlas = document.createElement('canvas');
  atlas.width = CW * atlasCols;
  atlas.height = CH * rowKeys.length;
  const ax = atlas.getContext('2d');

  const singles = [];
  rowKeys.forEach((key, ri) => {
    const list = byRow[key].sort((a, b) => a.i - b.i);
    out.rows[key] = { y: ri, count: list.length };
    list.forEach((f, fi) => {
      // Anchor: centre of mass horizontally, feet on a fixed baseline.
      const dx = Math.round(CW / 2 - f.cxMass);
      const dy = Math.round(CH - 4 - f.footY);
      const cell = document.createElement('canvas');
      cell.width = CW; cell.height = CH;
      const cc = cell.getContext('2d');
      cc.drawImage(c, f.minX, f.minY, f.maxX - f.minX + 1, f.maxY - f.minY + 1,
        f.minX + dx, f.minY + dy, f.maxX - f.minX + 1, f.maxY - f.minY + 1);
      // Key the paper out AFTER placing, so the threshold sees the same pixels.
      //
      // FLOOD FILL FROM THE CELL BORDER, not a colour test. His eyes are white
      // and his face is cream, both lighter than the threshold any global test
      // needs to catch the JPEG halo around the outlines — a threshold loose
      // enough to clear the paper punched holes straight through his face. The
      // paper touches the frame edge and his face does not, which is the only
      // difference that reliably tells them apart.
      const cd = cc.getImageData(0, 0, CW, CH), cp = cd.data;
      // Transparent counts as passable. The frame is drawn into the middle of a
      // larger cell, so the cell's border is empty padding, not paper — seeding
      // only on light pixels found nothing to start from and left the paper
      // sitting there as a white box.
      const light = (k) => cp[k*4+3] === 0 ||
        (cp[k*4] > 208 && cp[k*4+1] > 208 && cp[k*4+2] > 208);
      const clear = new Uint8Array(CW * CH);
      const stack = [];
      const seed = (k) => { if (!clear[k] && light(k)) { clear[k] = 1; stack.push(k); } };
      for (let ex = 0; ex < CW; ex++) { seed(ex); seed((CH-1)*CW + ex); }
      for (let ey = 0; ey < CH; ey++) { seed(ey*CW); seed(ey*CW + CW-1); }
      while (stack.length) {
        const k = stack.pop(), ex = k % CW, ey = (k / CW) | 0;
        if (ex > 0) seed(k-1);
        if (ex < CW-1) seed(k+1);
        if (ey > 0) seed(k-CW);
        if (ey < CH-1) seed(k+CW);
      }
      const edge = [];
      for (let k = 0; k < CW * CH; k++) {
        if (clear[k]) continue;
        const ex = k % CW, ey = (k / CW) | 0;
        if ((ex > 0 && clear[k-1]) || (ex < CW-1 && clear[k+1]) ||
            (ey > 0 && clear[k-CW]) || (ey < CH-1 && clear[k+CW])) edge.push(k);
      }
      for (const k of edge) clear[k] = 1;
      for (let k = 0; k < CW * CH; k++) if (clear[k]) cp[k*4+3] = 0;
      cc.putImageData(cd, 0, 0);
      ax.drawImage(cell, fi * CW, ri * CH);
      singles.push({ key, fi, data: cell.toDataURL('image/png') });
      out.frames.push({ row: key, frame: fi, x: fi * CW, y: ri * CH, w: CW, h: CH });
    });
  });
  return { meta: out, atlas: atlas.toDataURL('image/png'), singles,
    grid: { cols: frameCols.length, rows: rows.length } };
}, [src, ROWS]);

await mkdir(join(OUT, 'walk'), { recursive: true });
await writeFile(join(OUT, 'walk-atlas.png'), Buffer.from(result.atlas.split(',')[1], 'base64'));
for (const s of result.singles) {
  await writeFile(join(OUT, 'walk', `${s.key}-${String(s.fi).padStart(2, '0')}.png`),
    Buffer.from(s.data.split(',')[1], 'base64'));
}
await writeFile(join(OUT, 'walk-atlas.json'), JSON.stringify(result.meta, null, 2));
await browser.close();

console.log(`grid found: ${result.grid.cols} frames x ${result.grid.rows} directions`);
console.log(`cell ${result.meta.cell.w}x${result.meta.cell.h}, ${result.singles.length} frames`);
for (const [k, v] of Object.entries(result.meta.rows)) console.log(`  ${k.padEnd(9)} ${v.count} frames`);
console.log(`\natlas: assets/sprites/walk-atlas.png + .json`);
