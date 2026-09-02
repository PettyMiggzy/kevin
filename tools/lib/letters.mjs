// Marker-drawn lettering. Each glyph is a set of polylines on a 10x14 box, drawn
// as a fat black underlay with a colored stroke on top — the look of writing with
// a mouse, which is exactly how Kevin was made in the first place.
import { jitter, path } from './wobble.mjs';

const L = {
  A: [[[0, 14], [5, 0], [10, 14]], [[2, 9], [8, 9]]],
  B: [[[0, 14], [0, 0], [8, 0], [10, 3.5], [8, 7], [0, 7]], [[8, 7], [10, 10.5], [8, 14], [0, 14]]],
  C: [[[10, 2], [5, 0], [0, 4], [0, 10], [5, 14], [10, 12]]],
  D: [[[0, 0], [0, 14], [6, 14], [10, 10], [10, 4], [6, 0], [0, 0]]],
  E: [[[10, 0], [0, 0], [0, 14], [10, 14]], [[0, 7], [7, 7]]],
  F: [[[10, 0], [0, 0], [0, 14]], [[0, 7], [7, 7]]],
  G: [[[10, 2], [5, 0], [0, 4], [0, 10], [5, 14], [10, 12], [10, 8], [6, 8]]],
  H: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7], [10, 7]]],
  I: [[[5, 0], [5, 14]], [[2, 0], [8, 0]], [[2, 14], [8, 14]]],
  J: [[[10, 0], [10, 10], [5, 14], [0, 10]]],
  K: [[[0, 0], [0, 14]], [[10, 0], [0, 7]], [[3.5, 4.9], [10, 14]]],
  L: [[[0, 0], [0, 14], [10, 14]]],
  M: [[[0, 14], [0, 0], [5, 8], [10, 0], [10, 14]]],
  N: [[[0, 14], [0, 0], [10, 14], [10, 0]]],
  O: [[[5, 0], [0, 4], [0, 10], [5, 14], [10, 10], [10, 4], [5, 0]]],
  P: [[[0, 14], [0, 0], [10, 0], [10, 7], [0, 7]]],
  Q: [[[5, 0], [0, 4], [0, 10], [5, 14], [10, 10], [10, 4], [5, 0]], [[6, 10], [11, 15]]],
  R: [[[0, 14], [0, 0], [8, 0], [10, 3.5], [8, 7], [0, 7]], [[5, 7], [10, 14]]],
  S: [[[10, 2], [5, 0], [0, 3], [2, 7], [8, 7], [10, 11], [5, 14], [0, 12]]],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 14]]],
  U: [[[0, 0], [0, 10], [5, 14], [10, 10], [10, 0]]],
  V: [[[0, 0], [5, 14], [10, 0]]],
  W: [[[0, 0], [2.5, 14], [5, 5], [7.5, 14], [10, 0]]],
  X: [[[0, 0], [10, 14]], [[10, 0], [0, 14]]],
  Y: [[[0, 0], [5, 7], [10, 0]], [[5, 7], [5, 14]]],
  Z: [[[0, 0], [10, 0], [0, 14], [10, 14]]],
  0: [[[5, 0], [0, 4], [0, 10], [5, 14], [10, 10], [10, 4], [5, 0]], [[9, 3], [1, 11]]],
  1: [[[2, 3], [5, 0], [5, 14]], [[2, 14], [8, 14]]],
  2: [[[0, 3], [5, 0], [10, 3], [0, 14], [10, 14]]],
  3: [[[0, 1], [8, 0], [10, 4], [4, 7], [10, 10], [8, 14], [0, 13]]],
  4: [[[8, 14], [8, 0], [0, 10], [10, 10]]],
  5: [[[10, 0], [0, 0], [0, 6], [7, 6], [10, 10], [6, 14], [0, 13]]],
  6: [[[9, 1], [3, 3], [0, 9], [3, 14], [8, 13], [9, 9], [4, 7], [0, 9]]],
  7: [[[0, 0], [10, 0], [4, 14]]],
  8: [[[5, 0], [1, 3], [5, 7], [9, 3], [5, 0]], [[5, 7], [1, 11], [5, 14], [9, 11], [5, 7]]],
  9: [[[10, 6], [5, 8], [1, 5], [5, 0], [10, 4], [8, 12], [3, 14]]],
  '!': [[[5, 0], [5, 9]], [[5, 12.5], [5, 14]]],
  '?': [[[0, 3], [5, 0], [10, 3], [5, 8], [5, 10]], [[5, 13], [5, 14]]],
  '.': [[[5, 13], [5, 14]]],
  ',': [[[5, 12], [4, 16]]],
  "'": [[[5, 0], [5, 4]]],
  ':': [[[5, 3], [5, 5]], [[5, 10], [5, 12]]],
  '-': [[[1, 7], [9, 7]]],
  '/': [[[9, 0], [1, 14]]],
  '$': [[[9, 2], [4, 0], [0, 3], [2, 7], [8, 8], [10, 11], [5, 14], [0, 12]], [[5, -2], [5, 16]]],
  '%': [[[9, 1], [1, 13]], [[1, 1], [3, 1], [3, 4], [1, 4], [1, 1]], [[7, 10], [9, 10], [9, 13], [7, 13], [7, 10]]],
  '+': [[[5, 3], [5, 11]], [[1, 7], [9, 7]]],
  '*': [[[5, 2], [5, 12]], [[1, 4], [9, 10]], [[9, 4], [1, 10]]],
  '#': [[[3, 1], [1, 13]], [[8, 1], [6, 13]], [[0, 5], [10, 5]], [[0, 9], [10, 9]]],
  ' ': [],
};

const GW = 10;
const GH = 14;

/**
 * Draw text as hand-wobbled marker strokes.
 * Returns { svg, width, height } in the caller's coordinate space.
 */
export function strokeText(
  text,
  { x = 0, y = 0, size = 40, tracking = 0.34, weight = 0.22, ink = '#0B0B0B', fill = '#FFFFFF', wobble = 0.4, seed = 5, align = 'left' } = {}
) {
  const unit = size / GH;
  const advance = (GW + GW * tracking) * unit;
  const total = text.length * advance - GW * tracking * unit;
  const ox = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const stroke = Math.max(2, size * weight);

  const under = [];
  const over = [];
  [...text.toUpperCase()].forEach((ch, i) => {
    const glyph = L[ch] ?? L['?'];
    glyph.forEach((poly, j) => {
      const pts = jitter(
        poly.map(([px, py]) => [ox + i * advance + px * unit, y + py * unit]),
        size * wobble * 0.03,
        seed + i * 13 + j
      );
      const d = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
      under.push(path(d, { stroke: ink, width: stroke * 1.85 }));
      over.push(path(d, { stroke: fill, width: stroke }));
    });
  });

  return { svg: under.join('') + over.join(''), width: total, height: size, x: ox, y };
}

/** Largest size at which `text` fits inside `maxWidth`. */
export function fitSize(text, maxWidth, { max = 200, tracking = 0.34 } = {}) {
  const per = (GW + GW * tracking) / GH;
  const denom = text.length * per - (GW * tracking) / GH;
  return Math.min(max, denom > 0 ? maxWidth / denom : max);
}

export const textMetrics = (text, size, tracking = 0.34) => {
  const unit = size / GH;
  const advance = (GW + GW * tracking) * unit;
  return { width: text.length * advance - GW * tracking * unit, height: size };
};
