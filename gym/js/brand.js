// Putting a bought asset kit into Kevin's colours.
//
// The crib was furnished out of a CC0 furniture kit and looked like a furniture
// kit: pale blue-grey units, peach wood, a salmon-pink armchair. Correct
// Scandinavian catalogue, wrong flat. Kevin's world is brand red, gold, cream
// and heavy black outline — a gym and a fry house — and the room he lives in
// cannot be the one place that looks like a showroom.
//
// The fix is not new models. The ENTIRE Kenney furniture kit is built from
// eleven flat colours, reused across a hundred props:
//
//   #dfeaec x7   #f3cca8 x5   #f9a39e x3   #96a7a7 x2   and seven singles
//
// So eleven entries in a lookup table repaint every piece of furniture in the
// flat at once — the same move skins.js makes on the sprite, one level up. No
// download, no re-modelling, and a kit anybody can recognise stops being
// recognisable.
import * as THREE from 'three';

/**
 * Kenney's palette on the left, Kevin's on the right.
 *
 * Chosen so the room reads dark with red and gold in it, which is what the gym
 * and the fry house already read as. The two upholstery colours — the sofa's
 * baby blue and the armchair's salmon — both go to brand red on purpose: in a
 * flat with one sofa and one armchair, matching them is what makes it look
 * furnished rather than assembled from spares.
 */
export const KEVIN_PALETTE = {
  '#dfeaec': '#33333B',   // the kit's neutral, on almost everything -> charcoal
  '#f3cca8': '#6B4A32',   // peach "wood" -> the dark wood the crib floor uses
  '#f9a39e': '#C7382F',   // salmon upholstery -> brand red
  '#a1bef0': '#C7382F',   // baby blue upholstery -> the same red, deliberately
  '#96a7a7': '#26262C',   // cool grey -> near black, for screens and casings
  '#f8fdfa': '#E8E2D4',   // white -> cream, so nothing is pure white
  '#fcffff': '#E8E2D4',
  '#daebe3': '#8A8F98',   // pale mint -> steel
  '#fff5ca': '#FFE07A',   // lampshade -> warm gold, the card-room light
  '#d7b495': '#5A3A24',   // mid wood -> darker
  '#cd9491': '#A82B24',   // dusty rose -> the red's shadow tone
};

/** Parsed once. Comparing colours in a loop over every vertex is not free. */
const TABLE = Object.entries(KEVIN_PALETTE).map(([from, to]) => ({
  from: new THREE.Color(from),
  to: new THREE.Color(to),
}));

/**
 * Nearest-match rather than exact-match, on purpose.
 *
 * The loader does not hand back the byte-identical colour the file was authored
 * with — colour space conversion moves it a little — so keying a table on exact
 * hex silently matches nothing and the kit stays pastel. Asking which of eleven
 * known colours is closest has no threshold to get wrong, which is the same
 * reason skins.js classifies pixels that way.
 *
 * The distance guard matters though: a prop from ANOTHER pack that happens to
 * be greenish must not get dragged to the nearest Kenney colour. Anything
 * further than this stays exactly as it was.
 */
const MAX_D2 = 0.06;

export function rebrand(colour) {
  let best = null, bestD = Infinity;
  for (const e of TABLE) {
    const d = (colour.r - e.from.r) ** 2 + (colour.g - e.from.g) ** 2 + (colour.b - e.from.b) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return bestD <= MAX_D2 ? best.to.clone() : null;
}
