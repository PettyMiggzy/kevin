// Progress, and the decay that makes it mean anything.
//
// The whole product is one question: do you come back tomorrow because Kevin
// will visibly shrink if you don't? Everything here serves that and nothing
// else, so the numbers below are the most important numbers in the build.
//
// HONEST LIMIT, stated where somebody will read it: this is localStorage and
// Date.now(). Change the device clock and you can farm it. That is fine for a
// prototype and NOT fine for anything holding value — the moment $KEVIN or an
// NFT boost touches this, decay has to be computed from server time, stored as
// last-checkpoint-plus-value and derived lazily on read, with the client
// sending intents ("I used the bench") rather than results ("my muscle is 90").

const KEY = 'kevin.gym.v1';
const DAY = 86400000;

/**
 * Exponential, not linear. A linear drain takes everything from somebody who
 * went away for a fortnight and they never open it again; an exponential one
 * takes a lot on day one and progressively less after, so a bad week costs
 * about a third rather than all of it.
 *
 * 0.052/day gives a ~13-day half-life. Lifted from the shape Loop Habit
 * Tracker ships, reimplemented rather than copied — its source is GPL.
 */
export const DECAY_PER_DAY = 0.052;

/**
 * And then it is capped. Fourteen days away is one absence, not fourteen
 * separate punishments — the failure mode that kills a habit app is somebody
 * coming back after a holiday to a stick figure and closing it forever.
 */
export const MAX_DECAY = 0.45;

const FRESH = {
  muscle: 12,
  stamina: 8,
  coin: 40,
  streak: 0,
  freezes: 1,          // one earned "protein shake" to start, so the first miss stings less
  lastSeen: 0,
  lastWorkoutDay: 0,
  boosterUntil: 0,
  decaySlowUntil: 0,
  totalReps: 0,
  goalDay: 0,
  goalSets: 0,
  bestCombo: 0,
  sessions: 0,
  // --- the shift -----------------------------------------------------------
  shifts: 0,
  served: 0,
  bestShift: 0,          // best single-shift pay
  jobCoin: 0,            // lifetime earned at the window, for the board
  // --- what you look like --------------------------------------------------
  // Spread over a saved object, so a save from before skins existed picks these
  // up on next load rather than needing a migration.
  skin: 'Classic Red',   // worn now
  skins: ['Classic Red'], // owned. Classic Red is what you already are.
};

/** Three sets a day. Low on purpose — the streak has to be easy to keep. */
export const DAILY_GOAL = 3;

const dayOf = (t) => Math.floor(t / DAY);

/**
 * A save that shares nothing with FRESH.
 *
 * Spreading an object copies array REFERENCES, so state.skins WAS FRESH.skins
 * for any new player — and the shop pushes onto it. One purchase permanently
 * added that skin to the defaults, so the next new save, and every reset(),
 * started already owning it. Cheap to prove and easy to miss.
 */
const fresh = () => ({ ...FRESH, skins: [...FRESH.skins] });

