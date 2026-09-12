// The keeper now names the worst price it will accept on every poke, because
// the contract cannot work one out for itself: its sell limit is derived from
// a spot price read DURING the swap, so anyone who moves spot in the same
// block moves the limit with it.
//
// These are the arithmetic cases. upIsUp is FALSE on both live pools — a
// RISING $KEVIN is a FALLING sqrt price — and every sign below depends on
// that, which is why the orientation is asserted first and separately.

const ok = [], bad = [];
const check = (name, got, want) => {
  const j = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
  const g = j(got), w = j(want);
  (g === w ? ok : bad).push(g === w ? name : `${name}\n     got  ${g}\n     want ${w}`);
};

// --- the functions under test, kept in step with keeper/floor.mjs ----------
const worse = (a, b, up) => (up ? a < b : a > b);

function worseBy(x, bps, up) {
  const B = 10_000n;
  const [num, den] = up ? [B - bps, B] : [B, B - bps];
  return BigInt(Math.floor(Number(x) * Math.sqrt(Number(num) / Number(den))));
}

function minRate(selling, spot, floorAt, up, isZero, stopBps, feePpm, bufferBps = 100) {
  const Q = 1n << 96n;
  const limit = selling
    ? (worse(worseBy(spot, stopBps, up), floorAt, up) ? floorAt : worseBy(spot, stopBps, up))
    : floorAt;
  const c1PerC0 = (limit * limit) / Q;
  const c0PerC1 = c1PerC0 === 0n ? 0n : (Q * Q * Q) / (limit * limit);
  const out = selling ? (isZero ? c1PerC0 : c0PerC1) : (isZero ? c0PerC1 : c1PerC0);
  const afterFee = (out * (1_000_000n - BigInt(feePpm))) / 1_000_000n;
  return (afterFee * (10_000n - BigInt(bufferBps))) / 10_000n;
}

// --- the real pool ---------------------------------------------------------
// KEVIN / KEK, measured 10 Sep 2026: KEK is currency0, $KEVIN is currency1,
// so tokenIsZero is false and one KEK buys 2.199162 $KEVIN.
const Q = 2 ** 96;
const ZERO = false;          // $KEVIN is currency1
const UP = false;            // so a better $KEVIN price is a SMALLER sqrt price
const STOP = 250n;           // sellStopBps: no sale may walk the chart 2.5%
const FEE = 3000;            // 0.3% pool fee, in ppm

/** sqrtPriceX96 for "one KEK buys `k` $KEVIN". */
const sq = (k) => BigInt(Math.round(Math.sqrt(k) * Q));
/** What one $KEVIN is worth in KEK at that sqrt price — the seller's rate. */
const kekPerKevin = (s) => (Number(Q) / Number(s)) ** 2;
/** The same, as the Q96 integer the contract compares against. */
const rateX96 = (s) => ((1n << 96n) ** 3n) / (s * s);

const SPOT = sq(2.199162);   // 1 $KEVIN = 0.454719 KEK
const FLOOR_LOW = sq(2.75);  // a floor well under spot: the stop binds
const FLOOR_TIGHT = sq(2.21); // a floor just under spot: the floor binds

// --- orientation -----------------------------------------------------------

check('a better $KEVIN price is a smaller sqrt price on this pool',
  worse(sq(2.30), sq(2.199162), UP), true);

check('worseBy moves the sqrt price the way that costs $KEVIN',
  worseBy(SPOT, STOP, UP) > SPOT, true);

check('and by 2.5% in PRICE, not 2.5% in sqrt space',
  Math.round((1 - kekPerKevin(worseBy(SPOT, STOP, UP)) / kekPerKevin(SPOT)) * 1e4), 250);

// --- the bound lets an honest fill through ---------------------------------
//
// A limited swap fills from spot down to the limit, so its average is always
// better than the limit itself. The worst an honest fill can possibly do is
// every unit executing at the limit, less the fee.

const honestLimit = worseBy(SPOT, STOP, UP);
const worstHonest = (rateX96(honestLimit) * 997_000n) / 1_000_000n;
const bound = minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, FEE);

check('the bound sits under the worst an honest fill can do',
  bound < worstHonest, true);

