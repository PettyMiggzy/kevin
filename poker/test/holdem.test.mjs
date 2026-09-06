// The rules, played rather than read.
//
//     node poker/test/holdem.test.mjs      (exits non-zero on a failure)
//
// A betting game that cannot be checked should not take bets — holdem.js says
// so in its own first paragraph, which is why the rules live in a file with no
// UI in them. This is the checking. Three things it has caught that reading
// the code did not:
//
//   the blinds were posted one seat too far from the button, at every table
//   size, so the whole table acted out of position for months;
//   a blind who went all-in POSTING it was handed the turn, and an all-in
//   player cannot act — the hand froze with the pot on the table;
//   pots that everyone eligible for had folded out of quietly vanished.
//
// The fuzz plays random legal actions, which is the only opponent that will
// try things no sensible player would.
import { createGame, startHand, act, options, toCall, potTotal } from '../js/holdem.js';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };

// Deterministic PRNG so a failure is reproducible from its seed.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const mk = (n, chips = 1000) => createGame({
  seats: Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i, chips, human: false })),
  smallBlind: 10, bigBlind: 20,
});

console.log('A. who posts the blinds');
for (const n of [2, 3, 4, 6]) {
  const g = mk(n);
  startHand(g);
  const posted = g.seats.filter((s) => s.bet > 0).map((s) => ({ seat: s.seat, bet: s.bet }));
  const btn = g.button;
  const after = (k) => (btn + k) % n;
  // Heads-up: the button IS the small blind. Otherwise SB is one left of the
  // button and BB is two.
  const wantSb = n === 2 ? btn : after(1);
  const wantBb = n === 2 ? after(1) : after(2);
  const wantFirst = n === 2 ? btn : after(3 % n);
  const sb = posted.find((p) => p.bet === 10)?.seat;
  const bb = posted.find((p) => p.bet === 20)?.seat;
  console.log(`  ${ok(sb === wantSb && bb === wantBb && g.turn === wantFirst)} ${n}-handed button=${btn}: sb=${sb} (want ${wantSb}) bb=${bb} (want ${wantBb}) first=${g.turn} (want ${wantFirst})`);
}

console.log('B. a blind that is all-in must not be handed the turn');
{
  // Heads-up, the small blind has 6 chips: posting puts them all in.
  const g = createGame({ seats: [
    { id: 0, name: 'Rich', chips: 1000, human: false },
    { id: 1, name: 'Broke', chips: 6, human: false },
  ], smallBlind: 10, bigBlind: 20 });
  g.button = 1;           // startHand advances it to 0... force via a spin below
  startHand(g);
  const t = g.seats[g.turn];
  const stuck = g.street !== 'showdown' && g.turn >= 0 && (!t || t.allIn || t.folded || t.out);
  console.log(`  ${ok(!stuck)} turn=${g.turn} street=${g.street} ` +
    `allIn=${t ? t.allIn : '-'} chips=${g.seats.map((s) => s.chips).join('/')}`);
}

console.log('C. fuzz: 4000 hands, 2-6 seats, random legal actions');
{
  let deadlocks = 0, leaks = 0, hands = 0, stalls = 0;
  for (let round = 0; round < 400; round++) {
    const n = 2 + Math.floor(rnd() * 5);
    const g = mk(n, 200 + Math.floor(rnd() * 1400));
    const bank = g.seats.reduce((a, s) => a + s.chips, 0);
    for (let h = 0; h < 10; h++) {
      startHand(g);
      if (g.street === 'over') break;
      hands++;
      let steps = 0;
      while (g.street !== 'showdown' && g.street !== 'over' && steps++ < 400) {
        if (g.turn < 0) break;
        const s = g.seats[g.turn];
        if (!s || s.allIn || s.folded || s.out) { deadlocks++; break; }
        const opts = options(g, s);
        const pick = opts[Math.floor(rnd() * opts.length)];
        const before = { street: g.street, turn: g.turn, pot: potTotal(g) };
        if (pick === 'bet' || pick === 'raise') {
          act(g, g.turn, pick, s.bet + toCall(g, s) + Math.ceil(rnd() * s.chips));
        } else {
          act(g, g.turn, pick);
        }
        if (g.street === before.street && g.turn === before.turn && potTotal(g) === before.pot) {
          stalls++; break;                       // act() refused and nothing moved
        }
      }
      if (steps >= 400) stalls++;
      // At showdown the pots are already paid into chips, so potTotal() would
      // double-count them; mid-hand it is the money still on the table.
      const now = g.seats.reduce((a, s) => a + s.chips, 0)
        + (g.street === 'showdown' ? 0 : potTotal(g));
      if (now !== bank) leaks++;
      if (g.seats.filter((s) => s.chips > 0).length < 2) break;
    }
    const end = g.seats.reduce((a, s) => a + s.chips, 0);
    if (end !== bank) leaks++;
  }
  console.log(`  hands=${hands} deadlocks=${deadlocks} stalls=${stalls} chipLeaks=${leaks}`);
  console.log(`  ${ok(!deadlocks && !stalls && !leaks)}`);
}

console.log('D. a finished hand leaves nothing on the table twice');
{
  // collect() SWEEPS bets into the pots; it does not zero them. nextStreet has
  // always cleared them afterwards and finish() did not, so from the end of a
  // hand until the next deal, potTotal() — pots plus live bets — counted the
  // final street's money twice, and the readout over the felt doubled at the
  // exact moment the player looked at it to see what they had won.
  let doubled = 0, hands = 0;
  for (let round = 0; round < 240; round++) {
    const n = 2 + (round % 5);
    const g = createGame({
      seats: Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, chips: 400 + i * 25, human: false })),
      smallBlind: 10, bigBlind: 20,
    });
    for (let h = 0; h < 4 && g.seats.filter((s) => s.chips > 0).length > 1; h++) {
      startHand(g);
      for (let steps = 0; steps < 400 && g.street !== 'showdown' && g.street !== 'over'; steps++) {
        if (g.turn < 0) break;
        const o = options(g, g.turn);
        if (!o.length) break;
        const pick = o[(steps + round) % o.length];
        const before = { street: g.street, turn: g.turn, pot: potTotal(g) };
        act(g, g.turn, pick, pick === 'raise' || pick === 'bet'
          ? Math.min(g.seats[g.turn].bet + g.seats[g.turn].chips, toCall(g, g.turn) + g.bigBlind * 2) : 0);
        if (g.street === before.street && g.turn === before.turn && potTotal(g) === before.pot) break;
      }
      if (g.street !== 'showdown') continue;
      hands++;
      const onSeats = g.seats.reduce((a, s) => a + s.bet, 0);
      const inPots = g.pots.reduce((a, p) => a + p.amount, 0);
      // Everything must be in the pots and nothing still in front of anybody,
      // so the readout equals the pot that was actually awarded.
      if (onSeats !== 0 || potTotal(g) !== inPots) doubled++;
    }
  }
  console.log(`  hands reaching showdown=${hands} with money counted twice=${doubled}`);
  console.log(`  ${ok(hands > 40 && doubled === 0)}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
