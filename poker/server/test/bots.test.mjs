// Server-side bot opponents and the leaderboard, played rather than read.
//
//     node poker/server/test/bots.test.mjs      (exits non-zero on a failure)
//
// Two levels, the same shape as the rest of this suite: section B fuzzes
// table.mjs + bots.mjs directly with fake sockets (fast, no network, no real
// timers — it drives scheduleBotTurn's own logic synchronously instead of
// waiting on its setTimeout, the same "the delay is UX pacing, not a rule"
// trick table.test.mjs uses for settleIfDone's nextTimer). Sections A, C, D,
// E1 and E2 drive the real server (the same index.mjs a browser talks to)
// with a real `ws` client and real wall-clock bot "thinking" pauses, so a
// bug in how index.mjs wires POST /tables's `bots` field, or in
// scheduleBotTurn's real setTimeout chain, has somewhere to show up that a
// same-process test cannot catch.
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { startServer } from '../index.mjs';
import { open as openLeaderboardDb } from '../db.mjs';
import {
  createTable, addBots, handleJoin, handleAction, tryStartHand,
} from '../table.mjs';
import { options } from '../../js/holdem.js';
import { botMove } from '../bots.mjs';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeSocket {
  constructor(name) { this.name = name; this.readyState = 1; this.sent = []; }
  send(text) { this.sent.push(JSON.parse(text)); }
}

/** Same leak-detection rule as table.test.mjs's findLeak / integration.test.mjs's everLeaked, applied to a whole socket transcript — a bot's hole cards get exactly the same redaction a human's do, no special case either way. */
function everLeaked(log) {
  for (const msg of log) {
    if (msg.type !== 'state') continue;
    const contenders = msg.seats.filter((s) => !s.folded && !s.out);
    const revealAll = msg.street === 'showdown' && contenders.length > 1;
    for (const s of msg.seats) {
      const shouldShow = s.mine || (revealAll && !s.folded && !s.out);
      if (!shouldShow && s.hole.some((c) => c !== null)) return `seat ${s.seat} (bot=${s.bot}) leaked pre-showdown`;
    }
  }
  return null;
}

async function waitUntil(pred, timeoutMs = 3000, stepMs = 40) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(stepMs);
  }
  return pred();
}

console.log('B. a bot never takes an action options() would not allow, across many fuzzed hands');
{
  let seed = 246813579;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let illegal = null;
  let botActions = 0;

  for (let trial = 0; trial < 20 && !illegal; trial++) {
    // Bots seated before the one human joins — the production order (see
    // index.mjs's POST /tables: addBots runs right after createTable, before
    // anyone's `join` ever reaches the table) — so the human's own join is
    // what satisfies tryStartHand's `combined.length < 2` gate and deals
    // everyone in together, exactly like a lone real visitor's table.
    const table = createTable(`botfuzz-${trial}`, {
      smallBlind: 10, bigBlind: 20, startChips: 200 + Math.floor(rnd() * 400),
    });
    addBots(table, 1 + Math.floor(rnd() * 5));
    const human = new FakeSocket('Human');
    handleJoin(table, human, 'Human'); // triggers tryStartHand; deals in human + bots together

    for (let step = 0; step < 400 && !illegal; step++) {
      if (table.phase === 'idle' && table.game) {
        clearTimeout(table.nextTimer);
        tryStartHand(table);
      }
      const g = table.game;
      if (!g || table.phase !== 'playing' || g.turn < 0) continue;
      const seat = g.seats[g.turn];
      if (!seat.bot) {
        // Keep the hand moving with the simplest always-legal action — this
        // section exists to fuzz BOT legality, not human decisions.
        const legal = options(g, seat);
        handleAction(table, seat.ws, legal.includes('check') ? 'check' : 'call', 0);
        continue;
      }
      // The exact check handleAction itself makes, re-derived independently
      // here rather than trusted: options() BEFORE botMove decides, then
      // assert botMove's own choice is a member of that same set.
      const legalBefore = options(g, seat);
      const [action, amount] = botMove(g, seat);
      botActions++;
      if (!legalBefore.includes(action)) {
        illegal = `trial ${trial} step ${step}: bot seat ${g.turn} (style=${seat.style}) chose "${action}", ` +
          `legal was [${legalBefore.join(',')}]`;
        break;
      }
      handleAction(table, seat.ws, action, amount);
      // handleAction's own scheduleBotTurn call (see table.mjs) would arm a
      // REAL setTimeout for the next bot's turn here — irrelevant to this
      // synchronous driver (which is about to decide that turn itself right
      // away) and left pending would eventually re-fire handleAction later,
      // mid- or post-test, on a table this loop has already moved past.
      // scheduleBotTurn's own re-validation would no-op it harmlessly, but
      // clearing it outright is simpler than relying on that.
      clearTimeout(table.botTimer);
    }
  }
  console.log(`  trials=20 bot actions checked=${botActions}`);
  console.log(`  ${ok(!illegal)}${illegal ? '  ' + illegal : ''} every bot action was a member of options() at the moment it acted`);
}

