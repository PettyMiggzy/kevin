#!/usr/bin/env node
// The scores service.
//
//   node server/index.mjs                 listens on :8787
//   PORT=9000 node server/index.mjs
//
// One process, no dependencies, one SQLite file. It exists because the game
// keeps progress in localStorage on each player's own device, which means two
// people playing have two private numbers that have never met — there is
// nothing to rank, and nothing anybody could be paid against.
//
// WHAT THIS DOES AND DOES NOT FIX, because it matters before rewards ride on it:
//
//   FIXED  — decay and every total are computed here, from this machine's
//            clock. Winding a phone forward a year now does nothing at all.
//            That was the single worst hole and it is closed.
//   FIXED  — the client reports what it DID ("a set at the bench, played this
//            well"), never what it is WORTH. Forging that buys one good set.
//   RAISED — rate limits mean farming costs roughly what playing costs, which
//            removes most of the reason to bother.
//   NOT FIXED — this is still a browser game. A determined person can script
//            the endpoints at human speed and climb slowly. Nothing short of
//            running the gameplay server-side changes that, and I would not
//            pay out on these numbers without looking at the event log first.
//            That log is why it is kept.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { open } from './db.mjs';
import { creditSet, creditShift, implausible, settle } from './scoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DB_FILE = process.env.KEVIN_DB || join(HERE, 'data/kevin.db');
const HOUR = 3600e3;

/**
 * A shared secret the BOT uses to mint link codes. Without it anybody who can
 * reach this port could mint a code for any Telegram id and take over a place
 * on the board.
 */
const ADMIN_KEY = (process.env.KEVIN_ADMIN_KEY || readKey()).trim();
function readKey() {
  try { return readFileSync(join(HERE, '.admin.key'), 'utf8'); } catch { return ''; }
}
if (!ADMIN_KEY) {
  console.error('No admin key. Put one in server/.admin.key or set KEVIN_ADMIN_KEY.');
  console.error('Generate one: openssl rand -hex 32');
  process.exit(1);
}

const q = open(DB_FILE);
const now = () => Date.now();
const token = () => randomBytes(24).toString('base64url');

/** Constant-time, so the admin key cannot be guessed a character at a time. */
function keyOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

const clean = (s, n = 24) => String(s ?? '?').replace(/\s+/g, ' ').trim().slice(0, n) || '?';

// --- tiny http plumbing -----------------------------------------------------

function send(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    // The game is served from iamkevin.lol and this is a different origin.
    'access-control-allow-origin': process.env.KEVIN_ORIGIN || '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  });
  res.end(text);
}

async function readJson(req, limit = 4096) {
  let n = 0;
  const parts = [];
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error('body too large');
    parts.push(c);
  }
  if (!n) return {};
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

/**
 * Per-IP throttle, so a stranger cannot sit on /event creating players or
 * spinning the database. Crude on purpose — a Map and a minute window is the
 * right amount of machinery for a service this size.
 */
const hits = new Map();
function throttled(ip, max = 120) {
  const bucket = Math.floor(now() / 60000);
  const k = `${ip}:${bucket}`;
  const n = (hits.get(k) ?? 0) + 1;
  hits.set(k, n);
  if (hits.size > 5000) for (const key of hits.keys()) if (!key.endsWith(`:${bucket}`)) hits.delete(key);
  return n > max;
}

// --- the service ------------------------------------------------------------

