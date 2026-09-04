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
import { join, dirname, basename } from 'node:path';
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
const BRAND_YELLOW = 'FFE500';
const STILLS = join(ROOT, 'assets/stickers/stills');
const OUT = join(ROOT, 'assets/stickers/animated');
const PNG = join(ROOT, 'assets/stickers/png');
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
  'ABSOLUTELY DO NOT change the framing. The camera must not zoom, pan, dolly, ' +
  'push in or pull back at any point. The character must stay the exact same ' +
  'size and the exact same position in the frame for every single frame, at ' +
  'the same crop as the source image. The lettering must stay exactly where it ' +
  'is, the same size, fully visible, unchanged and unmoving, for the whole ' +
  'clip. ' +
  'Animate him IN PLACE: every part of his body moves — head, torso, arms, ' +
  'legs and hair all moving together as one connected mass with weight, squash ' +
  'and stretch — but he does not get smaller, does not get bigger, and does ' +
  'not move out of his position. "Animate the whole character" means every ' +
  'part of him moves, NOT that the shot widens to reveal more of him. ' +
  'Keep the character design, colours, proportions and black line art exactly ' +
  'as they are in the source image. Keep the background a completely flat, ' +
  'uniform, unchanging solid colour with no shadows, no gradient and no ' +
  'texture. Smooth 2D cartoon animation.';