const dbFile = join(tmpdir(), `kevin-poker-bots-test-${process.pid}-${Date.now()}.db`);
const srv = startServer({ port: 0, dbFile });
const port = srv.httpServer.address().port;
const sockets = [];

function connect(tableId) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${tableId}`);
  sockets.push(ws);
  return ws;
}
const onOpen = (ws) => new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

function bus(ws) {
  const log = [];
  const queue = [];
  let cursor = 0;
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    log.push(msg);
    queue.push(msg);
    for (const w of waiters.splice(0)) w();
  });
  async function waitFor(pred, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (; cursor < queue.length; cursor++) if (pred(queue[cursor])) return queue[cursor++];
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a matching message');
      await new Promise((resolve) => {
        const t = setTimeout(resolve, remaining);
        waiters.push(() => { clearTimeout(t); resolve(); });
      });
    }
  }
  return { log, waitFor };
}

async function postTable(body) {
  return fetch(`http://127.0.0.1:${port}/tables`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
}

/** Check/call on our own turn; wait passively otherwise — the server's real scheduleBotTurn timers act for every bot seat on their own. */
async function playPassively(watcher, socket, state, you) {
  let guard = 0;
  while (state.street !== 'showdown' && state.street !== 'over' && guard++ < 150) {
    if (state.turn === you) {
      const seat = state.seats[you];
      const legal = options({ seats: state.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: seat.bet, chips: seat.chips });
      socket.send(JSON.stringify({ type: 'action', action: legal.includes('check') ? 'check' : 'call', amount: 0 }));
    }
    state = await watcher.waitFor((m) => m.type === 'state' || m.type === 'error');
    if (state.type === 'error') throw new Error('server rejected a legal action: ' + state.message);
  }
  return state;
}

let handA, tableIdA, finalA, busA;
console.log('A. a lone real socket, a bots table, and a full hand to a real conclusion — no second human ever connects');
{
  const created = await postTable({ name: 'Solo vs bots', bots: 3 });
  console.log(`  ${ok(!!created.id)} POST /tables with bots:3 returns a real table id`);
  tableIdA = created.id;

  const ws = connect(tableIdA);
  await onOpen(ws);
  busA = bus(ws);
  ws.send(JSON.stringify({ type: 'join', name: 'Solo' }));

  const dealt = await busA.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
  console.log(`  ${ok(dealt.seats.length === 4)} the lone human plus 3 bots make a 4-seat hand`);
  console.log(`  ${ok(dealt.seats.filter((s) => s.bot).length === 3)} exactly 3 seats are flagged bot:true`);
  console.log(`  ${ok(!dealt.seats[dealt.you].bot)} the human's own seat is not flagged as a bot`);
  // Blinds are already posted by the time this first preflop broadcast
  // arrives (startHand posts them before dealing hole cards), which moved
  // that money from `chips` into `bet` — include `bet` here or this
  // under-counts the true total by the blinds, same as `bankOf`-style
  // checks elsewhere in this suite account for live bets mid-hand.
  const startChips = dealt.seats.reduce((a, s) => a + s.chips + s.bet, 0);

  const state = await playPassively(busA, ws, dealt, dealt.you);
  console.log(`  ${ok(state.street === 'showdown')} the hand reaches a real conclusion driven by the server's own bot timers`);
  // `g.pots` is left un-cleared after a hand concludes (its amounts are
  // already paid into the winners' `chips` by then — see holdem.js's
  // `finish()`), so a post-showdown bank check reads `chips` alone, exactly
  // like table.test.mjs's own `bankOf` helper does for the same reason.
  const endChips = state.seats.reduce((a, s) => a + s.chips, 0);
  console.log(`  ${ok(endChips === startChips)} chips are conserved across a table that is mostly bots`);

  handA = state.hand;
  finalA = state;
  console.log(`  ${ok(srv.tables.get(tableIdA)?.sockets.size === 1)} exactly one real socket was ever connected to this table`);
}

console.log('C. no bot seat\'s hole cards ever leaked any differently than a human seat\'s would');
console.log(`  ${ok(!everLeaked(busA.log))}${everLeaked(busA.log) ? '  ' + everLeaked(busA.log) : ''}`);

