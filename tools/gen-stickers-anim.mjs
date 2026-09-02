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

/**
 * Each sticker declares the poses it needs (rendered once, toggled per frame)
 * and a frame function returning { pose, transform }.
 * p runs 0..1 across the loop, so every animation is seamless by construction.
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
      // a slow, unimpressed sway. one blink, right at the end, like he
      // just decided you weren't worth watching continuously.
      pose: p > 0.86 && p < 0.92 ? 'blink' : 'open',
      transform: `translate(${Math.sin(p * TAU) * 7}px, ${Math.cos(p * TAU) * 5}px) rotate(${Math.sin(p * TAU) * 1.8}deg)`,
    }),
  },
  {
    slug: 'noted',
    caption: 'NOTED',
    poses: { a: { eyes: 'side', mouth: 'flat', props: ['arms'] } },
    // creeps toward the camera and stops. does not look away.
    frame: (p) => {
      const z = p < 0.6 ? ease(p / 0.6) : 1;
      return { pose: 'a', transform: `scale(${1 + z * 0.13}) translateY(${z * 4}px)` };
    },
  },
  {
    slug: 'kek',
    caption: 'KEK',
    poses: {
      open: { eyes: 'wide', mouth: 'big' },
      shut: { eyes: 'closed', mouth: 'big' },
    },
    // laughing: fast bob, eyes squeezing shut on each beat
    frame: (p) => {
      const beat = Math.sin(p * TAU * 4);
      return {
        pose: beat > 0.2 ? 'shut' : 'open',
        transform: `translateY(${-Math.abs(beat) * 14}px) rotate(${beat * 4}deg) scale(${1 + Math.abs(beat) * 0.04})`,
      };
    },
  },
  {
    slug: 'laser',
    caption: 'SEND IT',
    poses: { a: { eyes: 'laser', mouth: 'big' }, b: { eyes: 'laser', mouth: 'tri' } },
    // charging up: rattling, then a lurch forward
    frame: (p, i) => {
      const shake = (i % 3) - 1;
      const surge = p > 0.7 ? ease((p - 0.7) / 0.3) : 0;
      return {
        pose: p > 0.7 ? 'a' : 'b',
        transform: `translate(${shake * 3}px, ${-shake * 3 - surge * 10}px) scale(${1 + surge * 0.12})`,
      };
    },
  },
  {
    slug: 'rekt',
    caption: 'REKT',
    poses: { a: { eyes: 'x', mouth: 'frown' } },
    // tips over, hangs there, snaps back up. structurally still fine.
    frame: (p) => {
      const fall = p < 0.45 ? ease(p / 0.45) : p < 0.8 ? 1 : 1 - ease((p - 0.8) / 0.2);
      return { pose: 'a', transform: `rotate(${fall * -13}deg) translateY(${fall * 9}px)` };
    },
  },
  {
    slug: 'wen',
    caption: 'WEN',
    poses: { a: { eyes: 'wide', mouth: 'big' }, b: { eyes: 'wide', mouth: 'tri' } },
    // impatient bounce with a squash on landing
    frame: (p) => {
      const b = Math.abs(Math.sin(p * TAU * 2));
      const squash = b < 0.12 ? 1 : 0;
      return {
        pose: b > 0.5 ? 'a' : 'b',
        transform: `translateY(${-b * 26}px) scale(${1 + squash * 0.06}, ${1 - squash * 0.08})`,
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
    // waking up slowly and immediately regretting it
    frame: (p) => ({
      pose: p > 0.35 && p < 0.75 ? 'open' : 'shut',
      transform: `translateY(${Math.sin(p * TAU) * 6}px) rotate(${Math.sin(p * TAU) * 1.2}deg)`,
    }),
  },
  {
    slug: 'cope',
    caption: 'COPE',
    poses: { a: { eyes: 'cry', mouth: 'frown' }, b: { eyes: 'cry', mouth: 'flat' } },
    // sobbing shake
    frame: (p, i) => ({
      pose: i % 8 < 4 ? 'a' : 'b',
      transform: `translate(${((i % 4) - 1.5) * 3}px, ${Math.sin(p * TAU * 3) * 5}px) rotate(${((i % 4) - 1.5) * 1.4}deg)`,
    }),
  },
];

function page(anim, background) {
  const layers = Object.entries(anim.poses)
    .map(([name, opts]) => {
      const svg = kevin({ ...opts, background: null, caption: anim.caption, captionColor: '#FFFFFF' });
      return `<div class="pose" data-pose="${name}">${svg}</div>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:${background || 'transparent'};overflow:hidden}
    #stage{width:${SIZE}px;height:${SIZE}px;position:relative;transform-origin:50% 50%}
    .pose{position:absolute;inset:0;display:none}
    /* 8% of headroom inside the frame so zooms and tilts never clip the
       caption off the bottom edge. */
    .pose svg{width:100%;height:100%;display:block;transform:scale(.92);transform-origin:50% 50%}
  </style>
  <div id="stage">${layers}</div>
  <script>
    var stage = document.getElementById('stage');
    var poses = {};
    document.querySelectorAll('.pose').forEach(function (el) { poses[el.dataset.pose] = el; });
    window.setFrame = function (pose, transform) {
      for (var k in poses) poses[k].style.display = k === pose ? 'block' : 'none';
      stage.style.transform = transform;
    };
  </script>`;
}

async function renderFrames(browser, anim, background, tag) {
  const ctx = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await ctx.setContent(page(anim, background), { waitUntil: 'load' });
  const dir = join(TMP, `${anim.slug}_${tag}`);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < FRAMES; i++) {
    const { pose, transform } = anim.frame(i / FRAMES, i);
    await ctx.evaluate(([p, t]) => window.setFrame(p, t), [pose, transform]);
    await ctx.screenshot({
      path: join(dir, `${String(i).padStart(3, '0')}.png`),
      omitBackground: !background,
    });
  }
  await ctx.close();
  return dir;
}

/** VP9 + alpha, tuned down until it fits Telegram's 256KB sticker ceiling. */
async function toWebm(dir, out) {
  for (const crf of [34, 40, 46, 52]) {
    await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(dir, '%03d.png'),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
      '-crf', String(crf), '-b:v', '0', '-an', out]);
    const { size } = await stat(out);
    if (size <= 256 * 1024) return { crf, size };
  }
  return { crf: 52, size: (await stat(out)).size };
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
