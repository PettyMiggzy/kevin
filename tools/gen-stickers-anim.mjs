#!/usr/bin/env node
// Animated Kevin stickers.
//
// Output per sticker:
//   assets/stickers/animated/<slug>.webm  VP9 + alpha, 512x512, <=3s, <=256KB
//                                          (Telegram video sticker spec)
//   assets/stickers/animated/<slug>.gif    yellow-void version for X / Discord
//
//   node tools/gen-stickers-anim.mjs [slug ...]
//
import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { kevin, C } from './lib/kevin-vector.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/stickers/animated');
const TMP = join(ROOT, '.sframes');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG =
  process.env.FFMPEG_PATH ||
  ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ||
  '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

const SIZE = 512;
const FPS = 30;
const SECONDS = 2;
const FRAMES = FPS * SECONDS;

const TAU = Math.PI * 2;
const ease = (x) => 1 - Math.pow(1 - x, 3);
const sin = (p, phase = 0) => Math.sin((p + phase) * TAU);

// Transform origins in viewBox units — the head pivots at the neck, the hair
// at the crown, the body at the feet. Getting these wrong is what makes
// character animation look like a sticker being dragged around.
const ORIGINS = {
  head: '256px 340px',
  hair: '200px 150px',
  body: '256px 402px',
  legs: '256px 396px',
  hand: '300px 330px',
  props: '256px 366px',
  eyes: '282px 150px',
  mouth: '292px 286px',
  face: '292px 226px',
};

const t = (parts) => parts;

/**
 * Every sticker declares the poses it needs (rendered once, toggled per
 * frame) and a frame function returning per-part transforms. Because p runs
 * 0..1 across the loop, anything built from sin(p) loops seamlessly.
 *
 * `boil` re-seeds the roughness filter so the outlines shiver frame to frame,
 * the way hand-inked animation does. It is the single thing that stops this
 * reading as a vector being tweened.
 */