export function load() {
  let s;
  try {
    s = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    s = fresh();
  }
  // EVERY number, not just lastSeen. localStorage is editable by the person
  // playing, and a save written by any earlier build can carry anything — so
  // this is the boundary where an untrusted blob becomes state the rest of the
  // game may assume is numeric.
  //
  // The failure this prevents is permanent, which is why it is worth the loop.
  // settle() does arithmetic on muscle, stamina and lastSeen; one NaN anywhere
  // in that chain makes muscle, stamina, lost and days ALL NaN, and save() then
  // writes the NaN back. Measured before this existed:
  //
  //     muscle = NaN            -> muscle NaN, lost NaN
  //     lastSeen = 'yesterday'  -> muscle, stamina, lost, days ALL NaN
  //
  // and `if (!s.lastSeen)` does not catch the second, because 'yesterday' is
  // truthy. Once it is written back there is no way out of it from inside the
  // game: every subsequent settle() starts from NaN. The player has to clear
  // site data, which means losing everything, for a value they never touched.
  for (const k of Object.keys(FRESH)) {
    if (typeof FRESH[k] !== 'number') continue;
    const raw = s[k];
    // Numbers and numeric strings only. Number(null) and Number([]) are both 0,
    // so a plain Number() would quietly turn a null muscle into zero — the
    // player loses everything rather than getting the default back, for a value
    // they never touched.
    const v = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')
      ? Number(raw) : NaN;
    s[k] = Number.isFinite(v) ? v : FRESH[k];
  }
  if (!s.lastSeen) s.lastSeen = Date.now();
  // A save written before skins existed, or one somebody hand-edited, can carry
  // a non-array here. The shop pushes onto it without checking.
  if (!Array.isArray(s.skins)) s.skins = [...FRESH.skins];
  else s.skins = s.skins.filter((n) => typeof n === 'string');
  if (typeof s.skin !== 'string') s.skin = FRESH.skin;
  return s;
}

export function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode. the game still plays, it just forgets. */
  }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
  return { ...fresh(), lastSeen: Date.now() };
}

/**
 * Settle the time since the last visit. Returns what was lost so the UI can
 * say it out loud — silent decay reads as a bug, not a mechanic.
 */
export function settle(s, now = Date.now()) {
  const elapsed = Math.max(0, now - s.lastSeen);
  const days = elapsed / DAY;
  const before = { muscle: s.muscle, stamina: s.stamina };

  // Under a day is free. The bar to keep your muscle has to be low enough that
  // one set clears it, or the streak becomes a chore and people quit.
  if (days < 1) {
    s.lastSeen = now;
    return { days, lost: 0, staminaLost: 0, frozen: false, before };
  }

  // A MISSED DAY IS A CALENDAR DAY NOBODY WORKED OUT ON, not 24 elapsed hours.
  // Both rules below used to be keyed on hours, and both were wrong for it:
  //
  //   played Mon 09:00, back Tue 10:00  -> 25h. Nothing was missed, and it
  //                                        burned a protein shake anyway. Two
  //                                        days of ordinary play emptied both.
  //   played Mon 09:00, back Wed 09:00  -> 48h. Exactly one day (Tuesday) was
  //                                        missed — the case this file, the shop
  //                                        and the HUD all promise is forgiven —
  //                                        and the streak was reset regardless.
  //
  // Counting days instead of hours makes both behave the way they are sold, and
  // takes the clock time of day out of it entirely.
  //
  // lastWorkoutDay 0 means they have never worked out, so there is no day to
  // have missed, nothing to cover and no streak to lose.
  const missedDays = s.lastWorkoutDay ? dayOf(now) - s.lastWorkoutDay - 1 : 0;

  let frozen = false;
  // "A spare day. Miss one and this covers it instead of your muscle." One is
  // one: a shake is not spent on a gap that missed nothing, and it is not
  // thrown away on a gap it could never have covered.
  if (s.freezes > 0 && missedDays === 1) {
    s.freezes -= 1;
    frozen = true;
  } else {
    const slowed = now < s.decaySlowUntil ? 0.5 : 1;
    const factor = Math.max(1 - MAX_DECAY, Math.exp(-DECAY_PER_DAY * days * slowed));
    s.muscle = Math.max(0, s.muscle * factor);
    s.stamina = Math.max(0, s.stamina * factor);
    // The streak survives one missed day, then it is gone. Two days is a
    // decision; one day is a bus being late.
    if (missedDays >= 2) s.streak = 0;
  }

  s.lastSeen = now;
  return {
    days,
    lost: before.muscle - s.muscle,
    staminaLost: before.stamina - s.stamina,
    frozen,
    before,
  };
}

