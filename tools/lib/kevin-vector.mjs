// Kevin, vectorised. Faithful to the original crude drawing — same wonky eyes,
// same yellow void, same no-knees legs — but built from clean, scalable paths so
// it holds up at 4096px and on a sticker.
//
// FIRST LAW: the wonk is load-bearing. Do not straighten the eyes.

import { smoothPath, polyPath, blobEllipse, jitter, path } from './wobble.mjs';
import { strokeText } from './letters.mjs';

export const C = {
  void: '#FFE500',       // the yellow. not gold. not amber. yellow.
  voidDeep: '#F5C400',
  red: '#E8232B',        // Kevin red
  redDark: '#B0141B',
  redLight: '#FF4A52',
  cream: '#FFF6C8',      // the muzzle
  creamDark: '#E8DCA0',
  ink: '#0B0B0B',
  white: '#FFFFFF',
  kek: '#2FBF4A',
  gme: '#E8232B',
  weth: '#8A92B2',
  wethLight: '#DDE2F2',
  gold: '#FFC531',
  laser: '#FF1744',
  laserGlow: '#FF8FA3',
  blue: '#4AA3FF',
};

const S = 12; // outline weight at the 512 viewBox

/**
 * Ink a shape the way a kid with a mouse does it: lay the colour down first,
 * then go round the edge separately. The two never quite line up — the fill
 * spills over the line here and leaves a sliver of white there — and that
 * misregistration is most of what your eye reads as "drawn by hand" rather
 * than "generated". A lighter second pass over the outline finishes it, like
 * somebody went round twice to make sure.
 */
let clipId = 0;

/** Darken a hex colour toward black by `amount` (0..1). */
function darken(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - amount)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Cel shadow: the same silhouette, nudged down-right and clipped back to the
 * shape, so a hard-edged crescent of shade sits along the bottom-right. One
 * light source, no gradients — the way a cartoon is painted, not the way a
 * renderer does it.
 */
function celShade(pts, d, fill, seed) {
  const id = `kc${clipId++}`;
  const base = d(jitter(pts, 5.2, seed * 7 + 1));
  // Fill the whole shape with shadow, then lay the base colour back over it
  // offset up-left. What survives is a hard crescent along the bottom-right —
  // one light source, top-left, exactly like a painted cel.
  const lit = pts.map(([x, y]) => [x - 30, y - 38]);
  return (
    `<clipPath id="${id}"><path d="${base}"/></clipPath>` +
    `<g clip-path="url(#${id})">` +
    path(base, { fill: darken(fill, 0.2) }) +
    path(d(jitter(lit, 4, seed * 17 + 9)), { fill }) +
    `</g>`
  );
}

function inked(pts, { fill, seed = 1, width = S, smooth = true, secondPass = true, shade = false } = {}) {
  const d = smooth ? smoothPath : polyPath;
  const out = [
    path(d(jitter(pts, 5.2, seed * 7 + 1)), { fill }),
    shade ? celShade(pts, d, fill, seed) : '',
    path(d(jitter(pts, 2.4, seed * 13 + 5)), { fill: 'none', stroke: C.ink, width }),
  ];
  if (secondPass) {
    out.push(
      path(d(jitter(pts, 3.6, seed * 29 + 3)), {
        fill: 'none',
        stroke: C.ink,
        width: width * 0.5,
        extra: 'opacity=".5"',
      })
    );
  }
  return out.join('');
}

const group = (cls, content) => (content ? `<g class="${cls}">${content}</g>` : '');

// ---------------------------------------------------------------------------
// silhouette pieces
// ---------------------------------------------------------------------------

const headPts = () =>
  jitter(blobEllipse(252, 196, 150, 148, { steps: 16, wobble: 0.035, seed: 11 }), 5, 3);

