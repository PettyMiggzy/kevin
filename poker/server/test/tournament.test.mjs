// tournament.mjs, played rather than read.
//
//     node poker/server/test/tournament.test.mjs      (exits non-zero on a failure)
//
// Same fake-socket fuzzing style as table.test.mjs, one level up: instead of
// fuzzing a single table, this registers a whole field, starts the
// tournament, and drives EVERY active table's current turn with a random
// legal action every tick — through however many tables, rebalances, and
// blind levels it takes to end with exactly one winner. Two things get
// checked on every single tick, across every table the tournament is
// currently running: the same redaction property table.test.mjs checks
// (nobody's hole cards ever reach a socket that is not theirs outside a
// genuine multi-way showdown, checked self-contained the way
// integration.test.mjs's `everLeaked` does, since a mover's socket carries
// messages from more than one table over its lifetime here), and that the
// tournament's own chip ledger — the sum of every chip sitting at every
// active table (in a seat, in a pot, or queued in `waiting`) — never drifts
// from players registered × starting stack, exactly as bankOf() checks a
// single table in table.test.mjs.
import {
  createTournament, handleRegister, handleStart, handleAction, tick,
} from '../tournament.mjs';
import { options, toCall, potTotal } from '../../js/holdem.js';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };

class FakeSocket {
  constructor(name) { this.name = name; this.readyState = 1; this.sent = []; }
  send(text) { this.sent.push(JSON.parse(text)); }
}

/** Same self-contained rule as integration.test.mjs's everLeaked: every message stands on its own fields, so this works across a socket's whole life even though it moved between tables. */
function everLeaked(sent) {
  for (const msg of sent) {
    if (msg.type !== 'state') continue;
    const contenders = msg.seats.filter((s) => !s.folded && !s.out);
    const revealAll = msg.street === 'showdown' && contenders.length > 1;
    for (const s of msg.seats) {
      const shouldShow = s.mine || (revealAll && !s.folded && !s.out);
      if (!shouldShow && s.hole.some((c) => c !== null)) return `seat ${s.seat} at table ${msg.tableId} leaked`;
    }
  }
  return null;
}

/**
 * Every chip currently in the tournament: in a seat, in a pot, or in a
 * `waiting` queue (tournament seating always sets an explicit `chips` there
 * — see table.mjs's handleJoin). Eliminated players contribute nothing
 * because their stack was already paid out to whoever busted them, which
 * this sum already counts at that winner's seat.
 *
 * Same `street === 'showdown'` exclusion as table.test.mjs's own `bankOf`:
 * holdem.js's `finish()` sweeps the final street's bets into `g.pots` and
 * pays seats out of it, but does not clear `g.pots` itself (see its own
 * comment) — so between a hand ending and the next one dealing, `potTotal`
 * would double-count money that is already sitting in the winner's `chips`.
 */
function totalChipsInSystem(t) {
  let total = 0;
  for (const tb of t.tables.values()) {
    if (tb.game) {
      total += tb.game.seats.reduce((a, s) => a + s.chips, 0);
      if (tb.game.street !== 'showdown') total += potTotal(tb.game);
    }
    for (const w of tb.waiting) total += w.chips ?? 0;
  }
  return total;
}

let seed = 424242;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

function randomAction(g, seat) {
  const legal = options(g, seat);
  const choice = pick(legal);
  const amount = (choice === 'bet' || choice === 'raise')
    ? seat.bet + toCall(g, seat) + Math.ceil(rnd() * seat.chips) : 0;
  return { choice, amount };
}

/**
 * Drives every table's current turn once with `actionFor`, then ticks.
 * Returns after `maxSteps` even if not done, so a real bug hangs the test
 * with a clear failure instead of forever.
 *
 * The very action that finishes the tournament can fire from inside the
 * `for` loop below (a `handleAction` call that busts the runner-up settles
 * everything, tables included, synchronously) — checking the bank
 * afterward would then compare against `t.tables`, already emptied by
 * design, and call that a leak. Skipping the check once `status` has
 * already left `'running'` is not weaker: standings assert winner.chips
 * against the same `bank` separately, from `t.players` rather than the
 * now-retired tables.
 */