check('and not far under it — 1% of slack, not 10%',
  Math.round(Number(worstHonest - bound) / Number(worstHonest) * 1e4) <= 110, true);

// --- and refuses a sandwiched one ------------------------------------------
//
// The attacker sells $KEVIN in front of the poke, dropping the price 5%. The
// contract then recomputes its stop around THAT price and fills down from it.
// The best the sandwiched fill can achieve is its very first unit, at the
// manipulated spot. If the bound is above even that, the whole fill reverts.

const crushed = sq(2.199162 / 0.95);   // $KEVIN worth 5% less
const bestSandwiched = (rateX96(crushed) * 997_000n) / 1_000_000n;

check('a 5% front-run is refused even at its most generous',
  bound > bestSandwiched, true);

// Where the line actually falls, on that most-generous measure: the stop
// (2.5%), the fee and the 1% buffer add up, so a front-run has to be about
// 3.5% before even its FIRST unit is priced below the bound. Anything smaller
// than that is not waved through — the rest of the fill executes worse than
// its first unit, and it is the AVERAGE the contract checks — but 3.5% is the
// number that can be proved from the bound alone, so it is the one asserted.
const generousLimit = (pct) => bound > (rateX96(sq(2.199162 / (1 - pct))) * 997_000n) / 1_000_000n;
check('4% is refused on the first unit alone', generousLimit(0.04), true);
check('3% is not, on that measure', generousLimit(0.03), false);

check('ordinary drift of a tenth of a percent is well inside the bound',
  bound < (rateX96(sq(2.199162 / 0.999)) * 997_000n) / 1_000_000n, true);

// --- the floor binds when it is tighter than the stop ----------------------

check('a floor inside the stop is what the bound is priced from',
  minRate(true, SPOT, FLOOR_TIGHT, UP, ZERO, STOP, FEE),
  minRate(true, SPOT, FLOOR_TIGHT, UP, ZERO, 9_000n, FEE));

check('a floor outside the stop is not',
  minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, FEE) >
  minRate(true, SPOT, FLOOR_LOW, UP, ZERO, 400n, FEE), true);

// --- the bid is priced the other way up ------------------------------------
//
// Bidding gives up KEK for $KEVIN, so the rate that matters is $KEVIN per KEK,
// and the limit is the floor rather than any stop.

const bidBound = minRate(false, SPOT, FLOOR_LOW, UP, ZERO, STOP, FEE);
check('the bid rate is $KEVIN per KEK, so it is the reciprocal side',
  bidBound > (1n << 96n), true);
check('the sell rate is KEK per $KEVIN, which on this pool is under one',
  bound < (1n << 96n), true);
check('the two are not the same number', bidBound === bound, false);

// --- orientation again, with the token on the other side -------------------
//
// The WETH pool has $KEVIN as currency1 too, but a pool where the token is
// currency0 has to come out the other way round or every bound is inverted.

check('flipping tokenIsZero flips which side the rate is quoted from',
  minRate(true, SPOT, FLOOR_LOW, UP, true, STOP, FEE) >
  minRate(true, SPOT, FLOOR_LOW, UP, false, STOP, FEE), true);

// --- the fee comes out of the output ---------------------------------------

check('a fatter fee means a lower acceptable rate',
  minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, 10_000) <
  minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, 3_000), true);

check('and the difference is the fee itself',
  Math.round(Number(
    minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, 3_000)
    - minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, 10_000)
  ) / Number(minRate(true, SPOT, FLOOR_LOW, UP, ZERO, STOP, 3_000)) * 1e4), 70);

// --- a rate is not an amount -----------------------------------------------

check('a better $KEVIN price demands a better rate',
  minRate(true, sq(2.0), FLOOR_LOW, UP, ZERO, STOP, FEE) >
  minRate(true, sq(2.4), FLOOR_LOW, UP, ZERO, STOP, FEE), true);

check('and the bid bound moves with the floor, not with spot',
  minRate(false, SPOT, FLOOR_LOW, UP, ZERO, STOP, FEE) ===
  minRate(false, sq(9.9), FLOOR_LOW, UP, ZERO, STOP, FEE), true);

// ---------------------------------------------------------------------------
for (const n of ok) console.log('  ok  ', n);
for (const n of bad) console.log('  FAIL', n);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
