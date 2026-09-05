#!/usr/bin/env node
// Cut the ANIMATED custom-emoji set out of the animated stickers.
//
//   node tools/build-emoji.mjs                 # the whole pack
//   node tools/build-emoji.mjs wagmi gm        # just these
//
// gen-emoji.mjs makes the static 100x100 stills. This is the moving set, and
// Telegram is stricter about it than about stickers: WEBM / VP9 / 100x100 /
// <=3s / <=64KB. Sixty-four kilobytes is a quarter of a sticker's budget for a
// twenty-sixth of the pixels, so the ladder below has to be allowed to go a
// long way up the quality scale before it gives up.
//
// The crop is the point of this file. A 512px sticker squeezed into 100px
// leaves Kevin a smudge in the middle of a lot of nothing — at emoji size he is
// about as big as a word, so the frame has to come in tight to his silhouette.
// The box is the UNION of every frame's ink: crop each frame to its own bounds
// and he swims around inside the emoji as the animation plays.
//
// Alpha comes through the source untouched. Do not go looking for it with
// `ffprobe -show_entries stream=pix_fmt` — a WebM carries VP9 alpha as a second
// coded stream in Matroska BlockAdditions, so the container reports the colour
// plane's yuv420p no matter what is in the file, and ffmpeg's native vp9
// decoder cannot see the alpha at all. Only libvpx-vp9 decodes it, which is why
// every ffmpeg call here names that decoder explicitly.
import { readdir, mkdir, stat, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/stickers/animated');
const OUT = join(ROOT, 'assets/emoji/animated');
const SIZE = 100;
const LIMIT = 64 * 1024;
const FILL = 0.96;   // how much of the tile the character fills
const INK = 8;       // alpha at or below this is background, not a soft edge

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/**
 * The union of every frame's inked bounds, squared on the longer side and
 * clamped back inside the frame. Measured on the alpha plane, decoded through
 * libvpx because nothing else can see it.
 */
async function inkBox(webm, W, H) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9',
    '-i', webm, '-vf', 'alphaextract', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 28, encoding: 'buffer' });
  const plane = W * H;
  const frames = Math.floor(stdout.length / plane);
  if (!frames) throw new Error('no alpha plane to measure');

  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let f = 0; f < frames; f++) {
    const off = f * plane;
    for (let y = 0; y < H; y++) {
      const row = off + y * W;
      for (let x = 0; x < W; x++) {
        if (stdout[row + x] <= INK) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('every frame is empty');

  // Square on the longer side so nothing is squashed, then open it up by the
  // margin the tile leaves around the character.
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  let side = Math.ceil(Math.max(w, h) / FILL);
  side = Math.min(side, W, H);
  let x = Math.round(x0 + w / 2 - side / 2);
  let y = Math.round(y0 + h / 2 - side / 2);
  x = Math.max(0, Math.min(W - side, x));
  y = Math.max(0, Math.min(H - side, y));
  // yuv420p subsamples chroma, so every edge has to land on an even pixel.
  const even = (v) => v - (v % 2);
  return { x: even(x), y: even(y), side: even(side), frames, was: `${w}x${h}` };
}

/** alpha_mode on the container AND a real decode that reports yuva420p. */
async function hasAlpha(webm) {
  const { stdout: tag } = await run('ffprobe', ['-v', 'error',
    '-show_entries', 'stream_tags=alpha_mode', '-of', 'default=nw=1:nk=1', webm]);
  const { stderr: info } = await run('ffmpeg', ['-v', 'info', '-c:v', 'libvpx-vp9',
    '-i', webm, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  return tag.trim() === '1' && /yuva420p/.test(info);
}

await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC))
  .filter((f) => f.endsWith('.webm'))
  .filter((f) => !only.length || only.includes(basename(f, '.webm')))
  .sort();

console.log(`${files.length} source sticker(s) -> ${SIZE}x${SIZE} emoji\n`);
let made = 0;
let bad = 0;
for (const f of files) {
  const slug = basename(f, '.webm');
  const src = join(SRC, f);
  const dst = join(OUT, `${slug}.webm`);
  try {
    const { stdout: probe } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', src]);
    const [W, H, rate] = probe.trim().split(',');
    const fps = Math.round(eval(rate)); // r_frame_rate is "30/1"
    const box = await inkBox(src, Number(W), Number(H));

    // crf climbs first because dropping frames from a 3s loop is visible long
    // before extra compression is.
    let size = 0;
    let used = null;
    for (const [crf, f2] of [[30, fps], [38, fps], [45, fps], [52, fps], [58, fps],
                             [63, fps], [63, Math.min(fps, 20)], [63, Math.min(fps, 15)]]) {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', src,
        '-vf', `crop=${box.side}:${box.side}:${box.x}:${box.y},scale=${SIZE}:${SIZE}:flags=lanczos`,
        '-r', String(f2),
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(crf),
        '-an', '-loop', '0', dst], { maxBuffer: 1 << 26 });
      size = (await stat(dst)).size;
      used = [crf, f2];
      if (size <= LIMIT) break;
    }

    const alpha = await hasAlpha(dst);
    const ok = size <= LIMIT && alpha;
    if (!ok) bad++; else made++;
    console.log(`  ${ok ? 'ok  ' : 'BAD '} ${slug.padEnd(18)} ${box.was} -> ${box.side}px crop  ` +
      `${(size / 1024).toFixed(1).padStart(5)}KB  crf ${used[0]} @ ${used[1]}fps` +
      `${size > LIMIT ? '  <- OVER 64KB' : ''}${alpha ? '' : '  <- NO ALPHA'}`);
    if (!ok) await unlink(dst).catch(() => {});
  } catch (e) {
    bad++;
    console.log(`  BAD  ${slug.padEnd(18)} ${String(e.message).split('\n')[0].slice(0, 70)}`);
  }
}
console.log(`\n${made} emoji in assets/emoji/animated/${bad ? `, ${bad} failed` : ''}`);
process.exit(bad ? 1 : 0);
