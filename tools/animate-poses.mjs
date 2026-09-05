#!/usr/bin/env node
// Animate Todd's poses by moving the HEAD against the BODY.
//
//   node tools/animate-poses.mjs
//
// Two parts moving relative to each other is articulation; one part moving is
// vibration, and that is the difference between this and the first attempt.
// The head is cut off at the muzzle, drawn on its own pivot at the neck, and
// given a small rotation and bob while the body breathes counter to it. It is
// not a full rig, but a head that leads and a body that answers is most of what
// reads as "alive" in a cartoon.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/sprites/poses');
const TMP = join(ROOT, '.pose-frames');
const OUT = join(ROOT, 'assets/stickers/animated');
const PNG = join(ROOT, 'assets/stickers/png');
const SIZE = 512;
const FRAMES = 30;
const FPS = 15;

/** Per-pose feel. Amounts are in canvas pixels and radians. */
const MOOD = {
  idle:          { tilt: 0.035, bob: 5,  breathe: 0.020, phase: 0 },
  cheer:         { tilt: 0.055, bob: 11, breathe: 0.035, phase: 0 },
  'shades-point':{ tilt: 0.030, bob: 4,  breathe: 0.018, phase: 0.4 },
  thinking:      { tilt: 0.050, bob: 3,  breathe: 0.014, phase: 0 },
  kick:          { tilt: 0.040, bob: 8,  breathe: 0.030, phase: 0 },
  'lying-think': { tilt: 0.045, bob: 3,  breathe: 0.012, phase: 0.2 },
  phone:         { tilt: 0.026, bob: 3,  breathe: 0.014, phase: 0 },
  laughing:      { tilt: 0.070, bob: 10, breathe: 0.040, phase: 0 },
  finger:        { tilt: 0.038, bob: 6,  breathe: 0.022, phase: 0 },
  smoking:       { tilt: 0.022, bob: 3,  breathe: 0.013, phase: 0.5 },
  'lying-front': { tilt: 0.050, bob: 4,  breathe: 0.016, phase: 0 },
  running:       { tilt: 0.030, bob: 9,  breathe: 0.026, phase: 0 },
  money:         { tilt: 0.060, bob: 9,  breathe: 0.032, phase: 0 },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await mkdir(TMP, { recursive: true });
await mkdir(OUT, { recursive: true });
await mkdir(PNG, { recursive: true });

const files = (await readdir(SRC)).filter((f) => f.endsWith('.png')).sort();
const made = [];
for (const f of files) {
  const name = basename(f, '.png');
  const mood = MOOD[name] || MOOD.idle;
  const data = 'data:image/png;base64,' + (await readFile(join(SRC, f))).toString('base64');

  const frames = await page.evaluate(async ([dataUri, S, N, m]) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const work = document.createElement('canvas');
    work.width = W; work.height = H;
    const wx = work.getContext('2d', { willReadFrequently: true });
    wx.drawImage(img, 0, 0);
    const d = wx.getImageData(0, 0, W, H), p = d.data;

    // Find the muzzle: the biggest cream island. Its bottom is the neck line,
    // and its centre is where the head should pivot from.
    const cream = (k) => p[k*4+3] > 60 &&
      p[k*4] > 216 && p[k*4+1] > 200 && p[k*4+1] < 255 && p[k*4+2] > 150 && p[k*4+2] < 225;
    const seen = new Uint8Array(W*H);
    let best = 0, cut = 0, pivotX = W/2;
    for (let k0 = 0; k0 < W*H; k0++) {
      if (seen[k0] || !cream(k0)) continue;
      const st = [k0]; seen[k0] = 1;
      let n = 0, low = 0, sx = 0;
      while (st.length) {
        const k = st.pop(); n++;
        const cx = k % W, cy = (k / W) | 0;
        sx += cx;
        if (cy > low) low = cy;
        const go = (nk) => { if (!seen[nk] && cream(nk)) { seen[nk] = 1; st.push(nk); } };
        if (cx > 0) go(k-1);
        if (cx < W-1) go(k+1);
        if (cy > 0) go(k-W);
        if (cy < H-1) go(k+W);
      }
      if (n > best) { best = n; low = low; cut = low; pivotX = sx / n; }
    }
    if (!best) cut = Math.round(H * 0.55);
    cut = Math.min(H - 1, cut + 4);

    const part = (y0, y1) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').drawImage(work, 0, y0, W, y1 - y0, 0, y0, W, y1 - y0);
      return c;
    };
    const head = part(0, cut), body = part(cut, H);

    // Fit into the sticker square with room for the motion.
    const scale = (S * 0.88) / Math.max(W, H);
    const dw = W * scale, dh = H * scale;
    const ox = (S - dw) / 2, oy = (S - dh) / 2;
    const neckX = ox + pivotX * scale;
    const neckY = oy + cut * scale;
    const footY = oy + dh;

    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const out = [];
    for (let i = 0; i < N; i++) {
      const t = i / N, TAU = Math.PI * 2;
      x.clearRect(0, 0, S, S);
      // Body breathes about its own feet, a beat behind the head.
      const b = 1 + Math.sin((t + 0.12) * TAU) * m.breathe;
      x.save();
      x.translate(S/2, footY);
      x.scale(1 / b, b);
      x.translate(-S/2, -footY);
      x.drawImage(body, ox, oy, dw, dh);
      x.restore();
      // Head leads: tilt and bob about the neck.
      x.save();
      x.translate(neckX, neckY);
      x.rotate(Math.sin((t + m.phase) * TAU) * m.tilt);
      x.translate(0, -Math.abs(Math.sin((t + m.phase) * TAU)) * m.bob);
      x.translate(-neckX, -neckY);
      x.drawImage(head, ox, oy, dw, dh);
      x.restore();
      out.push(c.toDataURL('image/png'));
    }
    return out;
  }, [data, SIZE, FRAMES, mood]);

  for (let i = 0; i < frames.length; i++) {
    await writeFile(join(TMP, `f${String(i).padStart(3, '0')}.png`),
      Buffer.from(frames[i].split(',')[1], 'base64'));
  }
  const webm = join(OUT, `pose-${name}.webm`);
  let size = 0;
  for (const crf of [30, 36, 42, 50, 58]) {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS),
      '-i', join(TMP, 'f%03d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
      '-auto-alt-ref', '0', '-crf', String(crf), '-b:v', '0', '-an', webm]);
    size = (await import('node:fs')).statSync(webm).size;
    if (size <= 250 * 1024) break;
  }
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(TMP, 'f005.png'),
    '-vf', 'scale=512:512', join(PNG, `pose-${name}.png`)]);
  made.push({ name, kb: Math.round(size / 1024) });
  console.log(`  pose-${name.padEnd(13)} ${Math.round(size/1024)}KB`);
}
await browser.close();
console.log(`\n${made.length} animated poses in assets/stickers/animated/`);
