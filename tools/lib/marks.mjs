// Brand marks: wordmark, logo badge, pool coins, banner, OG card.
import { kevinGroup, C } from './kevin-vector.mjs';
import { strokeText, textMetrics, fitSize } from './letters.mjs';
import { smoothPath, blobEllipse, jitter, path } from './wobble.mjs';

// Head centre in character space, mapped to the centre of a 512 badge.
const HEAD = { x: 252, y: 196 };
const HEAD_SCALE = 1.5;
const HEAD_FIT = { x: 256 - HEAD.x * HEAD_SCALE, y: 256 - HEAD.y * HEAD_SCALE, scale: HEAD_SCALE };

const svg = (w, h, body, title = 'Kevin') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${title}</title>${body}</svg>`;

/** KEVIN, drawn with a mouse. */
export function wordmark(text = 'KEVIN', { size = 160, fill = C.red, ink = C.ink, background = null, pad = 40 } = {}) {
  const m = textMetrics(text, size);
  const w = Math.round(m.width + pad * 2);
  const h = Math.round(size + pad * 2);
  const bg = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : '';
  const t = strokeText(text, { x: pad, y: pad, size, fill, ink, seed: 3 });
  return svg(w, h, bg + t.svg, `${text} wordmark`);
}

/** Head-only badge: the logo mark. */
export function logoMark({ size = 512, background = C.void, ring = true, eyes = 'side', mouth = 'smirk' } = {}) {
  const body = [
    `<defs><clipPath id="badge"><circle cx="256" cy="256" r="234"/></clipPath></defs>`,
    background ? `<circle cx="256" cy="256" r="234" fill="${background}"/>` : '',
    // the head region of the full character, blown up and clipped to the badge
    `<g clip-path="url(#badge)">${kevinGroup({ eyes, mouth, background: null }, HEAD_FIT)}</g>`,
    ring ? `<circle cx="256" cy="256" r="234" fill="none" stroke="${C.ink}" stroke-width="18"/>` : '',
  ].join('');
  return svg(size, size, body, 'Kevin logo');
}

/** Favicon: cropped hard to the eyes so it reads at 16px. */
export function favicon() {
  return logoMark({ ring: true });
}

const POOLS = {
  kek: { label: 'KEK', color: C.kek, sub: 'THE LAUGH' },
  gme: { label: 'GME', color: C.gme, sub: 'THE GRUDGE' },
  weth: { label: 'WETH', color: C.weth, sub: 'THE GAS' },
};

/** A pool coin: KEK, GME or WETH. */
export function poolCoin(key, { size = 256 } = {}) {
  const p = POOLS[key];
  const body = [
    path(smoothPath(jitter(blobEllipse(128, 133, 112, 112, { steps: 34, wobble: 0.008, seed: 9 }), 2, 5)), { fill: C.ink }),
    path(smoothPath(jitter(blobEllipse(128, 126, 112, 112, { steps: 34, wobble: 0.008, seed: 9 }), 2, 5)), {
      fill: p.color,
      stroke: C.ink,
      width: 10,
    }),
    path(smoothPath(jitter(blobEllipse(128, 126, 92, 92, { steps: 30, wobble: 0.01, seed: 11 }), 2, 6)), {
      fill: 'none',
      stroke: C.ink,
      width: 6,
    }),
    // label only — the coin has to read at 24px in a nav bar. The pool's
    // nickname lives next to it in the UI, not on the face.
    strokeText(p.label, {
      x: 128,
      y: 96,
      size: fitSize(p.label, 132, { max: 62 }),
      align: 'center',
      fill: C.white,
      ink: C.ink,
      seed: 12,
    }).svg,
  ].join('');
  return svg(size, size, body, `${p.label} pool`);
}

/** 1500x500 header for X / Telegram. */
export function banner() {
  const w = 1500;
  const h = 500;
  const body = [
    `<rect width="${w}" height="${h}" fill="${C.void}"/>`,
    // scribbled void texture
    Array.from({ length: 26 }, (_, i) => {
      const y = 20 + i * 19;
      return path(`M0,${y} L${w},${y - 6}`, { stroke: C.voidDeep, width: 3 });
    }).join(''),
    strokeText('KEVIN', { x: 70, y: 110, size: 150, fill: C.red, ink: C.ink, seed: 3 }).svg,
    strokeText('TOLD NO. STAYED ANYWAY.', {
      x: 74,
      y: 290,
      size: fitSize('TOLD NO. STAYED ANYWAY.', 820, { max: 44 }),
      fill: C.white,
      ink: C.ink,
      seed: 8,
    }).svg,
    strokeText('KEK / GME / WETH - KEKFUN.XYZ', {
      x: 74,
      y: 372,
      size: fitSize('KEK / GME / WETH - KEKFUN.XYZ', 700, { max: 30 }),
      fill: C.ink,
      ink: C.ink,
      weight: 0.16,
      seed: 9,
    }).svg,
    kevinGroup({ eyes: 'side', mouth: 'smirk', props: ['arms'], background: null }, { x: 1040, y: -14, scale: 1.02 }),
  ].join('');
  return svg(w, h, body, 'Kevin banner');
}

/** 1200x630 link preview card. */
export function ogCard() {
  const w = 1200;
  const h = 630;
  const body = [
    `<rect width="${w}" height="${h}" fill="${C.void}"/>`,
    kevinGroup({ eyes: 'side', mouth: 'smirk', props: ['arms'], background: null }, { x: 754, y: 74, scale: 1.0 }),
    strokeText('KEVIN', { x: 70, y: 96, size: 150, fill: C.red, ink: C.ink, seed: 3 }).svg,
    strokeText('TOLD NO.', { x: 74, y: 286, size: fitSize('TOLD NO.', 600, { max: 66 }), fill: C.white, ink: C.ink, seed: 6 }).svg,
    strokeText('STAYED ANYWAY.', { x: 74, y: 386, size: fitSize('STAYED ANYWAY.', 600, { max: 66 }), fill: C.white, ink: C.ink, seed: 7 }).svg,
    strokeText('KEKFUN.XYZ', { x: 74, y: 512, size: 40, fill: C.ink, ink: C.ink, weight: 0.16, seed: 9 }).svg,
  ].join('');
  return svg(w, h, body, 'Kevin');
}

/** Tiling void pattern for section backgrounds. */
export function voidPattern() {
  const body = [
    `<rect width="200" height="200" fill="${C.void}"/>`,
    path('M0,40 L200,32', { stroke: C.voidDeep, width: 4 }),
    path('M0,120 L200,128', { stroke: C.voidDeep, width: 4 }),
    path(smoothPath(blobEllipse(150, 80, 8, 8, { steps: 8, wobble: 0.2, seed: 3 })), { fill: C.voidDeep }),
    path(smoothPath(blobEllipse(40, 170, 6, 6, { steps: 8, wobble: 0.2, seed: 4 })), { fill: C.voidDeep }),
  ].join('');
  return svg(200, 200, body, 'void');
}