const ANIMS = [
  {
    slug: 'petty',
    caption: 'PETTY',
    poses: {
      open: { eyes: 'side', mouth: 'smirk', props: ['arms'] },
      blink: { eyes: 'closed', mouth: 'smirk', props: ['arms'] },
    },
    frame: (p) => ({
      pose: p > 0.88 && p < 0.94 ? 'blink' : 'open',
      parts: t({
        // body sways one way, head counters it, hair arrives late
        body: `rotate(${sin(p) * 1.6}deg) translateY(${Math.abs(sin(p)) * 3}px)`,
        legs: `rotate(${sin(p) * 0.7}deg)`,
        head: `rotate(${sin(p, 0.12) * -2.6}deg) translate(${sin(p) * 4}px, ${sin(p, 0.25) * -3}px)`,
        hair: `rotate(${sin(p, 0.3) * 4.5}deg)`,
        props: `rotate(${sin(p) * 1.4}deg)`,
        mouth: `translateX(${sin(p, 0.1) * 2}px)`,
      }),
    }),
  },
  {
    slug: 'noted',
    caption: 'NOTED',
    poses: { a: { eyes: 'side', mouth: 'flat', props: ['arms'] } },
    // leans in, and keeps leaning in, and does not look away
    frame: (p) => {
      const z = p < 0.62 ? ease(p / 0.62) : 1;
      return {
        pose: 'a',
        root: `scale(${1 + z * 0.12})`,
        parts: t({
          head: `translateY(${z * 10}px) rotate(${z * -3}deg)`,
          hair: `rotate(${z * 5}deg)`,
          body: `translateY(${z * 4}px)`,
          eyes: `translate(${z * -4}px, ${z * 2}px)`,
        }),
      };
    },
  },
  {
    slug: 'kek',
    caption: 'KEK',
    poses: { open: { eyes: 'wide', mouth: 'big' }, shut: { eyes: 'closed', mouth: 'big' } },
    // head thrown back on every beat, hair whipping after it
    frame: (p) => {
      const beat = Math.sin(p * TAU * 3);
      return {
        pose: beat > 0.15 ? 'shut' : 'open',
        parts: t({
          head: `rotate(${beat * -9}deg) translateY(${-Math.abs(beat) * 12}px)`,
          hair: `rotate(${Math.sin((p + 0.06) * TAU * 3) * 13}deg)`,
          body: `translateY(${-Math.abs(beat) * 7}px) rotate(${beat * 2.5}deg)`,
          legs: `translateY(${-Math.abs(beat) * 4}px)`,
          hand: `rotate(${beat * 16}deg)`,
          mouth: `scale(${1 + Math.abs(beat) * 0.14})`,
        }),
      };
    },
  },
  {
    slug: 'laser',
    caption: 'SEND IT',
    poses: { a: { eyes: 'laser', mouth: 'big' }, b: { eyes: 'laser', mouth: 'tri' } },
    // rattles while charging, then lurches forward
    frame: (p, i) => {
      const rattle = (i % 3) - 1;
      const surge = p > 0.68 ? ease((p - 0.68) / 0.32) : 0;
      return {
        pose: p > 0.68 ? 'a' : 'b',
        root: `scale(${1 + surge * 0.1})`,
        parts: t({
          head: `translate(${rattle * 4}px, ${-rattle * 3 - surge * 14}px) rotate(${rattle * 1.5}deg)`,
          hair: `rotate(${rattle * 6 + surge * 8}deg)`,
          body: `translate(${-rattle * 2}px, ${surge * 6}px)`,
          hand: `rotate(${-surge * 30}deg)`,
        }),
      };
    },
  },
  {
    slug: 'rekt',
    caption: 'REKT',
    poses: { a: { eyes: 'x', mouth: 'frown' } },
    // tips over, head lagging behind the body, then snaps upright
    frame: (p) => {
      const fall = p < 0.42 ? ease(p / 0.42) : p < 0.78 ? 1 : 1 - ease((p - 0.78) / 0.22);
      const lag = p < 0.48 ? ease(Math.max(0, p - 0.06) / 0.42) : fall;
      return {
        pose: 'a',
        root: `rotate(${fall * -10}deg) translateY(${fall * 7}px)`,
        parts: t({
          head: `rotate(${lag * -7}deg)`,
          hair: `rotate(${lag * 12}deg)`,
          body: `rotate(${fall * 3}deg)`,
          hand: `rotate(${lag * -22}deg)`,
        }),
      };
    },
  },
  {
    slug: 'wen',
    caption: 'WEN',
    poses: { a: { eyes: 'wide', mouth: 'big' }, b: { eyes: 'wide', mouth: 'tri' } },
    // impatient hop: squash on landing, head and hair land a beat late
    frame: (p) => {
      const b = Math.abs(Math.sin(p * TAU * 2));
      const land = b < 0.15 ? 1 - b / 0.15 : 0;
      return {
        pose: b > 0.45 ? 'a' : 'b',
        root: `translateY(${-b * 22}px)`,
        parts: t({
          body: `scale(${1 + land * 0.08}, ${1 - land * 0.1})`,
          legs: `scale(${1 + land * 0.1}, ${1 - land * 0.16})`,
          head: `translateY(${land * 9 - b * 5}px) scale(${1 + land * 0.04}, ${1 - land * 0.05})`,
          hair: `rotate(${Math.sin((p + 0.08) * TAU * 2) * 9}deg)`,
          hand: `rotate(${b * 18}deg)`,
        }),
      };
    },
  },
  {
    slug: 'gm',
    caption: 'GM',
    poses: {
      shut: { eyes: 'closed', mouth: 'smirk', props: ['coffee'] },
      open: { eyes: 'normal', mouth: 'smirk', props: ['coffee'] },
    },
    // nods off, jerks awake, immediately regrets it
    frame: (p) => {
      const nod = p < 0.4 ? ease(p / 0.4) : p < 0.5 ? 1 - ease((p - 0.4) / 0.1) : 0;
      return {
        pose: p > 0.44 && p < 0.8 ? 'open' : 'shut',
        parts: t({
          head: `rotate(${nod * 9}deg) translateY(${nod * 12}px)`,
          hair: `rotate(${nod * -7}deg)`,
          body: `translateY(${nod * 4 + sin(p) * 2}px)`,
          props: `rotate(${nod * 6}deg)`,
        }),
      };
    },
  },
  {
    slug: 'cope',
    caption: 'COPE',
    poses: { a: { eyes: 'cry', mouth: 'frown' }, b: { eyes: 'cry', mouth: 'flat' } },
    // shoulders heaving, head shaking, hair limp
    frame: (p, i) => {
      const heave = Math.sin(p * TAU * 3);
      return {
        pose: i % 8 < 4 ? 'a' : 'b',
        parts: t({
          body: `translateY(${-Math.abs(heave) * 6}px) scale(1, ${1 + Math.abs(heave) * 0.04})`,
          head: `translate(${((i % 4) - 1.5) * 3}px, ${-Math.abs(heave) * 4}px) rotate(${((i % 4) - 1.5) * 2}deg)`,
          hair: `rotate(${((i % 4) - 1.5) * -3}deg)`,
          mouth: `translateY(${Math.abs(heave) * 2}px)`,
        }),
      };
    },
  },
];

