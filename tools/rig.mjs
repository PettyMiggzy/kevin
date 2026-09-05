#!/usr/bin/env node
// Cutout animation for the Todd-drawn stills.
//
//   node tools/rig.mjs gym-curl --preview     # colour the parts, animate nothing
//   node tools/rig.mjs gym-curl               # render the sticker
//   node tools/rig.mjs --all
//
// The rule this project keeps relearning: animation means the DRAWING changes
// between frames. One drawing translated, scaled or tilted is vibrating, and a
// head rocked against a body is rocking. Both were tried and both were called.
//
// So this does what cutout animation has always done — it moves the limbs. An
// arm swung about its shoulder is a different drawing every frame: the
// silhouette changes, the arm points somewhere new, and what it is holding goes
// with it. That is real animation from one drawing, and it is the only kind
// available until Todd draws more frames.
//
// CUTTING A LIMB OFF WITHOUT LEAVING A HOLE. The trick is the joint circle.
// Take every opaque pixel OUTSIDE a circle centred on the joint: if the circle
// is wider than the limb is at that point, the limb is now its own connected
// component, severed from the body exactly as scissors would sever it. Grow
// from a seed on the limb and that component is the part. Rotating about the
// centre of that circle maps the cut arc onto itself, so the joint stays
// covered at every angle and no gap can open however far the limb swings.
//
// The body layer then has the limb erased from it, which leaves a hole wherever
// the limb was lying over the torso. That hole is filled by nearest-neighbour
// inpaint from the surrounding body, the same way tools/scrub-logo.mjs fills
// the chest — a flat patch would read as a sticker on a sticker, since the
// suit is shaded.
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/stickers/static');
const RIGS = join(ROOT, 'rigs');
const OUT = join(ROOT, 'assets/stickers/animated');
const TMP = join(ROOT, '.sticker-frames/rig');
const S = 512;
const LIMIT = 256 * 1024;

const args = process.argv.slice(2);
const PREVIEW = args.includes('--preview');
const FIT = args.includes('--fit');
const ALL = args.includes('--all');
const names = args.filter((a) => !a.startsWith('--'));

const idx = (x, y) => (y * S + x) * 4;

