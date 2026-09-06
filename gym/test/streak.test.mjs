// The streak and the freeze, proved by playing.
//
//     node gym/test/streak.test.mjs        (exits non-zero on a failure)
//
// These two rules are the whole retention loop, they are sold in three places
// in the UI, and they are the easiest thing in the build to get subtly wrong —
// both were, for months, because both counted ELAPSED HOURS instead of missed
// calendar days. Reading the code did not catch it; playing three days of it
// did. So the days get played here, at fixed instants, on every change.
//
// No DOM: a localStorage stub is all save.js needs.
globalThis.localStorage = {
  _v: null,
  getItem() { return this._v; },
  setItem(_k, v) { this._v = v; },
  removeItem() { this._v = null; },
};
const { load, settle, workout } = await import('../js/save.js');

const DAY = 86400000;
const STATION = { stat: 'muscle', gain: 4, coin: 6 };
// Day 0 = a Monday, 09:00. Everything below is an absolute ms instant.
const BASE = Date.UTC(2026, 0, 5, 9, 0, 0);
const at = (day, hour = 9) => BASE + day * DAY + (hour - 9) * 3600000;

const fail = [];
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}${ok ? '' : ' (expected ' + want + ')'}`);
  if (!ok) fail.push(name);
};

// A save that has never been touched, seeded at day 0.
const start = () => {
  localStorage.removeItem();
  const s = load();
  s.lastSeen = at(0);
  return s;
};

console.log('1. daily play at drifting times never burns a freeze');
{
  const s = start();
  settle(s, at(0, 9)); workout(s, STATION, at(0, 9));
  // Tuesday 10:00 — 25 hours later. Nobody missed a day.
  settle(s, at(1, 10)); workout(s, STATION, at(1, 10));
  // Wednesday 12:00 — 26 hours later.
  settle(s, at(2, 12)); workout(s, STATION, at(2, 12));
  check('freezes still 1', s.freezes, 1);
  check('streak 3', s.streak, 3);
}

console.log('2. one missed day: the freeze covers it and the streak continues');
{
  const s = start();
  settle(s, at(0)); workout(s, STATION, at(0));
  settle(s, at(1)); workout(s, STATION, at(1));
  // day 2 skipped entirely. Back on day 3.
  const r = settle(s, at(3));
  check('frozen', r.frozen, true);
  check('freeze spent', s.freezes, 0);
  check('nothing lost', Math.round(r.lost * 1000) / 1000, 0);
  check('streak survived settle', s.streak, 2);
  workout(s, STATION, at(3));
  check('streak continues to 3', s.streak, 3);
}

console.log('3. one missed day with NO freeze: muscle decays, streak still survives');
{
  const s = start();
  s.freezes = 0;
  settle(s, at(0)); workout(s, STATION, at(0));
  settle(s, at(1)); workout(s, STATION, at(1));
  const before = s.muscle;
  const r = settle(s, at(3));
  check('not frozen', r.frozen, false);
  check('muscle decayed', s.muscle < before, true);
  check('streak survived settle', s.streak, 2);
  workout(s, STATION, at(3));
  check('streak continues to 3', s.streak, 3);
}

console.log('4. two missed days: the streak is gone, and no freeze is wasted on it');
{
  const s = start();
  settle(s, at(0)); workout(s, STATION, at(0));
  settle(s, at(1)); workout(s, STATION, at(1));
  // days 2 and 3 skipped. Back on day 4 — three days elapsed, past the 2.5 window.
  const r = settle(s, at(4));
  check('not frozen', r.frozen, false);
  check('freeze kept for a day it can save', s.freezes, 1);
  check('streak zeroed by settle', s.streak, 0);
  workout(s, STATION, at(4));
  check('streak restarts at 1', s.streak, 1);
}

console.log('5. first ever visit after a long gap does not burn the starting freeze');
{
  const s = start();
  // Never worked out. Opened it, closed it, came back two days later.
  const r = settle(s, at(2));
  check('not frozen', r.frozen, false);
  check('freeze intact', s.freezes, 1);
}

console.log('6. same day, twice: no double streak tick');
{
  const s = start();
  workout(s, STATION, at(0, 9));
  workout(s, STATION, at(0, 20));
  check('streak 1', s.streak, 1);
  check('goal sets 2', s.goalSets, 2);
}

console.log('7. five days straight earns a freeze back');
{
  const s = start();
  for (let d = 0; d < 5; d++) { settle(s, at(d)); workout(s, STATION, at(d)); }
  check('streak 5', s.streak, 5);
  check('freezes 2 (capped)', s.freezes, 2);
}

console.log('8. a freeze covers a missed day even mid-run, once');
{
  const s = start();
  settle(s, at(0)); workout(s, STATION, at(0));
  const r1 = settle(s, at(2));      // missed day 1
  check('first miss frozen', r1.frozen, true);
  workout(s, STATION, at(2));
  const r2 = settle(s, at(4));      // missed day 3, no freeze left
  check('second miss not frozen', r2.frozen, false);
  check('streak survives one miss', s.streak, 2);
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall pass');
process.exit(fail.length ? 1 : 0);
