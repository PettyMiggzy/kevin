// Tiny pixel-art canvas: draw with primitives, export as run-length-encoded SVG.
import { FONT, GLYPH_W, GLYPH_H } from './font5x7.mjs';

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(null);
  }

  clone() {
    const c = new Canvas(this.w, this.h);
    c.px = this.px.slice();
    return c;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.inside(x, y)) this.px[y * this.w + x] = color;
  }

  get(x, y) {
    return this.inside(x, y) ? this.px[y * this.w + x] : null;
  }

  /** Draw only where a pixel already exists (shading without changing silhouette). */
  shade(x, y, color) {
    if (this.get(x, y) !== null) this.set(x, y, color);
  }

  rect(x0, y0, x1, y1, color) {
    for (let y = Math.round(y0); y <= Math.round(y1); y++)
      for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, color);
    return this;
  }

  ellipse(cx, cy, rx, ry, color, { clip = null } = {}) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / (rx + 0.5);
        const dy = (y + 0.5 - cy) / (ry + 0.5);
        if (dx * dx + dy * dy <= 1) {
          if (clip === 'existing' && this.get(x, y) === null) continue;
          this.set(x, y, color);
        }
      }
    }
    return this;
  }

  roundRect(x0, y0, x1, y1, r, color) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
        const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
        if (dx * dx + dy * dy <= r * r + r * 0.6) this.set(x, y, color);
      }
    }
    return this;
  }

  /** Thick line, Bresenham-ish with a square brush. */
  line(x0, y0, x1, y1, color, thickness = 1) {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) * 2 + 1;
    const t = Math.max(1, thickness);
    const o = Math.floor((t - 1) / 2);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      for (let a = 0; a < t; a++)
        for (let b = 0; b < t; b++) this.set(Math.round(x) - o + a, Math.round(y) - o + b, color);
    }
    return this;
  }

  /** Erase a region back to transparent. */
  clear(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, null);
    return this;
  }

  /** Replace every pixel of one color with another. */
  swap(from, to) {
    for (let i = 0; i < this.px.length; i++) if (this.px[i] === from) this.px[i] = to;
    return this;
  }

  /** Grow a 1px border of `color` around every filled pixel. */
  outline(color, { diagonal = true } = {}) {
    const src = this.px.slice();
    const at = (x, y) => (this.inside(x, y) ? src[y * this.w + x] : null);
    const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const n8 = [...n4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const nb = diagonal ? n8 : n4;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (at(x, y) !== null) continue;
        if (nb.some(([dx, dy]) => at(x + dx, y + dy) !== null)) this.set(x, y, color);
      }
    }
    return this;
  }

  /** Drop shadow: offset copy of the silhouette painted underneath. */
  dropShadow(dx, dy, color) {
    const src = this.px.slice();
    for (let y = this.h - 1; y >= 0; y--) {
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x] === null) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (this.inside(nx, ny) && this.get(nx, ny) === null) this.set(nx, ny, color);
      }
    }
    return this;
  }


  /** Return a new canvas containing the given inclusive box. */
  crop(x0, y0, x1, y1) {
    const c = new Canvas(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) c.set(x - x0, y - y0, this.get(x, y));
    return c;
  }

  /** Tight bounding box of non-transparent pixels, or null when empty. */
  bounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.get(x, y) !== null) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  /** Vertical mirror. */
  flipX() {
    const c = new Canvas(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) c.set(this.w - 1 - x, y, this.get(x, y));
    return c;
  }

  text(str, x, y, color, { spacing = 1, scale = 1 } = {}) {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const glyph = FONT[ch] || FONT['?'];
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (glyph[gy][gx] !== '#') continue;
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++)
              this.set(cx + gx * scale + sx, y + gy * scale + sy, color);
        }
      }
      cx += (GLYPH_W + spacing) * scale;
    }
    return this;
  }

  /** Paste another canvas on top, skipping its transparent pixels. */
  paste(other, ox = 0, oy = 0) {
    for (let y = 0; y < other.h; y++)
      for (let x = 0; x < other.w; x++) {
        const c = other.get(x, y);
        if (c !== null) this.set(x + ox, y + oy, c);
      }
    return this;
  }

  /** Horizontal run-length encoding -> compact SVG rects. */
  toSVG({ scale = 1, background = null, title = '', pad = 0, extra = '' } = {}) {
    const W = (this.w + pad * 2) * scale;
    const H = (this.h + pad * 2) * scale;
    const parts = [];
    for (let y = 0; y < this.h; y++) {
      let x = 0;
      while (x < this.w) {
        const c = this.get(x, y);
        if (c === null) { x++; continue; }
        let run = 1;
        while (x + run < this.w && this.get(x + run, y) === c) run++;
        parts.push(`<rect x="${x + pad}" y="${y + pad}" width="${run}" height="1" fill="${c}"/>`);
        x += run;
      }
    }
    const bg = background ? `<rect width="${this.w + pad * 2}" height="${this.h + pad * 2}" fill="${background}"/>` : '';
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${this.w + pad * 2} ${this.h + pad * 2}" shape-rendering="crispEdges">`,
      title ? `<title>${title}</title>` : '',
      bg,
      parts.join(''),
      extra,
      `</svg>`,
    ].filter(Boolean).join('\n');
  }
}

export const textWidth = (str, spacing = 1, scale = 1) =>
  str.length === 0 ? 0 : (str.length * (GLYPH_W + spacing) - spacing) * scale;
