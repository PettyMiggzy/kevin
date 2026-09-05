// Skins: the same drawings, wearing a different colour.
//
// This is the first thing in the game anybody can spend $KEVIN on and then be
// SEEN spending it on. The shop until now sold three consumables — a booster, a
// streak freeze, a decay slower — all of which are real mechanics and none of
// which anybody can look at. For a memecoin that is the wrong way round.
//
// It costs no new art. tools/sprite-parts.mjs measured Todd's palette off the
// sprites and wrote eight colourways into parts.json, and then nothing ever
// read them: the recolour was described in that file's header and never
// implemented. This is that implementation, moved to runtime.
//
// RUNTIME, not build time, on purpose. Baking eight atlases would ship eight
// times the sprite bytes to every player so that each one can look at one of
// them. The atlas is a few hundred KB and a canvas redraw is a millisecond, so
// the phone does the work instead of the network.
import * as THREE from 'three';

/**
 * Swap one palette entry for another.
 *
 * A PALETTE SWAP, not a hue rotation. Todd's art is four flat colours, and
 * hue-rotating flat colour that has been through JPEG turns his clean red to
 * mud — that is exactly what made the first PFP variants look brown and wrong.
 *
 * Two things this has to get right that a naive replace does not:
 *
 * NEAREST-COLOUR CLASSIFICATION, not a tolerance around red. The atlas came
 * from a JPEG, so his flat red is really a cloud of a few thousand near-reds,
 * and any fixed tolerance either misses the edge of the cloud or starts eating
 * the ink outline. Asking which of the four palette colours a pixel is closest
 * to has no threshold to get wrong.
 *
 * OFFSET PRESERVED, not flattened. Replacing every red pixel with one flat
 * colour throws away the antialiasing against the black outline, and the sprite
 * comes back with a hard jagged edge. Carrying each pixel's distance from the
 * source red over to the target keeps every soft edge exactly as soft.
 */
export function recolour(image, palette, target) {
  const W = image.naturalWidth ?? image.width;
  const H = image.naturalHeight ?? image.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const from = palette.red;
  // Classic Red is the source colour, so a swap to it is a no-op — but still
  // return a canvas, so the caller has one kind of thing to hold.
  if (target[0] === from[0] && target[1] === from[1] && target[2] === from[2]) return c;

  const img = ctx.getImageData(0, 0, W, H);
  const p = img.data;
  const entries = Object.values(palette);
  const redIndex = entries.indexOf(from);

  for (let k = 0; k < p.length; k += 4) {
    if (p[k + 3] < 8) continue;                      // transparent padding
    let best = 0, bestD = Infinity;
    for (let e = 0; e < entries.length; e++) {
      const q = entries[e];
      const d = (p[k] - q[0]) ** 2 + (p[k + 1] - q[1]) ** 2 + (p[k + 2] - q[2]) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best !== redIndex) continue;                 // cream, white and ink stay
    for (let ch = 0; ch < 3; ch++) {
      p[k + ch] = Math.max(0, Math.min(255, target[ch] + (p[k + ch] - from[ch])));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * The walk atlas in a given colourway, as a texture the sprite code can take.
 *
 * A CanvasTexture rather than a Texture because the source is a canvas we drew;
 * everything else about it has to match what TextureLoader would have produced,
 * or the sprite comes out in the wrong colour space and washes out.
 */
export function skinTexture(image, palette, target) {
  const tex = new THREE.CanvasTexture(recolour(image, palette, target));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * What each colourway costs, and what it is called on the shelf.
 *
 * Classic Red is not for sale: it is what you already are. The rest climb from
 * a couple of sessions' pay to something you have to actually save for, and
 * Void is the top because a black Kevin against a red-and-yellow gym is the
 * only one that reads as a flex from across the room.
 */
export const SKINS = [
  { name: 'Fryer Orange', cost: 150, blurb: 'The house colours. Smells of the fryer.' },
  { name: 'Kek Green', cost: 220, blurb: 'For the ones who were here early.' },
  { name: 'Cold Blue', cost: 260, blurb: 'Bear market cope, worn with pride.' },
  { name: 'Bubblegum', cost: 300, blurb: 'Unserious. That is the point.' },
  { name: 'Grape', cost: 340, blurb: 'Purple candle. Do not get attached.' },
  { name: 'Gold', cost: 600, blurb: 'Says more about you than a bag ever could.' },
  { name: 'Void', cost: 900, blurb: 'Nothing left to prove. Or to lose.' },
];

/** The one you start in, and the one a bad save falls back to. */
export const DEFAULT_SKIN = 'Classic Red';

/**
 * The contract address, which is also a palette.
 *
 * An Ethereum address is 40 hex characters, and a hex colour is six. So the CA
 * is six colours with four left over — not a metaphor, an identity. Anyone can
 * check it by chopping the address into sixes, which is the point: these are
 * the only skins in the game whose colour nobody has to take on trust.
 *
 * And they do a job beyond looking good. config.js explains why the address is
 * published before trading opens — "the group gets to memorise the real one
 * while it is calm, so on launch day, when the fakes appear, they already
 * know". Collecting these makes somebody stare at the real address for an hour.
 * A skin that teaches the CA is worth more than a skin that is merely a colour.
 */
export const CONTRACT = '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A';

/**
 * Chop an address into colours.
 *
 * Six slices of six characters, then the four that do not fit. The tail wraps
 * back onto the head to make a seventh — the address read as a ring rather than
 * a line — so nothing in it goes unused and the seventh is still derived, not
 * invented. Deterministic from the address alone, which is what makes it
 * checkable.
 */
export function contractColours(addr = CONTRACT) {
  const h = addr.replace(/^0x/i, '');
  const hex = [];
  for (let i = 0; i + 6 <= 36; i += 6) hex.push(h.slice(i, i + 6));
  hex.push(h.slice(36) + h.slice(0, 2));            // 284A + 63 — the ring closes
  return hex.map((c) => ({
    hex: c.toUpperCase(),
    rgb: [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)],
  }));
}

/**
 * The six, plus the tail you cannot buy.
 *
 * Named for their own hex, so the shelf spells the contract address out in
 * order and reading it top to bottom IS reading the CA. The seventh — the last
 * four, the digits people actually check a fake against — is not for sale at
 * any price: it unlocks when you own the other six. By then you know the
 * address by heart, which was always the real reward.
 */
export const CONTRACT_SKINS = contractColours().map((c, i) => ({
  name: c.hex,
  rgb: c.rgb,
  cost: i < 6 ? 180 + i * 90 : 0,
  tail: i === 6,
  blurb: i < 6
    ? `Bytes ${i * 3}–${i * 3 + 2} of the contract.`
    : 'The last four. Earned by owning the other six, never sold.',
}));
