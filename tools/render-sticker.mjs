#!/usr/bin/env node
// Render an animated Telegram sticker from the game's own Kevin.
//
//   node tools/render-sticker.mjs
//   node tools/render-sticker.mjs --frames 60 --fps 24 --out assets/stickers/animated/lift.webm
//
// Telegram video stickers: WEBM, VP9, 512x512, ALPHA, 3 seconds or less, and
// 256KB or less. That last limit is the one that bites — the encode ladder
// below walks quality down until it fits rather than failing, because a sticker
// that is 8KB over is not a sticker.
import { writeFile, mkdir, readFile, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

const FRAMES = Number(flag('frames', 48));
const FPS = Number(flag('fps', 24));
const OUT = join(ROOT, flag('out', 'assets/stickers/animated/lift.webm'));
const PORT = 8791;
const LIMIT = 256 * 1024;

async function main() {
  const tmp = join(ROOT, '.sticker-frames');
  await mkdir(tmp, { recursive: true });
  await mkdir(dirname(OUT), { recursive: true });

  // Serve the repo so the harness can import the game's modules by path.
  const { createServer } = await import('node:http');
  const server = createServer(async (req, res) => {
    try {
      const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const body = await readFile(p);
      const type = p.endsWith('.html') ? 'text/html'
        : p.endsWith('.js') || p.endsWith('.mjs') ? 'text/javascript'
        : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await pw.chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  page.on('pageerror', (e) => console.error('PAGE:', e.message));

  console.log(`rendering ${FRAMES} frames...`);
  await page.goto(`http://127.0.0.1:${PORT}/tools/sticker-lift.html?frames=${FRAMES}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const frames = await page.evaluate(() => window.__frames);
  await browser.close();
  server.close();

  for (let i = 0; i < frames.length; i++) {
    await writeFile(join(tmp, `f${String(i).padStart(4, '0')}.png`),
      Buffer.from(frames[i].split(',')[1], 'base64'));
  }
  console.log(`${frames.length} frames written`);

  // VP9 with yuva420p — the alpha pixel format. Without it the sticker gets a
  // black box behind it in every chat that is not dark themed.
  //
  // Do NOT read `ffprobe -show_entries stream=pix_fmt` to check this landed. A
  // WebM keeps VP9 alpha as a SECOND coded stream in Matroska BlockAdditions,
  // so the container reports the colour plane's yuv420p and nothing else, and
  // ffmpeg's native vp9 decoder cannot see the alpha at all. The two things
  // that actually prove it are the container's alpha_mode tag and a decode
  // through libvpx-vp9 — which is what verify() below does.
  const encode = async (crf, fps) => {
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-framerate', String(fps),
      '-i', join(tmp, 'f%04d.png'),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
      '-b:v', '0', '-crf', String(crf),
      '-an', '-loop', '0',
      OUT,
    ], { maxBuffer: 1 << 26 });
    return (await stat(OUT)).size;
  };

  let size = 0;
  for (const [crf, fps] of [[32, FPS], [40, FPS], [48, FPS], [55, FPS], [55, 20], [63, 16]]) {
    size = await encode(crf, fps);
    const secs = (FRAMES / fps).toFixed(2);
    console.log(`  crf ${crf} @ ${fps}fps -> ${(size / 1024).toFixed(0)}KB, ${secs}s`);
    if (size <= LIMIT && FRAMES / fps <= 3) break;
  }

  for (let i = 0; i < frames.length; i++) {
    await unlink(join(tmp, `f${String(i).padStart(4, '0')}.png`)).catch(() => {});
  }

  const alpha = await verify(OUT);
  await derive(OUT);

  const secs = FRAMES / FPS;
  console.log(`\n${OUT.replace(ROOT + '/', '')}  ${(size / 1024).toFixed(0)}KB  ${secs.toFixed(2)}s`);
  console.log(size <= LIMIT ? '  under the 256KB limit' : `  OVER by ${((size - LIMIT) / 1024).toFixed(0)}KB`);
  console.log(secs <= 3 ? '  under the 3s limit' : '  OVER 3 seconds');
  console.log(alpha ? '  alpha present (alpha_mode=1, decodes yuva420p)' : '  NO ALPHA — do not ship this');
}

/**
 * Prove the alpha survived the encode, both ways it can be proven: the
 * container flag, and a real decode through libvpx-vp9 (the only decoder here
 * that reads alpha out of BlockAdditions).
 */
async function verify(webm) {
  const { stdout: tag } = await run('ffprobe', ['-v', 'error',
    '-show_entries', 'stream_tags=alpha_mode', '-of', 'default=nw=1:nk=1', webm]);
  const { stderr: info } = await run('ffmpeg', ['-v', 'info',
    '-c:v', 'libvpx-vp9', '-i', webm, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  return tag.trim() === '1' && /yuva420p/.test(info);
}

/**
 * A still and a flat loop, same as the rest of the pack: the png keeps alpha
 * for the site, and the gif is flattened onto the brand yellow because a GIF
 * has one bit of transparency and keying it looks like a bad cutout.
 */
async function derive(webm) {
  const slug = webm.replace(/\.webm$/, '');
  const png = join(ROOT, 'assets/stickers/png', `${slug.split('/').pop()}.png`);
  await mkdir(dirname(png), { recursive: true });
  await run('ffmpeg', ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', webm,
    '-vf', 'select=eq(n\\,4),scale=512:512', '-vframes', '1', '-pix_fmt', 'rgba', png]);
  await run('ffmpeg', ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', webm,
    '-filter_complex',
    'color=c=0xFFE500:s=512x512[bg];[bg][0:v]overlay=shortest=1,fps=14,' +
    'scale=320:-1:flags=lanczos,split[a][b];' +
    '[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', `${slug}.gif`], { maxBuffer: 1 << 26 });
}

await main();
