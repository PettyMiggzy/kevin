// The rate limits, proved by farming.
//
//     node server/test/scoring.test.mjs        (exits non-zero on a failure)
//
// implausible() IS the anti-cheat. There is no way to make a browser game
// unforgeable, so the whole defence is that cheating should cost about what
// playing costs — and for shifts it cost nothing at all, because the counter
// behind the hourly cap selected `kind = 'set'` and a shift event read zero
// through it every time. One guard was left on the endpoint, the four-second
// floor between any two events, and 4s of nothing is 900 perfect shifts an
// hour at 168 coin each.
//
// Reading the code did not catch that. Farming it does, so it gets farmed here
// on every change.

import { readFile } from 'node:fs/promises';
import {
  implausible, creditShift, creditSet, STATIONS,
  MIN_SET_MS, MAX_SETS_PER_HOUR, MAX_SHIFTS_PER_HOUR,
} from '../scoring.mjs';

const HOUR = 3600000;
const T = Date.UTC(2026, 8, 7, 12, 0, 0);

const fail = [];
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ' (expected ' + JSON.stringify(want) + ')'}`);
  if (!ok) fail.push(name);
};

/** A linked player who last did something a while ago. */
const player = (over = {}) => ({
  id: 1, coin: 0, sets: 0, shifts: 0, served: 0,
  muscle: 10, stamina: 10, last_event: T - HOUR, last_seen: T - HOUR,
  ...over,
});

// --- the floor between any two events ---------------------------------------
{
  const p = player({ last_event: T - 1000 });
  check('a second after the last event is too fast', implausible(p, T, {}), 'too fast');
  check('MIN_SET_MS after it is not', implausible(player({ last_event: T - MIN_SET_MS }), T, {}), null);
}

// --- sets, which were already capped ----------------------------------------
{
  check('under the set cap passes',
    implausible(player(), T, { sets: MAX_SETS_PER_HOUR - 1 }), null);
  check('at the set cap is refused',
    implausible(player(), T, { sets: MAX_SETS_PER_HOUR }), 'too many sets this hour');
}

// --- shifts, which were not ---------------------------------------------------
{
  check('under the shift cap passes',
    implausible(player(), T, { shifts: MAX_SHIFTS_PER_HOUR - 1 }), null);
  check('at the shift cap is refused',
    implausible(player(), T, { shifts: MAX_SHIFTS_PER_HOUR }), 'too many shifts this hour');
  // The bug in one line: a shift farmer's SET count stays at zero forever, so
  // the only cap that ran never saw anything to count.
  check('a farmer with no sets is still stopped',
    implausible(player(), T, { sets: 0, shifts: MAX_SHIFTS_PER_HOUR }), 'too many shifts this hour');
}

// --- what the exploit was actually worth, and what it is worth now -----------
{
  const perfect = { served: 6, mistakes: 0, walked: 0 };
  const pay = creditShift(player(), perfect, T).pay;
  check('a perfect shift pays', pay, 168);
  // 4s floor and no shift cap: 3600/4 = 900 an hour.
  const before = Math.floor(HOUR / MIN_SET_MS) * pay;
  const after = MAX_SHIFTS_PER_HOUR * pay;
  check('the old ceiling was 900 shifts an hour', Math.floor(HOUR / MIN_SET_MS), 900);
  check('coin an hour, before', before, 151200);
  check('coin an hour, now', after, 16800);
  check('the cap cuts it by 9x', Math.round(before / after), 9);
}

// --- and the shift credit still refuses impossible reports -------------------
{
  check('more customers than a shift has',
    creditShift(player(), { served: 5, mistakes: 0, walked: 5 }, T).error,
    'more customers than a shift has');
  check('served is clamped to the shift length',
    creditShift(player(), { served: 999, mistakes: 0, walked: 0 }, T).served, 6);
  check('negative served cannot pay',
    creditShift(player(), { served: -20, mistakes: 0, walked: 0 }, T).pay, 0);
}

// --- a set still credits, so the cap did not break the other half -----------
{
  const r = creditSet(player(), { station: 'bench', quality: 1 }, T);
  check('a set still credits muscle', r.muscle > 10, true);
  check('an unknown station still cannot',
    creditSet(player(), { station: 'jacuzzi', quality: 1 }, T).error, 'unknown station');
}

// --- the two station tables have to agree ------------------------------------
// A comment saying "changing one means changing both" is not a mechanism. Four
// stations were added to the gym and this table was not touched, so every set
// at the lat pulldown, the rower, the squat rack and the bike came back
// 'unknown station' and scored nothing on the board. Read the gym's own table
// and compare, so the next one cannot land silently.
{
  const src = await readFile(new URL('../../gym/js/main.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const STATIONS = ['));
  const client = {};
  // Each entry declares id, stat, gain and coin; the rest of it is geometry.
  for (const m of block.slice(0, block.indexOf('\n];')).matchAll(
    /id:\s*'([a-z]+)'[\s\S]*?stat:\s*'(muscle|stamina)',\s*gain:\s*([\d.]+),\s*coin:\s*(\d+)/g
  )) client[m[1]] = { stat: m[2], gain: Number(m[3]), coin: Number(m[4]) };

  check('the gym declares seven stations', Object.keys(client).length, 7);
  for (const [id, c] of Object.entries(client)) {
    check(`server knows ${id}`, JSON.stringify(STATIONS[id] ?? null), JSON.stringify(c));
  }
  for (const id of Object.keys(STATIONS)) {
    check(`${id} is still in the gym`, Boolean(client[id]), true);
  }
}

console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall pass');
process.exit(fail.length ? 1 : 0);