export const STICKERS = [
  {
    slug: 'wagmi', src: '01-hero-portrait.jpg', word: 'WAGMI', start: 1.5,
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
  {
    // Head and fist, NOT a full body — which is the whole reason the rest of the
    // pack holds its model. Asked for a body head to toe, the model spends its
    // detail budget inventing legs and the head degrades on the way: two
    // attempts came back with a spiky mane, shrunken eyes and a narrow muzzle,
    // from the portrait AND from the full-body moon shot. Every sticker that
    // works here is a head-and-arms shot, so this one is too.
    // nudgeY 0 because this still is asked for with no baked lettering; the
    // default lift exists to crop the generator's own words out of frame and
    // would otherwise slice his chin off for nothing.
    slug: 'star-power', src: '01-hero-portrait.jpg', word: 'STAR POWER', nudgeY: 0,
    edit: 'Keep his head exactly as it is — same size, same position, same enormous white oval eyes, same wide cream muzzle, same smooth rounded red hood with thick blunt dreadlock spikes. Leave clear empty space across the top of the frame. Change only his arms: one arm punched straight up into that empty space above his head with the hand in a tight closed fist, the other fist raised beside his shoulder. Resting right on top of the raised fist, put one big glossy yellow five-pointed cartoon power-up star with two simple black oval eyes and a thick black outline, knocked upward by the punch, with short white impact lines flicking off it. His mouth is wide open shouting and his eyes look up at the star. Add no text or lettering anywhere in the image',
    action: 'His WHOLE BODY drives upward with the punch, torso stretching tall, shoulders lifting, head tipping back to shout up at it, hood and dreadlocks swinging with the motion, the raised fist punching up hard — the star spins, flashes and bounces higher on the hit — then he drops back into a squash and punches straight up into it again',
  },
  // --- the fryer set ------------------------------------------------------
  // He works the fryer. It is the whole character, so it gets its own batch.
  {
    slug: 'time-to-cook', src: '01-hero-portrait.jpg', word: 'TIME TO COOK', start: 1.5,
    edit: 'Dress him in a red and yellow fast-food crew uniform with a matching visor cap, sleeves pushed up, gripping the handle of a stainless steel deep-fryer basket in both hands and lowering it in front of him, golden fries tumbling in the basket, a big puff of white steam rising around it. Add the words "TIME TO COOK" in bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY dips down as he lowers the basket, knees bending, torso leaning forward over it, head dropping to watch, dreadlocks swinging forward — then he rises back up, chest lifting, head snapping up with a grin, the steam billowing and the fries jumping in the basket',
  },
  {
    slug: 'let-him-cook', src: '01-hero-portrait.jpg', word: 'LET HIM COOK', start: 1.5,
    edit: 'Dress him in a red and yellow fast-food crew uniform with a matching visor cap, both hands gripping a stainless steel fryer basket over a fryer vat, eyes narrowed in total concentration, tongue poking out of one corner of his mouth, orange flames licking up around the vat. Add the words "LET HIM COOK" in bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY shakes the basket in tight fast bursts, arms juddering, shoulders and torso vibrating with it, legs braced and bouncing, head locked in place staring down, dreadlocks trembling, the flames flaring up higher with each shake',
  },
  {
    slug: 'fried', src: '01-hero-portrait.jpg', word: 'FRIED', start: 1.5,
    edit: 'Dress him in a red and yellow fast-food crew uniform that is scorched and blackened with soot, thin wisps of smoke curling off his shoulders, his face smudged black, eyes wide and completely blank in a thousand-yard stare, holding one empty fryer basket limply at his side. Add the word "FRIED" in huge bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY sags and sways very slowly on the spot, shoulders slumping lower, head drooping forward then lolling back up, torso swaying, knees wobbling, dreadlocks hanging limp and swinging gently, the smoke curling upward, a single slow blink',
  },
  {
    slug: 'shift-over', src: '01-hero-portrait.jpg', word: 'SHIFT OVER', start: 1.5,
    edit: 'Dress him in a red and yellow fast-food crew uniform, mid-stride walking forward, tearing the visor cap off his head with one hand and flinging it away, the apron strings flying loose off his shoulders, mouth open in a huge triumphant grin. Add the words "SHIFT OVER" in bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY strides forward on the spot, legs pumping, torso twisting with each step, one arm whipping the cap away over his head and the other punching forward, head thrown back laughing, dreadlocks and apron strings flying behind him',
  },
  {
    slug: 'order-up', src: '01-hero-portrait.jpg', word: 'ORDER UP', start: 1.5,
    edit: 'Dress him in a red and yellow fast-food crew uniform with a matching visor cap, thrusting a red fast-food fry carton up above his head in one hand, mouth wide open shouting, other arm raised. The carton is packed with tall bright green glowing stock-market candlestick bars sticking straight up out of it instead of fries — flat green rectangles with thin wicks, not potato fries. There is no counter, no table and no furniture anywhere in the picture. Add the words "ORDER UP" in bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY drives upward thrusting the carton higher, legs straightening onto his toes, torso stretching up, head thrown back to shout, dreadlocks flying, then dropping back down into a squash and driving up again, the green candles bouncing and springing in the carton',
  },
  {
    slug: 'on-break', src: '01-hero-portrait.jpg', word: 'ON BREAK', start: 1.5,
    edit: 'Dress him in a red and yellow fast-food crew uniform with the visor cap pushed up off his forehead, sitting hunched over on an upturned plastic bucket, both hands cupping a phone close to his face, the phone screen throwing a bright green glow up onto his face, expression completely flat and deadpan. Add the words "ON BREAK" in bold black cartoon letters across the bottom',
    action: 'His WHOLE BODY hunches tighter over the phone, shoulders creeping up, torso curling in, head lowering closer to the screen, one thumb scrolling, knees bouncing — then his head snaps up to the camera for a single flat stare and drops straight back down to the phone',
  },
];

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const only = args.filter((a) => !a.startsWith('--'));

// The pack is the animated character on transparent, nothing else. The word
// plate stays in the code because it is useful for one-off promo art, but it is
// off unless asked for — and note that with it off the crop has to lift, or the
// generator's own baked-in lettering is left showing at the bottom of frame.
const WORDS = has('text');
const NO_TEXT_LIFT = 0.16;

/**
 * Cut a raw 16:9 clip down to a Telegram video sticker.
 * The backdrop is keyed out by sampling the top-left pixel — every source here
 * is a flat-backed cartoon, so the corner is the background colour by
 * definition, which beats hardcoding a hex that changes per image.
 */
/**
 * Cut a raw clip down to a Telegram video sticker.
 *
 * Two things the generator does that have to be undone here. It reframes over
 * the first second or so — widening the shot and scrolling the baked-in word
 * out of view — so the trim starts after that settles. And because the word is
 * gone by then, it gets typeset back on afterwards, which also means the
 * lettering is identical across the whole pack instead of varying per clip.
 *
 * The backdrop is keyed by sampling the clip's own top-left pixel: every
 * source is a flat-backed cartoon, so the corner is the background by
 * definition, and that stays true as sources change.
 */
/**
 * Some clips come back with a black letterbox bar baked into the frame. It is
 * not the keyed backdrop colour, so the keyer leaves it and the content
 * detector counts it as part of the character — which drags the crop down and
 * smears black across the bottom of the sticker. Trim it off first.
 */
async function blackBars(src, start, dur) {
  const { stderr } = await run(FFMPEG, ['-v', 'info', '-ss', String(start), '-t', String(dur), '-i', src,
    '-vf', 'cropdetect=limit=24:round=2:reset=0', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 24 }).catch((e) => ({ stderr: e.stderr || '' }));
  const hits = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!hits.length) return null;
  const [w, h, x, y] = hits[hits.length - 1].slice(1).map(Number);
  return { w, h, x, y };
}

