// Many tables at once, played rather than read.
//
//     node poker/server/test/multitable.test.mjs      (exits non-zero on a failure)
//
// table.test.mjs and integration.test.mjs both prove a single table is
// sound. This file exists for the property that is only checkable with MORE
// than one: that the server's shared table registry (index.mjs's `tables`
// Map, keyed by table id) actually keeps every table's broadcasts — hole
// cards AND everything else — inside that one table, when many tables are
// running fully concurrently and their clients' actions are interleaved
// rather than played one table to completion before the next starts.
//
// Two levels, same as the rest of this suite: A fuzzes many independent
// table.mjs instances directly with fake sockets (fast, no network, proves
// table.mjs itself has no shared mutable state a second table could ever
// touch); B drives the real server — one shared `wss`, one shared `tables`
// registry — with real `ws` clients spread across several real table ids at
// once, which is the only place a routing bug (the wrong socket ending up
// in the wrong table's broadcast set) could actually happen.
import WebSocket from 'ws';
import {
  createTable, handleJoin, handleAction, handleDisconnect, tryStartHand,
} from '../table.mjs';
import { startServer } from '../index.mjs';
import { options, toCall } from '../../js/holdem.js';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };

class FakeSocket {
  constructor(name) { this.name = name; this.readyState = 1; this.sent = []; }
  send(text) { this.sent.push(JSON.parse(text)); }
}

let seed = 13579;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

console.log('A. many independent table.mjs tables, fuzzed with interleaved actions, never bleed into one another');
{
  const TABLES = 20;
  const tables = Array.from({ length: TABLES }, (_, i) => createTable(`multi-${i}`, {
    smallBlind: 10, bigBlind: 20, startChips: 300 + Math.floor(rnd() * 900),
  }));
  const sockets = tables.map((tb, i) => {
    const n = 2 + Math.floor(rnd() * 4);
    const ss = Array.from({ length: n }, (_, j) => new FakeSocket(`T${i}P${j}`));
    for (const ws of ss) handleJoin(tb, ws, ws.name);
    return ss;
  });

  let leak = null;
  let crossTableId = null;
  // Genuinely interleaved: each step picks a RANDOM table to advance by one
  // action, rather than draining table 0 before touching table 1 — the
  // ordering a real server sees from real, independently-timed browsers.
  for (let step = 0; step < 20000; step++) {
    const i = Math.floor(rnd() * TABLES);
    const table = tables[i];

    if (rnd() < 0.01 && table.sockets.size > 2) handleDisconnect(table, pick([...table.sockets]));
    if (table.phase === 'idle' && table.game && table.sockets.size >= 2) {
      clearTimeout(table.nextTimer);
      tryStartHand(table);
    }

    // Every socket's LAST message must be for its own table and must not
    // show a hole card it should not see — checked on every single step,
    // for every table, not just the one that just acted, since a routing
    // bug could leak a broadcast into a table that never acted at all.
    for (let ti = 0; ti < TABLES && !leak && !crossTableId; ti++) {
      const g = tables[ti].game;
      const contenders = g ? g.seats.filter((s) => !s.folded && !s.out) : [];
      const revealAll = !!g && g.street === 'showdown' && contenders.length > 1;
      for (const ws of sockets[ti]) {
        const last = ws.sent.at(-1);
        if (!last || last.type !== 'state') continue;
        if (last.tableId !== tables[ti].id) { crossTableId = `${ws.name} (seated at ${tables[ti].id}) received a broadcast tagged ${last.tableId}`; break; }
        for (let si = 0; si < last.seats.length; si++) {
          const seen = last.seats[si];
          const real = g.seats[si];
          if (!real) continue; // composition changed since this message was sent; nothing to cross-check it against
          const shouldShow = seen.mine || (revealAll && !real.folded && !real.out);
          if (!shouldShow && seen.hole.some((c) => c !== null)) { leak = `${ws.name} at ${tables[ti].id} saw seat ${si}'s hole cards`; break; }
        }
      }
    }
    if (leak || crossTableId) break;

    const g = table.game;
    if (!g || table.phase !== 'playing' || g.turn < 0) continue;
    const seat = g.seats[g.turn];
    if (!seat.connected) continue;
    const legal = options(g, seat);
    const choice = pick(legal);
    const amount = (choice === 'bet' || choice === 'raise')
      ? seat.bet + toCall(g, seat) + Math.ceil(rnd() * seat.chips) : 0;
    handleAction(table, seat.ws, choice, amount);
  }

  const handsStarted = tables.reduce((n, tb) => n + (tb.game?.hand ?? 0), 0);
  console.log(`  tables=${TABLES} total hands started across all of them=${handsStarted}`);
  console.log(`  ${ok(!leak)}${leak ? '  ' + leak : ''} no hole card ever crossed a table boundary`);
  console.log(`  ${ok(!crossTableId)}${crossTableId ? '  ' + crossTableId : ''} no socket ever received a broadcast tagged with a table id that was not its own`);
}