// Duplicated points make Catmull-Rom cusp instead of curve — that is how the
// hair gets its sharp tips while the top of the head stays round.
const hairPts = () => {
  const tip = (x, y) => [[x, y], [x, y]];
  return jitter(
    [
      [232, 56], [168, 60], [124, 102], [106, 158], [102, 214], [110, 262],
      ...tip(96, 330), [126, 288],
      ...tip(140, 356), [162, 292],
      ...tip(182, 348), [198, 288],
      ...tip(214, 322), [220, 262],
      [218, 206], [212, 148], [234, 98],
    ],
    3,
    21
  ).flat().length ? jitter(
    [
      [232, 56], [168, 60], [124, 102], [106, 158], [102, 214], [110, 262],
      ...tip(96, 330), [126, 288],
      ...tip(140, 356), [162, 292],
      ...tip(182, 348), [198, 288],
      ...tip(214, 322), [220, 262],
      [218, 206], [212, 148], [234, 98],
    ],
    3,
    21
  ) : [];
};

const facePts = () =>
  jitter(blobEllipse(292, 226, 118, 116, { steps: 14, wobble: 0.04, seed: 5 }), 4, 9);

const bodyPts = () =>
  jitter(
    [
      [250, 300], [296, 306], [318, 336], [312, 372], [296, 392],
      [262, 400], [232, 388], [222, 356], [226, 322],
    ],
    4,
    31
  );

// the spiky mitt. it is not a hand. it has never been a hand.
const handPts = () =>
  jitter([[306, 316], [364, 300], [340, 332], [382, 336], [344, 356], [370, 386], [322, 366], [304, 348]], 3, 41);

// ---------------------------------------------------------------------------
// eyes — the whole personality lives here
// ---------------------------------------------------------------------------

const EYE_L = { cx: 224, cy: 158, rx: 56, ry: 62, rot: -0.16 };
const EYE_R = { cx: 340, cy: 140, rx: 68, ry: 74, rot: 0.08 };

function eyeWhite(e, seed) {
  return smoothPath(jitter(blobEllipse(e.cx, e.cy, e.rx, e.ry, { steps: 14, wobble: 0.03, seed, rotate: e.rot }), 3, seed + 1));
}

/**
 * Pupils sit LEFT of centre in both eyes — canon: he looks slightly to the left
 * of whoever is looking at him.
 */
function pupil(e, { dx = -0.28, dy = 0.02, scale = 1 } = {}) {
  const cx = e.cx + e.rx * dx;
  const cy = e.cy + e.ry * dy;
  return smoothPath(blobEllipse(cx, cy, 17 * scale, 24 * scale, { steps: 12, wobble: 0.05, seed: 77 }));
}