/** What tomorrow costs if you walk away right now. The number people act on. */
export function projectedLoss(s, now = Date.now()) {
  const slowed = now < s.decaySlowUntil ? 0.5 : 1;
  return s.muscle * (1 - Math.exp(-DECAY_PER_DAY * slowed));
}

/**
 * Credit a completed set.
 *
 * `quality` is how well the set was actually played — 0.25 for five misses,
 * about 1.0 for a scrappy clean set, up to ~2.5 for five perfects. It is the
 * whole reason the reps exist: without it every set pays the same and pressing
 * the button well is decoration.
 */
export function workout(s, station, now = Date.now(), quality = 1) {
  const boosted = now < s.boosterUntil;
  const mult = (boosted ? 2 : 1) * quality;
  const gain = station.stat === 'muscle' ? station.gain * mult : 0;
  const stam = station.stat === 'stamina' ? station.gain * mult : 0;
  const coin = Math.round(station.coin * mult);

  s.muscle = Math.min(100, s.muscle + gain);
  s.stamina = Math.min(100, s.stamina + stam);
  s.coin += coin;
  s.totalReps += 1;

  // The streak ticks once per calendar day, on any station. Keeping it must be
  // easy; the ambitious workout is a separate reward on top.
  const today = dayOf(now);
  // Sets done today, for the daily goal. Reset when the day rolls over.
  if (s.goalDay !== today) { s.goalDay = today; s.goalSets = 0; }
  s.goalSets = (s.goalSets || 0) + 1;

  if (s.lastWorkoutDay !== today) {
    // ONE MISSED DAY IS FORGIVEN. settle() has always said so — "the streak
    // survives one missed day, then it is gone. Two days is a decision; one day
    // is a bus being late" — and the shop and the HUD both sell it. This line
    // did not implement it: only `today - 1` continued a streak, so a single
    // missed day reset it to 1 no matter what settle() had decided, and a
    // freeze spent to protect it protected nothing.
    const cont = s.lastWorkoutDay === today - 1 || s.lastWorkoutDay === today - 2
      || s.lastWorkoutDay === 0;
    s.streak = cont ? s.streak + 1 : 1;
    s.lastWorkoutDay = today;
    s.coin += 15;                      // showing up is worth more than the set
    if (s.streak > 0 && s.streak % 5 === 0) s.freezes = Math.min(2, s.freezes + 1);
  }

  s.lastSeen = now;
  return { gain, stam, coin, boosted };
}


/** Credit a finished shift at the fry house. */
export function payShift(s, r, now = Date.now()) {
  s.coin += r.coin;
  s.jobCoin = (s.jobCoin || 0) + r.coin;
  s.shifts = (s.shifts || 0) + 1;
  s.served = (s.served || 0) + r.served;
  s.bestShift = Math.max(s.bestShift || 0, r.coin);
  s.lastSeen = now;
  return r;
}

/**
 * The board on the gym wall.
 *
 * LOCAL ONLY, and the board says so on its face. The crew below are fixed
 * numbers, not other players — there is no server, so there is nobody else to
 * rank against. Beating them is a milestone rather than a competition, and the
 * shape of this function (rows in, rows out) is what a real ranking would slot
 * into unchanged.
 */
const RIVALS = [
  ['Big Mike', 96], ['Sandra', 81], ['Trav', 68], ['The Regular', 57],
  ['Dave from work', 44], ['Kayla', 33], ['Nan', 24], ['The Night Guy', 15],
];

export function leaderboard(s) {
  const you = { name: 'You', score: Math.round(s.muscle), you: true };
  const all = [...RIVALS.map(([name, score]) => ({ name, score })), you]
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // A board that leaves you off it is not a leaderboard, it is a poster. You
  // start on 12 muscle, below every rival, so the naive top-8 showed a stranger
  // eight times and never the player. Top seven, then you — at your real rank.
  const top = all.slice(0, 7);
  if (top.some((r) => r.you)) return all.slice(0, 8);
  return [...top, all.find((r) => r.you)];
}
