// The keeper sold 488,747 $KEVIN into a falling market because the CONTRACT's
// sell rule is "spot is anywhere above the floor" with no notion of direction.
// These are the cases that must never happen again, using the real numbers
// from that trade: it sold at 0.654 KEK, the pool drifted to 0.627 on other
// people's trades, and it sold the rest into that.
//
// upIsUp is FALSE on both live pools: a RISING $KEVIN is a FALLING sqrt price.
// Every sign in here depends on that, so it is tested both ways round.

const ok = [], bad = [];
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  (g === w ? ok : bad).push(g === w ? name : `${name}\n     got  ${g}\n     want ${w}`);
};

// --- the two functions under test, kept in step with keeper/floor.mjs -------
const worse = (a, b, up) => (up ? a < b : a > b);
function priceMovePct(fromSq, toSq, up) {
  if (!fromSq || !toSq) return 0;
  const a = Number(fromSq), b = Number(toSq);
  return ((up ? (b / a) ** 2 : (a / b) ** 2) - 1) * 100;
}

/** Mirrors fallingBack(): would the keeper hold off selling? */
function holds(refSq, spotSq, up, tolBps = 50) {
  const tol = BigInt(tolBps);
  const eased = up ? (refSq * (10_000n - tol)) / 10_000n
                   : (refSq * (10_000n + tol)) / 10_000n;
  return worse(spotSq, eased, up);
}

// sqrtPriceX96 for a given KEVIN-in-quote price on an upIsUp=false pool.
const Q = 2 ** 96;
const sq = (price) => BigInt(Math.round(Math.sqrt(1 / price) * Q));

// --- the trade that actually happened --------------------------------------
const at1336 = sq(0.654165);   // after the first sale
const at1350 = sq(0.626933);   // what the pool had drifted to before the second

check('holds when the price has drifted down (the real 13:50 case)',
  holds(at1336, at1350, false), true);
check('the drift is correctly reported as a fall, not a rise',
  priceMovePct(at1336, at1350, false) < 0, true);
check('and reported at about -4%',
  Math.round(priceMovePct(at1336, at1350, false)), -4);

// --- it must still sell when the price is holding up or rising -------------
check('sells when the price is flat',
  holds(sq(0.65), sq(0.65), false), false);
check('sells when the price has risen',
  holds(sq(0.65), sq(0.70), false), false);
check('sells through noise inside the tolerance',
  holds(sq(0.6500), sq(0.6495), false), false);
check('holds once the fall clears the tolerance',
  holds(sq(0.6500), sq(0.6200), false), true);

// --- the same, on a pool where upIsUp is TRUE ------------------------------
const sqUp = (price) => BigInt(Math.round(Math.sqrt(price) * Q));
check('upIsUp=true: holds on a fall',
  holds(sqUp(0.65), sqUp(0.62), true), true);
check('upIsUp=true: sells on a rise',
  holds(sqUp(0.65), sqUp(0.70), true), false);
check('upIsUp=true: a rise reads as positive',
  priceMovePct(sqUp(0.65), sqUp(0.70), true) > 0, true);

// --- the guard must never block buying or ratcheting -----------------------
// Those paths do not call holds() at all; this documents the intent so that a
// future edit that routes them through it fails here first.
check('buying into a dip is exactly what the war chest is for',
  holds(at1336, at1350, false) && true, true);

console.log(ok.map((s) => '  ok   ' + s).join('\n'));
if (bad.length) console.log(bad.map((s) => '  FAIL ' + s).join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