/**
 * Find the character's bounding box across the clip.
 *
 * A centre crop is wrong: the generator does not centre him, so a fixed centre
 * square slices his head off and leaves a laser looking like a smear from
 * nowhere. Keying the flat backdrop to alpha and running cropdetect over the
 * whole clip gives the box he actually occupies.
 */
async function contentBox(src, hex, start, dur, bars) {
  const pre = bars ? `crop=${bars.w}:${bars.h}:${bars.x}:${bars.y},` : '';
  const { stderr } = await run(FFMPEG, ['-v', 'info', '-ss', String(start), '-t', String(dur), '-i', src,
    '-vf', `${pre}colorkey=${hex}:0.18:0.05,alphaextract,cropdetect=limit=0.06:round=2:reset=0`,
    '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 }).catch((e) => ({ stderr: e.stderr || '' }));
  const hits = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!hits.length) return null;
  const last = hits[hits.length - 1].slice(1).map(Number);
  return { w: last[0], h: last[1], x: last[2], y: last[3] };
}

/**
 * Render a word as a transparent overlay strip, once, in the brand face.
 *
 * The word has to FIT. The old version picked a size from the letter count and
 * sat 12px off the bottom with a 15px stroke — so the stroke was clipped by the
 * frame on every sticker and the longer words ran edge to edge. Measure and
 * shrink instead, and give the stroke room to be a stroke.
 */
async function wordPlate(word, out) {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    const font = (await rf(join(ROOT, 'assets/fonts/luckiest-guy-400.woff2'))).toString('base64');
    await page.setContent(`<style>
      @font-face{font-family:'LG';src:url(data:font/woff2;base64,${font}) format('woff2')}
      *{margin:0;padding:0}
      html,body{width:512px;height:512px;background:transparent;overflow:hidden}
      #row{position:absolute;left:0;right:0;bottom:18px;text-align:center}
      #w{display:inline-block;font-family:'LG',sans-serif;font-weight:400;line-height:1.04;
        color:#fff;paint-order:stroke fill;white-space:nowrap}
    </style><div id="row"><span id="w">${word}</span></div>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    // Shrink only if the word genuinely does not fit. The element has to be
    // inline-block to be measurable at all — a full-width block reports 512px
    // whatever it contains, so the loop shrank every word to the floor.
    await page.evaluate(() => {
      const el = document.getElementById('w');
      const AVAILABLE = 512 - 26 * 2;
      for (let size = 106; size > 30; size -= 2) {
        el.style.fontSize = `${size}px`;
        // The stroke straddles the glyph edge, so half sits outside the measured
        // box on each side. Count it, or the widest letters clip.
        const stroke = Math.round(size * 0.155);
        el.style.webkitTextStroke = `${stroke}px #0B0B0B`;
        el.style.letterSpacing = size > 74 ? '1px' : '0px';
        if (el.getBoundingClientRect().width + stroke <= AVAILABLE) break;
      }
    });

    await wf(out, await page.screenshot({ omitBackground: true }));
    await page.close();
  });
}

/**
 * Cut a raw clip down to a Telegram video sticker.
 *
 * Two things the generator does that have to be undone here. It reframes over
 * the first second or so — widening the shot and scrolling the baked-in word
 * out of view — so the trim starts after that settles. And because the word is
 * gone by then, it gets typeset back on afterwards, which also means the
 * lettering is identical across the whole pack instead of varying per clip.
 *
 * The backdrop is keyed by sampling the clip's own top-left pixel: every
 * source is a flat-backed cartoon, so the corner is the background by
 * definition, and that stays true as sources change.
 */
