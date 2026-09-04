#!/usr/bin/env node
// Verify animated stickers against what Telegram actually enforces.
//
//   node tools/check-stickers.mjs                 # the whole pack
//   node tools/check-stickers.mjs kek-power gym-curl
//
// Telegram video sticker: WEBM / VP9 / 512x512 / <=3s / <=256KB / no audio,
// and for anything that is not going to sit in a black box in every light
// themed chat, alpha.
//
// ALPHA IS THE ONE THAT LIES. Do not check it with
// `ffprobe -show_entries stream=pix_fmt`: a WebM keeps VP9 alpha as a SECOND
// coded stream in Matroska BlockAdditions, so the container reports the colour
// plane's yuv420p whatever the file contains, and ffmpeg's native vp9 decoder
// cannot see the alpha at all. That field says "no alpha" on files with
// perfectly good alpha — it cost me an afternoon and a wrong bug report. The
// two things that actually prove it are the container's alpha_mode tag and a
// decode through libvpx-vp9, so this checks both, plus the alpha plane's own
// coverage to catch a file that is technically alpha and entirely opaque.
import { readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets/stickers/animated');
const LIMIT = 256 * 1024;

const only = process.argv.slice(2);
const files = (await readdir(DIR))
  .filter((f) => f.endsWith('.webm'))
  .filter((f) => !only.length || only.includes(f.replace('.webm', '')))
  .sort();

let bad = 0;
console.log(`${files.length} stickers\n`);
for (const f of files) {
  const p = join(DIR, f);
  const notes = [];

  const { size } = await stat(p);
  if (size > LIMIT) notes.push(`${(size / 1024).toFixed(0)}KB OVER 256KB`);

  // A file still being written by the generator will not probe. Report it and
  // move on rather than take the whole run down with it.
  let probe;
  try {
    ({ stdout: probe } = await run('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_name,codec_type,width,height:format=duration:stream_tags=alpha_mode',
      '-of', 'default=nw=1', p]));
  } catch {
    console.log(`  BAD  ${f.replace('.webm', '').padEnd(14)} unreadable — still being written, or truncated`);
    bad++;
    continue;
  }
  // ffprobe prefixes tags with TAG: when stream tags are asked for alongside
  // other fields, and does not when they are asked for alone. Accept both.
  const get = (k) => (new RegExp(`^(?:TAG:)?${k}=(.*)$`, 'm').exec(probe) || [])[1];

  if (get('codec_name') !== 'vp9') notes.push(`codec is ${get('codec_name')}, not vp9`);
  if (get('width') !== '512' || get('height') !== '512') notes.push(`${get('width')}x${get('height')}, not 512x512`);
  if (probe.includes('codec_type=audio')) notes.push('has an audio stream');
  const dur = Number(get('duration'));
  if (!(dur <= 3.001)) notes.push(`${dur.toFixed(2)}s OVER 3s`);
  if (get('alpha_mode') !== '1') notes.push('no alpha_mode tag');

  // Decode through libvpx and measure the alpha plane. An all-white plane is a
  // fully opaque sticker wearing an alpha flag.
  let cover = null;
  try {
    // metadata=print:file=- writes to STDOUT, not stderr.
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', p,
      '-vf', 'alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
      '-frames:v', '1', '-f', 'null', '-'], { maxBuffer: 1 << 24 });
    const m = /YAVG=([\d.]+)/.exec(stdout);
    if (m) cover = Number(m[1]) / 255;
  } catch { /* falls through to the null check below */ }
  if (cover === null) notes.push('alpha will not decode');
  else if (cover > 0.97) notes.push('alpha is effectively opaque');

  const ok = notes.length === 0;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'BAD '} ${f.replace('.webm', '').padEnd(14)} ` +
    `${(size / 1024).toFixed(0).padStart(4)}KB  ${dur.toFixed(2)}s  ` +
    `${cover === null ? 'alpha ?' : `${(cover * 100).toFixed(0)}% opaque`}` +
    `${notes.length ? '  <- ' + notes.join('; ') : ''}`);
}
console.log(bad ? `\n${bad} need attention` : '\nall pass');
process.exit(bad ? 1 : 0);
