// Hand-drawn vector helpers. Everything is deterministic (seeded), so re-running
// the generator produces byte-identical SVGs and git diffs stay clean.

/** Mulberry32 — small deterministic PRNG. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nudge every point by up to `amount` px. This is where the wonk comes from. */
export function jitter(points, amount, seed = 1) {
  const r = rng(seed);
  return points.map(([x, y]) => [x + (r() * 2 - 1) * amount, y + (r() * 2 - 1) * amount]);
}

const n2 = (v) => Math.round(v * 100) / 100;

/**
 * Catmull-Rom through the given points, emitted as cubic beziers.
 * `tension` < 1 tightens the curve; closed loops wrap around.
 */
export function smoothPath(points, { closed = true, tension = 1 } = {}) {
  const p = points;
  const n = p.length;
  if (n < 3) return '';
  const at = (i) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${n2(p[0][0])},${n2(p[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${n2(c1[0])},${n2(c1[1])} ${n2(c2[0])},${n2(c2[1])} ${n2(p2[0])},${n2(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

/** Straight-line polygon, for the sharp bits (mouth, nose, hair tips). */
export function polyPath(points, closed = true) {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${n2(x)},${n2(y)}`).join('');
  return closed ? d + 'Z' : d;
}

/** An ellipse as a wobbly closed blob: `steps` points around the ellipse, jittered. */
export function blobEllipse(cx, cy, rx, ry, { steps = 12, wobble = 0, seed = 7, rotate = 0 } = {}) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 + rotate;
    const k = 1 + (r() * 2 - 1) * wobble;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/** Build an SVG <path> element string. */
export function path(d, { fill = 'none', stroke = null, width = 0, cls = '', extra = '' } = {}) {
  const attrs = [
    `d="${d}"`,
    `fill="${fill}"`,
    stroke ? `stroke="${stroke}"` : '',
    stroke ? `stroke-width="${width}"` : '',
    stroke ? 'stroke-linejoin="round" stroke-linecap="round"' : '',
    cls ? `class="${cls}"` : '',
    extra,
  ].filter(Boolean);
  return `<path ${attrs.join(' ')}/>`;
}
