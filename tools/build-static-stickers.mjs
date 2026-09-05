#!/usr/bin/env node
// Turn the flat-backdrop stills into Telegram static stickers.
//
//   node tools/build-static-stickers.mjs            # every on-model still
//   node tools/build-static-stickers.mjs kek-flex   # just these
//
// The stills are 1024x1024 on solid brand yellow. Telegram wants one side at
// exactly 512, under 512KB, and — for anything that is not going to sit in a
// yellow box in every dark-themed chat — alpha.
//
// GETTING THE PAPER OFF. This has been got wrong twice on this project, so:
// it has to be a FLOOD FILL FROM THE BORDER, never a colour key. A key tight
// enough to leave his eyes alone leaves a halo of half-keyed pixels that reads
// as a dirty outline at sticker size; a key loose enough to catch the halo
// punches holes through him, because his eyes are white and his muzzle is
// cream and both are closer to the backdrop than the halo is. A fill only ever
// reaches colour that is connected to the outside of the frame, so an enclosed
// white eye is safe no matter how loose the tolerance gets.
//
// Then one pass of erosion, which takes the half-and-half ring where ink meets
// backdrop. Without it every sticker wears a yellow rim.
import { readdir, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/stickers/stills');
const OUT = join(ROOT, 'assets/stickers/static');
const TMP = join(ROOT, '.sticker-frames/static');
const SIZE = 512;
const LIMIT = 512 * 1024;
const TOL = 34;

// The Todd-built stills. The rest of assets/stickers/stills came out of the
// video pipeline and is already published as animation.
const isOnModel = (slug) =>
  slug.startsWith('kek-') || slug.startsWith('gym-') || slug === 'kevin-great';

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

await mkdir(OUT, { recursive: true });
await mkdir(TMP, { recursive: true });

const files = (await readdir(SRC))
  .filter((f) => f.endsWith('.png'))
  .filter((f) => (only.length ? only.includes(basename(f, '.png')) : isOnModel(basename(f, '.png'))))
  .sort();

console.log(`${files.length} still(s) -> ${SIZE}x${SIZE} transparent stickers\n`);
let made = 0, bad = 0;
for (const f of files) {
  const slug = basename(f, '.png');
  const raw = join(TMP, `${slug}.rgba`);
  const dst = join(OUT, `${slug}.webp`);
  try {
    const { stdout: dim } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(SRC, f)]);
    const [W, H] = dim.trim().split(',').map(Number);
    const { stdout: buf } = await run('ffmpeg', ['-v', 'error', '-i', join(SRC, f),
      '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28, encoding: 'buffer' });
    const px = Buffer.from(buf);

    // Seed on the backdrop colour as it actually is in the corner, not on the
    // brand value — the PNG has been through a resize and is a shade off.
    const bg = [px[0], px[1], px[2]];
    const near = (c) => {
      if (px[c * 4 + 3] < 128) return true;          // padding counts as passable,
      return Math.abs(px[c * 4] - bg[0]) <= TOL &&   // or the fill finds no seed
             Math.abs(px[c * 4 + 1] - bg[1]) <= TOL &&
             Math.abs(px[c * 4 + 2] - bg[2]) <= TOL;
    };

    const gone = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) {
      for (const c of [x, (H - 1) * W + x]) if (!gone[c] && near(c)) { gone[c] = 1; stack.push(c); }
    }
    for (let y = 0; y < H; y++) {
      for (const c of [y * W, y * W + W - 1]) if (!gone[c] && near(c)) { gone[c] = 1; stack.push(c); }
    }
    while (stack.length) {
      const c = stack.pop();
      const x = c % W, y = (c / W) | 0;
      const go = (n) => { if (!gone[n] && near(n)) { gone[n] = 1; stack.push(n); } };
      if (x > 0) go(c - 1); if (x < W - 1) go(c + 1);
      if (y > 0) go(c - W); if (y < H - 1) go(c + W);
    }

    // One erosion pass: the ring where ink meets backdrop is half of each, and
    // at sticker size it reads as a yellow rim around every character.
    const edge = [];
    for (let c = 0; c < W * H; c++) {
      if (gone[c]) continue;
      const x = c % W, y = (c / W) | 0;
      if ((x > 0 && gone[c - 1]) || (x < W - 1 && gone[c + 1]) ||
          (y > 0 && gone[c - W]) || (y < H - 1 && gone[c + W])) edge.push(c);
    }
    for (const c of edge) gone[c] = 1;

    let cut = 0;
    for (let c = 0; c < W * H; c++) if (gone[c]) { px[c * 4 + 3] = 0; cut++; }

    // A fill that ate the character is the failure mode worth catching: it
    // leaves an outline drawing, which looks deliberate until you see it in a
    // chat. Nothing here should be more than four fifths backdrop.
    const share = cut / (W * H);
    if (share > 0.82) { console.log(`  BAD  ${slug.padEnd(14)} fill took ${(share * 100).toFixed(0)}% — left alone`); bad++; continue; }

    await writeFile(raw, px);
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${W}x${H}`, '-i', raw,
      '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos`, '-frames:v', '1',
      '-c:v', 'libwebp', '-lossless', '0', '-quality', '92', '-compression_level', '6', dst]);
    await rm(raw, { force: true });

    const { size } = await stat(dst);
    const ok = size <= LIMIT;
    if (!ok) bad++; else made++;
    console.log(`  ${ok ? 'ok  ' : 'BAD '} ${slug.padEnd(14)} ${(share * 100).toFixed(0)}% cut  ` +
      `${(size / 1024).toFixed(0).padStart(3)}KB${ok ? '' : '  <- OVER 512KB'}`);
  } catch (e) {
    bad++;
    console.log(`  BAD  ${slug.padEnd(14)} ${String(e.message).split('\n')[0].slice(0, 60)}`);
  }
}
console.log(`\n${made} in assets/stickers/static/${bad ? `, ${bad} failed` : ''}`);
process.exit(bad ? 1 : 0);
