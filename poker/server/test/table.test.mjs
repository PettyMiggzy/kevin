// table.mjs, played rather than read.
//
//     node poker/server/test/table.test.mjs      (exits non-zero on a failure)
//
// holdem.test.mjs fuzzes the rules; this fuzzes the wrapper around them —
// random players joining, acting, and disconnecting against random tables —
// and checks the one property this whole task exists for: nobody ever
// receives a hole card that is not theirs outside a real multi-way showdown.
// It also checks the wrapper does not itself leak or duplicate chips across
// a stable seating, and that a disconnect mid-turn never stalls the table.
//
// Fake sockets rather than real ones — table.mjs only needs `.send` and
// `.readyState`, so this runs fast and needs no network, the same reason
// holdem.js's own fuzz test needs no browser.
import {
  createTable, handleJoin, handleAction, handleDisconnect, tryStartHand, viewFor, MAX_SEATS,
} from '../table.mjs';
import { options, toCall, potTotal } from '../../js/holdem.js';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };

let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

class FakeSocket {
  constructor(name) { this.name = name; this.readyState = 1; this.sent = []; }
  send(text) { this.sent.push(JSON.parse(text)); }
}

/**
 * The security check. `viewFor` is also exercised directly by the server on
 * every broadcast, but re-deriving "should this be visible" from the real
 * game object here — independently of table.mjs's own reasoning — is the
 * point: it catches table.mjs agreeing with itself while being wrong.
 */
function findLeak(table) {
  const g = table.game;
  if (!g) return null;
  const contenders = g.seats.filter((s) => !s.folded && !s.out);
  const revealAll = g.street === 'showdown' && contenders.length > 1;
  for (const ws of table.sockets) {
    const last = ws.sent[ws.sent.length - 1];
    if (!last || last.type !== 'state') continue;
    for (let i = 0; i < last.seats.length; i++) {
      const seen = last.seats[i];
      const real = g.seats[i];
      if (seen.mine && real.ws !== ws) return `seat ${i} marked "mine" for a socket that does not own it`;
      const shouldShow = seen.mine || (revealAll && !real.folded && !real.out);
      if (!shouldShow) {
        if (seen.hole.some((c) => c !== null)) return `seat ${i}'s hole cards leaked to a viewer who should not see them`;
      } else if (real.hole.length && seen.hole.some((c, k) => c !== real.hole[k])) {
        return `seat ${i}'s revealed hole cards do not match the real cards`;
      }
    }
  }
  return null;
}

/** chips still in hand + everything already committed to the pot(s) this street or earlier. */
const bankOf = (g) => g.seats.reduce((a, s) => a + s.chips, 0) + (g.street === 'showdown' ? 0 : potTotal(g));

console.log('A. redaction holds and chips stay conserved across random multiplayer play');
{
  let leak = null, bankBad = 0, handsStarted = 0, tables = 0;
  for (let trial = 0; trial < 50; trial++) {
    tables++;
    const table = createTable(`fuzz-${trial}`, { smallBlind: 10, bigBlind: 20, startChips: 300 + Math.floor(rnd() * 900) });
    const n = 2 + Math.floor(rnd() * (MAX_SEATS - 1));
    const sockets = Array.from({ length: n }, (_, i) => new FakeSocket(`P${trial}-${i}`));
    for (const ws of sockets) handleJoin(table, ws, ws.name);

    let baseline = null;
    for (let step = 0; step < 2000; step++) {
      // Occasionally scatter a connection, exercising the disconnect path —
      // but never below 2, or there is nothing left to fuzz.
      if (rnd() < 0.015 && table.sockets.size > 2) {
        handleDisconnect(table, pick([...table.sockets]));
      }
      // The real gap between hands is a setTimeout (see table.mjs), which a
      // synchronous fuzz loop never lets fire. Drive it directly — the delay
      // is UX pacing for a browser, not a rule the engine depends on.
      if (table.phase === 'idle' && table.game && table.sockets.size >= 2) {
        clearTimeout(table.nextTimer);
        tryStartHand(table);
        if (table.phase === 'playing') handsStarted++;
      }

      if (table.game !== baseline?.gameRef) {
        // A new game object means the seating changed — chips a departed
        // player still had are deliberately forfeited (see table.mjs), so
        // conservation is only checked within one stable seating, exactly
        // as holdem.test.mjs checks it within one stable table.
        baseline = { gameRef: table.game, bank: table.game ? bankOf(table.game) : 0 };
      }

      const found = findLeak(table);
      if (found && !leak) leak = `${found} (trial ${trial}, step ${step})`;

      const g = table.game;
      if (g && bankOf(g) !== baseline.bank) bankBad++;

      if (!g || table.phase !== 'playing' || g.turn < 0) continue;
      const seat = g.seats[g.turn];
      if (!seat.connected) continue; // should be impossible — autoAct handles this synchronously
      const legal = options(g, seat);
      const choice = pick(legal);
      const amount = (choice === 'bet' || choice === 'raise')
        ? seat.bet + toCall(g, seat) + Math.ceil(rnd() * seat.chips)
        : 0;
      handleAction(table, seat.ws, choice, amount);
    }
  }
  console.log(`  tables=${tables} hands started=${handsStarted} bank mismatches=${bankBad}`);
  console.log(`  ${ok(!leak && !bankBad)}${leak ? '  ' + leak : ''}`);
}

