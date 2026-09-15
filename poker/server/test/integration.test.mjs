// The whole stack, played rather than read.
//
//     node poker/server/test/integration.test.mjs      (exits non-zero on a failure)
//
// table.test.mjs fuzzes table.mjs directly with fake sockets. This drives
// the real server (the same index.mjs a browser talks to) with real `ws`
// clients over a real TCP socket, through an actual hand to a real showdown
// — so a bug in the JSON wire format, in how index.mjs wires messages to
// table.mjs, or in the WebSocket upgrade path, has somewhere to show up
// that a same-process test cannot catch.
import WebSocket from 'ws';
import { startServer } from '../index.mjs';
import { options } from '../../js/holdem.js';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };

const connect = (port, table) => new WebSocket(`ws://127.0.0.1:${port}/ws/${table}`);

const onOpen = (ws) => new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

/**
 * A queue, not a one-shot listener. The server can (and does — see the "B
 * calls" / "C folds" pair below) put two broadcasts on the wire back to
 * back, close enough together that both 'message' events fire in the same
 * synchronous burst. A `waitFor` that only registers its listener after an
 * `await` resumes can miss the second one outright — this file's first
 * version of that helper did exactly that and hung. Buffering every message
 * as it arrives and scanning forward from a cursor cannot lose one.
 */
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
  async function waitFor(pred, timeoutMs = 4000) {
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

/** No non-owned, non-showdown hole card ever appeared anywhere in this socket's history. */
function everLeaked(log) {
  for (const msg of log) {
    if (msg.type !== 'state') continue;
    const contenders = msg.seats.filter((s) => !s.folded && !s.out);
    const revealAll = msg.street === 'showdown' && contenders.length > 1;
    for (const s of msg.seats) {
      const shouldShow = s.mine || (revealAll && !s.folded && !s.out);
      if (!shouldShow && s.hole.some((c) => c !== null)) return `seat ${s.seat} leaked pre-showdown`;
    }
  }
  return null;
}

const srv = startServer({ port: 0 });
const port = srv.httpServer.address().port;

console.log('A. two real clients play a full hand to a real showdown over the wire');
{
  const tableId = `itest-${Date.now()}`;
  const alice = connect(port, tableId);
  const bob = connect(port, tableId);
  await Promise.all([onOpen(alice), onOpen(bob)]);
  const a = bus(alice), b = bus(bob);

  alice.send(JSON.stringify({ type: 'join', name: 'Alice' }));
  await a.waitFor((m) => m.type === 'state' && m.you === null); // alone in the waiting room, not dealt in
  bob.send(JSON.stringify({ type: 'join', name: 'Bob' }));

  const dealt = await a.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
  await b.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
  console.log(`  ${ok(dealt.seats.length === 2)} a hand deals in both players`);
  console.log(`  ${ok(dealt.seats[dealt.you].hole.every((c) => typeof c === 'string'))} a player sees their own two hole cards`);
  const otherSeat = dealt.seats.find((s) => !s.mine);
  console.log(`  ${ok(otherSeat.hole.every((c) => c === null))} the opponent's hole cards are null, not just hidden client-side`);

  // Call everything down to showdown — the betting logic itself is
  // holdem.js's job and is fuzzed elsewhere; this loop only has to prove the
  // protocol can carry a hand to completion.
  let state = dealt;
  for (let i = 0; i < 40 && state.street !== 'showdown' && state.street !== 'over'; i++) {
    const seat = state.seats[state.turn];
    const legal = options({ seats: state.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: seat.bet, chips: seat.chips });
    const action = legal.includes('check') ? 'check' : 'call';
    const actor = seat.mine ? alice : bob;
    actor.send(JSON.stringify({ type: 'action', action, amount: 0 }));
    state = await a.waitFor((m) => m.type === 'state' || m.type === 'error');
    if (state.type === 'error') { console.log('  FAIL server rejected a legal action:', state.message); break; }
  }
  await b.waitFor((m) => m.type === 'state' && m.street === state.street);

  console.log(`  ${ok(state.street === 'showdown')} the hand reaches a real showdown`);
  console.log(`  ${ok(state.seats.every((s) => s.hole.every((c) => typeof c === 'string')))} both hands are revealed at a genuine two-way showdown`);
  const total = state.seats.reduce((acc, s) => acc + s.chips, 0);
  console.log(`  ${ok(total === 4000)} chips are conserved end to end (2 x 2000 starting stack)`);

  console.log(`  ${ok(!everLeaked(a.log))} Alice's socket never once carried Bob's hole cards early`);
  console.log(`  ${ok(!everLeaked(b.log))} Bob's socket never once carried Alice's hole cards early`);

  alice.close();
  bob.close();
}

/**
 * Check or call every turn until the hand ends. `resolveActor(seat)` maps
 * the public (name-only — never hole cards) view of whoever's turn it is to
 * a socket this test controls, or null when nobody we control can act right
 * now (their socket is gone and we are waiting on the server's own
 * auto-fold to move the turn along) — that null branch just waits for the
 * next broadcast instead of guessing.
 */
async function callDown(watcher, resolveActor, state) {
  let guard = 0;
  while (state.street !== 'showdown' && state.street !== 'over' && guard++ < 80) {
    const seat = state.seats[state.turn];
    const actor = resolveActor(seat);
    if (!actor) { state = await watcher.waitFor(() => true, 3000); continue; }
    const legal = options({ seats: state.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: seat.bet, chips: seat.chips });
    const action = legal.includes('check') ? 'check' : 'call';
    actor.send(JSON.stringify({ type: 'action', action, amount: 0 }));
    state = await watcher.waitFor((m) => m.type === 'state' || m.type === 'error');
    if (state.type === 'error') break;
  }
  return state;
}

console.log('B. a disconnect mid-hand does not stall the other players or crash the server');
{
  const tableId = `itest-disc-${Date.now()}`;
  const clients = ['A', 'B', 'C'].map((n) => ({ name: n, ws: connect(port, tableId) }));
  await Promise.all(clients.map((c) => onOpen(c.ws)));
  const survivor = bus(clients[0].ws); // everything below is observed through A's socket
  const byName = Object.fromEntries(clients.map((c) => [c.name, c.ws]));
  const resolveActor = (seat) => {
    const ws = byName[seat.name];
    return ws && ws.readyState === WebSocket.OPEN ? ws : null;
  };

  // A and B seat immediately (the server deals as soon as two are down), so
  // C necessarily joins mid-hand-one as a spectator waiting for hand two —
  // which is itself worth proving: a late joiner does not disrupt the hand
  // already running.
  clients[0].ws.send(JSON.stringify({ type: 'join', name: 'A' }));
  clients[1].ws.send(JSON.stringify({ type: 'join', name: 'B' }));
  let state = await survivor.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.seats.length === 2);
  clients[2].ws.send(JSON.stringify({ type: 'join', name: 'C' }));

  state = await callDown(survivor, resolveActor, state);
  console.log(`  ${ok(state.street === 'showdown')} hand one (A and B only) finishes normally while C waits`);

  // Hand two deals C in. table.mjs schedules it a few seconds after
  // showdown — this is the one place the test waits on real wall-clock time
  // rather than driving the engine directly, exactly because it IS the real
  // server's own pacing being exercised, not table.mjs's internals.
  state = await survivor.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.seats.length === 3, 8000);
  console.log(`  ${ok(state.seats.length === 3)} hand two deals in all three players`);

  clients[2].ws.terminate(); // kill C outright, mid-hand

  state = await callDown(survivor, resolveActor, state);
  console.log(`  ${ok(state.street === 'showdown' || state.street === 'over')} the table reaches a conclusion despite a mid-hand disconnect`);
  console.log(`  ${ok(state.seats[2]?.connected === false)} the disconnected seat is reported as disconnected, not silently dropped`);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  console.log(`  ${ok(health.ok === true)} the server is still up and answering /health after a client vanished`);

  clients[0].ws.close();
  clients[1].ws.close();
}

await srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
