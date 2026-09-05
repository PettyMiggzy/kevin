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

// --- outside ----------------------------------------------------------------

/** Sky: a vertical gradient with a few flat clouds. Painted, not simulated. */
export const skyTexture = () =>
  canvasTexture(256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1E7FD6');
    g.addColorStop(0.55, '#63B4EC');
    g.addColorStop(1, '#BFE3F7');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#FFFFFF';
    const puff = (cx, cy, r) => { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
    for (const [cx, cy, r] of [[46, 54, 15], [62, 48, 20], [80, 55, 14],
                               [170, 38, 12], [186, 33, 17], [202, 39, 11],
                               [120, 92, 10], [134, 88, 14], [148, 93, 9]]) puff(cx, cy, r);
  });

/** Cracked concrete forecourt. */
export const concreteTexture = () =>
  canvasTexture(128, 128, (x, w, h) => {
    x.fillStyle = '#9E9A92';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      x.fillStyle = ['#AAA69E', '#928E86', '#B4B0A8'][i % 3];
      x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    x.strokeStyle = '#7E7A73';
    x.lineWidth = 2;
    x.strokeRect(0, 0, w, h);
    // A couple of cracks, so it reads as a yard rather than a tile.
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(10, 0); x.lineTo(34, 42); x.lineTo(22, 78); x.lineTo(48, 128);
    x.moveTo(96, 0); x.lineTo(84, 36); x.lineTo(104, 70);
    x.stroke();
  }, { repeat: [10, 10] });

/**
 * The facade sign: KEVIN'S GYM in heavy red block letters on concrete, the way
 * it is painted straight onto the wall of a unit rather than mounted on a board.
 */
export const facadeTexture = () =>
  canvasTexture(1024, 320, (x, w, h) => {
    x.fillStyle = '#C9C4BA';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      x.fillStyle = i % 2 ? '#00000008' : '#FFFFFF10';
      x.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    x.font = '700 150px ui-monospace, Menlo, monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.lineWidth = 22;
    x.strokeStyle = '#0B0B0B';
    x.strokeText("KEVIN'S GYM", w / 2, h / 2);
    x.fillStyle = '#E8232B';
    x.fillText("KEVIN'S GYM", w / 2, h / 2);
  });

/** The banner strung under the sign. */
export const bannerTexture = () =>
  canvasTexture(1024, 160, (x, w, h) => {
    x.fillStyle = '#F3E9C8';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#0B0B0B';
    x.lineWidth = 8;
    x.strokeRect(4, 4, w - 8, h - 8);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '700 74px ui-monospace, Menlo, monospace';
    x.fillStyle = '#0B0B0B';
    x.fillText('NO PAIN, ONLY ', w / 2 - 70, h / 2);
    const width = x.measureText('NO PAIN, ONLY ').width;
    x.fillStyle = '#E8232B';
    x.fillText('KEVIN!', w / 2 - 70 + width / 2 + 90, h / 2);
  });

/** A roadside billboard. Dark, so it reads against the sky. */
export const billboardTexture = () =>
  canvasTexture(768, 512, (x, w, h) => {
    x.fillStyle = '#141414';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#FFC531';
    x.lineWidth = 10;
    x.strokeRect(10, 10, w - 20, h - 20);
    x.textAlign = 'center';
    x.font = '700 62px ui-monospace, Menlo, monospace';
    x.fillStyle = '#FFC531';
    x.fillText('TRAIN LIKE KEVIN', w / 2, 92);
    x.fillText('OR CRY LATER', w / 2, h - 48);
  });

/** The hand-painted board by the door. */
export const boardTexture = () =>
  canvasTexture(512, 384, (x, w, h) => {
    x.fillStyle = '#D9CDB4';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#6B5B41';
    x.lineWidth = 12;
    x.strokeRect(6, 6, w - 12, h - 12);
    x.textAlign = 'center';
    x.font = '700 42px ui-monospace, Menlo, monospace';
    x.fillStyle = '#0B0B0B';
    x.fillText("WEIGHTS DON'T LIE,", w / 2, 110);
    x.fillStyle = '#E8232B';
    x.fillText('KEVIN', w / 2, 190);
    x.fillStyle = '#0B0B0B';
    x.fillText("DOESN'T EITHER", w / 2, 268);
  });

// --- the strip: market, restaurant, and something behind the fence ----------
// Everything below fills what used to be flat blue sky and empty concrete. All
// of it is canvas on a quad rather than geometry, for the same reason the gym
// signage is: a painted sign costs one texture, a modelled one costs a model.

/** Awning stripes. Two colours, because one is a tarpaulin and two is a market. */
export const awningTexture = (a = '#E8232B', b = '#FFF6C8') =>
  canvasTexture(128, 128, (x, w, h) => {
    for (let i = 0; i < 8; i++) {
      x.fillStyle = i % 2 ? a : b;
      x.fillRect((i * w) / 8, 0, w / 8, h);
    }
  }, { repeat: [3, 1] });

