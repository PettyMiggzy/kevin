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
// The "lobby" for phase 1 is a table id in the URL — /ws/<id> — and nothing
// else: no accounts, no matchmaking, no list of open tables. Anyone who has
// the same id lands at the same table. That is deliberately weak and is
// fine for play money; it is the first thing to revisit once real stakes
// are involved.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  createTable, handleJoin, handleAction, handleLeave, handleDisconnect,
} from './table.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Boots one server: its own table registry, its own HTTP+WS listener.
 * Exported (rather than just running at import time) so a test can start a
 * real instance on an ephemeral port and drive it with real `ws` clients —
 * see test/integration.test.mjs — without spawning a child process.
 */
export function startServer({ port = 0, origin = process.env.KEVIN_ORIGIN || '*' } = {}) {
  const tables = new Map();
  function getTable(id) {
    let t = tables.get(id);
    if (!t) { t = createTable(id); tables.set(id, t); }
    return t;
  }

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': origin };
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, tables: tables.size }));
      return;
    }
    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: 'no' }));
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    const id = m ? decodeURIComponent(m[1]) : '';
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
  });

  httpServer.listen(port);

  return {
    httpServer,
    tables,
    close: () => new Promise((resolve) => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => httpServer.close(() => resolve()));
    }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.PORT || 8788);
  const srv = startServer({ port: PORT });
  srv.httpServer.on('listening', () => console.log(`Kevin poker on :${PORT}`));
}