function page(anim, background) {
  const layers = Object.entries(anim.poses)
    .map(([name, opts]) => {
      const svg = kevin({ ...opts, background: null, caption: anim.caption, captionColor: '#FFFFFF' });
      return `<div class="pose" data-pose="${name}">${svg}</div>`;
    })
    .join('');
  const origins = Object.entries(ORIGINS)
    .map(([k, v]) => `.k-${k}{transform-box:view-box;transform-origin:${v};transition:none}`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:${background || 'transparent'};overflow:hidden}
    #stage{width:${SIZE}px;height:${SIZE}px;position:relative;transform-origin:50% 50%}
    .pose{position:absolute;inset:0;display:none}
    /* headroom so a zoom or a tilt never clips the caption off the bottom */
    .pose svg{width:100%;height:100%;display:block;transform:scale(.92);transform-origin:50% 50%}
    ${origins}
  </style>
  <div id="stage">${layers}</div>
  <script>
    var stage = document.getElementById('stage');
    var poses = {};
    document.querySelectorAll('.pose').forEach(function (el) { poses[el.dataset.pose] = el; });
    var PARTS = ${JSON.stringify(Object.keys(ORIGINS))};

    window.setFrame = function (pose, root, parts, boil) {
      for (var k in poses) poses[k].style.display = k === pose ? 'block' : 'none';
      stage.style.transform = root || '';
      // transforms go on every pose copy, so switching pose keeps the motion
      PARTS.forEach(function (name) {
        var v = parts[name] || '';
        document.querySelectorAll('.k-' + name).forEach(function (el) { el.style.transform = v; });
      });
      // re-seed the roughness so the ink line shivers, like inked animation
      document.querySelectorAll('feTurbulence').forEach(function (n) { n.setAttribute('seed', boil); });
    };
  </script>`;
}

async function renderFrames(browser, anim, background, tag) {
  const ctx = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await ctx.setContent(page(anim, background), { waitUntil: 'load' });
  const dir = join(TMP, `${anim.slug}_${tag}`);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < FRAMES; i++) {
    const f = anim.frame(i / FRAMES, i);
    // Boil on threes, the way hand-inked animation does. Every frame reads as
    // static; it also triples the encode cost for no visible gain.
    const boil = Math.floor(i / 3) % 12;
    await ctx.evaluate(
      ([pose, root, parts, seed]) => window.setFrame(pose, root, parts, seed),
      [f.pose, f.root || '', f.parts || {}, boil]
    );
    await ctx.screenshot({
      path: join(dir, `${String(i).padStart(3, '0')}.png`),
      omitBackground: !background,
    });
  }
  await ctx.close();
  return dir;
}

/**
 * VP9 + alpha, tuned down until it fits Telegram's 256KB sticker ceiling.
 * Aim at 235KB rather than 256 — the boiling outline is expensive to encode
 * and landing on 253KB leaves no room if their check measures differently.
 */
const SIZE_TARGET = 235 * 1024;

async function toWebm(dir, out) {
  for (const crf of [36, 40, 44, 50]) {
    await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(dir, '%03d.png'),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
      '-crf', String(crf), '-b:v', '0', '-an', out]);
    const { size } = await stat(out);
    if (size <= SIZE_TARGET) return { crf, size };
  }
  return { crf: 50, size: (await stat(out)).size };
}

async function toGif(dir, out) {
  const palette = join(dir, 'palette.png');
  await run(FFMPEG, ['-y', '-i', join(dir, '%03d.png'),
    '-vf', 'fps=20,scale=360:-1:flags=lanczos,palettegen=max_colors=64', palette]);
  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(dir, '%03d.png'), '-i', palette,
    '-lavfi', 'fps=20,scale=360:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', out]);
}

async function main() {
  const only = process.argv.slice(2);
  const list = only.length ? ANIMS.filter((a) => only.includes(a.slug)) : ANIMS;

  await rm(TMP, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const anim of list) {
    const alphaDir = await renderFrames(browser, anim, null, 'a');
    const webm = join(OUT, `${anim.slug}.webm`);
    const { crf, size } = await toWebm(alphaDir, webm);

    const voidDir = await renderFrames(browser, anim, C.void, 'v');
    await toGif(voidDir, join(OUT, `${anim.slug}.gif`));

    const gifSize = (await stat(join(OUT, `${anim.slug}.gif`))).size;
    console.log(
      `${anim.slug.padEnd(12)} webm ${(size / 1024).toFixed(0).padStart(4)}KB (crf ${crf})   gif ${(gifSize / 1024).toFixed(0).padStart(4)}KB`
    );
  }
  await browser.close();
  await rm(TMP, { recursive: true, force: true });
  console.log('\nwrote', (await readdir(OUT)).length, 'files to assets/stickers/animated/');
}

await main();