/** A stall's header board. Short words only — it is read at a glance, in 3D. */
export const stallTexture = (title, sub, bg = '#0B0B0B', fg = '#FFE500') =>
  canvasTexture(768, 224, (x, w, h) => {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = fg;
    x.lineWidth = 8;
    x.strokeRect(10, 10, w - 20, h - 20);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = fg;
    x.font = '700 76px ui-monospace, Menlo, monospace';
    x.fillText(title, w / 2, h * 0.40);
    x.fillStyle = '#FFFFFF';
    x.font = '700 34px ui-monospace, Menlo, monospace';
    x.fillText(sub, w / 2, h * 0.74);
  });

/** The fry house fascia. Kevin's own colours — this is his second job, not a
 *  franchise, and it should not look like anybody else's. */
export const fryHouseTexture = () =>
  canvasTexture(1024, 320, (x, w, h) => {
    x.fillStyle = '#E8232B';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#FFE500';
    x.fillRect(0, h - 34, w, 34);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#FFE500';
    x.font = '700 128px ui-monospace, Menlo, monospace';
    x.fillText("KEVIN'S", w / 2, h * 0.40);
    x.fillStyle = '#FFFFFF';
    x.font = '700 44px ui-monospace, Menlo, monospace';
    x.fillText("MCKEVIN'S  ·  OVER 3 SERVED", w / 2, h * 0.74);
  });

/** The menu above the counter. Prices in $KEVIN, which is a score. */
export const menuTexture = () =>
  canvasTexture(640, 448, (x, w, h) => {
    x.fillStyle = '#141418';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#FFE500';
    x.lineWidth = 8;
    x.strokeRect(8, 8, w - 16, h - 16);
    x.textAlign = 'left';
    x.textBaseline = 'middle';
    x.fillStyle = '#FFE500';
    x.font = '700 40px ui-monospace, Menlo, monospace';
    x.fillText('MENU', 40, 56);
    const rows = [['BURGER', '1'], ['FRIES', '1'], ['SHAKE', '1'], ['NUGGETS', '1']];
    x.font = '700 34px ui-monospace, Menlo, monospace';
    rows.forEach(([name, price], i) => {
      const y = 130 + i * 62;
      x.fillStyle = '#FFFFFF';
      x.fillText(name, 44, y);
      x.fillStyle = '#E8232B';
      x.textAlign = 'right';
      x.fillText(price, w - 44, y);
      x.textAlign = 'left';
    });
    x.fillStyle = '#8A8A8A';
    x.font = '700 22px ui-monospace, Menlo, monospace';
    x.fillText('ASK ABOUT THE FRYER', 44, h - 42);
  });

/**
 * A block in the skyline. Windows are drawn, not modelled — at forty metres
 * nobody can tell, and a lit grid on a box is what makes a box read as a
 * building rather than a box.
 */
export const windowsTexture = (wall = '#6E6A78', lit = '#FFE9A8', seed = 1) =>
  canvasTexture(128, 256, (x, w, h) => {
    x.fillStyle = wall;
    x.fillRect(0, 0, w, h);
    let s = seed * 9301;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 5; col++) {
        const r = rnd();
        x.fillStyle = r > 0.62 ? lit : r > 0.3 ? '#3A3A46' : '#2A2A34';
        x.fillRect(10 + col * 22, 12 + row * 20, 14, 12);
      }
    }
    x.fillStyle = '#00000022';
    x.fillRect(0, 0, w, 8);
  });

/**
 * The leaderboard, redrawn whenever the numbers move.
 *
 * Takes rows rather than reading state, so the same board can show local bests
 * today and server rankings later without touching the drawing.
 */
export const leaderTexture = (rows, { title = 'TOP OF THE GYM', note = '' } = {}) =>
  canvasTexture(768, 512, (x, w, h) => {
    x.fillStyle = '#0B0B0B';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#FFE500';
    x.lineWidth = 10;
    x.strokeRect(12, 12, w - 24, h - 24);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#FFE500';
    x.font = '700 46px ui-monospace, Menlo, monospace';
    x.fillText(title, w / 2, 62);

    x.textAlign = 'left';
    x.font = '700 30px ui-monospace, Menlo, monospace';
    rows.slice(0, 8).forEach((r, i) => {
      const y = 124 + i * 41;
      const you = r.you;
      x.fillStyle = you ? '#E8232B' : '#FFFFFF';
      // The row's own rank, not its position in the list — the last row is the
      // player, who may be ninth.
      x.fillText(String(r.rank ?? i + 1).padStart(2, ' '), 44, y);
      x.fillText(r.name.slice(0, 16).toUpperCase(), 100, y);
      x.textAlign = 'right';
      x.fillStyle = you ? '#E8232B' : '#FFE500';
      x.fillText(r.score, w - 48, y);
      x.textAlign = 'left';
    });

    if (note) {
      x.textAlign = 'center';
      x.fillStyle = '#7A7A7A';
      x.font = '700 20px ui-monospace, Menlo, monospace';
      x.fillText(note, w / 2, h - 40);
    }
  });
