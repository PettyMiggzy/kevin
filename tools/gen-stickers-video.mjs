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
import { loadKey, edit, toBase64 } from './lib/venice.mjs';
import { readFile } from 'node:fs/promises';
import { quote, queue, retrieve, save } from './lib/video.mjs';
import { withBrowser } from './lib/render.mjs';
import { readFile as rf, writeFile as wf } from 'node:fs/promises';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets/stickers/raw');
const STILLS = join(ROOT, 'assets/stickers/stills');
const OUT = join(ROOT, 'assets/stickers/animated');
const FFMPEG = process.env.FFMPEG_PATH || ['/usr/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg';

const BRANCH = process.env.REF_BRANCH || 'claude/kevin-crypto-art-website-ymq79j';
const BASE = `https://raw.githubusercontent.com/PettyMiggzy/kevin/${BRANCH}/assets/refs`;

const MODEL = process.env.VIDEO_MODEL || 'wan-3-0-image-to-video';

// Keep the framing and the backdrop nailed down; the model only animates.
// Drift shows up first in the head: the hair goes spiky, the muzzle narrows,
// the eyes shrink. Naming those parts specifically holds them far better than
// a general "keep the character the same".
const EDIT_HOLD =
  'CRITICAL — keep the character IDENTICAL to the source image: the same ' +
  'smooth rounded red hood shape with the same thick blunt dreadlock spikes ' +
  '(never spiky, never messy, never human hair), the same TWO ENORMOUS white ' +
  'oval eyes at the same size cutting up into the hood, the same wide pale ' +
  'cream muzzle at the same width, the same heavy black line art, the same ' +
  'flat colours. Change only what is asked for. Keep the whole character in ' +
  'frame, centred, with margin on all sides, on a flat solid single-colour ' +
  'background with nothing else in it. Do not crop in on his face.';

const HOLD =
  'Keep the character design, colours, proportions and black line art exactly ' +
  'as they are in the source image. Keep the background a completely flat, ' +
  'uniform, unchanging solid colour with no shadows, no gradient and no ' +
  'texture. Keep the camera perfectly still. Smooth 2D cartoon animation.';

/**
 * Each sticker is a two-stage build:
 *   1. EDIT one of the reference images — new outfit, prop, pose and the word
 *      itself — which preserves the character, where generating a fresh still
 *      drifts off-model.
 *   2. ANIMATE that edited still.
 *
 * `word` is baked into the art rather than overlaid, the way the references
 * do it. `edit` describes the still; `action` describes what then moves.
 */
export const STICKERS = [
  {
    slug: 'wagmi', src: '01-hero-portrait.jpg', word: 'WAGMI',
    edit: 'Dress him in a red and yellow fast-food crew uniform with a matching visor cap, giving a big thumbs up with one hand. Add the word "WAGMI" in huge bold black cartoon letters across the bottom of the image',
    action: 'His WHOLE BODY bounces up and down on his feet with the beat, head bobbing, torso twisting side to side, hood and dreadlocks swinging with the motion, thumb pumping. Everything moves together — head, body, arms, legs',
  },
  {
    slug: 'gm', src: '01-hero-portrait.jpg', word: 'GM',
    edit: 'Give him a big steaming white coffee mug held in both hands, eyes half closed and sleepy, hair messy. Add the word "GM" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY sags and sways sleepily, head lolling forward then jerking back up, shoulders rising and falling with a huge yawn, torso rocking, dreadlocks swinging heavily. Then he lifts the mug with both arms and his whole body leans into the sip',
  },
  {
    slug: 'lfg', src: '01-hero-portrait.jpg', word: 'LFG',
    edit: 'Both fists thrown up in the air, mouth wide open mid-shout, eyes blazing with excitement. Add the word "LFG" in huge bold black cartoon letters across the bottom',
    action: 'He JUMPS — whole body leaving the ground, legs kicking, torso twisting, head thrown back, hood and dreadlocks flying up, both fists punching the air, then lands in a squash and springs again. Full body jump, not just arms',
  },
  {
    slug: 'buy', src: '01-hero-portrait.jpg', word: 'BUY',
    edit: 'He is slamming his hand down on an enormous glossy green arcade BUY button on a stand in front of him. Add the word "BUY" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY rears back then slams forward onto the button, torso folding, legs bracing, head snapping down with the hit, dreadlocks whipping forward, whole frame recoiling on impact, then rearing back to do it again',
  },
  {
    slug: 'send-it', src: '01-hero-portrait.jpg', word: 'SEND IT',
    edit: 'Glowing bright red laser beams shooting from both of his eyes, leaning forward aggressively, mouth open in a yell. Add the words "SEND IT" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY leans hard into the camera, torso pushing forward, legs planting and sliding, head lowering, dreadlocks streaming backward from the force, whole frame shaking with the beams firing',
  },
  {
    slug: 'hodl', src: '09-eating-candle.jpg', word: 'HODL',
    edit: 'He is hugging the giant green candlestick bar tightly with both arms wrapped around it, eyes clenched shut, refusing to let go. Add the word "HODL" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY clenches around the candle, torso squeezing tighter, legs gripping, head shaking violently side to side in refusal, dreadlocks whipping, whole frame trembling with the effort',
  },
  {
    slug: 'ngmi', src: '01-hero-portrait.jpg', word: 'NGMI',
    edit: 'He is pointing straight at the viewer with one hand and laughing hard, head tipped back, other hand on his belly. Add the word "NGMI" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY rocks backward laughing, torso folding and unfolding, head tipping back then snapping forward to point again, shoulders heaving, legs unsteady, dreadlocks swinging with every laugh',
  },
  {
    slug: 'rekt', src: '01-hero-portrait.jpg', word: 'REKT',
    overlay: true,
    edit: 'He is flat on his back on the ground, limbs sprawled out, both eyes replaced with simple black X shapes, tongue lolling out. Do not add any text or lettering anywhere in the image',
    action: 'His WHOLE BODY twitches and spasms once on the ground, a leg kicking up and flopping down, torso jerking, head rolling to the side, tongue flopping, then everything goes limp and still',
  },
  {
    slug: 'wen', src: '01-hero-portrait.jpg', word: 'WEN',
    edit: 'He is tapping an oversized wristwatch on his wrist impatiently, one eyebrow raised, mouth a flat line. Add the word "WEN" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY leans in impatiently then rocks back, hip cocking, foot tapping fast enough to shake his whole frame, head tilting and snapping to the camera, shoulders shrugging, dreadlocks bouncing',
  },
  {
    slug: 'pump-it', src: '10-candle-summit.jpg', word: 'PUMP IT',
    edit: 'He is riding the giant green candlestick like a rocket, arms raised in triumph, cape of red hair streaming behind him. Add the words "PUMP IT" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY rides upward with the candle, legs bending and straightening to absorb the surge, torso arching back, head thrown up, arms punching the sky, hood and dreadlocks streaming down behind him in the wind',
  },
  {
    slug: 'printer-go-brrr', src: '08-money-printer.jpg', word: 'BRRRR',
    edit: 'Cash exploding out of the money machine in a huge spray, him leaning back with both arms behind his head, feet up, laughing. Add the word "BRRRR" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY rocks back in the chair laughing, torso heaving, legs kicking up and down, head tipping back, dreadlocks swinging, the chair rocking under him as cash sprays everywhere',
  },
  {
    slug: 'ceo-of-chaos', src: '08-money-printer.jpg', word: 'CEO OF CHAOS',
    edit: 'Put a golden crown on his head and a royal fur-trimmed cape on his shoulders, sitting back like a king on the office chair, fingers steepled. Add the words "CEO OF CHAOS" in bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY settles back into the throne with authority, torso reclining, shoulders rolling, head tilting up and giving a slow deliberate nod, cape and dreadlocks shifting with the movement, fingers steepling',
  },
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

/**
 * Composite a word onto a still. Used where the model refuses to spell a
 * deliberate misspelling — it "corrects" REKT to RECT or REXT every time, so
 * that one gets set in type instead of generated.
 */
async function overlayWord(pngPath, word) {
  const b64 = (await rf(pngPath)).toString('base64');
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
    const font = (await rf(join(ROOT, 'assets/fonts/luckiest-guy-400.woff2'))).toString('base64');
    await page.setContent(`<style>
      @font-face{font-family:'LG';src:url(data:font/woff2;base64,${font}) format('woff2')}
      *{margin:0;padding:0}
      html,body{width:1024px;height:1024px;overflow:hidden}
      #w{position:relative;width:1024px;height:1024px}
      img{width:100%;height:100%;display:block}
      b{position:absolute;left:0;right:0;bottom:52px;text-align:center;
        font-family:'LG',sans-serif;font-weight:400;font-size:200px;line-height:1;
        color:#0B0B0B;letter-spacing:2px}
    </style><div id="w"><img src="data:image/png;base64,${b64}"><b>${word}</b></div>`,
      { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const shot = await page.screenshot();
    await wf(pngPath, shot);
    await page.close();
  });
}

async function main() {
  if (has('list')) {
    for (const s of STICKERS) console.log(`  ${(s.word || s.slug).padEnd(14)} ${s.src.padEnd(24)} ${s.edit.slice(0, 58)}…`);
    return;
  }

  const key = await loadKey();
  const list = only.length ? STICKERS.filter((s) => only.includes(s.slug)) : STICKERS;

  const each = await quote(key, { model: MODEL, duration: '5s', resolution: '720p', aspect_ratio: '16:9' });
  console.log(`model ${MODEL} · $${each.toFixed(2)} per clip · ${list.length} clips = $${(each * list.length).toFixed(2)}\n`);

  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  await mkdir(STILLS, { recursive: true });

  // Stage 1: edit every reference into its sticker still, then push, because
  // the video stage can only read the still over a public URL.
  const pending = [];
  for (const s of list) {
    const still = join(STILLS, `${s.slug}.png`);
    if (existsSync(still) && !has('redo-stills')) { pending.push(s); continue; }
    process.stdout.write(`  ${s.slug.padEnd(16)} editing still…`);
    try {
      const src = await readFile(join(ROOT, 'assets/refs', s.src));
      const out = await edit(key, {
        image: toBase64(src),
        prompt: `${s.edit}. ${EDIT_HOLD}`,
        aspect_ratio: '1:1',
      });
      const stillPath = await save(out, STILLS, `${s.slug}.png`);
      if (s.overlay && s.word) await overlayWord(stillPath, s.word);
      console.log(`\r  ${s.slug.padEnd(16)} still ok${s.overlay ? ' (word set in type)' : ''}        `);
      pending.push(s);
    } catch (e) {
      console.log(`\r  ${s.slug.padEnd(16)} STILL FAILED — ${e.message.slice(0, 70)}`);
    }
  }

  if (has('stills-only')) {
    console.log('\nstills in assets/stickers/stills/ — review, then run again to animate');
    return;
  }

  await run('git', ['add', 'assets/stickers/stills'], { cwd: ROOT }).catch(() => {});
  await run('git', ['-c', 'user.email=bahmed3170@gmail.com', '-c', 'user.name=PettyMiggzy',
    'commit', '-q', '-m', 'Add sticker stills'], { cwd: ROOT }).catch(() => {});
  await run('git', ['push', '-q', 'origin', BRANCH], { cwd: ROOT }).catch(() => {});

  // Stage 2: animate each still.
  for (const s of pending) {
    process.stdout.write(`  ${s.slug.padEnd(16)} queueing…`);
    try {
      const id = await queue(key, {
        model: MODEL,
        image_url: `https://raw.githubusercontent.com/PettyMiggzy/kevin/${BRANCH}/assets/stickers/stills/${s.slug}.png`,
        prompt: `${s.action}. ${HOLD}`,
        duration: '5s',
        resolution: '720p',
        aspect_ratio: '16:9',
      });
      process.stdout.write(`\r  ${s.slug.padEnd(16)} rendering…      `);
      const mp4 = await retrieve(key, { model: MODEL, queue_id: id });
      const rawPath = await save(mp4, RAW, `${s.slug}.mp4`);
      const webm = join(OUT, `${s.slug}.webm`);
      const { size, crf } = await toSticker(rawPath, webm);
      console.log(`\r  ${s.slug.padEnd(16)} ${(size / 1024).toFixed(0).padStart(4)}KB (crf ${crf})       `);
    } catch (e) {
      console.log(`\r  ${s.slug.padEnd(16)} FAILED — ${e.message.split('\n')[0].slice(0, 80)}`);
    }
  }
  console.log(`\n${(await readdir(OUT)).length} stickers in assets/stickers/animated/`);
}

await main();