console.log('B. the real server runs several real tables concurrently, with real interleaved clients, and keeps them isolated');
{
  const srv = startServer({ port: 0 });
  const port = srv.httpServer.address().port;
  const connect = (table) => new WebSocket(`ws://127.0.0.1:${port}/ws/${table}`);
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

  const TABLE_COUNT = 4;
  const tableIds = Array.from({ length: TABLE_COUNT }, (_, i) => `multi-real-${Date.now()}-${i}`);
  // Two clients per table, all TABLE_COUNT tables opened and joined
  // concurrently (Promise.all, not one table awaited to completion before
  // the next starts) — exactly the "many tables running at once" shape a
  // lobby full of real players produces.
  const rooms = await Promise.all(tableIds.map(async (id, i) => {
    const alice = connect(id);
    const bob = connect(id);
    await Promise.all([onOpen(alice), onOpen(bob)]);
    const a = bus(alice), b = bus(bob);
    alice.send(JSON.stringify({ type: 'join', name: `A${i}` }));
    bob.send(JSON.stringify({ type: 'join', name: `B${i}` }));
    const dealt = await a.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
    await b.waitFor((m) => m.type === 'state' && m.street === 'preflop' && m.you !== null);
    return { id, alice, bob, a, b, state: dealt };
  }));

  console.log(`  ${ok(srv.tables.size === TABLE_COUNT)} the server registry holds exactly ${TABLE_COUNT} independent tables`);
  console.log(`  ${ok(new Set(rooms.map((r) => r.state.tableId)).size === TABLE_COUNT)} each table dealt a hand tagged with its own distinct table id`);

  // Play every table down to showdown IN LOCKSTEP — one action at table 0,
  // then table 1, then table 2... round-robin — rather than finishing one
  // table before touching the next, so messages for different tables are
  // genuinely interleaved on the wire, not just concurrent in wall-clock
  // time.
  let guard = 0;
  while (rooms.some((r) => r.state.street !== 'showdown' && r.state.street !== 'over') && guard++ < 400) {
    for (const r of rooms) {
      if (r.state.street === 'showdown' || r.state.street === 'over') continue;
      const seat = r.state.seats[r.state.turn];
      const legal = options({ seats: r.state.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: seat.bet, chips: seat.chips });
      const action = legal.includes('check') ? 'check' : 'call';
      const actor = seat.mine ? r.alice : r.bob;
      actor.send(JSON.stringify({ type: 'action', action, amount: 0 }));
      r.state = await r.a.waitFor((m) => m.type === 'state' || m.type === 'error');
    }
  }
  for (const r of rooms) await r.b.waitFor((m) => m.type === 'state' && m.street === r.state.street);

  console.log(`  ${ok(rooms.every((r) => r.state.street === 'showdown'))} every table independently reached its own showdown`);

  // The cross-table check: for EVERY client, EVERY message it ever received
  // must be tagged with its own table's id, and must never show a hole card
  // outside that table's own genuine showdown.
  let crossTableId = null, leak = null;
  for (const r of rooms) {
    for (const [who, bus_] of [['A', r.a], ['B', r.b]]) {
      for (const msg of bus_.log) {
        if (msg.type !== 'state') continue;
        if (msg.tableId !== r.id) { crossTableId = `${who} at ${r.id} received a message tagged ${msg.tableId}`; break; }
        const contenders = msg.seats.filter((s) => !s.folded && !s.out);
        const revealAll = msg.street === 'showdown' && contenders.length > 1;
        for (const s of msg.seats) {
          const shouldShow = s.mine || (revealAll && !s.folded && !s.out);
          if (!shouldShow && s.hole.some((c) => c !== null)) { leak = `${who} at ${r.id} saw seat ${s.seat}'s hole cards early`; break; }
        }
      }
    }
  }
  console.log(`  ${ok(!crossTableId)}${crossTableId ? '  ' + crossTableId : ''} no client ever received a message meant for a different table`);
  console.log(`  ${ok(!leak)}${leak ? '  ' + leak : ''} no client ever saw a hole card that was not theirs, at any table`);

  const totals = rooms.map((r) => r.state.seats.reduce((a, s) => a + s.chips, 0));
  console.log(`  ${ok(totals.every((tt) => tt === 4000))} each table's chips are conserved independently (2 x 2000 each)`);

  for (const r of rooms) { r.alice.close(); r.bob.close(); }
  await srv.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