async function decode(path) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path,
    '-vf', `scale=${S}:${S}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 28, encoding: 'buffer' });
  return Buffer.from(stdout);
}

/**
 * Everything outside the joint circle that is connected to the seed. The circle
 * has to be wider than the limb, or the flood walks straight back into the body
 * and takes the whole character with it — which is what the coverage guard
 * below catches.
 */
function cutPart(px, { joint: [jx, jy], r, seed: [sx, sy], cuts = [], region = null }) {
  const out = new Uint8Array(S * S);
  const inAny = (rects, x, y) =>
    rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const open = (c) => {
    if (px[c * 4 + 3] < 128) return false;
    const x = c % S, y = (c / S) | 0;
    if ((x - jx) ** 2 + (y - jy) ** 2 <= r * r) return false;
    // Some limbs are drawn fused to what they lie against — his upper arm has
    // no outline where it leaves the hair, so a flood cannot tell them apart at
    // any radius. `region` bounds the part by shape instead: a union of boxes
    // the limb lives inside. The flood still runs, so the shape only has to be
    // roughly right, and the joint circle still handles the pivot.
    if (region && !inAny(region, x, y)) return false;
    // Extra straight cuts, for a limb that also lies along something else —
    // his arm rests on the hair here, and a contact that is a line rather than
    // a point cannot be severed by a circle without taking half the limb.
    // Cut pixels are simply left with the body, so no gap opens.
    for (const [x0, y0, x1, y1] of cuts) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return false;
    }
    return true;
  };
  const start = sy * S + sx;
  if (!open(start)) throw new Error(`seed ${sx},${sy} is transparent or inside the joint circle`);
  const st = [start]; out[start] = 1;
  let n = 1;
  while (st.length) {
    const c = st.pop();
    const x = c % S, y = (c / S) | 0;
    const go = (q) => { if (!out[q] && open(q)) { out[q] = 1; st.push(q); n++; } };
    if (x > 0) go(c - 1); if (x < S - 1) go(c + 1);
    if (y > 0) go(c - S); if (y < S - 1) go(c + S);
  }
  return { mask: out, n };
}

/**
 * Fill only the holes the limb was actually COVERING, from the nearest
 * surviving pixel so the patch keeps the shading.
 *
 * The distinction matters more than it sounds. A swung arm vacates two very
 * different kinds of space: the part that was lying over the torso, which has
 * to be painted back in, and the part that was out in open air, which has to
 * stay transparent. Fill both and the arm leaves a solid ghost of itself behind
 * — and because the nearest surviving pixel to most of that ghost is the arm's
 * own black outline, the ghost comes out dark brown and is impossible to miss.
 *
 * Open air is anything the frame border can reach by walking through
 * transparent and vacated pixels, so that is the test.
 */
function openToAir(px, hole) {
  const air = new Uint8Array(S * S);
  const passable = (c) => hole[c] || px[c * 4 + 3] < 128;
  const st = [];
  for (let x = 0; x < S; x++) {
    for (const c of [x, (S - 1) * S + x]) if (!air[c] && passable(c)) { air[c] = 1; st.push(c); }
  }
  for (let y = 0; y < S; y++) {
    for (const c of [y * S, y * S + S - 1]) if (!air[c] && passable(c)) { air[c] = 1; st.push(c); }
  }
  while (st.length) {
    const c = st.pop();
    const x = c % S, y = (c / S) | 0;
    const go = (n) => { if (!air[n] && passable(n)) { air[n] = 1; st.push(n); } };
    if (x > 0) go(c - 1); if (x < S - 1) go(c + 1);
    if (y > 0) go(c - S); if (y < S - 1) go(c + S);
  }
  return air;
}

function inpaint(px, hole) {
  const src = new Int32Array(S * S).fill(-1);
  const q = [];
  for (let c = 0; c < S * S; c++) {
    if (hole[c] || px[c * 4 + 3] < 128) continue;
    const x = c % S, y = (c / S) | 0;
    if ((x > 0 && hole[c - 1]) || (x < S - 1 && hole[c + 1]) ||
        (y > 0 && hole[c - S]) || (y < S - 1 && hole[c + S])) { src[c] = c; q.push(c); }
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % S, y = (c / S) | 0;
    const go = (n) => { if (hole[n] && src[n] === -1) { src[n] = src[c]; q.push(n); } };
    if (x > 0) go(c - 1); if (x < S - 1) go(c + 1);
    if (y > 0) go(c - S); if (y < S - 1) go(c + S);
  }
  for (let c = 0; c < S * S; c++) {
    if (!hole[c] || src[c] === -1) continue;
    const d = c * 4, s = src[c] * 4;
    px[d] = px[s]; px[d + 1] = px[s + 1]; px[d + 2] = px[s + 2]; px[d + 3] = 255;
  }
}

/**
 * Draw a part rotated about its joint. Samples backwards from the destination
 * — for every output pixel, work out where it came from — because sampling
 * forwards leaves unwritten pixels scattered through the result wherever
 * rotation stretches the grid.
 */
function stamp(dst, srcPx, mask, [jx, jy], deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(-a), sin = Math.sin(-a);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - jx, dy = y - jy;
      const sx = jx + dx * cos - dy * sin;
      const sy = jy + dx * sin + dy * cos;
      const x0 = Math.round(sx), y0 = Math.round(sy);
      if (x0 < 0 || y0 < 0 || x0 >= S || y0 >= S) continue;
      const s = y0 * S + x0;
      if (!mask[s] || srcPx[s * 4 + 3] < 128) continue;
      const d = (y * S + x) * 4;
      dst[d] = srcPx[s * 4]; dst[d + 1] = srcPx[s * 4 + 1];
      dst[d + 2] = srcPx[s * 4 + 2]; dst[d + 3] = 255;
    }
  }
}

const PALETTE = [[0, 200, 255], [255, 0, 200], [120, 255, 0], [255, 180, 0], [160, 0, 255]];

async function build(slug) {
  const rigPath = join(RIGS, `${slug}.json`);
  if (!existsSync(rigPath)) { console.log(`  --   ${slug.padEnd(14)} no rig`); return false; }
  const rig = JSON.parse(await readFile(rigPath, 'utf8'));
  const base = await decode(join(SRC, `${slug}.webp`));

  // Cut every part, then check none of them swallowed the character.
  const parts = [];
  for (const p of rig.parts) {
    const { mask, n } = cutPart(base, p);
    if (n > S * S * 0.25) throw new Error(`part "${p.name}" grabbed ${n}px — joint circle r=${p.r} is too small, the flood walked back into the body`);
    parts.push({ ...p, mask, n });
  }

  // The body is what is left. Holes where limbs lay over it get filled.
  const body = Buffer.from(base);
  const limb = new Uint8Array(S * S);
  for (const p of parts) for (let c = 0; c < S * S; c++) if (p.mask[c]) limb[c] = 1;

  // Which vacated space was open air must be decided on the limb's TRUE
  // footprint, before the fringe is grown. Grow first and the dilated ring
  // bridges the outline the limb was resting against, so the flood from the
  // border leaks straight through into the body and paints a transparent stripe
  // across him at exactly the height of the arms.
  const air = openToAir(base, limb);

  // Now grow past the antialiased fringe. Those pixels sit at an alpha the part
  // mask does not take, and left in the body they stay behind as a pale
  // outline of where the limb used to be.
  const hole = new Uint8Array(limb);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(hole);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = y * S + x;
      if (hole[c]) continue;
      if ((x > 0 && hole[c - 1]) || (x < S - 1 && hole[c + 1]) ||
          (y > 0 && hole[c - S]) || (y < S - 1 && hole[c + S])) next[c] = 1;
    }
    hole.set(next);
  }

  for (let c = 0; c < S * S; c++) if (hole[c]) body[c * 4 + 3] = 0;
  const covered = new Uint8Array(S * S);
  for (let c = 0; c < S * S; c++) if (hole[c] && !air[c]) covered[c] = 1;
  inpaint(body, covered);

  if (PREVIEW) {
    const prev = Buffer.from(body);
    parts.forEach((p, i) => {
      const [r, g, b] = PALETTE[i % PALETTE.length];
      for (let c = 0; c < S * S; c++) {
        if (!p.mask[c]) continue;
        const d = c * 4;
        prev[d] = (base[d] + r) >> 1; prev[d + 1] = (base[d + 1] + g) >> 1;
        prev[d + 2] = (base[d + 2] + b) >> 1; prev[d + 3] = 255;
      }
      // Mark the joint so a wrong pivot is obvious rather than subtle.
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
        const c = (p.joint[1] + y) * S + p.joint[0] + x;
        if (c >= 0 && c < S * S) { const d = c * 4; prev[d] = 0; prev[d+1] = 0; prev[d+2] = 0; prev[d+3] = 255; }
      }
    });
    await mkdir(TMP, { recursive: true });
    const raw = join(TMP, `${slug}-prev.rgba`);
    await writeFile(raw, prev);
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${S}x${S}`, '-i', raw, join(TMP, `${slug}-preview.png`)]);
    await rm(raw, { force: true });
    console.log(`  prev ${slug.padEnd(14)} ` + parts.map((p) => `${p.name}:${p.n}px`).join('  '));
    return true;
  }

  // Render the loop. Angles come from the rig's keys, eased so the ends of the
  // swing slow down the way a real limb does at the top and bottom of a rep.
  const FPS = rig.fps || 24;
  const N = rig.frames || 36;
  await mkdir(TMP, { recursive: true });
  // One file holding every frame back to back. ffmpeg's rawvideo demuxer reads
  // a stream, not a numbered sequence — `-f rawvideo -i f%04d.rgba` looks for a
  // file called literally that and fails.
  const reel = Buffer.alloc(S * S * 4 * N);
  for (let f = 0; f < N; f++) {
    const t = f / N;
    const frame = Buffer.from(body);
    for (const p of parts) {
      const [lo, hi] = p.swing;
      // One full there-and-back per loop, cosine-eased.
      const phase = t + (p.phase || 0);
      const k = (1 - Math.cos(2 * Math.PI * phase)) / 2;
      stamp(frame, base, p.mask, p.joint, lo + (hi - lo) * k);
    }
    frame.copy(reel, f * S * S * 4);
  }
  const reelPath = join(TMP, `${slug}.rgba`);
  await writeFile(reelPath, reel);

  let size = 0, crf = 0;
  for (const c of [30, 36, 42, 48, 54, 60, 63]) {
    await run('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${S}x${S}`, '-framerate', String(FPS),
      '-i', reelPath,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(c),
      '-an', '-loop', '0', join(OUT, `${slug}.webm`)], { maxBuffer: 1 << 26 });
    size = (await stat(join(OUT, `${slug}.webm`))).size;
    crf = c;
    if (size <= LIMIT) break;
  }
  await rm(reelPath, { force: true });

  const { stdout: tag } = await run('ffprobe', ['-v', 'error',
    '-show_entries', 'stream_tags=alpha_mode', '-of', 'default=nw=1:nk=1',
    join(OUT, `${slug}.webm`)]);
  const ok = size <= LIMIT && tag.trim() === '1';
  console.log(`  ${ok ? 'ok  ' : 'BAD '} ${slug.padEnd(14)} ${N}f @ ${FPS}fps  ` +
    `${(size / 1024).toFixed(0).padStart(4)}KB crf ${crf}  ` +
    parts.map((p) => `${p.name} ${p.swing[0]}..${p.swing[1]}°`).join(', '));
  return ok;
}