async function toSticker(src, out, opts = {}) {
  // Some clips open on a close-up and pull out to a wide shot. Where the
  // costume IS the joke, start after the pull-out so the outfit is visible.
  const { word = null, dur = 3 } = opts;
  const start = opts.start ?? 0.3;
  const probe = await run(FFMPEG, ['-v', 'error', '-ss', String(start), '-i', src,
    '-vf', 'crop=8:8:0:0,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 20 });
  const [r, g, b] = probe.stdout;
  const hex = `0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  // square crop around the character, with margin, clamped to the frame
  const meta = await run(FFMPEG, ['-v', 'error', '-i', src, '-f', 'null', '-'], { encoding: 'utf8' })
    .catch((e) => ({ stderr: e.stderr || '' }));
  const dim = /, (\d{3,4})x(\d{3,4})/.exec(meta.stderr || '') || [null, '1280', '720'];
  const FW = Number(dim[1]);
  const FH = Number(dim[2]);

  const bars = await blackBars(src, start, dur);
  const bw = bars ? bars.w : FW;
  const bh = bars ? bars.h : FH;
  const bx = bars ? bars.x : 0;
  const by = bars ? bars.y : 0;
  const trim = bars ? `crop=${bw}:${bh}:${bx}:${by},` : '';

  const box = await contentBox(src, hex, start, dur, bars);
  // The fallback centre crop has to honour nudgeY as well — this clip takes
  // this branch, not the content-box one, which is why lifting the crop
  // appeared to do nothing however far it was pushed.
  const fbSide = Math.round(bh * (1 - (opts.nudgeY ?? 0)));
  let crop = `${trim}crop=${fbSide}:${fbSide}:${Math.round((bw - fbSide) / 2)}:0`;
  if (box && box.w > 60 && box.h > 60) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    // A full-frame-height crop has nowhere to move, so nudgeY has to buy its own
    // headroom by taking the crop in first — otherwise the clamp below pins y
    // to 0 and the lift silently does nothing.
    const room = bh * (1 - (opts.nudgeY ?? 0));
    const side = Math.min(room, Math.max(box.w, box.h) * (opts.wide ? 1.5 : 1.22));
    const x = Math.max(0, Math.min(bw - side, cx - side / 2));
    // nudgeY lifts the crop off the bottom of the frame. Some clips keep the
    // generator's own baked-in lettering down there, and it ghosts through
    // underneath the typeset plate; lifting the crop leaves it outside.
    const ny = cy - side / 2 - side * (opts.nudgeY ?? 0);
    const y = Math.max(0, Math.min(bh - side, ny));
    crop = `${trim}crop=${Math.round(side)}:${Math.round(side)}:${Math.round(x)}:${Math.round(y)}`;
  }

  let plate = null;
  if (word) {
    plate = join(RAW, `_word_${word.replace(/[^A-Z0-9]/gi, '')}.png`);
    await wordPlate(word, plate);
  }

  const base = `${crop},scale=512:512:flags=lanczos,colorkey=${hex}:0.18:0.05`;

  // Telegram rejects a video sticker over 256KB. Give up frame rate and
  // quality first, because both degrade gracefully; give up seconds last,
  // because a clip cut short loses the end of the gag. A busy clip — steam,
  // flames, cash, a whole body moving — can need every rung of this.
  let last = null;
  for (const secs of [dur, dur * 0.8, dur * 0.65]) {
    for (const fps of [30, 24, 20, 16, 12]) {
      for (const crf of [34, 40, 46, 52, 58, 63]) {
        const args = ['-y', '-v', 'error', '-ss', String(start), '-t', secs.toFixed(2), '-i', src];
        if (plate) args.push('-i', plate);
        const chain = fps === 30 ? base : `fps=${fps},${base}`;
        args.push('-filter_complex',
          plate ? `[0:v]${chain}[k];[k][1:v]overlay=0:0,format=yuva420p`
                : `[0:v]${chain},format=yuva420p`);
        args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
          '-crf', String(crf), '-b:v', '0', '-an', out);
        await run(FFMPEG, args);
        const { size } = await stat(out);
        last = { size, crf, fps, secs, crop };
        if (size <= 240 * 1024) return last;
      }
    }
  }
  // Nothing fit. Say so loudly — publishing would fail at Telegram instead.
  console.log(`  ! ${basename(out)} is ${(last.size / 1024).toFixed(0)}KB, over the 256KB ceiling`);
  return { ...last, oversize: true };
}

/**
 * The webm is the sticker. The site also wants a still and a loop that plays
 * where transparent VP9 doesn't — X and Discord. Both fall straight out of the
 * finished webm, so they are derived here rather than generated separately.
 *
 *   png — one frame, alpha kept
 *   gif — the loop flattened onto the brand yellow, because a GIF only has
 *         one bit of transparency and keying it looks like a bad cutout
 */
async function derive(webm, slug) {
  await mkdir(PNG, { recursive: true });
  await run(FFMPEG, ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', webm,
    '-vf', 'select=eq(n\\,4),scale=512:512', '-vframes', '1', '-pix_fmt', 'rgba',
    join(PNG, `${slug}.png`)]);
  await run(FFMPEG, ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', webm,
    '-filter_complex',
    `color=c=0x${BRAND_YELLOW}:s=512x512[bg];[bg][0:v]overlay=shortest=1,fps=14,` +
    'scale=320:-1:flags=lanczos,split[a][b];' +
    '[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0', join(OUT, `${slug}.gif`)]);
}

async function main() {
  if (has('list')) {
    for (const s of STICKERS) console.log(`  ${(s.word || s.slug).padEnd(14)} ${s.src.padEnd(24)} ${s.edit.slice(0, 58)}…`);
    return;
  }

  const list = only.length ? STICKERS.filter((s) => only.includes(s.slug)) : STICKERS;

  // Re-cutting is free — the raws are already paid for. Never regenerate to
  // change a trim, a crop or a caption.
  if (has('recut')) {
    await mkdir(OUT, { recursive: true });
    for (const s of list) {
      const raw = join(RAW, `${s.slug}.mp4`);
      if (!existsSync(raw)) { console.log(`  ${s.slug.padEnd(16)} no raw, skipped`); continue; }
      const webm = join(OUT, `${s.slug}.webm`);
      const { size, crf, fps } = await toSticker(raw, webm, {
        word: WORDS ? s.word : null,
        wide: s.wide,
        start: s.start,
        nudgeY: s.nudgeY ?? (WORDS ? 0 : NO_TEXT_LIFT),
      });
      await derive(webm, s.slug);
      console.log(`  ${s.slug.padEnd(16)} ${(size / 1024).toFixed(0).padStart(4)}KB (crf ${crf}${fps < 30 ? `, ${fps}fps` : ''})`);
    }
    return;
  }

  const key = await loadKey();

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

  // The video stage fetches the still over a public URL. A branch URL is
  // mutable and CDN-cached, so a freshly regenerated still can be served stale
  // — which silently animates the PREVIOUS version of the image. Committing and
  // then addressing the still by commit SHA makes the URL immutable, so what
  // gets animated is always what was just generated.
  await run('git', ['add', 'assets/stickers/stills'], { cwd: ROOT }).catch(() => {});
  await run('git', ['-c', 'user.email=bahmed3170@gmail.com', '-c', 'user.name=PettyMiggzy',
    'commit', '-q', '-m', 'Add sticker stills'], { cwd: ROOT }).catch(() => {});
  const push = await run('git', ['push', '-q', 'origin', BRANCH], { cwd: ROOT })
    .then(() => true).catch((e) => { console.log(`  ! push failed: ${String(e.message).slice(0, 80)}`); return false; });
  if (!push) { console.log('  ! stills are not reachable by the video stage — aborting'); return; }
  const sha = (await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
  const STILL_BASE = `https://raw.githubusercontent.com/PettyMiggzy/kevin/${sha}/assets/stickers/stills`;

  // Stage 2: animate each still.
  for (const s of pending) {
    process.stdout.write(`  ${s.slug.padEnd(16)} queueing…`);
    try {
      const id = await queue(key, {
        model: MODEL,
        image_url: `${STILL_BASE}/${s.slug}.png`,
        prompt: `${s.action}. ${HOLD}`,
        duration: '5s',
        resolution: '720p',
        aspect_ratio: '16:9',
      });
      process.stdout.write(`\r  ${s.slug.padEnd(16)} rendering…      `);
      const mp4 = await retrieve(key, { model: MODEL, queue_id: id });
      const rawPath = await save(mp4, RAW, `${s.slug}.mp4`);
      const webm = join(OUT, `${s.slug}.webm`);
      const { size, crf, fps } = await toSticker(rawPath, webm, {
        word: WORDS ? s.word : null,
        wide: s.wide,
        start: s.start,
        nudgeY: s.nudgeY ?? (WORDS ? 0 : NO_TEXT_LIFT),
      });
      await derive(webm, s.slug);
      console.log(`\r  ${s.slug.padEnd(16)} ${(size / 1024).toFixed(0).padStart(4)}KB (crf ${crf}${fps < 30 ? `, ${fps}fps` : ''})       `);
    } catch (e) {
      console.log(`\r  ${s.slug.padEnd(16)} FAILED — ${e.message.split('\n')[0].slice(0, 80)}`);
    }
  }
  console.log(`\n${(await readdir(OUT)).length} stickers in assets/stickers/animated/`);
}

await main();
