// Who can sit at the table.
//
// This is the seam the NFTs plug into. A character is data, not code: an id, a
// name, a picture and a play style. Nothing in the game reaches past this
// registry, so when the collection exists, minting a playable character means
// adding a row here (or fetching rows from a contract) rather than touching
// the table, the dealer or the UI.
//
// The art is the sticker stills, cut out at load. They are Todd's Kevin and
// they are already in the repo — no new assets, and every seat is on-model.

/**
 * @typedef {Object} Character
 * @property {string} id     stable key; an NFT would use its token id
 * @property {string} name   shown on the seat
 * @property {string} art    path to a transparent-able still
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
  { id: 'kevin',     name: 'Kevin',      art: '../assets/stickers/stills/kek-power.png',  style: 'maniac' },
  { id: 'kevin-gm',  name: 'Sleepy Kev', art: '../assets/stickers/stills/kek-gm.png',     style: 'rock' },
  { id: 'kevin-flex',name: 'Big Kev',    art: '../assets/stickers/stills/gym-flex.png',   style: 'shark' },
  { id: 'kevin-hodl',name: 'HODL Kev',   art: '../assets/stickers/stills/kek-hodl.png',   style: 'rock' },
  { id: 'kevin-snack',name:'Snack Kev',  art: '../assets/stickers/stills/kek-snack.png',  style: 'caller' },
  { id: 'kevin-suit',name: 'Suit Kev',   art: '../assets/stickers/stills/kevin-great.png',style: 'shark' },
  { id: 'kevin-spin',name: 'Spin Kev',   art: '../assets/stickers/stills/kek-spin.png',   style: 'caller' },
  { id: 'kevin-run', name: 'Cardio Kev', art: '../assets/stickers/stills/gym-run.png',    style: 'maniac' },
];

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
 * Cut a character's art off its flat backdrop, once, and cache it.
 *
 * The stills sit on flat brand yellow so the sticker pipeline can key them.
 * At the table they need to be transparent, and it has to be a fill from the
 * frame edge rather than a colour key — his eyes are white and the KEK coin
 * carries greens that a key loose enough to clear the yellow would eat.
 */
const cache = new Map();
export function portrait(character) {
  if (cache.has(character.id)) return cache.get(character.id);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, w, h);
      const px = d.data;
      const bg = [px[4 * (4 * w + 4)], px[4 * (4 * w + 4) + 1], px[4 * (4 * w + 4) + 2]];
      const near = (k) =>
        Math.abs(px[k * 4] - bg[0]) <= 30 && Math.abs(px[k * 4 + 1] - bg[1]) <= 30 &&
        Math.abs(px[k * 4 + 2] - bg[2]) <= 30;
      const gone = new Uint8Array(w * h);
      const st = [];
      const seed = (k) => { if (!gone[k] && near(k)) { gone[k] = 1; st.push(k); } };
      for (let i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
      for (let j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
      while (st.length) {
        const k = st.pop();
        const cx = k % w;
        const cy = (k / w) | 0;
        if (cx > 0) seed(k - 1);
        if (cx < w - 1) seed(k + 1);
        if (cy > 0) seed(k - w);
        if (cy < h - 1) seed(k + w);
      }
      for (let k = 0; k < w * h; k++) if (gone[k]) px[k * 4 + 3] = 0;
      x.putImageData(d, 0, 0);
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = character.art;
  });
  cache.set(character.id, p);
  return p;
}
