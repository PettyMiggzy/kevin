// The whole tournament stack, over real sockets, played rather than read.
//
//     node poker/server/test/tournament.integration.test.mjs
//
// tournament.test.mjs drives tournament.mjs directly with fake sockets —
// fast, thorough, no network. This is the same story integration.test.mjs
// is to table.test.mjs: the real server (the same index.mjs a browser
// talks to), real `ws` clients, real HTTP for the lobby endpoints, driven
// through an actual small multi-table tournament — register, start, play
// down through real bust-outs and real table rebalances and a real blind
// increase, to one real winner — so a bug in the wire format, in
// index.mjs's `/tournament/<id>` routing, or in the `/tournaments` HTTP
// endpoint has somewhere to show up that tournament.test.mjs's in-process
// calls cannot catch.
import WebSocket from 'ws';
import { startServer } from '../index.mjs';
import { options } from '../../js/holdem.js';

let failed = 0;
const ok = (pass) => { if (!pass) failed++; return pass ? 'ok  ' : 'FAIL'; };

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
  async function waitFor(pred, timeoutMs = 15000) {
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

/** Self-contained, same rule as every other test file in this suite: every state message stands on its own. */
function everLeaked(log) {
  for (const msg of log) {
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

const srv = startServer({ port: 0, tickMs: 120 }); // a fast real interval — this test wants to actually observe the driver run on the wire, not just call tick() itself
const port = srv.httpServer.address().port;
const httpBase = `http://127.0.0.1:${port}`;

console.log('A. a real 7-player tournament: HTTP lobby creation, real registration, a real blind increase, real bust-outs and table merges, one real winner');
{
  const created = await fetch(`${httpBase}/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Integration MTT',
      startChips: 400,
      seatsPerTable: 3, // 7 players -> 3 tables (3,2,2), guarantees real rebalancing
      minPlayers: 2,
      // A turbo schedule so this test observes a real blind increase (and
      // the short stacks it forces) without waiting on the 10-minute
      // default levels — still real wall-clock time, just fast wall-clock
      // time, driven by the server's own real tickMs=120 interval above.
      levels: [
        { smallBlind: 10, bigBlind: 20, durationMs: 3000 },
        { smallBlind: 25, bigBlind: 50, durationMs: 3000 },
        { smallBlind: 50, bigBlind: 100, durationMs: 3000 },
        { smallBlind: 100, bigBlind: 200, durationMs: null },
      ],
    }),
  }).then((r) => r.json());
  console.log(`  ${ok(!!created.id)} POST /tournaments creates a tournament and returns an id`);

  const lobbyBefore = await fetch(`${httpBase}/lobby`).then((r) => r.json());
  const listed = lobbyBefore.tournaments.find((t) => t.id === created.id);
  console.log(`  ${ok(!!listed && listed.status === 'registering')} GET /lobby lists it as registering`);

  const N = 7;
  const players = Array.from({ length: N }, (_, i) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/tournament/${created.id}`);
    return { name: `Runner${i}`, ws };
  });
  await Promise.all(players.map((p) => new Promise((resolve, reject) => {
    p.ws.once('open', resolve);
    p.ws.once('error', reject);
  })));
  for (const p of players) { p.bus = bus(p.ws); p.ws.send(JSON.stringify({ type: 'register', name: p.name })); }
  await Promise.all(players.map((p) => p.bus.waitFor((m) => m.type === 'tournament' && m.status === 'registering' && m.you)));
  console.log(`  ${ok(true)} all ${N} players registered over real sockets`);

  players[0].ws.send(JSON.stringify({ type: 'start' }));
  await Promise.all(players.map((p) => p.bus.waitFor((m) => m.type === 'tournament' && m.status === 'running')));
  console.log(`  ${ok(true)} the tournament starts once any registrant sends 'start'`);

  const lobbyAfter = await fetch(`${httpBase}/lobby`).then((r) => r.json());
  const runningRow = lobbyAfter.tournaments.find((t) => t.id === created.id);
  console.log(`  ${ok(!!runningRow && runningRow.status === 'running')} GET /lobby reflects the tournament as running`);

  // Every player's own socket also starts carrying `type:'state'` table
  // broadcasts the moment it is seated — this is the whole design (see
  // tournament.mjs's header comment): one persistent socket, multiplexing
  // both message types, moved between tables by the tournament layer
  // without ever closing the connection.
  for (const p of players) await p.bus.waitFor((m) => m.type === 'state');

  // Play every table's current turn, everywhere, check/call only — enough
  // by itself (with the turbo blind schedule above) to force real
  // eliminations without needing to model betting strategy. Each round is a
  // non-blocking pass over every player's OWN message log (real, in order,
  // pushed by its 'message' handler regardless of whether this loop is
  // looking at it) rather than a `waitFor` per player — a short sleep only
  // happens when a whole pass finds nobody actionable, so the loop reacts
  // immediately as soon as it IS somebody's turn instead of paying a fixed
  // poll delay on every single action.
  const lastOfType = (log, type) => { for (let i = log.length - 1; i >= 0; i--) if (log[i].type === type) return log[i]; return null; };

  let done = false;
  let sawLevelIncrease = false;
  let sawMultipleTables = false;
  let rounds = 0;
  const started = Date.now();
  const overallDeadline = started + 180000;
  while (!done && Date.now() < overallDeadline && rounds++ < 50000) {
    let actedThisRound = false;
    for (const p of players) {
      const tmsg = lastOfType(p.bus.log, 'tournament');
      if (tmsg) {
        if (tmsg.status === 'done') { done = true; break; }
        if (tmsg.you?.eliminated) { p.busted = true; }
        if (tmsg.level > 0) sawLevelIncrease = true;
        if (tmsg.tables && tmsg.tables.length > 1) sawMultipleTables = true;
      }
      if (p.busted) continue;
      const smsg = lastOfType(p.bus.log, 'state');
      if (!smsg || smsg.turn < 0 || smsg.street === 'showdown' || smsg.street === 'over') continue;
      const turnSeat = smsg.seats[smsg.turn];
      if (!turnSeat || !turnSeat.mine) continue; // not this player's turn right now
      const legal = options({ seats: smsg.seats.map((s) => ({ bet: s.bet, chips: s.chips })) }, { bet: turnSeat.bet, chips: turnSeat.chips });
      p.ws.send(JSON.stringify({ type: 'action', action: legal.includes('check') ? 'check' : 'call', amount: 0 }));
      actedThisRound = true;
    }
    if (done) break;
    // Yield to the event loop EVERY round, acted or not — a round that just
    // sent actions still needs Node to actually process the incoming
    // responses before the next pass reads `p.bus.log` again, or this spins
    // resending the same stale turn against state that never changes
    // (exactly what a purely synchronous loop here did: tens of thousands
    // of rounds in under a second, zero real progress). A short real sleep
    // when NOTHING was actionable avoids busy-waiting while still reacting
    // promptly once it is somebody's turn.
    await new Promise((resolve) => setImmediate(resolve));
    if (!actedThisRound) await new Promise((resolve) => setTimeout(resolve, 60));
  }

  console.log(`  rounds=${rounds} elapsedMs=${Date.now() - started}`);
  console.log(`  ${ok(done)} the tournament actually reaches 'done' within the time budget`);

  const finalMsgs = players.map((p) => [...p.bus.log].reverse().find((m) => m.type === 'tournament' && m.status === 'done'));
  console.log(`  ${ok(finalMsgs.every((m) => !!m))} every player's own socket was told the tournament finished`);
  const standings = finalMsgs.find((m) => m)?.standings;
  console.log(`  ${ok(!!standings && standings.length === N)} the final standings cover all ${N} players`);
  const positions = (standings || []).map((s) => s.position).sort((a, b) => a - b);
  console.log(`  ${ok(JSON.stringify(positions) === JSON.stringify(Array.from({ length: N }, (_, i) => i + 1)))} positions are a complete 1..${N}`);
  const winner = (standings || []).find((s) => s.position === 1);
  console.log(`  ${ok(!!winner && winner.chips === N * 400)} the winner holds every chip in play (${winner?.chips} of ${N * 400})`);
  console.log(`  ${ok(sawMultipleTables)} multiple tables really did run at once at some point`);
  console.log(`  ${ok(sawLevelIncrease)} the blind level really did increase at least once, live, over the wire`);

  let leak = null;
  for (const p of players) { const l = everLeaked(p.bus.log); if (l && !leak) leak = `${p.name}: ${l}`; }
  console.log(`  ${ok(!leak)}${leak ? '  ' + leak : ''} no player's socket ever saw a hole card that was not theirs, across every table it visited`);

  const lobbyFinal = await fetch(`${httpBase}/lobby`).then((r) => r.json());
  const doneRow = lobbyFinal.tournaments.find((t) => t.id === created.id);
  console.log(`  ${ok(!!doneRow && doneRow.status === 'done')} GET /lobby reflects the tournament as done`);

  for (const p of players) p.ws.close();
}

console.log('B. a made-up tournament id is refused, not auto-created');
{
  const ws = new WebSocket(`ws://127.0.0.1:${port}/tournament/does-not-exist`);
  const closed = await new Promise((resolve) => { ws.once('close', (code) => resolve(code)); ws.once('open', () => ws.send('{}')); });
  console.log(`  ${ok(closed === 4004)} the socket is closed with a specific code instead of silently creating a tournament`);
}

await srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