function eyes(mood) {
  const out = [];
  const both = [EYE_L, EYE_R];

  if (mood === 'closed' || mood === 'blink') {
    both.forEach((e, i) => {
      out.push(path(smoothPath(jitter(blobEllipse(e.cx, e.cy, e.rx, e.ry, { steps: 14, wobble: 0.03, seed: 13 + i }), 3, 4), { closed: true }), { fill: C.cream, stroke: C.ink, width: S }));
      out.push(path(polyPath([[e.cx - e.rx * 0.8, e.cy], [e.cx + e.rx * 0.8, e.cy - 6]], false), { stroke: C.ink, width: S }));
    });
    return out.join('');
  }

  if (mood === 'x') {
    both.forEach((e, i) => {
      out.push(path(eyeWhite(e, 13 + i), { fill: C.white, stroke: C.ink, width: S }));
      const r = e.rx * 0.62;
      out.push(path(polyPath([[e.cx - r, e.cy - r], [e.cx + r, e.cy + r]], false), { stroke: C.ink, width: S + 4 }));
      out.push(path(polyPath([[e.cx + r, e.cy - r], [e.cx - r, e.cy + r]], false), { stroke: C.ink, width: S + 4 }));
    });
    return out.join('');
  }

  if (mood === 'spiral') {
    both.forEach((e, i) => {
      out.push(path(eyeWhite(e, 13 + i), { fill: C.white, stroke: C.ink, width: S }));
      let d = `M${e.cx},${e.cy}`;
      for (let t = 0; t < 26; t++) {
        const a = t * 0.62;
        const r = t * (e.rx / 30);
        d += `L${(e.cx + Math.cos(a) * r).toFixed(1)},${(e.cy + Math.sin(a) * r * 0.95).toFixed(1)}`;
      }
      out.push(path(d, { stroke: C.ink, width: 9 }));
    });
    return out.join('');
  }

  // whites first
  both.forEach((e, i) => out.push(path(eyeWhite(e, 13 + i), { fill: C.white, stroke: C.ink, width: S })));

  if (mood === 'laser') {
    both.forEach((e) => {
      const cx = e.cx - e.rx * 0.2;
      const cy = e.cy;
      out.push(path(smoothPath(blobEllipse(cx, cy, 22, 26, { steps: 12, wobble: 0.05, seed: 3 })), { fill: C.laser }));
      out.push(path(smoothPath(blobEllipse(cx - 4, cy - 4, 10, 12, { steps: 10, wobble: 0.05, seed: 4 })), { fill: C.laserGlow }));
    });
  } else if (mood === 'side') {
    // pupils shoved to the far left, then a heavy lid dropped over the top of
    // each eye — half-closed, but you can still see exactly where he is looking.
    both.forEach((e) => out.push(path(pupil(e, { dx: -0.58, dy: 0.1 }), { fill: C.ink })));
    both.forEach((e, i) => {
      const lidTop = e.cy - e.ry * 1.25;
      const lidBottom = e.cy - e.ry * 0.1;
      out.push(
        path(
          smoothPath(jitter([
            [e.cx - e.rx * 1.05, lidBottom + 8],
            [e.cx - e.rx * 0.5, lidTop],
            [e.cx + e.rx * 0.5, lidTop],
            [e.cx + e.rx * 1.05, lidBottom - 14],
          ], 3, 90 + i), { closed: true }),
          { fill: C.cream, stroke: C.ink, width: S }
        )
      );
    });
  } else if (mood === 'wide') {
    both.forEach((e) => out.push(path(pupil(e, { dx: -0.18, scale: 0.62 }), { fill: C.ink })));
  } else if (mood === 'derp') {
    out.push(path(pupil(EYE_L, { dx: -0.5, dy: 0.3, scale: 0.85 }), { fill: C.ink }));
    out.push(path(pupil(EYE_R, { dx: 0.18, dy: -0.28, scale: 1.05 }), { fill: C.ink }));
  } else if (mood === 'money') {
    both.forEach((e) => {
      out.push(strokeText('$', { x: e.cx, y: e.cy - e.ry * 0.55, size: e.ry * 1.15, align: 'center', fill: C.kek, ink: C.ink, seed: 33 }).svg);
    });
  } else if (mood === 'cry') {
    both.forEach((e) => out.push(path(pupil(e, { dx: -0.24, dy: -0.16 }), { fill: C.ink })));
    both.forEach((e) =>
      out.push(
        path(
          smoothPath(jitter(blobEllipse(e.cx - e.rx * 0.2, e.cy + e.ry * 1.05, 22, 34, { steps: 10, wobble: 0.06, seed: 8 }), 3, 6)),
          { fill: C.blue, stroke: C.ink, width: 8 }
        )
      )
    );
  } else {
    both.forEach((e) => out.push(path(pupil(e), { fill: C.ink })));
  }

  return out.join('');
}

// ---------------------------------------------------------------------------
// mouth + nose
// ---------------------------------------------------------------------------

function nose() {
  return path(polyPath(jitter([[300, 214], [332, 230], [300, 240]], 3, 55)), { fill: C.ink });
}

