#!/usr/bin/env node
// Poster scenes. Every string is a parameter, so one template makes a hundred
// memes — change the billboard, change the sign, re-run, post.
//
//   node tools/gen-scenes.mjs
//
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sky, clouds, skyline, road, billboard, highwaySign, placard, speechBubble,
  moneyBill, cart, copCar, speedLines, motionStreaks, kevinGroup, C, shape,
  billScatter, moneyPile,
} from './lib/scene.mjs';
import { strokeText, fitSize } from './lib/letters.mjs';
import { withBrowser, svgToPng } from './lib/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_SVG = join(ROOT, 'assets/scenes');
const OUT_PNG = join(ROOT, 'assets/png/scenes');

const W = 1600;
const H = 900;

const doc = (body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${title}</title>${body}</svg>`;

/**
 * THE GETAWAY — Kevin leaving with the bag, unbothered, being chased.
 * Billboard and highway sign are text parameters.
 */
export function getaway({
  billboardText = 'IAMKEVIN.LOL',
  signRows = ['BIG DREAMS', 'WETH / KEK / GME', 'FREE KEVIN'],
  bubble = null,
  placardText = 'FREE KEVIN',
} = {}) {
  const horizon = 560;

  // keep flying cash off the signage and off his face
  const avoid = [
    [40, 100, 400, 330],      // highway sign
    [1040, 60, 1580, 300],    // billboard
    [640, 180, 1080, 560],    // his head
    [1200, 540, 1520, 720],   // the placard
  ];

  const body = [
    sky(W, H, horizon),
    clouds(W, 3),
    skyline(W, horizon, { seed: 11 }),
    road(W, H, horizon),
    speedLines(880, 560, { count: 20, inner: 420, outer: 1500, opacity: 0.22 }),

    // cash in the air goes down first, so nothing lands on top of the copy
    billScatter(13, { w: W, h: H, avoid, seed: 61, y0: 90, y1: 700, minS: 0.55, maxS: 1.05 }),

    highwaySign(48, 120, 330, signRows, { seed: 31 }),
    billboard(1050, 78, 520, 210, [{ text: billboardText, size: 96 }], { seed: 21 }),

    // the chase, well behind him
    `<g opacity=".97">${copCar(70, 606, 0.82, { seed: 81 })}</g>`,
    motionStreaks(520, 590, 300, 12, { seed: 95 }),

    // the fan club
    placard(1230, 545, 250, 130, placardText, { seed: 41, rotate: -7 }),
    kevinGroup({ eyes: 'wide', mouth: 'big', background: null, shade: true }, { x: 1210, y: 640, scale: 0.42 }),
    kevinGroup({ eyes: 'normal', mouth: 'big', background: null, shade: true }, { x: 1390, y: 656, scale: 0.4 }),

    // him, in the cart, with the bag
    kevinGroup(
      { eyes: 'normal', mouth: 'smirk', props: ['cap', 'shades'], background: null, shade: true },
      { x: 560, y: 170, scale: 1.02 }
    ),
    // cash that overflows the rim, then the cart drawn around it
    moneyPile(905, 566, 470, 90, { seed: 67, count: 14 }),
    cart(600, 590, 620, 200, { seed: 71, contents: moneyPile(910, 690, 600, 190, { seed: 65, count: 26 }) }),

    // a few in front, low, where they read as motion rather than clutter
    billScatter(6, { w: W, h: H, avoid, seed: 77, y0: 700, y1: 880, minS: 0.7, maxS: 1.3 }),

    bubble
      ? speechBubble(660, 60, 420, 200, bubble, { tail: [0.34, 1], seed: 51 })
      : '',
  ].join('\n');

  return doc(body, 'Kevin — the getaway');
}

/**
 * THE GYM — same rig, different situation. Proves the template idea: the
 * banner, the sign and the bubble are all just strings.
 */
export function gym({
  frontText = "KEVIN'S GYM",
  bannerText = 'NO PAIN, ONLY KEVIN',
  signText = 'WEIGHTS DO NOT LIE',
  bubble = [{ text: 'LEG DAY?' }, { text: 'MORE LIKE', fill: C.ink }, { text: 'LEG YAY', fill: C.red }],
} = {}) {
  const horizon = 600;
  const wallTop = 90;
  const body = [
    sky(W, H, horizon),
    clouds(W, 9),

    // the building front
    shape([[-10, wallTop], [980, wallTop - 18], [980, horizon + 6], [-10, horizon + 10]], '#C9BFAE', { smooth: false, seed: 5, wobble: 4, width: 9 }),
    shape([[40, 250], [900, 236], [900, horizon - 4], [40, horizon]], '#2A2E36', { smooth: false, seed: 6, wobble: 3, width: 8 }),
    strokeText(frontText, {
      x: 480,
      y: 108,
      size: fitSize(frontText, 830, { max: 118 }),
      align: 'center',
      fill: C.red,
      ink: C.ink,
      seed: 12,
    }).svg,
    // banner across the door
    shape([[60, 300], [880, 286], [884, 372], [64, 386]], '#F0E6C8', { smooth: false, seed: 7, wobble: 4, width: 8 }),
    strokeText(bannerText, {
      x: 470,
      y: 306,
      size: fitSize(bannerText, 760, { max: 54 }),
      align: 'center',
      fill: C.ink,
      ink: C.ink,
      seed: 13,
    }).svg,

    // ground
    shape([[-10, horizon], [W + 10, horizon - 8], [W + 10, H + 10], [-10, H + 10]], '#9A9384', { smooth: false, seed: 8, wobble: 3, width: 7 }),

    // gym sign on the right
    billboard(1140, 250, 430, 190, [{ text: signText, size: 54 }], { seed: 23, face: '#1B1F27' }),

    // spotter in the back
    kevinGroup({ eyes: 'x', mouth: 'big', background: null, shade: true }, { x: 60, y: 380, scale: 0.5 }),
    // him, mid-set
    kevinGroup(
      { eyes: 'wide', mouth: 'big', props: ['chain'], background: null, shade: true },
      { x: 700, y: 240, scale: 1.15 }
    ),
    speechBubble(1000, 60, 460, 210, bubble, { tail: [0.22, 1], seed: 53 }),
  ].join('\n');

  return doc(body, 'Kevin — the gym');
}

const SCENES = {
  getaway: getaway(),
  'getaway-bubble': getaway({
    bubble: [{ text: 'TOLD NO.' }, { text: 'STAYED ANYWAY.', fill: C.red }],
    billboardText: 'IAMKEVIN.LOL',
  }),
  gym: gym(),
};

async function main() {
  await mkdir(OUT_SVG, { recursive: true });
  await mkdir(OUT_PNG, { recursive: true });
  await withBrowser(async (browser) => {
    for (const [name, svg] of Object.entries(SCENES)) {
      await writeFile(join(OUT_SVG, `${name}.svg`), svg);
      await svgToPng(browser, svg, join(OUT_PNG, `${name}.png`), W, H);
      console.log('  ', name);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
