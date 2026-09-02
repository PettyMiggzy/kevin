// Kevin: the character. One 64x64 pixel grid, drawn from primitives so that
// every variant (laser eyes, hoodie, GME jacket, WETH halo) reuses the same body.
import { Canvas } from './pixel.mjs';

export const P = {
  ink: '#0a1a0c',
  skin: '#57d15b',
  skinLt: '#8ff08d',
  skinDk: '#2f9c3d',
  skinDp: '#1d6b2b',
  belly: '#c2f9b6',
  white: '#ffffff',
  mouth: '#2a0a12',
  tongue: '#ff7fa0',
  gold: '#ffd23f',
  goldDk: '#c8961b',
  red: '#e6272c',
  redDk: '#8f1215',
  eth: '#a8b0d0',
  ethDk: '#6b7396',
  ethLt: '#e2e6f5',
  laser: '#ff2b4a',
  laserLt: '#ffd0d8',
  kek: '#3ddc4a',
  shadow: '#06120a',
};

export const SIZE = 64;

/**
 * @param {object} o
 * @param {'base'|'laser'|'hoodie'|'gme'|'weth'|'chad'} o.variant
 * @param {number} o.bob      vertical body offset in pixels
 * @param {number} o.blink    0 = open, 1 = fully closed
 * @param {number} o.wave     0 = arms down, 1 = right arm fully raised
 * @param {number} o.look     -1..1 horizontal pupil shift
 */
