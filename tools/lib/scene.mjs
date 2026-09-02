// Scene painting: skies, skylines, signage, props and speed lines, so Kevin
// can be dropped into a situation instead of standing on a colour.
//
// Everything here is parameterised — the sign text, the billboard, the speech
// bubble — so one scene template makes a hundred memes by changing strings.

import { smoothPath, polyPath, blobEllipse, jitter, path, rng } from './wobble.mjs';
import { strokeText, fitSize } from './letters.mjs';
import { kevinGroup, C } from './kevin-vector.mjs';

export const SKY = {
  top: '#2FA8F5',
  bottom: '#BFE8FF',
  cloud: '#FFFFFF',
  cloudShade: '#DCEEFB',
  city: '#2A3A55',
  cityLight: '#3C5175',
  road: '#5A5F6B',
  roadDark: '#464B56',
  line: '#F5E14A',
  money: '#7CC47F',
  moneyDark: '#4E8F55',
  copBody: '#12161F',
  copPanel: '#F2F4F8',
  steel: '#B9C0CC',
  steelDark: '#7C8header',
};
SKY.steelDark = '#7C8697';

const ink = (d, w = 7) => path(d, { fill: 'none', stroke: C.ink, width: w });

/** Blob with a black outline — the workhorse for every prop in here. */
export function shape(pts, fill, { width = 7, smooth = true, seed = 1, wobble = 3 } = {}) {
  const d = smooth ? smoothPath : polyPath;
  return (
    path(d(jitter(pts, wobble, seed * 3 + 1)), { fill }) +
    path(d(jitter(pts, wobble * 0.8, seed * 5 + 2)), { fill: 'none', stroke: C.ink, width })
  );
}

export function sky(w, h, horizon) {
  return (
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${SKY.top}"/><stop offset="1" stop-color="${SKY.bottom}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${horizon + 4}" fill="url(#sky)"/>`
  );
}

export function clouds(w, seed = 3) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < 6; i++) {
    const cx = 60 + r() * (w - 120);
    const cy = 50 + r() * 260;
    const s = 0.6 + r() * 0.9;
    const puff = (dx, dy, rx, ry) =>
      smoothPath(jitter(blobEllipse(cx + dx * s, cy + dy * s, rx * s, ry * s, { steps: 12, wobble: 0.08, seed: seed + i }), 3, i + 2));
    out +=
      path(puff(-60, 10, 60, 34), { fill: SKY.cloud }) +
      path(puff(10, -18, 74, 46), { fill: SKY.cloud }) +
      path(puff(74, 12, 56, 32), { fill: SKY.cloud }) +
      path(puff(20, 26, 70, 26), { fill: SKY.cloudShade });
  }
  return out;
}

export function skyline(w, horizon, { seed = 11, minH = 150, maxH = 380 } = {}) {
  const r = rng(seed);
  let out = '';
  let x = -40;
  while (x < w + 40) {
    const bw = 60 + r() * 110;
    const bh = minH + r() * (maxH - minH);
    const top = horizon - bh;
    out += shape(
      [[x, horizon], [x, top], [x + bw, top], [x + bw, horizon]],
      r() > 0.5 ? SKY.city : SKY.cityLight,
      { smooth: false, seed: x, wobble: 2, width: 5 }
    );
    // windows
    for (let wy = top + 22; wy < horizon - 24; wy += 34) {
      for (let wx = x + 14; wx < x + bw - 18; wx += 26) {
        if (r() > 0.55) out += path(polyPath([[wx, wy], [wx + 12, wy], [wx + 12, wy + 16], [wx, wy + 16]]), { fill: '#FFE07A' });
      }
    }
    x += bw + 6 + r() * 14;
  }
  return out;
}

export function road(w, h, horizon) {
  let out = shape([[-10, horizon], [w + 10, horizon], [w + 10, h + 10], [-10, h + 10]], SKY.road, {
    smooth: false,
    seed: 4,
    wobble: 2,
    width: 6,
  });
  // perspective dashes
  for (let i = 0; i < 7; i++) {
    const t = i / 7;
    const y = horizon + 40 + Math.pow(t, 1.7) * (h - horizon);
    const len = 60 + t * 190;
    const cx = w * 0.5 + (t - 0.5) * 220;
    out += path(polyPath([[cx - len / 2, y], [cx + len / 2, y + 6]], false), {
      fill: 'none',
      stroke: SKY.line,
      width: 8 + t * 12,
    });
  }
  return out;
}

