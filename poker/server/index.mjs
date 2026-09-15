#!/usr/bin/env node
// The poker server: the one process that ever sees a hole card that isn't
// showing.
//
//   node poker/server/index.mjs              listens on :8788
//   PORT=9000 node poker/server/index.mjs
//
// holdem.js was written with no UI in it specifically so this file could
// exist — read its first comment. This is that file: it holds the deck, it
// runs holdem.js as the only source of truth for every table, and it hands
// each browser a redacted view (table.mjs's `viewFor`) instead of the real
// game object. A client that knows every card is a client that can read
// them, which is exactly the sentence poker/README.md opens with.
//
// The lobby: `GET /lobby` lists every open practice table and tournament,
// `POST /tables` and `POST /tournaments` create one with a real name instead
// of a table id someone had to already know. A practice table's `/ws/<id>`
// still auto-creates on first connect exactly like phase 1 did — typing a
// URL with a made-up code still works, the lobby is a nicer way to arrive at
// one, not the only way. A tournament has no such auto-create: it carries
// real configuration (blind schedule, seats per table), so it only exists
// once POST /tournaments makes one, and `/tournament/<id>` refuses to open a
// socket for an id nobody created.
//
// No accounts, no matchmaking beyond this list, still exactly as guessable
// and as play-money as phase 1 — see poker/server/README.md's "What this
// phase does NOT defend against".
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  createTable, handleJoin, handleAction, handleLeave, handleDisconnect, summarizeTable, addBots,
} from './table.mjs';
import {
  createTournament, handleRegister, handleAction as tournamentHandleAction, handleStart,
  handleUnregister, handleDisconnect as tournamentHandleDisconnect, tick as tournamentTick,
  summarizeTournament,
} from './tournament.mjs';
import { open as openLeaderboard } from './db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/O/1/l/i — same as the client's own code generator

function randomId(taken) {
  let id;
  do { id = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(''); }
  while (taken.has(id));
  return id;
}

/** Every request body this server reads is a small lobby form, never a poker action — 64KB is generous headroom, not a budget. */
function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

/**
 * Boots one server: its own table and tournament registries, its own
 * HTTP+WS listener. Exported (rather than just running at import time) so a
 * test can start a real instance on an ephemeral port and drive it with
 * real `ws` clients — see test/integration.test.mjs — without spawning a
 * child process. `tickMs` (default 500) is how often every running
 * tournament's `tick()` runs — see tournament.mjs's own doc comment on
 * `tick` for why that pacing is UX, not a rule; tests that want to control
 * timing exactly drive `tick()` directly instead (see tournament.test.mjs)
 * and can pass `tickMs: 0` here to disable the interval entirely.
 *
 * `dbFile` (default `poker/server/data/leaderboard.db`, overridable with
 * `KEVIN_POKER_DB` — same `process.env.X || default` shape as `PORT` below
 * and `KEVIN_ORIGIN` above) is the leaderboard's own SQLite file — see
 * db.mjs. A test can pass `':memory:'` to avoid touching disk at all.
 */
