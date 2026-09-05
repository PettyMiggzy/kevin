// Who can sit at the table.
//
// This is the seam the NFTs plug into. A character is data, not code: an id, a
// name, a picture and a play style. Nothing in the game reaches past this
// registry, so when the collection exists, minting a playable character means
// adding a row here (or fetching rows from a contract) rather than touching
// the table, the dealer or the UI.
//
// The art is the Todd-drawn sticker set, in both states: a cut-out still for
// the seat at rest, and the rigged animation for whoever is acting. Both are
// already in the repo — no new assets, and every seat is on-model.

/**
 * @typedef {Object} Character
 * @property {string} id     stable key; an NFT would use its token id
 * @property {string} name   shown on the seat
 * @property {string} art    cut-out still, shown at rest
 * @property {string} anim   rigged loop, shown while this seat is acting
 * @property {string} style  how the bot plays: 'rock' | 'caller' | 'shark' | 'maniac'
 * @property {string} [owner] wallet, once these are minted
 */

/** Play styles, kept honest: each is a real strategy, not a difficulty slider. */
export const STYLES = {
  // Folds anything weak, raises only the top of its range. Beatable by
  // pressure, punishing if you pay it off.
  rock:   { open: 0.16, call: 0.34, raise: 0.10, bluff: 0.02, aggression: 0.7 },
  // Calls far too much and almost never raises. The one that pays you off.
  caller: { open: 0.42, call: 0.72, raise: 0.06, bluff: 0.03, aggression: 0.5 },
  // Tight-aggressive. Plays fewer hands than it looks and bets them hard.
  shark:  { open: 0.26, call: 0.44, raise: 0.28, bluff: 0.14, aggression: 1.2 },
  // Raises with anything. Wins pots it has no business in and then gives it
  // all back.
  maniac: { open: 0.62, call: 0.50, raise: 0.44, bluff: 0.34, aggression: 1.6 },
};

export const ROSTER = [
  { id: 'kevin',      name: 'Kevin',      slug: 'kek-power',   style: 'maniac' },
  { id: 'kevin-gm',   name: 'Sleepy Kev', slug: 'kek-gm',      style: 'rock' },
  { id: 'kevin-flex', name: 'Big Kev',    slug: 'gym-flex',    style: 'shark' },
  { id: 'kevin-hodl', name: 'HODL Kev',   slug: 'kek-hodl',    style: 'rock' },
  { id: 'kevin-snack',name: 'Snack Kev',  slug: 'kek-snack',   style: 'caller' },
  { id: 'kevin-suit', name: 'Suit Kev',   slug: 'kevin-great', style: 'shark' },
  { id: 'kevin-spin', name: 'Spin Kev',   slug: 'kek-spin',    style: 'caller' },
  { id: 'kevin-run',  name: 'Cardio Kev', slug: 'gym-run',     style: 'maniac' },
].map((c) => ({
  ...c,
  art: `../assets/stickers/static/${c.slug}.webp`,
  anim: `../assets/stickers/animated/${c.slug}.webm`,
}));

export const byId = (id) => ROSTER.find((c) => c.id === id) || ROSTER[0];

/**
 * Where owned characters will come from.
 *
 * Deliberately a stub with a real shape rather than nothing: when the
 * collection is live this fetches the wallet's tokens and returns the same
 * Character rows the roster returns, so the table cannot tell the difference
 * between a built-in seat and a minted one.
 */
export async function ownedBy(_wallet) {
  return [];
}

/**
 * The seat portrait.
 *
 * This used to download eight 1024px stills on their flat brand yellow and
 * flood-fill the backdrop off each one in JavaScript at load — about eight
 * million pixels of fill on the main thread before the table could be dealt,
 * for 3.9MB of PNG. tools/build-static-stickers.mjs now does that same cut
 * ahead of time and writes 512px WebP with real alpha, so the whole roster is
 * 267KB and arrives ready to draw. The fill lives in one place instead of two.
 */
const cache = new Map();
export function portrait(character) {
  if (cache.has(character.id)) return cache.get(character.id);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.alt = character.name;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = character.art;
  });
  cache.set(character.id, p);
  return p;
}