/** Big roadside billboard on two posts. */
export function billboard(x, y, w, h, lines, { seed = 21, face = '#EDEFF2' } = {}) {
  const post = (px) => shape([[px, y + h], [px + 22, y + h], [px + 22, y + h + 210], [px, y + h + 210]], SKY.steelDark, { smooth: false, seed: px, wobble: 2, width: 6 });
  const text = lines
    .map((line, i) => {
      const size = fitSize(line.text, w - 90, { max: line.size || 96 });
      return strokeText(line.text, {
        x: x + w / 2,
        y: y + 34 + i * (h / lines.length),
        size,
        align: 'center',
        fill: line.fill || C.ink,
        ink: C.ink,
        seed: seed + i,
      }).svg;
    })
    .join('');
  return (
    post(x + w * 0.18) +
    post(x + w * 0.74) +
    shape([[x, y], [x + w, y - 10], [x + w, y + h], [x, y + h + 8]], face, { smooth: false, seed, wobble: 4, width: 9 }) +
    text
  );
}

/** Green highway sign, the kind with the arrows. */
export function highwaySign(x, y, w, rows, { seed = 31 } = {}) {
  const h = 42 + rows.length * 48;
  let out =
    shape([[x + w * 0.42, y + h], [x + w * 0.42 + 18, y + h], [x + w * 0.42 + 18, y + h + 230], [x + w * 0.42, y + h + 230]], SKY.steelDark, { smooth: false, seed, wobble: 2, width: 6 }) +
    shape([[x, y], [x + w, y - 6], [x + w, y + h], [x, y + h + 6]], '#1F7A45', { smooth: false, seed: seed + 1, wobble: 3, width: 8 });
  rows.forEach((t, i) => {
    const size = fitSize(t, w - 90, { max: 34 });
    out += strokeText(t, { x: x + 26, y: y + 30 + i * 48, size, fill: '#FFFFFF', ink: C.ink, weight: 0.18, seed: seed + i }).svg;
    const ay = y + 30 + i * 48 + size * 0.5;
    out += path(polyPath([[x + w - 54, ay], [x + w - 22, ay]], false), { fill: 'none', stroke: '#FFFFFF', width: 7 });
    out += path(polyPath([[x + w - 34, ay - 12], [x + w - 20, ay], [x + w - 34, ay + 12]]), { fill: '#FFFFFF' });
  });
  return out;
}

/** A held cardboard placard. */
export function placard(x, y, w, h, text, { seed = 41, rotate = -6 } = {}) {
  const size = fitSize(text, w - 34, { max: 46 });
  return (
    `<g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">` +
    shape([[x + w * 0.44, y + h], [x + w * 0.44 + 14, y + h], [x + w * 0.44 + 14, y + h + 120], [x + w * 0.44, y + h + 120]], '#B98A4E', { smooth: false, seed, wobble: 2, width: 6 }) +
    shape([[x, y], [x + w, y - 6], [x + w, y + h], [x, y + h + 6]], '#E8D3A6', { smooth: false, seed: seed + 1, wobble: 4, width: 8 }) +
    strokeText(text, { x: x + w / 2, y: y + h / 2 - size / 2, size, align: 'center', fill: C.red, ink: C.ink, seed: seed + 2 }).svg +
    `</g>`
  );
}

export function speechBubble(x, y, w, h, lines, { tail = [0.3, 1], seed = 51 } = {}) {
  const pts = blobEllipse(x + w / 2, y + h / 2, w / 2, h / 2, { steps: 18, wobble: 0.05, seed });
  const tx = x + w * tail[0];
  const ty = y + h * tail[1];
  return (
    shape([[tx - 30, ty - 10], [tx + 6, ty + 78], [tx + 40, ty - 14]], '#FFFFFF', { smooth: false, seed: seed + 1, wobble: 3, width: 8 }) +
    shape(pts, '#FFFFFF', { seed: seed + 2, wobble: 3, width: 8 }) +
    lines
      .map((l, i) => {
        const size = fitSize(l.text, w - 70, { max: l.size || 46 });
        return strokeText(l.text, {
          x: x + w / 2,
          y: y + h / 2 - (lines.length * 30) + i * 56,
          size,
          align: 'center',
          fill: l.fill || C.ink,
          ink: C.ink,
          seed: seed + 3 + i,
        }).svg;
      })
      .join('')
  );
}