const routes = {
  /** Health, and something to curl after deploying. */
  'GET /health': () => ({ ok: true, players: q.db.prepare('SELECT COUNT(*) n FROM players').get().n }),

  /**
   * The leaderboards the bot reads. Public and read-only: these are the only
   * numbers that leave here, and they carry no ids.
   */
  'GET /top': (req, res, url) => {
    const board = url.searchParams.get('board') === 'job' ? 'job' : 'gym';
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const rows = (board === 'job' ? q.topCoin : q.topMuscle).all(limit)
      .map((r) => ({ name: r.name, score: Math.round(r.score) }));
    return { board, updated: new Date().toISOString(), rows };
  },

  /** A new game asks for an identity. Anonymous until it links a Telegram id. */
  'POST /session': () => {
    const t = token();
    q.createPlayer.run(t, '?', now(), now());
    return { token: t };
  },

  /** The bot mints a code; the game redeems it. Admin key required. */
  'POST /link/code': async (req) => {
    if (!keyOk(bearer(req))) return { status: 401, error: 'no' };
    const { tgId, name } = await readJson(req);
    if (!Number.isFinite(Number(tgId))) return { status: 400, error: 'tgId required' };
    const code = randomBytes(4).toString('hex').toUpperCase();
    q.makeCode.run(code, Number(tgId), clean(name), now() + 15 * 60e3);
    return { code, expiresIn: 900 };
  },

  /** The game redeems it, attaching this save to that Telegram account. */
  'POST /link/claim': async (req) => {
    const { token: t, code } = await readJson(req);
    const player = q.playerByToken.get(String(t || ''));
    if (!player) return { status: 401, error: 'unknown session' };
    const row = q.takeCode.get(String(code || '').toUpperCase(), now());
    if (!row) return { status: 400, error: 'bad or expired code' };
    // One Telegram account owns one save: linking again moves it rather than
    // leaving the old one on the board forever.
    q.unlinkOthers.run(row.tg_id, player.id);
    q.linkPlayer.run(row.tg_id, row.name, player.id);
    q.dropCode.run(row.code);
    return { ok: true, name: row.name };
  },

  /** What the server thinks you have. Settled to now, so decay is visible. */
  'GET /me': (req) => {
    const p = q.playerByToken.get(bearer(req));
    if (!p) return { status: 401, error: 'unknown session' };
    const s = settle(p, now());
    return {
      name: p.name, linked: Boolean(p.tg_id),
      muscle: Math.round(s.muscle * 10) / 10,
      stamina: Math.round(s.stamina * 10) / 10,
      coin: p.coin, sets: p.sets, shifts: p.shifts,
    };
  },

  /**
   * Something happened in the game. The client says WHAT, never what it is
   * worth — scoring.mjs works that out from its own tables.
   */
  'POST /event': async (req) => {
    const p = q.playerByToken.get(bearer(req));
    if (!p) return { status: 401, error: 'unknown session' };
    const body = await readJson(req);

    const recent = q.setsSince.get(p.id, now() - HOUR).n;
    const why = implausible(p, now(), recent);
    if (why) return { status: 429, error: why };

    let next;
    if (body.type === 'set') next = creditSet(p, body, now());
    else if (body.type === 'shift') next = creditShift(p, body, now());
    else return { status: 400, error: 'unknown event' };
    if (next.error) return { status: 400, error: next.error };

    q.updateScores.run(
      next.muscle, next.stamina, next.coin,
      next.sets ?? p.sets, next.shifts ?? p.shifts, next.served ?? p.served,
      now(), now(), p.id
    );
    q.logEvent.run(p.id, body.type, JSON.stringify(body).slice(0, 300), now());

    return {
      muscle: Math.round(next.muscle * 10) / 10,
      stamina: Math.round(next.stamina * 10) / 10,
      coin: next.coin,
    };
  },
};

const server = createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '?';
  const url = new URL(req.url, 'http://x');

  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (throttled(ip)) return send(res, 429, { error: 'slow down' });

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: 'no' });

  try {
    const out = await handler(req, res, url);
    if (out?.status) return send(res, out.status, { error: out.error });
    send(res, 200, out);
  } catch (e) {
    // Never hand an internal message to a caller; log it instead.
    console.error(`${req.method} ${url.pathname}:`, e.message);
    send(res, 400, { error: 'bad request' });
  }
});

server.listen(PORT, () => {
  console.log(`Kevin scores on :${PORT}, db ${DB_FILE}`);
});