export function startServer({
  port = 0, origin = process.env.KEVIN_ORIGIN || '*', tickMs = 500,
  dbFile = process.env.KEVIN_POKER_DB || join(HERE, 'data/leaderboard.db'),
} = {}) {
  const tables = new Map();
  const tournaments = new Map();
  const leaderboard = openLeaderboard(dbFile);

  // The one place table.mjs's storage-agnostic `onHandSettled` seam (see its
  // own comment on `createTable`) meets an actual database — table.mjs never
  // imports node:sqlite, or anything DB-related, itself. Only ever wired
  // onto PRACTICE tables created below: tournament.mjs builds its own
  // table.mjs tables directly (never through `getTable`/`POST /tables`), so
  // its chip movements are never recorded here — tournament.mjs's own
  // economy is separate and self-contained on purpose (see its file header).
  const onHandSettled = (table, deltas) => {
    if (deltas.length) leaderboard.recordHand(table.id, table.game.hand, deltas);
  };

  function getTable(id) {
    let t = tables.get(id);
    if (!t) { t = createTable(id, { onHandSettled }); tables.set(id, t); }
    return t;
  }

  // `origin` is '*', or a comma-separated allowlist — e.g. the apex and
  // `www.` both, since Vercel serves the real site from `www.iamkevin.lol`
  // (redirecting the bare domain there) and a browser's actual `Origin`
  // header is whichever one the page loaded from, not whichever one an
  // operator typed into KEVIN_ORIGIN first. A single fixed string here
  // caused a real outage: KEVIN_ORIGIN was `https://iamkevin.lol`, every
  // real visitor's origin was `https://www.iamkevin.lol`, and the mismatch
  // made the browser block every request. Echo back the caller's own
  // Origin when it is on the allowlist rather than always sending one
  // fixed value, same as any multi-origin CORS setup has to.
  const allowedOrigins = origin === '*' ? null : origin.split(',').map((o) => o.trim());
  const corsOrigin = (reqOrigin) => {
    if (!allowedOrigins) return '*';
    if (reqOrigin && allowedOrigins.includes(reqOrigin)) return reqOrigin;
    return allowedOrigins[0];
  };

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const allow = corsOrigin(req.headers.origin);
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': allow };
    const json = (code, body) => { res.writeHead(code, headers); res.end(JSON.stringify(body)); };

    // POST with a JSON body is not a CORS "simple request", so a browser
    // sends an OPTIONS preflight first and refuses the real request unless
    // this answers it with the allow-methods/allow-headers pair below — the
    // exact shape `poker.iamkevin.lol` running on its own subdomain (see
    // this file's own header comment, and server/README.md's "Putting it
    // on the internet") needs for `poker/js/lobby.js`'s `POST /tables` and
    // `POST /tournaments` to work from the main site's origin at all.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': allow,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, tables: tables.size, tournaments: tournaments.size });
    }
    if (req.method === 'GET' && url.pathname === '/lobby') {
      return json(200, {
        tables: [...tables.values()].map(summarizeTable),
        tournaments: [...tournaments.values()].map(summarizeTournament),
      });
    }
    if (req.method === 'GET' && url.pathname === '/leaderboard') {
      const limit = Number.isFinite(Number(url.searchParams.get('limit'))) ? Number(url.searchParams.get('limit')) : 20;
      return json(200, { players: leaderboard.top(limit) });
    }
    if (req.method === 'POST' && url.pathname === '/tables') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return json(400, { error: e.message }); }
      const id = randomId(tables);
      const t = createTable(id, {
        name: String(body.name ?? '').trim().slice(0, 40) || `Table ${id}`,
        mode: 'practice', // the only mode this endpoint can create — see createTable's own comment on the `mode` seam
        smallBlind: Number.isFinite(Number(body.smallBlind)) ? Math.max(1, Math.trunc(Number(body.smallBlind))) : undefined,
        bigBlind: Number.isFinite(Number(body.bigBlind)) ? Math.max(2, Math.trunc(Number(body.bigBlind))) : undefined,
        startChips: Number.isFinite(Number(body.startChips)) ? Math.max(2, Math.trunc(Number(body.startChips))) : undefined,
        onHandSettled,
      });
      // Pre-seeds `table.waiting` before the creator's own `handleJoin` ever
      // runs, so a lone visitor's `join` alone already satisfies
      // `tryStartHand`'s existing `combined.length < 2` gate — no separate
      // "start with bots" code path, just bots sitting down first. Anything
      // that is not a small non-negative integer collapses to 0 (no bots)
      // rather than failing the whole request, the same lenient style
      // already used for smallBlind/bigBlind/startChips just above; 5 keeps
      // a table at or under MAX_SEATS even if a human joins after.
      const bots = Number.isInteger(Number(body.bots)) ? Math.max(0, Math.min(5, Number(body.bots))) : 0;
      addBots(t, bots);
      tables.set(id, t);
      return json(200, { id, name: t.name });
    }
    if (req.method === 'POST' && url.pathname === '/tournaments') {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return json(400, { error: e.message }); }
      const id = randomId(tournaments);
      // `levels` lets a test (or an operator who wants a turbo/hyper
      // structure) override tournament.mjs's default ten-minute schedule;
      // anything malformed is ignored in favor of that default rather than
      // rejecting the whole request over one bad field.
      const levels = Array.isArray(body.levels) ? body.levels
        .map((l) => ({
          smallBlind: Number(l?.smallBlind),
          bigBlind: Number(l?.bigBlind),
          durationMs: l?.durationMs === null || l?.durationMs === 'Infinity' ? Infinity : Number(l?.durationMs),
        }))
        .filter((l) => Number.isFinite(l.smallBlind) && l.smallBlind > 0
          && Number.isFinite(l.bigBlind) && l.bigBlind >= l.smallBlind
          && (l.durationMs === Infinity || (Number.isFinite(l.durationMs) && l.durationMs > 0)))
        : undefined;
      const t = createTournament(id, {
        name: String(body.name ?? '').trim().slice(0, 40) || `Tournament ${id}`,
        startChips: Number.isFinite(Number(body.startChips)) ? Math.max(2, Math.trunc(Number(body.startChips))) : undefined,
        seatsPerTable: Number.isFinite(Number(body.seatsPerTable)) ? Math.trunc(Number(body.seatsPerTable)) : undefined,
        minPlayers: Number.isFinite(Number(body.minPlayers)) ? Math.trunc(Number(body.minPlayers)) : undefined,
        maxPlayers: Number.isFinite(Number(body.maxPlayers)) ? Math.trunc(Number(body.maxPlayers)) : undefined,
        levels: levels && levels.length ? levels : undefined,
      });
      tournaments.set(id, t);
      return json(200, { id, name: t.name });
    }
    return json(404, { error: 'no' });
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    let m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ID_RE.test(id)) { ws.close(4000, 'bad table id'); return; }
      const table = getTable(id);

      // 32KB is generous for {type:'action', action:'raise', amount:1234} and
      // stops a hostile client from wedging a huge frame into JSON.parse.
      ws.on('message', (raw) => {
        if (raw.length > 32 * 1024) return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'join': handleJoin(table, ws, msg.name); break;
          case 'action': handleAction(table, ws, msg.action, msg.amount); break;
          case 'leave': handleLeave(table, ws); break;
          default: break; // unknown message types are ignored, not fatal
        }
      });

      ws.on('close', () => {
        if (handleDisconnect(table, ws)) tables.delete(id);
      });
      // 'close' always follows 'error' for a WebSocket, so cleanup above still runs.
      ws.on('error', () => {});
      return;
    }

    m = url.pathname.match(/^\/tournament\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const t = tournaments.get(id);
      // Unlike a practice table, a tournament id is never auto-created here
      // — it carries real configuration (blind schedule, seats per table)
      // that only POST /tournaments can supply, so an unknown id is a
      // mistyped or stale link, not an invitation to start a fresh one.
      if (!ID_RE.test(id) || !t) { ws.close(4004, 'unknown tournament'); return; }

      ws.on('message', (raw) => {
        if (raw.length > 32 * 1024) return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'register': handleRegister(t, ws, msg.name); break;
          case 'unregister': handleUnregister(t, ws); break;
          case 'start': handleStart(t, ws); break;
          case 'action': tournamentHandleAction(t, ws, msg.action, msg.amount); break;
          default: break;
        }
      });
      ws.on('close', () => tournamentHandleDisconnect(t, ws));
      ws.on('error', () => {});
      return;
    }

    ws.close(4000, 'bad path');
  });

  const tickTimer = tickMs > 0 ? setInterval(() => {
    for (const t of tournaments.values()) tournamentTick(t);
  }, tickMs) : null;

  httpServer.listen(port);

  return {
    httpServer,
    tables,
    tournaments,
    close: () => new Promise((resolve) => {
      if (tickTimer) clearInterval(tickTimer);
      // Every table's own pending timers (settleIfDone's `nextTimer`,
      // scheduleBotTurn's `botTimer` — see table.mjs) would otherwise keep
      // firing into a server that is shutting down, which matters for a
      // test that opens many short-lived servers back to back.
      for (const t of tables.values()) { clearTimeout(t.nextTimer); clearTimeout(t.botTimer); }
      for (const c of wss.clients) c.terminate();
      wss.close(() => httpServer.close(() => { leaderboard.db.close(); resolve(); }));
    }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.PORT || 8788);
  const srv = startServer({ port: PORT });
  srv.httpServer.on('listening', () => console.log(`Kevin poker on :${PORT}`));
}