// --fit sweeps the joint radius and reports where the limb comes free. The
// black outline touches everything it borders, so a circle that only spans the
// limb's colour still leaves it welded to the torso through the outline; the
// radius that works is always larger than the limb looks.
if (FIT) {
  for (const slug of names) {
    const rig = JSON.parse(await readFile(join(RIGS, `${slug}.json`), 'utf8'));
    const base = await decode(join(SRC, `${slug}.webp`));
    for (const p of rig.parts) {
      const row = [];
      for (let r = 6; r <= 48; r += 2) {
        try {
          const { n } = cutPart(base, { ...p, r });
          row.push(`${r}:${n > 60000 ? 'BODY' : n}`);
        } catch { row.push(`${r}:seed-in`); }
      }
      console.log(`${slug} ${p.name}\n  ${row.join('  ')}`);
    }
  }
  process.exit(0);
}

const list = ALL
  ? (await readdir(RIGS)).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')).sort()
  : names;
if (!list.length) { console.log('nothing to do — name a sticker or pass --all'); process.exit(1); }
let bad = 0;
for (const slug of list) {
  try { if (!(await build(slug))) bad++; }
  catch (e) { bad++; console.log(`  BAD  ${slug.padEnd(14)} ${e.message}`); }
}
process.exit(bad ? 1 : 0);