function mouth(kind) {
  if (kind === 'none') return '';
  if (kind === 'flat') return path(polyPath([[258, 282], [330, 288]], false), { fill: 'none', stroke: C.ink, width: S });
  if (kind === 'smirk') return path(smoothPath([[252, 280], [292, 292], [332, 268]], { closed: false }), { fill: 'none', stroke: C.ink, width: S });
  if (kind === 'frown') return path(smoothPath([[252, 296], [292, 274], [332, 296]], { closed: false }), { fill: 'none', stroke: C.ink, width: S });
  if (kind === 'drool') {
    return (
      path(polyPath(jitter([[248, 268], [336, 276], [300, 316], [258, 300]], 4, 61)), { fill: C.ink }) +
      path(smoothPath(jitter(blobEllipse(316, 330, 16, 30, { steps: 10, wobble: 0.08, seed: 12 }), 3, 2)), { fill: C.blue, stroke: C.ink, width: 8 })
    );
  }
  if (kind === 'big') {
    return (
      path(smoothPath(jitter(blobEllipse(292, 292, 62, 44, { steps: 12, wobble: 0.06, seed: 15 }), 4, 8)), { fill: C.ink }) +
      path(smoothPath(blobEllipse(294, 312, 34, 18, { steps: 10, wobble: 0.05, seed: 16 })), { fill: '#FF6E8A' })
    );
  }
  // the original: a mouth that is technically a triangle
  return path(polyPath(jitter([[254, 264], [330, 282], [262, 312]], 5, 71)), { fill: C.ink });
}

// ---------------------------------------------------------------------------
// legs
// ---------------------------------------------------------------------------