export function moneyBill(cx, cy, { rot = 0, s = 1, seed = 61 } = {}) {
  const w = 84 * s;
  const h = 42 * s;
  return (
    `<g transform="rotate(${rot} ${cx} ${cy})">` +
    shape([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], SKY.money, { smooth: false, seed, wobble: 2.5, width: 5 }) +
    path(smoothPath(blobEllipse(cx, cy, w * 0.24, h * 0.34, { steps: 10, wobble: 0.08, seed: seed + 1 })), { fill: 'none', stroke: SKY.moneyDark, width: 4 }) +
    strokeText('$', { x: cx, y: cy - h * 0.3, size: h * 0.62, align: 'center', fill: SKY.moneyDark, ink: SKY.moneyDark, weight: 0.2, seed: seed + 2 }).svg +
    `</g>`
  );
}

/**
 * Scatter bills across the frame while keeping clear of `avoid` rectangles —
 * money flying over the billboard copy just reads as a mistake.
 */
export function billScatter(count, { w, h, avoid = [], seed = 61, x0 = 0, y0 = 0, x1 = null, y1 = null, minS = 0.6, maxS = 1.2 } = {}) {
  const r = rng(seed);
  const X1 = x1 ?? w;
  const Y1 = y1 ?? h;
  const clear = (x, y) => !avoid.some((a) => x > a[0] - 70 && x < a[2] + 70 && y > a[1] - 50 && y < a[3] + 50);
  let out = '';
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < count * 40) {
    const x = x0 + r() * (X1 - x0);
    const y = y0 + r() * (Y1 - y0);
    if (!clear(x, y)) continue;
    out += moneyBill(x, y, { rot: r() * 360, s: minS + r() * (maxS - minS), seed: seed + placed });
    placed++;
  }
  return out;
}

/** A heap of cash, for filling a cart. */
export function moneyPile(cx, cy, w, h, { seed = 65, count = 22 } = {}) {
  const r = rng(seed);
  let out = shape(
    [[cx - w / 2, cy + h / 2], [cx - w / 2 + 20, cy - h / 2], [cx + w / 2 - 16, cy - h / 2 - 10], [cx + w / 2, cy + h / 2]],
    SKY.money,
    { smooth: false, seed, wobble: 5, width: 6 }
  );
  for (let i = 0; i < count; i++) {
    out += moneyBill(cx - w / 2 + 30 + r() * (w - 60), cy - h / 2 + 10 + r() * (h - 20), {
      rot: -25 + r() * 50,
      s: 0.55 + r() * 0.45,
      seed: seed + i,
    });
  }
  return out;
}

/**
 * Shopping cart, side-on. `contents` is drawn after the basket fill but before
 * the mesh, so whatever is in it shows through the wire like it should.
 */
export function cart(x, y, w, h, { seed = 71, contents = '' } = {}) {
  const basket = [[x, y], [x + w, y - 14], [x + w - 46, y + h], [x + 42, y + h]];
  let out = '';
  // wheels
  for (const wx of [x + 74, x + w - 88]) {
    out += shape(blobEllipse(wx, y + h + 44, 30, 30, { steps: 12, wobble: 0.06, seed: seed + wx }), '#2B2F38', { seed: seed + wx, width: 7 });
    out += shape(blobEllipse(wx, y + h + 44, 12, 12, { steps: 10, wobble: 0.08, seed: seed + wx + 1 }), SKY.steel, { seed, width: 5 });
  }
  out += shape([[x + 44, y + h], [x + w - 46, y + h], [x + w - 60, y + h + 26], [x + 58, y + h + 26]], SKY.steelDark, { smooth: false, seed, wobble: 2, width: 6 });

  // basket, then whatever is riding in it
  out += shape(basket, '#E4E8EE', { smooth: false, seed: seed + 2, wobble: 3, width: 9 });
  if (contents) {
    const id = `cart${seed}`;
    out += `<clipPath id="${id}"><path d="${polyPath(jitter(basket, 3, seed * 3 + 1))}"/></clipPath>`;
    out += `<g clip-path="url(#${id})">${contents}</g>`;
  }

  // wire mesh over the top
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    out += ink(polyPath([[x + w * t, y - 14 * t], [x + 42 + (w - 88) * t, y + h]], false), 5);
  }
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    out += ink(polyPath([[x + 42 * t, y + h * t], [x + w - 46 * t, y - 14 + (h + 14) * t]], false), 5);
  }
  // rim last, so the mesh tucks under it
  out += path(polyPath(jitter(basket, 3, seed * 5 + 2)), { fill: 'none', stroke: C.ink, width: 10 });
  return out;
}

