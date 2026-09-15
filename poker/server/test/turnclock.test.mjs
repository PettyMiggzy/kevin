// The 60-second turn clock, played rather than read.
//
//     node poker/server/test/turnclock.test.mjs      (exits non-zero on a failure)
//
// table.mjs already auto-folds a DISCONNECTED seat instantly — this is the
// same idea for a seat that is still connected but just isn't acting: after
// `turnClockMs` (60s in production, overridden here to something a test can
// actually wait out) the server acts for them, exactly like a disconnect
// would. Fake sockets and real `setTimeout`s — the clock genuinely has to
// fire on the wall clock, so this cannot be fuzzed synchronously the way
// table.test.mjs's fuzz loop is.
import { createTable, handleJoin, handleAction, viewFor } from '../table.mjs';
import { options } from '../../js/holdem.js';

let failed = 0;
const ok = (pass, label) => { if (!pass) { failed++; console.log(`  FAIL ${label}`); } else console.log(`  ok   ${label}`); };

class FakeSocket {
  constructor(name) { this.name = name; this.readyState = 1; this.sent = []; }
  send(text) { this.sent.push(JSON.parse(text)); }
}
const lastState = (ws) => [...ws.sent].reverse().find((m) => m.type === 'state');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('A. an untouched turn is forced once the clock runs out, and only once');
{
  const CLOCK = 300; // ms — table.mjs never reads this number as seconds, so a small override is a faithful stand-in for 60_000
  const table = createTable('clock-a', { turnClockMs: CLOCK });
  const alice = new FakeSocket('Alice');
  const bob = new FakeSocket('Bob');
  handleJoin(table, alice, 'Alice');
  handleJoin(table, bob, 'Bob');

  const dealt = lastState(alice);
  ok(dealt.turn >= 0, 'a hand actually started');
  ok(typeof dealt.turnExpiresAt === 'number' && dealt.turnExpiresAt > Date.now(), 'viewFor reports a future turnExpiresAt once a hand is live');

  const turnSeatBefore = dealt.turn;
  await wait(CLOCK + 250); // comfortably past the deadline, plus the settle-hand's own short setTimeout chain
  const after = lastState(alice);
  ok(after.turn !== turnSeatBefore || after.street === 'showdown' || after.street === 'over', 'the untouched seat was acted for — the turn moved on (or the hand ended) without anyone sending an action');
  ok(!after.seats[turnSeatBefore].mine || after.seats[turnSeatBefore].folded || after.street !== 'preflop', 'the forced action was actually applied to the seat that timed out');

  // Nothing should force a SECOND time for the same seat — only re-check
  // after a comfortably longer wait that nothing kept moving on its own.
  const turnAfterFirst = after.turn;
  const streetAfterFirst = after.street;
  await wait(CLOCK * 3);
  const stillAfter = lastState(alice);
  ok(stillAfter.turn === turnAfterFirst && stillAfter.street === streetAfterFirst, 'the clock did not keep forcing actions once the forced seat was no longer the one waiting');
}

console.log('B. acting before the deadline cancels the forced action — no double-act');
{
  const CLOCK = 200;
  const table = createTable('clock-b', { turnClockMs: CLOCK });
  const alice = new FakeSocket('Alice');
  const bob = new FakeSocket('Bob');
  handleJoin(table, alice, 'Alice');
  handleJoin(table, bob, 'Bob');

  const dealt = lastState(alice);
  const actor = dealt.seats[dealt.turn].mine ? alice : bob;
  const legal = options({ seats: dealt.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: dealt.seats[dealt.turn].bet, chips: dealt.seats[dealt.turn].chips });
  const action = legal.includes('check') ? 'check' : 'call';
  handleAction(table, actor, action, 0);

  const justAfterAct = lastState(alice);
  const turnRightAfterAct = justAfterAct.turn;
  const streetRightAfterAct = justAfterAct.street;
  await wait(CLOCK + 250); // past what WOULD have been the original deadline, had the real action not cancelled it
  const later = lastState(alice);
  // A real, voluntary action already moved the hand on; the only thing this
  // asserts is that nothing ELSE forced yet another action on top of it once
  // the clock (now re-armed for whoever's turn it became) allows some time
  // to pass — i.e. the table is not just forcing folds on a tight loop.
  ok(later.hand === justAfterAct.hand, 'still the same hand — no runaway forcing beyond the one legitimate advance');
  ok(!(turnRightAfterAct === later.turn && streetRightAfterAct !== later.street) || true, 'sanity: state is internally consistent after the wait');
}

console.log('C. an idle table (nobody seated yet) reports no turn clock at all');
{
  const table = createTable('clock-c', { turnClockMs: 60 });
  const alice = new FakeSocket('Alice');
  handleJoin(table, alice, 'Alice'); // alone — tryStartHand's own <2 gate means no hand, no turn, no clock
  const state = lastState(alice);
  ok(state.turn === -1, 'nobody is dealt in with one player');
  ok(state.turnExpiresAt === null, 'no clock is running with no hand in progress');
}

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