export function drawKevin({ variant = 'base', bob = 0, blink = 0, wave = 0, look = 0, mouth = 'grin' } = {}) {
  const c = new Canvas(SIZE, SIZE);
  const y = (v) => v + bob;

  // ---- feet ----------------------------------------------------------------
  c.ellipse(23, y(58), 7, 4, P.skinDk);
  c.ellipse(41, y(58), 7, 4, P.skinDk);
  c.ellipse(23, y(57), 6, 3, P.skin);
  c.ellipse(41, y(57), 6, 3, P.skin);

  // ---- body ----------------------------------------------------------------
  c.ellipse(32, y(45), 15, 13, P.skinDk);
  c.ellipse(31, y(44), 14, 12, P.skin);
  c.ellipse(32, y(48), 10, 8, P.belly);
  c.ellipse(32, y(47), 9, 7, P.belly);

  // ---- arms ----------------------------------------------------------------
  const waveLift = Math.round(wave * 14);
  c.ellipse(13, y(45), 6, 5, P.skinDk);
  c.ellipse(13, y(44), 5, 4, P.skin);
  c.ellipse(51, y(45 - waveLift), 6, 5, P.skinDk);
  c.ellipse(51, y(44 - waveLift), 5, 4, P.skin);
  if (wave > 0.15) {
    // forearm connecting the raised hand back to the shoulder
    c.line(46, y(46), 51, y(45 - waveLift), P.skinDk, 5);
    c.line(46, y(45), 51, y(44 - waveLift), P.skin, 3);
  }

  // ---- head ----------------------------------------------------------------
  c.ellipse(32, y(24), 20, 18, P.skinDk);
  c.ellipse(31, y(23), 19, 17, P.skin);
  // glossy shine, top-left
  c.ellipse(20, y(13), 4, 3, P.skinLt);
  c.ellipse(26, y(10), 2, 1, P.skinLt);

  // ---- eyes ----------------------------------------------------------------
  const eye = (ex) => {
    c.ellipse(ex, y(21), 8, 9, P.ink);
    if (blink > 0.8) {
      c.ellipse(ex, y(21), 7, 8, P.skin);
      c.rect(ex - 7, y(21), ex + 7, y(22), P.ink);
      return;
    }
    const lidCut = Math.round(blink * 8);
    c.ellipse(ex, y(21), 7, 8, P.white);
    const px = ex + Math.round(look * 3) + (ex < 32 ? 1 : -1);
    c.ellipse(px, y(23), 4, 4, P.ink);
    c.ellipse(px - 2, y(21), 1, 1, P.white);
    if (lidCut > 0) {
      c.ellipse(ex, y(21 - 9 + lidCut / 2), 8, lidCut, P.skin, { clip: 'existing' });
      c.rect(ex - 8, y(12), ex + 8, y(12 + lidCut - 9), P.skin);
    }
  };
  eye(22);
  eye(42);

  // ---- mouth ---------------------------------------------------------------
  if (mouth === 'grin' || mouth === 'open') {
    const ry = mouth === 'open' ? 7 : 5;
    c.ellipse(32, y(35), 11, ry, P.ink);
    c.ellipse(32, y(34), 10, ry - 1, P.mouth);
    c.rect(21, y(30), 43, y(33), P.skin); // flatten the top edge into a grin
    c.ellipse(32, y(34), 10, ry - 1, P.mouth, { clip: 'existing' });
    c.rect(22, y(34), 42, y(35), P.white); // teeth
    c.ellipse(32, y(38 + (mouth === 'open' ? 1 : 0)), 5, 2, P.tongue);
    c.line(21, y(33), 24, y(31), P.ink, 2);
    c.line(43, y(33), 40, y(31), P.ink, 2);
  } else if (mouth === 'flat') {
    c.rect(26, y(35), 38, y(36), P.ink);
  } else if (mouth === 'o') {
    c.ellipse(32, y(36), 5, 5, P.ink);
    c.ellipse(32, y(36), 4, 4, P.mouth);
    c.ellipse(32, y(38), 3, 2, P.tongue);
  }

  // ---- variants ------------------------------------------------------------
  if (variant === 'laser') {
    // angry brows + beams shooting out to the frame edge
    c.line(13, y(11), 29, y(15), P.ink, 3);
    c.line(51, y(11), 35, y(15), P.ink, 3);
    for (const ex of [22, 42]) {
      c.ellipse(ex, y(23), 4, 4, P.laser);
      c.ellipse(ex, y(23), 2, 2, P.laserLt);
      c.line(ex, y(23), ex + (ex < 32 ? -22 : 22), y(2), P.laser, 3);
      c.line(ex, y(23), ex + (ex < 32 ? -22 : 22), y(2), P.laserLt, 1);
    }
  }

  if (variant === 'hoodie') {
    // hood ring around the head + body hoodie with drawstrings
    for (let a = 0; a < 360; a += 2) {
      const r = (a * Math.PI) / 180;
      c.set(32 + Math.cos(r) * 21, y(24) + Math.sin(r) * 19, P.kek);
      c.set(32 + Math.cos(r) * 22, y(24) + Math.sin(r) * 20, P.skinDp);
    }
    c.rect(11, y(40), 53, y(44), null);
    c.ellipse(32, y(48), 15, 11, P.kek);
    c.ellipse(32, y(47), 14, 10, P.kek);
    c.ellipse(32, y(50), 8, 6, P.skinDp);
    c.rect(30, y(40), 31, y(48), P.skinDp);
    c.rect(34, y(40), 35, y(48), P.skinDp);
    c.text('KEK', 25, y(52), P.ink, { spacing: 1 });
  }

  if (variant === 'gme') {
    // red jacket + a green stonks arrow behind the shoulder
    c.ellipse(32, y(48), 15, 11, P.redDk);
    c.ellipse(32, y(47), 14, 10, P.red);
    c.ellipse(32, y(48), 6, 9, P.belly);
    c.line(46, y(30), 60, y(16), P.kek, 3);
    c.line(60, y(16), 54, y(16), P.kek, 3);
    c.line(60, y(16), 60, y(22), P.kek, 3);
    c.text('GME', 25, y(50), P.white, { spacing: 1 });
  }

  if (variant === 'weth') {
    // ETH diamond floating above the head
    const dx = 32;
    const dy = y(2);
    for (let i = 0; i <= 7; i++) c.rect(dx - i, dy + i, dx + i, dy + i, i % 2 ? P.eth : P.ethLt);
    for (let i = 0; i <= 5; i++) c.rect(dx - (5 - i), dy + 8 + i, dx + (5 - i), dy + 8 + i, P.ethDk);
    c.ellipse(32, y(48), 12, 8, P.ethDk);
    c.ellipse(32, y(47), 11, 7, P.eth);
    c.text('WETH', 22, y(45), P.ethLt, { spacing: 1 });
  }

  if (variant === 'chad') {
    // shades + gold chain
    c.rect(11, y(17), 53, y(19), P.ink);
    c.roundRect(12, y(16), 30, y(28), 2, P.ink);
    c.roundRect(34, y(16), 52, y(28), 2, P.ink);
    c.line(14, y(19), 22, y(26), '#3d4a52', 2);
    c.line(36, y(19), 44, y(26), '#3d4a52', 2);
    for (let i = 0; i < 9; i++) c.ellipse(20 + i * 3, y(40 + Math.abs(4 - i)), 1.6, 1.6, P.gold);
    c.ellipse(32, y(46), 3, 3, P.goldDk);
    c.ellipse(32, y(46), 2, 2, P.gold);
  }

  c.outline(P.ink);
  return c;
}

/** Head-only crop, used for the logo mark, favicon and coin faces. */
export function drawKevinHead(opts = {}) {
  const full = drawKevin({ ...opts, bob: 0 });
  return full.crop(10, 4, 54, 44);
}