export function copCar(x, y, s = 1, { seed = 81 } = {}) {
  const W = 380 * s;
  const H = 150 * s;
  let out = '';
  out += shape([[x, y + H], [x + 30 * s, y + 52 * s], [x + 120 * s, y + 44 * s], [x + 175 * s, y], [x + 285 * s, y + 6 * s], [x + 330 * s, y + 56 * s], [x + W, y + 66 * s], [x + W, y + H]], SKY.copBody, { smooth: false, seed, wobble: 3, width: 8 });
  out += shape([[x + 46 * s, y + 56 * s], [x + 300 * s, y + 62 * s], [x + 300 * s, y + 96 * s], [x + 46 * s, y + 92 * s]], SKY.copPanel, { smooth: false, seed: seed + 1, wobble: 2, width: 6 });
  out += shape([[x + 130 * s, y + 42 * s], [x + 180 * s, y + 8 * s], [x + 268 * s, y + 12 * s], [x + 296 * s, y + 48 * s]], '#8FC6EC', { smooth: false, seed: seed + 2, wobble: 2, width: 6 });
  // light bar
  out += shape([[x + 176 * s, y - 4 * s], [x + 232 * s, y - 4 * s], [x + 232 * s, y - 30 * s], [x + 176 * s, y - 30 * s]], '#E02A2A', { smooth: false, seed: seed + 3, wobble: 2, width: 5 });
  out += shape([[x + 232 * s, y - 4 * s], [x + 288 * s, y - 2 * s], [x + 288 * s, y - 28 * s], [x + 232 * s, y - 30 * s]], '#2A7BE0', { smooth: false, seed: seed + 4, wobble: 2, width: 5 });
  for (const wx of [x + 92 * s, x + 306 * s]) {
    out += shape(blobEllipse(wx, y + H, 40 * s, 40 * s, { steps: 12, wobble: 0.05, seed: seed + wx }), '#1B1F27', { seed, width: 7 });
    out += shape(blobEllipse(wx, y + H, 17 * s, 17 * s, { steps: 10, wobble: 0.07, seed: seed + wx + 3 }), SKY.steel, { seed, width: 5 });
  }
  out += strokeText('POLICE', { x: x + 172 * s, y: y + 66 * s, size: 26 * s, align: 'center', fill: C.ink, ink: C.ink, weight: 0.18, seed: seed + 5 }).svg;
  return out;
}

/** Radiating action lines — cheap, and they carry the whole sense of speed. */
export function speedLines(cx, cy, { count = 26, inner = 320, outer = 1400, seed = 91, color = '#FFFFFF', opacity = 0.5 } = {}) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.1;
    const i0 = inner + r() * 120;
    const i1 = outer * (0.6 + r() * 0.6);
    out += path(
      polyPath([[cx + Math.cos(a) * i0, cy + Math.sin(a) * i0], [cx + Math.cos(a) * i1, cy + Math.sin(a) * i1]], false),
      { fill: 'none', stroke: color, width: 4 + r() * 12, extra: `opacity="${opacity}"` }
    );
  }
  return out;
}

/** Horizontal motion streaks, for things moving left-to-right. */
export function motionStreaks(x, y, w, count = 10, { seed = 95 } = {}) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const yy = y + r() * 240;
    const len = 90 + r() * 240;
    out += path(polyPath([[x - len + r() * 60, yy], [x + r() * 40, yy + 4]], false), {
      fill: 'none',
      stroke: '#FFFFFF',
      width: 5 + r() * 9,
      extra: 'opacity=".55"',
    });
  }
  return out;
}

export { kevinGroup, C };
