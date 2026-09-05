#!/usr/bin/env node
// Paint a fast-food chest logo out of an animated sticker.
//
//   node tools/scrub-logo.mjs --check              # report, change nothing
//   node tools/scrub-logo.mjs fried wagmi          # repair these in place
//
// Two of the Venice scenes came back with the McDonald's golden arches drawn on
// Kevin's uniform. That is someone else's registered trademark on a pack that
// hangs off the bot, so it cannot ship — but the art was paid for and is
// otherwise fine, so this takes the mark off rather than binning the sticker.
//
// FINDING IT. The mark is not painted on — it is a HOLE. The arches were drawn
// in the same yellow as the backdrop, so the pipeline that cut the background
// out took the logo's strokes with it and left arches-shaped transparency in
// the shirt. That is worse than a drawn logo, not better: a hole shows the chat
// through it, so the mark stays legible in every theme. So the badge is "a hole
// or a light shape, completely surrounded by shirt" — measure how red each
// candidate's neighbourhood is and the muzzle, teeth, gloves, fries and the
// outer background all drop out, because none of those is ringed by uniform.
// Do not try to isolate it by connected colour: antialiasing welds the mark to
// the collar on some frames, and the merged blob then fails every size test.
//
// REMOVING IT. Nearest-neighbour inpaint from the surrounding shirt, not a flat
// fill: the uniform carries shading and a flat patch reads as a sticker on a
// sticker. Every frame is measured on its own, so the mark is tracked through
// the animation for free.
import { writeFile, stat, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets/stickers/animated');
const TMP = join(ROOT, '.sticker-frames/scrub');
const W = 512, H = 512;
const LIMIT = 256 * 1024;

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const slugs = args.filter((a) => !a.startsWith('--'));

const light = (r, g, b) => r > 165 && g > 150 && b > 120;
const shirt = (r, g, b) => r > 60 && g < 110 && b < 110 && (r - g) > 40;

/** Fraction of the ring just outside a box that is uniform shirt red. */
function ringRed(px, x0, y0, x1, y1, pad) {
  let tot = 0, red = 0;
  for (let y = Math.max(0, y0 - pad); y <= Math.min(H - 1, y1 + pad); y++) {
    for (let x = Math.max(0, x0 - pad); x <= Math.min(W - 1, x1 + pad); x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      const k = (y * W + x) * 4;
      if (px[k + 3] < 140) continue;          // holes do not vote
      tot++;
      if (shirt(px[k], px[k + 1], px[k + 2])) red++;
    }
  }
  return tot < 60 ? 0 : red / tot;
}

/** The badge mask for one frame: a hole or light shape in a sea of shirt. */
function findBadge(px) {
  const cand = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const hole = px[k + 3] < 140;
      if (!hole && !light(px[k], px[k + 1], px[k + 2])) continue;
      cand[y * W + x] = 1;
    }
  }
  // Label, and keep only blobs the size and shape of a chest badge.
  const seen = new Uint8Array(W * H);
  const keep = new Uint8Array(W * H);
  const boxes = [];
  for (let s = 0; s < W * H; s++) {
    if (!cand[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1;
    const px2 = []; let x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (st.length) {
      const c = st.pop(); px2.push(c);
      const x = c % W, y = (c / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const go = (q) => { if (cand[q] && !seen[q]) { seen[q] = 1; st.push(q); } };
      if (x > 0) go(c - 1); if (x < W - 1) go(c + 1);
      if (y > 0) go(c - W); if (y < H - 1) go(c + W);
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (px2.length < 200 || px2.length > 2500) continue;
    if (w < 18 || h < 18 || w > 90 || h > 90) continue;
    // The test that separates a chest badge from an eye, a glove or a tooth:
    // the badge is the only light shape with nothing but uniform all the way
    // around it. Everything else on the character touches muzzle, outline or
    // background somewhere on its border.
    if (ringRed(px, x0, y0, x1, y1, 6) < 0.85) continue;
    // Take the whole badge box, not just this blob. The arches break into
    // separate islands wherever antialiasing thins a stroke, and a stray island
    // left behind reads as a speck of chat showing through the shirt.
    for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y1 + 2); y++) {
      for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) {
        const c = y * W + x, k = c * 4;
        if (px[k + 3] < 200 || light(px[k], px[k + 1], px[k + 2])) keep[c] = 1;
      }
    }
    boxes.push({ n: px2.length, x0, y0, w, h });
  }
  return { keep, boxes };
}