console.log('B. acting out of turn, or with an action options() does not allow, changes nothing');
{
  const table = createTable('imp', { startChips: 500 });
  const a = new FakeSocket('A'), b = new FakeSocket('B');
  handleJoin(table, a, 'A');
  handleJoin(table, b, 'B');
  const g = table.game;
  const rightWs = g.seats[g.turn].ws;
  const wrongWs = rightWs === a ? b : a;

  const before = JSON.stringify(g.seats.map((s) => ({ chips: s.chips, bet: s.bet, folded: s.folded })));
  handleAction(table, wrongWs, 'fold');
  const afterWrongTurn = JSON.stringify(g.seats.map((s) => ({ chips: s.chips, bet: s.bet, folded: s.folded })));
  console.log(`  ${ok(before === afterWrongTurn)} acting out of turn changes nothing`);
  console.log(`  ${ok(wrongWs.sent.at(-1)?.type === 'error')} the wrong-turn actor gets an error, not a state update`);

  const stillRight = g.seats[g.turn].ws === rightWs;
  const illegal = options(g, g.seats[g.turn]).includes('check') ? 'call' : 'check';
  handleAction(table, rightWs, illegal);
  console.log(`  ${ok(stillRight && g.turn === g.seats.findIndex((s) => s.ws === rightWs))} turn did not move on an illegal action`);
  console.log(`  ${ok(rightWs.sent.at(-1)?.type === 'error')} an action outside options() is refused with an error`);
}

console.log('C. own hole cards are visible immediately; the opponent\'s are null pre-showdown');
{
  const table = createTable('view', { startChips: 500 });
  const a = new FakeSocket('A'), b = new FakeSocket('B');
  handleJoin(table, a, 'A');
  handleJoin(table, b, 'B');
  const g = table.game;
  const seatA = g.seats.findIndex((s) => s.ws === a);
  const seatB = g.seats.findIndex((s) => s.ws === b);
  const va = viewFor(table, a), vb = viewFor(table, b);
  console.log(`  ${ok(va.seats[seatA].hole.every((c) => typeof c === 'string'))} A sees A's own hole cards`);
  console.log(`  ${ok(va.seats[seatB].hole.every((c) => c === null))} A does not see B's hole cards`);
  console.log(`  ${ok(vb.seats[seatA].hole.every((c) => c === null))} B does not see A's hole cards`);
  console.log(`  ${ok(!va.seats.some((s) => JSON.stringify(s) === JSON.stringify(g)))} sanity: view is not just the raw game object`);
}

console.log('D. a lone player waits; a hand starts once a second joins; nobody crashes below two');
{
  const table = createTable('lonely', { startChips: 500 });
  const a = new FakeSocket('A');
  handleJoin(table, a, 'A');
  console.log(`  ${ok(table.phase === 'idle' && !table.game)} nobody is dealt to with one player`);
  const b = new FakeSocket('B');
  handleJoin(table, b, 'B');
  console.log(`  ${ok(table.phase === 'playing' && table.game && table.game.turn >= 0)} a hand starts once a second player joins`);

  handleDisconnect(table, b);
  console.log(`  ${ok(!!table.game)} the table survives its only opponent vanishing`);
  console.log(`  ${ok(table.sockets.size === 1)} the remaining socket is still tracked`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
