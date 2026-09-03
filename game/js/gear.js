// The things Kevin actually holds, and the dressing that makes the room a room.
//
// Built from boxes rather than downloaded, for one reason: the barbell ends up
// eighteen inches from the camera during a bench set. A smooth photoreal bar in
// a blocky character's hands is where a style mismatch is least forgivable, so
// anything he touches is built to match him.
import * as THREE from 'three';

const box = (w, h, d, colour, mat) => {
  const g = new THREE.BoxGeometry(w, h, d);
  const c = new THREE.Color(colour);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return new THREE.Mesh(g, mat);
};

/** A loaded bar: knurled shaft, collars, and a plate stack each end. */
export function makeBarbell(mat, { length = 2.0, plates = 2 } = {}) {
  const g = new THREE.Group();
  g.add(box(length, 0.055, 0.055, '#9AA0A8', mat));
  for (const sx of [-1, 1]) {
    g.add(box(0.07, 0.10, 0.10, '#6E747C', mat)).position.x = sx * (length / 2 - 0.30);
    for (let i = 0; i < plates; i++) {
      const r = 0.24 - i * 0.05;
      const p = box(0.065, r * 2, r * 2, i === 0 ? '#1E1E22' : '#B0141B', mat);
      p.position.x = sx * (length / 2 - 0.20 + i * 0.075);
      g.add(p);
    }
  }
  return g;
}

/** One dumbbell, sized to sit in a voxel fist. */
export function makeDumbbell(mat) {
  const g = new THREE.Group();
  g.add(box(0.055, 0.055, 0.30, '#9AA0A8', mat));
  for (const sz of [-1, 1]) {
    const bell = box(0.17, 0.17, 0.10, '#1E1E22', mat);
    bell.position.z = sz * 0.14;
    g.add(bell);
  }
  return g;
}

// --- room dressing ----------------------------------------------------------

/**
 * Canvas textures rather than more geometry. A painted floor and a signed wall
 * do more for "this is a gym" than another rack does, and they cost one texture
 * each instead of a draw call each.
 */
function canvasTexture(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

/** Interlocking rubber floor tiles, the speckled kind every gym has. */
export const floorTexture = () =>
  canvasTexture(128, 128, (x, w, h) => {
    x.fillStyle = '#4A4A50';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = ['#5A5A62', '#3E3E44', '#6A6A72'][i % 3];
      x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    x.strokeStyle = '#2C2C31';
    x.lineWidth = 4;
    x.strokeRect(2, 2, w - 4, h - 4);
  }, { repeat: [16, 13] });

/** The lifting platform: a different tile, and a colour that says "stand here". */
export const platformTexture = () =>
  canvasTexture(128, 128, (x, w, h) => {
    x.fillStyle = '#2F6F4A';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      x.fillStyle = i % 2 ? '#37805604' : '#2769420A';
      x.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    x.strokeStyle = '#245A3B';
    x.lineWidth = 5;
    x.strokeRect(2, 2, w - 4, h - 4);
  }, { repeat: [6, 4] });

/**
 * A painted wall sign. Gyms are covered in them and they carry the brand
 * without a single extra polygon beyond the quad they sit on.
 */
export function signTexture(lines, { bg = '#E8232B', fg = '#FFE500', size = 96 } = {}) {
  const w = 1024;
  const h = 256;
  return canvasTexture(w, h, (x) => {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = fg;
    x.lineWidth = 10;
    x.strokeRect(14, 14, w - 28, h - 28);
    x.fillStyle = fg;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const step = h / (lines.length + 1);
    lines.forEach((line, i) => {
      x.font = `700 ${i === 0 ? size : size * 0.52}px ui-monospace, Menlo, monospace`;
      x.fillText(line, w / 2, step * (i + 1));
    });
  });
}

/** Wall-mounted mirror: a cool dark panel with a bright frame. Not reflective —
 *  a real reflection costs a second render pass and reads no better at this
 *  size than a tinted panel does. */
export function mirrorPanel(mat, w, h) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.06, '#8FA6B8', mat));
  const frame = box(w + 0.16, h + 0.16, 0.04, '#D8D2C4', mat);
  frame.position.z = -0.03;
  g.add(frame);
  return g;
}

/** Strip light: a bright bar under a dark housing. */
export function stripLight(mat, len) {
  const g = new THREE.Group();
  g.add(box(len, 0.10, 0.28, '#FFFDF0', mat));
  const housing = box(len + 0.12, 0.12, 0.36, '#3A3A40', mat);
  housing.position.y = 0.10;
  g.add(housing);
  return g;
}