console.log('D. once the only human disconnects from an all-bot-remaining table, no further bot action is scheduled and the table is dropped');
{
  const created = await postTable({ bots: 3 });
  const ws = connect(created.id);
  await onOpen(ws);
  const b = bus(ws);
  ws.send(JSON.stringify({ type: 'join', name: 'Lonely' }));
  await b.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);

  const table = srv.tables.get(created.id);
  console.log(`  ${ok(!!table && !table.closed)} the table exists and is not yet closed while its one human is connected`);

  ws.close();
  const dropped = await waitUntil(() => !srv.tables.has(created.id));
  console.log(`  ${ok(dropped)} the table is removed from the server's registry once its only human disconnects`);
  console.log(`  ${ok(table.closed === true)} the table is marked closed so scheduleBotTurn refuses to arm another timer`);

  const handAfter = table.game.hand;
  const turnAfter = table.game.turn;
  const chipsAfter = table.game.seats.map((s) => s.chips);
  // Longer than scheduleBotTurn's own 550-1400ms max "thinking" delay — if a
  // bot timer had survived the disconnect, this is enough time for it to
  // have fired and changed the game underneath us.
  await sleep(2000);
  const unchanged = table.game.hand === handAfter && table.game.turn === turnAfter
    && JSON.stringify(table.game.seats.map((s) => s.chips)) === JSON.stringify(chipsAfter);
  console.log(`  ${ok(unchanged)} nothing about the game changed in the 2s after disconnect — no orphaned bot timer fired`);
}

console.log('E. the leaderboard: settled-hand deltas are recorded accurately and, for an all-human hand, sum to zero');
{
  const lb = openLeaderboardDb(dbFile);

  // E1 — the bots table from section A: only the human seat is recorded
  // (bots never appear on the leaderboard, by design — see db.mjs's
  // recordHand), and the recorded delta must exactly match the human's own
  // real chip change over that hand, even though the other three seats'
  // offsetting movements are deliberately not recorded at all.
  const rowsA = lb.db.prepare('SELECT name, delta FROM hand_results WHERE table_id = ? AND hand = ?').all(tableIdA, handA);
  console.log(`  ${ok(rowsA.length === 1)} exactly one recorded delta for a 1-human/3-bot hand (the human's)`);
  const human = finalA.seats[finalA.you];
  const expectedDelta = human.chips - 2000; // 2000 is this table's default startChips
  console.log(`  ${ok(rowsA[0]?.name === 'Solo' && rowsA[0]?.delta === expectedDelta)} the recorded delta (${rowsA[0]?.delta}) matches the human's real chip change (${expectedDelta})`);

  // E2 — a fresh, bot-free, two-human table: with every seat recorded (no
  // bot seats to exclude), the sum of that hand's recorded deltas must be
  // exactly zero — the same chip-conservation invariant the rest of this
  // suite already checks directly against game.seats, now checked against
  // what actually landed in the database.
  const created = await postTable({ name: 'no bots here' });
  const alice = connect(created.id), bob = connect(created.id);
  await Promise.all([onOpen(alice), onOpen(bob)]);
  const a = bus(alice), b = bus(bob);
  alice.send(JSON.stringify({ type: 'join', name: `Alice-${randomUUID().slice(0, 6)}` }));
  bob.send(JSON.stringify({ type: 'join', name: `Bob-${randomUUID().slice(0, 6)}` }));
  const dealt = await a.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
  await b.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
  console.log(`  ${ok(!dealt.seats.some((s) => s.bot))} this second table has no bots at all`);

  let state = dealt;
  let guard = 0;
  while (state.street !== 'showdown' && state.street !== 'over' && guard++ < 80) {
    const seat = state.seats[state.turn];
    const legal = options({ seats: state.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: seat.bet, chips: seat.chips });
    const actor = seat.mine ? alice : bob;
    actor.send(JSON.stringify({ type: 'action', action: legal.includes('check') ? 'check' : 'call', amount: 0 }));
    state = await a.waitFor((m) => m.type === 'state' || m.type === 'error');
  }
  await b.waitFor((m) => m.type === 'state' && m.street === state.street);
  console.log(`  ${ok(state.street === 'showdown')} the bot-free hand also reaches a real conclusion`);

  const rowsE2 = lb.db.prepare('SELECT name, delta FROM hand_results WHERE table_id = ? AND hand = ?').all(created.id, state.hand);
  console.log(`  ${ok(rowsE2.length === 2)} both players' deltas were recorded for an all-human hand`);
  const sum = rowsE2.reduce((n, r) => n + r.delta, 0);
  console.log(`  ${ok(sum === 0)} the sum of recorded deltas for a fully-recorded hand is zero (got ${sum})`);

  lb.db.close();
}

for (const ws of sockets) { try { ws.close(); } catch { /* already closed */ } }
await srv.close();
rmSync(dbFile, { force: true });
rmSync(`${dbFile}-wal`, { force: true });
rmSync(`${dbFile}-shm`, { force: true });

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
