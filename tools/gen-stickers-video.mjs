#!/usr/bin/env node
// ANIMATED sticker pack, built by animating the reference art itself.
//
// Generating fresh stills drifts off-model, so the source frame here is always
// one of the images in assets/refs/ — served to Venice over its public raw
// GitHub URL, animated, then cut down to a Telegram video sticker.
//
// Telegram video sticker spec: WEBM / VP9, 512x512, <=3s, <=256KB, no audio.
// Alpha is optional but worth having, so the flat backdrop is keyed out.
//
//   node tools/gen-stickers-video.mjs --list
//   node tools/gen-stickers-video.mjs laugh          # one
//   node tools/gen-stickers-video.mjs               # all
//
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { loadKey } from './lib/venice.mjs';
import { quote, queue, retrieve, save } from './lib/video.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets/stickers/raw');
const OUT = join(ROOT, 'assets/stickers/animated');
const FFMPEG = process.env.FFMPEG_PATH || ['/usr/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg';

const BRANCH = process.env.REF_BRANCH || 'claude/kevin-crypto-art-website-ymq79j';
const BASE = `https://raw.githubusercontent.com/PettyMiggzy/kevin/${BRANCH}/assets/refs`;

const MODEL = process.env.VIDEO_MODEL || 'wan-3-0-image-to-video';

// Keep the framing and the backdrop nailed down; the model only animates.
const HOLD =
  'Keep the character design, colours, proportions and black line art exactly ' +
  'as they are in the source image. Keep the background a completely flat, ' +
  'uniform, unchanging solid colour with no shadows, no gradient and no ' +
  'texture. Keep the camera perfectly still. Smooth 2D cartoon animation.';

export const STICKERS = [
  { slug: 'laugh',    src: '01-hero-portrait.jpg', action: 'He throws his head back and laughs hard, eyes squeezing shut and opening again, whole body shaking with the laugh, arms waving' },
  { slug: 'yes',      src: '01-hero-portrait.jpg', action: 'He nods enthusiastically, over and over, grinning wider each time, hands pumping in front of him' },
  { slug: 'no',       src: '01-hero-portrait.jpg', action: 'He shakes his head slowly and firmly side to side, mouth flat, arms folding across his chest' },
  { slug: 'printer',  src: '08-money-printer.jpg', action: 'He leans back further in the chair and kicks his feet up, cash spraying faster out of the machine and fluttering down around him' },
  { slug: 'chomp',    src: '09-eating-candle.jpg', action: 'He bites down on the giant green candle and chews, cheeks bulging, green crumbs flying, head bobbing' },
  { slug: 'summit',   src: '10-candle-summit.jpg', action: 'He plants his feet, throws both arms up in victory on top of the candle, wind blowing past him, clouds drifting behind' },
  { slug: 'star',     src: '11-star-power.jpg',    action: 'He punches upward and grabs the star, sparkles bursting out, then pumps his fist as he lands' },
  { slug: 'scream',   src: '07-moon-action.jpg',   action: 'He runs frantically toward the camera, legs pumping, arms flailing, mouth open screaming, debris streaking past' },
  { slug: 'boss',     src: '06-toxic-graffiti.jpg', action: 'He unfolds his arms slowly and points straight at the camera, chin lifting, paint dripping down the wall behind him' },
  { slug: 'crunch',   src: '05-cereal.jpg',        action: 'He shovels a huge spoonful of green cereal into his mouth and chews happily, milk splashing, eyes wide' },
];

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const only = args.filter((a) => !a.startsWith('--'));

/**
 * Cut a raw 16:9 clip down to a Telegram video sticker.
 * The backdrop is keyed out by sampling the top-left pixel — every source here
 * is a flat-backed cartoon, so the corner is the background colour by
 * definition, which beats hardcoding a hex that changes per image.
 */
async function toSticker(src, out, { key = true } = {}) {
  const probe = await run(FFMPEG, ['-v', 'error', '-i', src, '-vf', 'crop=8:8:0:0,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    , { encoding: 'buffer', maxBuffer: 1 << 20 });
  const [r, g, b] = probe.stdout;
  const hex = `0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  // square centre crop -> 512 -> 3 seconds, then key the flat backdrop
  const chain = [
    'crop=ih:ih:(iw-ih)/2:0',
    'scale=512:512:flags=lanczos',
    key ? `colorkey=${hex}:0.18:0.05` : null,
    'format=yuva420p',
  ].filter(Boolean).join(',');

  for (const crf of [34, 40, 46, 52]) {
    await run(FFMPEG, ['-y', '-v', 'error', '-t', '3', '-i', src, '-vf', chain,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
      '-crf', String(crf), '-b:v', '0', '-an', out]);
    const { size } = await stat(out);
    if (size <= 240 * 1024) return { size, crf, hex };
  }
  return { size: (await stat(out)).size, crf: 52, hex };
}

async function main() {
  if (has('list')) {
    for (const s of STICKERS) console.log(`  ${s.slug.padEnd(10)} ${s.src.padEnd(24)} ${s.action.slice(0, 60)}…`);
    return;
  }

  const key = await loadKey();
  const list = only.length ? STICKERS.filter((s) => only.includes(s.slug)) : STICKERS;

  const each = await quote(key, { model: MODEL, duration: '5s', resolution: '720p', aspect_ratio: '16:9' });
  console.log(`model ${MODEL} · $${each.toFixed(2)} per clip · ${list.length} clips = $${(each * list.length).toFixed(2)}\n`);

  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });

  for (const s of list) {
    process.stdout.write(`  ${s.slug.padEnd(10)} queueing…`);
    try {
      const id = await queue(key, {
        model: MODEL,
        image_url: `${BASE}/${s.src}`,
        prompt: `${s.action}. ${HOLD}`,
        duration: '5s',
        resolution: '720p',
        aspect_ratio: '16:9',
      });
      process.stdout.write(`\r  ${s.slug.padEnd(10)} rendering…   `);
      const mp4 = await retrieve(key, { model: MODEL, queue_id: id });
      const rawPath = await save(mp4, RAW, `${s.slug}.mp4`);
      const webm = join(OUT, `${s.slug}.webm`);
      const { size, crf } = await toSticker(rawPath, webm);
      console.log(`\r  ${s.slug.padEnd(10)} ${(size / 1024).toFixed(0).padStart(4)}KB (crf ${crf})     `);
    } catch (e) {
      console.log(`\r  ${s.slug.padEnd(10)} FAILED — ${e.message.split('\n')[0].slice(0, 90)}`);
    }
  }
  console.log(`\n${(await readdir(OUT)).length} stickers in assets/stickers/animated/`);
}

await main();