/** Grow the mask, then fill each masked pixel from the nearest shirt pixel. */
function inpaint(px, mask) {
  const grow = new Uint8Array(mask);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(grow);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (grow[y * W + x]) continue;
      const c = y * W + x;
      if ((x > 0 && grow[c - 1]) || (x < W - 1 && grow[c + 1]) ||
          (y > 0 && grow[c - W]) || (y < H - 1 && grow[c + W])) next[c] = 1;
    }
    grow.set(next);
  }
  // Multi-source BFS outward from every shirt pixel that borders the hole.
  const src = new Int32Array(W * H).fill(-1);
  const q = [];
  for (let c = 0; c < W * H; c++) {
    if (grow[c]) continue;
    const k = c * 4;
    if (px[k + 3] < 140 || !shirt(px[k], px[k + 1], px[k + 2])) continue;
    const x = c % W, y = (c / W) | 0;
    const near = (x > 0 && grow[c - 1]) || (x < W - 1 && grow[c + 1]) ||
                 (y > 0 && grow[c - W]) || (y < H - 1 && grow[c + W]);
    if (near) { src[c] = c; q.push(c); }
  }
  for (let head = 0; head < q.length; head++) {
    const c = q[head];
    const x = c % W, y = (c / W) | 0;
    const go = (n) => { if (grow[n] && src[n] === -1) { src[n] = src[c]; q.push(n); } };
    if (x > 0) go(c - 1); if (x < W - 1) go(c + 1);
    if (y > 0) go(c - W); if (y < H - 1) go(c + W);
  }
  let filled = 0;
  for (let c = 0; c < W * H; c++) {
    if (!grow[c] || src[c] === -1) continue;
    const d = c * 4, s = src[c] * 4;
    px[d] = px[s]; px[d + 1] = px[s + 1]; px[d + 2] = px[s + 2]; px[d + 3] = 255;
    filled++;
  }
  return filled;
}

const list = slugs.length ? slugs : ['fried', 'wagmi'];
for (const slug of list) {
  const src = join(DIR, `${slug}.webm`);
  const { stdout: raw } = await run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9',
    '-i', src, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 30, encoding: 'buffer' });
  const frames = Math.floor(raw.length / (W * H * 4));
  const { stdout: rate } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src]);
  const fps = Math.round(Number(rate.split('/')[0]) / Number(rate.split('/')[1] || 1));

  const buf = Buffer.from(raw);
  let hits = 0, painted = 0;
  const sample = [];
  for (let f = 0; f < frames; f++) {
    const px = buf.subarray(f * W * H * 4, (f + 1) * W * H * 4);
    const { keep, boxes } = findBadge(px);
    if (!boxes.length) continue;
    hits++;
    if (sample.length < 3) sample.push(`f${f}: ` + boxes.map((b) => `${b.w}x${b.h}@${b.x0},${b.y0}`).join(' '));
    if (!CHECK) painted += inpaint(px, keep);
  }
  console.log(`${slug}: badge on ${hits}/${frames} frames${sample.length ? '  (' + sample.join('; ') + ')' : ''}`);
  if (CHECK || !hits) continue;

  await mkdir(TMP, { recursive: true });
  const rawOut = join(TMP, `${slug}.rgba`);
  await writeFile(rawOut, buf);
  // Same climb render-sticker.mjs uses. A raw round trip encodes fatter than
  // the original did, so a fixed crf lands the repaired file over the limit.
  let size = 0, used = 0;
  for (const crf of [32, 38, 44, 50, 56, 63]) {
    await run('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', rawOut,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(crf),
      '-an', '-loop', '0', src], { maxBuffer: 1 << 26 });
    size = (await stat(src)).size;
    used = crf;
    if (size <= LIMIT) break;
  }
  // The site serves a gif and a still cut from the webm, so a repair that stops
  // at the webm leaves the logo on the page it was taken off the sticker for.
  const png = join(ROOT, 'assets/stickers/png', `${slug}.png`);
  await mkdir(dirname(png), { recursive: true });
  await run('ffmpeg', ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', src,
    '-vf', 'select=eq(n\\,30),scale=512:512', '-vframes', '1', '-pix_fmt', 'rgba', png]);
  await run('ffmpeg', ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', src,
    '-filter_complex',
    'color=c=0xFFE500:s=512x512[bg];[bg][0:v]overlay=shortest=1,fps=14,' +
    'scale=320:-1:flags=lanczos,split[a][b];' +
    '[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', join(DIR, `${slug}.gif`)], { maxBuffer: 1 << 26 });

  const { stdout: tag } = await run('ffprobe', ['-v', 'error',
    '-show_entries', 'stream_tags=alpha_mode', '-of', 'default=nw=1:nk=1', src]);
  console.log(`  repainted ${painted} px, re-encoded ${(size / 1024).toFixed(0)}KB at crf ${used}, gif+still redone` +
    `${size > LIMIT ? '  <- OVER 256KB' : ''}${tag.trim() === '1' ? '' : '  <- ALPHA LOST'}`);
  await rm(rawOut, { force: true });
}