function runToCompletion(t, actionFor, maxSteps, clock, clockStep) {
  let steps = 0;
  let bankBad = 0;
  const bank = t.players.size * t.startChips;
  let sawLevelUp = false;
  while (t.status === 'running' && steps++ < maxSteps) {
    if (clock) clock.value += clockStep;
    tick(t);
    if (t.status !== 'running') break;
    if (t.levelIndex > 0) sawLevelUp = true;
    for (const tb of t.tables.values()) {
      const g = tb.game;
      if (!g || tb.phase !== 'playing' || g.turn < 0) continue;
      const seat = g.seats[g.turn];
      if (!seat.connected) continue;
      const { choice, amount } = actionFor(g, seat);
      handleAction(t, seat.ws, choice, amount);
    }
    if (t.status !== 'running') break;
    if (totalChipsInSystem(t) !== bank) bankBad++;
  }
  return { steps, bankBad, sawLevelUp, bank };
}

console.log('A. a full randomized tournament runs to exactly one winner: chips conserved, no leaks, standings complete');
{
  const N = 8;
  const clock = { value: 0 };
  const t = createTournament('fuzz-mtt', {
    name: 'Fuzz MTT',
    startChips: 500,
    seatsPerTable: 3, // forces 3 tables at 8 players, guaranteeing real rebalancing as the field shrinks
    minPlayers: 2,
    now: () => clock.value,
    levels: [
      { smallBlind: 10, bigBlind: 20, durationMs: 400 },
      { smallBlind: 25, bigBlind: 50, durationMs: 400 },
      { smallBlind: 50, bigBlind: 100, durationMs: 400 },
      { smallBlind: 100, bigBlind: 200, durationMs: Infinity },
    ],
  });

  const sockets = Array.from({ length: N }, (_, i) => new FakeSocket(`P${i}`));
  for (const ws of sockets) handleRegister(t, ws, ws.name);
  console.log(`  ${ok(t.players.size === N)} all ${N} registrations recorded`);
  console.log(`  ${ok(t.status === 'registering')} tournament waits in 'registering' until started`);

  handleStart(t, sockets[0]);
  console.log(`  ${ok(t.status === 'running')} tournament starts once minPlayers is met`);
  console.log(`  ${ok(t.tables.size === 3)} 8 players at 3-per-table seats exactly 3 tables`);
  const seatedAtStart = [...t.tables.values()].reduce((n, tb) => n + tb.waiting.length + (tb.game?.seats.length ?? 0), 0);
  console.log(`  ${ok(seatedAtStart === N)} every registrant is seated (or queued) somewhere at start`);

  const { steps, bankBad, sawLevelUp, bank } = runToCompletion(
    t,
    (g, s) => randomAction(g, s),
    30000,
    clock,
    50,
  );
  console.log(`  steps=${steps} bank=${bank} bank mismatches=${bankBad} blind level reached=${t.levelIndex} winner-declared=${t.status === 'done'}`);
  console.log(`  ${ok(t.status === 'done')} the tournament actually finishes within the step budget`);
  console.log(`  ${ok(bankBad === 0)} total chips in the system never drifted from players × starting stack`);
  console.log(`  ${ok(sawLevelUp)} the blind level advanced at least once over the course of the tournament`);

  let leak = null;
  for (const ws of sockets) { const l = everLeaked(ws.sent); if (l && !leak) leak = `${ws.name}: ${l}`; }
  console.log(`  ${ok(!leak)}${leak ? '  ' + leak : ''} no socket ever saw a hole card that was not theirs, across every table it ever sat at`);

  console.log(`  ${ok(!!t.standings && t.standings.length === N)} standings cover every registrant`);
  const positions = (t.standings || []).map((s) => s.position).sort((a, b) => a - b);
  const wantPositions = Array.from({ length: N }, (_, i) => i + 1);
  console.log(`  ${ok(JSON.stringify(positions) === JSON.stringify(wantPositions))} positions are a complete 1..${N} with no gaps or ties`);
  const winnerRow = (t.standings || []).find((s) => s.position === 1);
  console.log(`  ${ok(!!winnerRow && winnerRow.chips === bank)} the winner ends up holding every chip in play (${winnerRow?.chips} of ${bank})`);
  const losers = (t.standings || []).filter((s) => s.position !== 1);
  console.log(`  ${ok(losers.every((s) => s.chips === 0))} everyone else finishes with 0 chips`);
  console.log(`  ${ok(t.tables.size === 0)} tables are cleaned up once the tournament ends`);
}

