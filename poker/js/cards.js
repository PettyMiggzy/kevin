// Cards, and working out who won.
//
// Hand evaluation is the part of a poker game that has to be RIGHT — a table
// that pays the wrong player is worse than no table — so it is a plain
// exhaustive best-of-seven rather than anything clever. Twenty-one five-card
// combinations per player per showdown is nothing on a modern machine, and it
// is checkable by eye, which a bitmask lookup is not.

export const SUITS = ['s', 'h', 'd', 'c'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
/** 2 is 2, ace is 14. Ace also plays as 1 in a wheel — handled in straightHigh. */
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

export const CATEGORIES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

export function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

/**
 * Fisher-Yates, drawing from crypto rather than Math.random.
 *
 * Not for cryptographic strength — nothing here is adversarial yet — but
 * because a shuffle people bet against should not be reproducible from a
 * timestamp, and getRandomValues costs nothing.
 */
export function shuffle(deck) {
  const d = deck.slice();
  const rand = (n) => {
    const buf = new Uint32Array(1);
    // Reject the tail so the modulo is unbiased. With n <= 52 the loop
    // effectively never runs twice, but a biased shuffle in a betting game is
    // the kind of thing that is impossible to spot and impossible to defend.
    const limit = Math.floor(0xFFFFFFFF / n) * n;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  };
  for (let i = d.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const rankOf = (c) => RANK_VALUE[c[0]];
const suitOf = (c) => c[1];

/** Highest card of a straight in these five ranks, or 0. */
function straightHigh(values) {
  const u = [...new Set(values)].sort((a, b) => b - a);
  if (u.length !== 5) return 0;
  if (u[0] - u[4] === 4) return u[0];
  // The wheel: A-5-4-3-2 counts as a five-high straight, and the ace is low.
  if (u[0] === 14 && u[1] === 5 && u[4] === 2) return 5;
  return 0;
}

/**
 * Score exactly five cards.
 *
 * Returns [category, ...tiebreakers] so two hands compare with a plain
 * lexicographic walk — no special cases per category, which is where hand
 * comparison usually goes wrong.
 */
export function scoreFive(cards) {
  const values = cards.map(rankOf);
  const flush = new Set(cards.map(suitOf)).size === 1;
  const straight = straightHigh(values);

  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  // Sort by count first, then by rank: trips beat a pair, and a higher trip
  // beats a lower one.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const byGroup = groups.map((g) => g[0]);

  if (straight && flush) return [8, straight];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...values.slice().sort((a, b) => b - a)];
  if (straight) return [4, straight];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...values.slice().sort((a, b) => b - a)];
}

export function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Best five of seven. Returns { score, cards, name }, or null.
 *
 * Null when there are fewer than five cards, which happens every time a hand
 * ends before the flop: the winner has two cards and the board is empty, and
 * there is no hand to name because nobody had to show one.
 */
export function bestOfSeven(cards) {
  if (!cards || cards.length < 5) return null;
  let best = null;
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = scoreFive(five);
            if (!best || compareScores(score, best.score) > 0) best = { score, cards: five };
          }
  return { ...best, name: CATEGORIES[best.score[0]] };
}
