// The rules, server-side.
//
// This is the whole point of the service. The browser copy in gym/js/save.js
// stays where it is — it makes the game feel instant — but it is now a
// PREDICTION, and this is the record. Every number that anybody is ranked on,
// or one day paid for, is computed here from events the client reports, using
// this machine's clock.
//
// Why that matters, stated plainly: the browser version reads Date.now() off
// the player's own device. Set your clock forward a year and the decay maths
// hands you whatever you like. That is fine for a toy and it is not fine the
// moment a leaderboard or a reward depends on it. Nothing in this file trusts
// a timestamp, a total, or a rate that came over the wire.

/** Mirrors STATIONS in gym/js/main.js. Changing one means changing both. */
export const STATIONS = {
  bench: { stat: 'muscle', gain: 3.0, coin: 10 },
  rack: { stat: 'muscle', gain: 2.0, coin: 7 },
  treadmill: { stat: 'stamina', gain: 3.6, coin: 9 },
};

export const DECAY_PER_DAY = 0.052;      // ~13-day half-life
export const MAX_DECAY = 0.45;
const DAY = 86400000;

/**
 * The floor on how fast a set can physically be played.
 *
 * Five reps, each a sweep of the marker; the quickest station sweeps in 1.75s
 * and the slowest in 0.80s. Even played perfectly the fastest possible set is
 * several seconds, so anything under this did not happen in a browser — it was
 * a script. Deliberately generous: a false accusation costs a real player their
 * progress, and the cap below catches sustained abuse anyway.
 */
export const MIN_SET_MS = 4000;

/** And nobody trains for eight hours straight. Sets per rolling hour. */
export const MAX_SETS_PER_HOUR = 90;

/** Quality is graded client-side; clamp it to what the grading can produce. */
const MIN_QUALITY = 0.25;
const MAX_QUALITY = 2.6;

/**
 * Settle decay up to `now`, using OUR clock and the stored last-seen.
 * Returns the new values; does not mutate.
 */
export function settle(row, now) {
  const days = Math.max(0, (now - row.last_seen) / DAY);
  if (days < 1) return { muscle: row.muscle, stamina: row.stamina, lost: 0 };
  const factor = Math.max(1 - MAX_DECAY, Math.exp(-DECAY_PER_DAY * days));
  const muscle = row.muscle * factor;
  return { muscle, stamina: row.stamina * factor, lost: row.muscle - muscle };
}

/**
 * Credit one completed set.
 *
 * The client says which station and how well it went. It does NOT say how much
 * muscle that is worth — that sum happens here, so a forged "quality" is worth
 * at most one very good set rather than an arbitrary number.
 */
export function creditSet(row, { station, quality }, now) {
  const st = STATIONS[station];
  if (!st) return { error: 'unknown station' };

  const settled = settle(row, now);
  const q = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, Number(quality) || 1));
  const gain = st.stat === 'muscle' ? st.gain * q : 0;
  const stam = st.stat === 'stamina' ? st.gain * q : 0;

  return {
    muscle: Math.min(100, settled.muscle + gain),
    stamina: Math.min(100, settled.stamina + stam),
    coin: row.coin + Math.round(st.coin * q),
    sets: row.sets + 1,
  };
}

/** Credit a finished shift at the fry house. Mirrors gym/js/job.js. */
export function creditShift(row, { served, mistakes, walked }, now) {
  const s = Math.max(0, Math.min(6, Number(served) | 0));
  const m = Math.max(0, Math.min(30, Number(mistakes) | 0));
  const w = Math.max(0, Math.min(6, Number(walked) | 0));
  if (s + w > 6) return { error: 'more customers than a shift has' };

  // Pay the middle of the range rather than the best case: the client is not
  // trusted to report how fast it was, and speed is where the tip comes from.
  const perCustomer = 3 * 4;                 // three items at 4 each
  const tip = m === 0 && w === 0 ? 6 : 0;
  const bonus = s === 6 && w === 0 && m === 0 ? 60 : s === 6 && w === 0 ? 25 : 0;
  const pay = s * (perCustomer + tip) + bonus;

  const settled = settle(row, now);
  return {
    muscle: settled.muscle,
    stamina: settled.stamina,
    coin: row.coin + pay,
    shifts: row.shifts + 1,
    served: row.served + s,
    pay,
  };
}

/**
 * Is this event physically possible given what came before?
 *
 * Returns null when fine, or a reason. Rate limiting IS the anti-cheat here —
 * there is no way to make a browser game unforgeable, so the aim is to make
 * cheating cost about as much time as playing, which removes the point of it.
 */
export function implausible(row, now, recentSets) {
  if (now - row.last_event < MIN_SET_MS) return 'too fast';
  if (recentSets >= MAX_SETS_PER_HOUR) return 'too many sets this hour';
  return null;
}