console.log('B. eliminations shrink the field enough to force a real table merge, and isolation holds across it');
{
  // Small, check/call-only field so hands reliably reach showdown (nobody
  // folds) and the short blind schedule below forces quick eliminations —
  // this exists to GUARANTEE the "break the shortest table" path in
  // rebalance() actually runs during this test, not just hope a big
  // randomized fuzz happens to hit it.
  const N = 4;
  const clock = { value: 0 };
  const t = createTournament('fuzz-merge', {
    name: 'Merge test',
    startChips: 60,
    seatsPerTable: 2, // 4 players -> 2 tables of 2; down to 2 players -> must merge to 1 table
    minPlayers: 2,
    now: () => clock.value,
    levels: [{ smallBlind: 10, bigBlind: 20, durationMs: Infinity }],
  });
  const sockets = Array.from({ length: N }, (_, i) => new FakeSocket(`Q${i}`));
  for (const ws of sockets) handleRegister(t, ws, ws.name);
  handleStart(t, sockets[0]);
  console.log(`  ${ok(t.tables.size === 2)} 4 players at 2-per-table start on 2 separate tables`);

  const tableCountsSeen = new Set();
  const checkOrCall = (g, s) => {
    const legal = options(g, s);
    return { choice: legal.includes('check') ? 'check' : 'call', amount: 0 };
  };
  const { steps, bankBad, bank } = (() => {
    let stepsLocal = 0, bankBadLocal = 0;
    const bankLocal = t.players.size * t.startChips;
    while (t.status === 'running' && stepsLocal++ < 20000) {
      tick(t);
      tableCountsSeen.add(t.tables.size);
      if (t.status !== 'running') break;
      for (const tb of t.tables.values()) {
        const g = tb.game;
        if (!g || tb.phase !== 'playing' || g.turn < 0) continue;
        const seat = g.seats[g.turn];
        if (!seat.connected) continue;
        const { choice, amount } = checkOrCall(g, seat);
        handleAction(t, seat.ws, choice, amount);
      }
      if (t.status !== 'running') break; // see runToCompletion's comment above — the finishing action can fire from inside this loop
      if (totalChipsInSystem(t) !== bankLocal) bankBadLocal++;
    }
    return { steps: stepsLocal, bankBad: bankBadLocal, bank: bankLocal };
  })();

  console.log(`  steps=${steps} table counts observed=${[...tableCountsSeen].sort().join(',')}`);
  console.log(`  ${ok(t.status === 'done')} this small tournament also finishes within budget`);
  console.log(`  ${ok(bankBad === 0)} chips stayed conserved through the merge too`);
  console.log(`  ${ok(tableCountsSeen.has(1))} the field really did shrink to a single merged table at some point`);
  const winnerRow = (t.standings || []).find((s) => s.position === 1);
  console.log(`  ${ok(!!winnerRow && winnerRow.chips === bank)} the winner still holds every chip after the merge (${winnerRow?.chips} of ${bank})`);

  let leak = null;
  for (const ws of sockets) { const l = everLeaked(ws.sent); if (l && !leak) leak = `${ws.name}: ${l}`; }
  console.log(`  ${ok(!leak)}${leak ? '  ' + leak : ''} no leak across the merge either`);
}

console.log('C. registering, unregistering, and starting are refused at the wrong times');
{
  const t = createTournament('guard', { minPlayers: 3 });
  const a = new FakeSocket('A'), b = new FakeSocket('B');
  handleRegister(t, a, 'A');
  handleStart(t, a);
  console.log(`  ${ok(t.status === 'registering')} start is refused below minPlayers`);
  console.log(`  ${ok(a.sent.at(-1)?.type === 'error')} the requester gets an error, not a silent no-op`);

  handleRegister(t, b, 'B');
  const c = new FakeSocket('C');
  handleRegister(t, c, 'C');
  handleStart(t, b);
  console.log(`  ${ok(t.status === 'running')} any registrant can start it once minPlayers is met`);

  const d = new FakeSocket('D');
  handleRegister(t, d, 'D');
  console.log(`  ${ok(t.players.size === 3)} registering after start is refused`);
  console.log(`  ${ok(d.sent.at(-1)?.type === 'error')} the late registrant gets an error`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