function legs() {
  // Two straight lines. No knees. Never any knees.
  const leg = (x, seed) => {
    const a = jitter([[x, 392], [x + 4, 452]], 3, seed);
    const b = jitter([[x, 392], [x + 4, 452]], 4, seed + 11);
    return (
      path(polyPath(a, false), { fill: 'none', stroke: C.ink, width: 26 }) +
      path(polyPath(b, false), { fill: 'none', stroke: C.red, width: 13 })
    );
  };
  const foot = (x, seed) =>
    inked(blobEllipse(x, 460, 30, 16, { steps: 10, wobble: 0.07, seed }), { fill: C.red, seed, secondPass: false });
  return leg(244, 81) + leg(288, 83) + foot(238, 85) + foot(294, 87);
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

function prop(name) {
  switch (name) {
    case 'shades':
      return (
        path(polyPath([[150, 120], [432, 96]], false), { stroke: C.ink, width: 16 }) +
        path(smoothPath(jitter(blobEllipse(228, 156, 78, 58, { steps: 12, wobble: 0.03, seed: 22 }), 3, 5)), { fill: '#101418', stroke: C.ink, width: S }) +
        path(smoothPath(jitter(blobEllipse(348, 142, 86, 64, { steps: 12, wobble: 0.03, seed: 23 }), 3, 6)), { fill: '#101418', stroke: C.ink, width: S }) +
        path(polyPath([[262, 120], [262, 120]], false), { stroke: C.ink, width: 14 }) +
        path(polyPath([[190, 140], [232, 178]], false), { stroke: '#43505c', width: 12 }) +
        path(polyPath([[312, 126], [356, 166]], false), { stroke: '#43505c', width: 12 })
      );
    case 'chain':
      return Array.from({ length: 9 }, (_, i) => {
        const x = 206 + i * 22;
        const y = 322 + Math.abs(4 - i) * -10 + 40;
        return path(smoothPath(blobEllipse(x, y, 12, 12, { steps: 8, wobble: 0.06, seed: 30 + i })), { fill: C.gold, stroke: C.ink, width: 6 });
      }).join('') +
        path(smoothPath(blobEllipse(258, 404, 20, 20, { steps: 10, wobble: 0.05, seed: 44 })), { fill: C.gold, stroke: C.ink, width: 7 });
    case 'brain':
      // fully polished. zero folds. zero regrets.
      return (
        path(polyPath([[252, 60], [252, 20]], false), { stroke: C.ink, width: 10 }) +
        path(smoothPath(jitter(blobEllipse(252, 40, 122, 40, { steps: 16, wobble: 0.02, seed: 51 }), 2, 7)), { fill: '#FFB3C7', stroke: C.ink, width: S }) +
        path(smoothPath(blobEllipse(206, 30, 38, 12, { steps: 10, wobble: 0.02, seed: 52 })), { fill: '#FFD9E2' })
      );
    case 'think':
      // hand on chin. nothing behind the hand.
      return (
        path(polyPath(jitter([[336, 372], [372, 344], [386, 360], [352, 392]], 3, 65)), { fill: C.red, stroke: C.ink, width: S }) +
        path(smoothPath(jitter(blobEllipse(338, 332, 42, 34, { steps: 12, wobble: 0.05, seed: 61 }), 4, 9)), { fill: C.red, stroke: C.ink, width: S }) +
        path(smoothPath(blobEllipse(392, 128, 34, 26, { steps: 10, wobble: 0.05, seed: 62 })), { fill: C.white, stroke: C.ink, width: 9 }) +
        path(smoothPath(blobEllipse(438, 82, 22, 17, { steps: 10, wobble: 0.05, seed: 63 })), { fill: C.white, stroke: C.ink, width: 8 }) +
        path(smoothPath(blobEllipse(470, 46, 13, 11, { steps: 8, wobble: 0.05, seed: 64 })), { fill: C.white, stroke: C.ink, width: 7 })
      );
    case 'arms':
      // Crossed. He has been standing like this since March. Two clean bars
      // and two mitts — any more geometry and it reads as a tangle.
      return (
        inked([[192, 336], [320, 366], [316, 390], [188, 360]], { fill: C.red, seed: 71, smooth: false }) +
        inked([[188, 378], [316, 334], [324, 356], [196, 400]], { fill: C.red, seed: 73, smooth: false }) +
        inked(blobEllipse(322, 350, 25, 21, { steps: 10, wobble: 0.07, seed: 75 }), { fill: C.red, seed: 75 }) +
        inked(blobEllipse(186, 352, 23, 19, { steps: 10, wobble: 0.07, seed: 76 }), { fill: C.red, seed: 76 })
      );
    case 'cap':
      // Sits on the crown, brim out to the right. Small — a big cap turns him
      // into a different character, and he is touchy about that.
      return (
        inked([[146, 92], [168, 44], [240, 20], [318, 34], [352, 78], [356, 100], [250, 88], [160, 100]], {
          fill: C.red,
          seed: 81,
        }) +
        inked([[336, 78], [432, 92], [446, 118], [330, 108]], { fill: C.redDark, seed: 82, smooth: false }) +
        inked(blobEllipse(244, 24, 17, 11, { steps: 10, wobble: 0.1, seed: 83 }), { fill: C.redDark, seed: 83 })
      );
    case 'coffee':
      return (
        path(polyPath([[360, 336], [420, 336], [410, 404], [370, 404]]), { fill: C.white, stroke: C.ink, width: S }) +
        path(polyPath([[420, 348], [446, 356], [438, 382], [414, 384]]), { fill: 'none', stroke: C.ink, width: S }) +
        path(smoothPath([[378, 320], [386, 300], [378, 284]], { closed: false }), { fill: 'none', stroke: C.ink, width: 8 }) +
        path(smoothPath([[402, 320], [410, 298], [402, 280]], { closed: false }), { fill: 'none', stroke: C.ink, width: 8 })
      );
    case 'diamond':
      return ['L', 'R'].map((side, i) => {
        const x = i ? 372 : 152;
        return (
          path(polyPath([[x - 34, 340], [x + 34, 340], [x + 18, 312], [x - 18, 312]]), { fill: C.wethLight, stroke: C.ink, width: 9 }) +
          path(polyPath([[x - 34, 340], [x + 34, 340], [x, 386]]), { fill: C.weth, stroke: C.ink, width: 9 })
        );
      }).join('');
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {'normal'|'laser'|'x'|'closed'|'side'|'wide'|'derp'|'cry'|'money'|'spiral'} o.eyes
 * @param {'tri'|'big'|'flat'|'smirk'|'frown'|'drool'|'none'} o.mouth
 * @param {string[]} o.props
 * @param {string|null} o.background  fill for the void, or null for transparent
 * @param {string|null} o.caption     pixel-ish caption across the bottom
 */
function kevinLayers({
  eyes: eyeMood = 'normal',
  mouth: mouthKind = 'tri',
  props = [],
  shade = false,
  background = C.void,
  caption = null,
  captionColor = C.ink,
  bleed = false,
} = {}) {
  const behind = props.filter((p) => ['brain', 'diamond'].includes(p));
  const front = props.filter((p) => !behind.includes(p));

  // Named groups so an animator can move the parts independently — the head
  // bobs, the hair lags behind it, the mitt waves, the eyes dart.
  const layers = [
    background ? `<rect x="-8" y="-8" width="528" height="528" fill="${background}"/>` : '',
    group('k-behind', behind.map(prop).join('')),
    group('k-legs', legs()),
    group('k-body', inked(bodyPts(), { fill: C.red, seed: 3, shade })),
    // the loose mitt only shows when the arms aren't folded over it
    props.includes('arms') ? '' : group('k-hand', inked(handPts(), { fill: C.red, seed: 4, smooth: false })),
    group(
      'k-head',
      group('k-skull', inked(headPts(), { fill: C.red, seed: 5, shade })) +
        group('k-face', inked(facePts(), { fill: C.cream, seed: 6, shade })) +
        group('k-hair', inked(hairPts(), { fill: C.red, seed: 7, shade })) +
        group('k-eyes', eyes(eyeMood)) +
        group('k-nose', nose()) +
        group('k-mouth', mouth(mouthKind))
    ),
    group('k-props', front.map(prop).join('')),
    caption
      ? strokeText(caption, {
          x: 256,
          y: bleed ? 448 : 442,
          size: Math.min(52, 3400 / Math.max(5, caption.length * 8)),
          align: 'center',
          fill: captionColor,
          ink: C.ink,
          seed: 17,
        }).svg
      : '',
  ];

  return layers.filter(Boolean).join('\n');
}

/**
 * Fractal-noise displacement over every edge at once. Vector paths are too
 * even to read as hand-drawn no matter how much you jitter the control
 * points — this puts the waver *between* the points, which is where a real
 * unsteady hand puts it.
 */
let roughId = 0;
function roughFilter(id, { scale = 5, frequency = 0.019, seed = 4 } = {}) {
  return (
    `<filter id="${id}" x="-12%" y="-12%" width="124%" height="124%" filterUnits="objectBoundingBox">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" seed="${seed}" result="noise"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`
  );
}

/** Kevin as a standalone SVG document. */
export function kevin(opts = {}) {
  const size = opts.size ?? 512;
  const rough = opts.rough !== false;
  const id = `kv-rough-${roughId++}`;
  const body = kevinLayers(opts);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">`,
    `<title>Kevin</title>`,
    rough ? `<defs>${roughFilter(id, opts.roughness || {})}</defs>` : '',
    rough ? `<g filter="url(#${id})">${body}</g>` : body,
    `</svg>`,
  ].join('\n');
}

/** Kevin as a nestable <g>, for banners, coins and composites. */
export function kevinGroup(opts = {}, { x = 0, y = 0, scale = 1 } = {}) {
  const rough = opts.rough !== false;
  const id = `kv-rough-${roughId++}`;
  const body = kevinLayers(opts);
  const inner = rough
    ? `<defs>${roughFilter(id, opts.roughness || {})}</defs><g filter="url(#${id})">${body}</g>`
    : body;
  return `<g transform="translate(${x},${y}) scale(${scale})">${inner}</g>`;
}
