// A multi-table tournament: registration, seating players across several
// `table.mjs` tables, blind-level escalation, bust-out tracking, and table
// rebalancing as the field shrinks — the state layer the phase-2 spec asked
// for, sitting entirely ABOVE table.mjs rather than inside it.
//
// This file never looks at a hole card and never touches `viewFor`. Every
// piece of poker it runs — dealing, betting, showdowns — happens inside a
// table.mjs `table` exactly the way a practice table does; this file only
// decides WHICH table.mjs table a player's socket is plugged into at any
// given moment, using table.mjs's own `handleJoin`/`handleDisconnect` to do
// the plugging and unplugging. A moved player leaves their old table the
// same way a disconnect does (seat cleared, socket dropped from that
// table's broadcast set — see table.mjs's `handleDisconnect`) and joins
// their new one the same way any newcomer does (queued in `waiting`, dealt
// a brand new hand by holdem.js) — so there is no code path here, or
// anywhere, that copies a hole card from one table to another, and nobody
// mid-hand at the destination table gets a new pair of eyes on their cards
// either: the mover isn't seated in that table's live `game.seats` until
// holdem.js itself deals them in.
import { randomUUID } from 'node:crypto';
import {
  createTable, handleJoin, handleAction as tableHandleAction, handleDisconnect as tableHandleDisconnect,
  tryStartHand, summarizeTable, MAX_SEATS,
} from './table.mjs';

const OPEN = 1;
const isOpen = (ws) => !!ws && ws.readyState === OPEN;
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';

function send(ws, obj) {
  if (!isOpen(ws)) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* dying socket; close() will follow */ }
}

// A doubling-ish stepped structure, sane defaults for play money: blinds
// roughly double every level, ten minutes a level. `createTournament`'s
// caller can pass its own `levels` (and shorter `durationMs`, which is how
// the tests below run a whole tournament in seconds instead of hours).
export const DEFAULT_LEVELS = [
  { smallBlind: 10, bigBlind: 20 },
  { smallBlind: 15, bigBlind: 30 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 75, bigBlind: 150 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 150, bigBlind: 300 },
  { smallBlind: 200, bigBlind: 400 },
  { smallBlind: 300, bigBlind: 600 },
  { smallBlind: 400, bigBlind: 800 },
].map((l) => ({ ...l, durationMs: 10 * 60 * 1000 }));

/**
 * @param {string} id
 * @param {{name?:string, startChips?:number, seatsPerTable?:number,
 *   minPlayers?:number, maxPlayers?:number, levels?:Array,
 *   now?:()=>number}} [opts]
 */
export function createTournament(id, opts = {}) {
  return {
    id,
    name: opts.name || `Tournament ${id}`,
    mode: 'tournament',
    startChips: opts.startChips ?? 1500,
    seatsPerTable: Math.max(2, Math.min(MAX_SEATS, opts.seatsPerTable ?? MAX_SEATS)),
    minPlayers: Math.max(2, opts.minPlayers ?? 2),
    maxPlayers: opts.maxPlayers ?? 500,
    levels: (opts.levels && opts.levels.length ? opts.levels : DEFAULT_LEVELS).map((l) => ({ ...l })),
    now: opts.now || (() => Date.now()),
    status: 'registering', // 'registering' | 'running' | 'done'
    levelIndex: 0,
    levelStartedAt: 0,
    // playerId -> { id, ws, name, chips, tableId, eliminated, position, connected }
    // `position` is filled in the moment a player busts (see recordBustouts)
    // — the same "you finished 6th" a real tournament tells you on the spot
    // — not deferred to the end, so it is meaningful mid-tournament too.
    players: new Map(),
    tables: new Map(),     // tableId -> table.mjs table (this tournament's own, never in index.mjs's registry)
    nextTableSeq: 0,
    standings: null,       // set once status becomes 'done': [{ id, name, position, chips }], sorted by position
  };
}

const playerByWs = (t, ws) => [...t.players.values()].find((p) => p.ws === ws);
const currentLevel = (t) => t.levels[Math.min(t.levelIndex, t.levels.length - 1)];

/**
 * Builds one `{type:'tournament', ...}` message factory so `broadcastAll`
 * only computes the shared parts (standings, level, table list) once per
 * broadcast rather than once per recipient — the per-recipient part is just
 * `you`, which never includes anyone else's chips, cards, or table.
 */
function summarizeTournamentFor(t) {
  const shared = {
    type: 'tournament',
    id: t.id,
    name: t.name,
    mode: t.mode,
    status: t.status,
    minPlayers: t.minPlayers,
    maxPlayers: t.maxPlayers,
    totalPlayers: t.players.size,
    playersRemaining: [...t.players.values()].filter((p) => !p.eliminated).length,
    level: t.levelIndex,
    smallBlind: currentLevel(t).smallBlind,
    bigBlind: currentLevel(t).bigBlind,
    levelEndsAt: t.status === 'running' && Number.isFinite(currentLevel(t).durationMs)
      ? t.levelStartedAt + currentLevel(t).durationMs : null,
    registered: t.status === 'registering'
      ? [...t.players.values()].map((p) => ({ name: p.name, connected: p.connected })) : undefined,
    tables: [...t.tables.values()].map((tb) => ({ id: tb.id, players: summarizeTable(tb).seatedCount })),
    standings: t.standings,
  };
  return (p) => ({
    ...shared,
    you: p ? {
      id: p.id, name: p.name, chips: p.chips, tableId: p.tableId,
      eliminated: p.eliminated, position: p.position, connected: p.connected,
    } : null,
  });
}

export function summarizeTournament(t) {
  return summarizeTournamentFor(t)(null);
}

/** Everyone this tournament still owes a broadcast to: every registrant with an open socket. */
function broadcastAll(t) {
  const view = summarizeTournamentFor(t);
  for (const p of t.players.values()) send(p.ws, view(p));
}

/** Someone opens the tournament socket and asks to register (buy in — play money, see poker/server/README.md). */
export function handleRegister(t, ws, name) {
  if (t.status !== 'registering') {
    send(ws, { type: 'error', message: 'tournament has already started' });
    return;
  }
  if (playerByWs(t, ws)) return; // already registered on this socket
  if (t.players.size >= t.maxPlayers) {
    send(ws, { type: 'error', message: 'tournament is full' });
    return;
  }
  const id = randomUUID();
  t.players.set(id, {
    id, ws, name: cleanName(name), chips: t.startChips,
    tableId: null, eliminated: false, position: null, connected: true,
  });
  broadcastAll(t);
}

/** Registered but changed their mind — only meaningful before the tournament starts. */
export function handleUnregister(t, ws) {
  if (t.status !== 'registering') return;
  const p = playerByWs(t, ws);
  if (!p) return;
  t.players.delete(p.id);
  broadcastAll(t);
}

/** Any registrant can start the tournament once the minimum has registered — no admin concept in play money phase 1.5. */
export function handleStart(t, ws) {
  if (t.status !== 'registering') {
    send(ws, { type: 'error', message: 'already started' });
    return;
  }
  if (!playerByWs(t, ws)) {
    send(ws, { type: 'error', message: 'register before starting' });
    return;
  }
  if (t.players.size < t.minPlayers) {
    send(ws, { type: 'error', message: `need at least ${t.minPlayers} players` });
    return;
  }
  startTournament(t);
}

function newTable(t) {
  const id = `${t.id}-tbl${t.nextTableSeq++}`;
  const tb = createTable(id, {
    name: `${t.name} — Table ${t.nextTableSeq}`,
    mode: 'tournament',
    smallBlind: currentLevel(t).smallBlind,
    bigBlind: currentLevel(t).bigBlind,
    startChips: t.startChips, // unused by tournament seating (chips is always explicit below), kept for sanity/debug only
  });
  t.tables.set(id, tb);
  return tb;
}

/** Fisher-Yates. The card shuffle itself stays entirely inside cards.js and is untouched by any of this — this only randomizes seating assignment. */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startTournament(t) {
  t.status = 'running';
  t.levelIndex = 0;
  t.levelStartedAt = t.now();
  const roster = shuffled([...t.players.values()]);
  const tableCount = Math.max(1, Math.ceil(roster.length / t.seatsPerTable));
  const tables = Array.from({ length: tableCount }, () => newTable(t));
  roster.forEach((p, i) => seatPlayer(t, tables[i % tableCount], p));
  for (const tb of tables) tryStartHand(tb);
  broadcastAll(t);
}

/** Plug a player's real, already-open socket into `tb` with their EXACT current stack — never table.startChips. */
function seatPlayer(t, tb, p) {
  p.tableId = tb.id;
  handleJoin(tb, p.ws, p.name, p.chips);
}

/** Pull a player's socket off whichever table.mjs table currently holds it, using table.mjs's own disconnect path so the seat is cleared and the socket stops receiving that table's broadcasts — without ever closing the real connection. */
function unseatPlayer(t, p) {
  const tb = t.tables.get(p.tableId);
  if (tb) tableHandleDisconnect(tb, p.ws);
  p.tableId = null;
}

/** Route a poker action to whichever table this player is currently seated at. */
export function handleAction(t, ws, action, amount) {
  const p = playerByWs(t, ws);
  if (!p || p.tableId == null) return send(ws, { type: 'error', message: 'you are not seated at a table' });
  const tb = t.tables.get(p.tableId);
  if (!tb) return send(ws, { type: 'error', message: 'you are not seated at a table' });
  tableHandleAction(tb, ws, action, amount);
  processOutcomes(t);
}

/** The socket closed. If the tournament hasn't started, that's just a withdrawn registration; once running it is exactly a disconnect at whatever table they're on — table.mjs already auto-folds them when it's their turn, same as a practice table, and they keep losing chips into the blinds like anyone would if they walked away from a real table. */
export function handleDisconnect(t, ws) {
  const p = playerByWs(t, ws);
  if (!p) return;
  if (t.status === 'registering') { t.players.delete(p.id); broadcastAll(t); return; }
  p.connected = false;
  const tb = t.tables.get(p.tableId);
  if (tb) tableHandleDisconnect(tb, ws);
  processOutcomes(t);
}

function processOutcomes(t) {
  recordBustouts(t);
  maybeFinish(t);
  broadcastAll(t);
}

/**
 * A seat's `chips` reaching 0 is the whole elimination rule — real or play
 * money, that is what "busted" means — but ONLY once the hand that got
 * them there has actually finished. `s.chips` also reads 0 for a player who
 * is simply all-in with the hand still live (holdem.js's `post()` sets it
 * the moment their last chip goes in, long before `finish()` decides who
 * wins it): scanning for busts while a table is still `phase === 'playing'`
 * would misread that as an elimination and pull a player who might go on
 * to WIN the pot clean out of their own hand and out of the tournament —
 * their eventual winnings would then land on a seat this file has already
 * stopped tracking. table.mjs's `settleIfDone` flips a table to `'idle'`
 * synchronously the instant a hand actually concludes (see table.mjs), so
 * gating on that, rather than on the chip count alone, is both necessary
 * and sufficient: every idle table's last hand is fully settled, and every
 * settled hand's table is idle.
 *
 * Position is awarded immediately, the same way a real tournament tells
 * you "you finished 6th" the moment you're out rather than waiting for the
 * field to finish: whoever is still in right after this player is marked
 * eliminated tells you how many people finished ahead of them.
 *
 * This is also the one place `p.chips` — the tournament-level bookkeeping
 * copy `viewFor`-style broadcasts read `you.chips` from — gets refreshed
 * from the real number sitting at the table (`table.mjs`'s own
 * `s.chips`, updated by holdem.js on every hand). It is deliberately only
 * refreshed here, between hands, rather than continuously during one: an
 * idle table's chip counts are final and settled, exactly the property the
 * bust check above depends on too.
 */
function recordBustouts(t) {
  for (const tb of t.tables.values()) {
    if (tb.phase !== 'idle') continue;
    for (const s of tb.game?.seats ?? []) {
      const p = [...t.players.values()].find((pl) => pl.tableId === tb.id && pl.ws === s.ws && !pl.eliminated);
      if (!p) continue; // already recorded, or this seat's ws was already cleared
      p.chips = s.chips;
      if (s.chips > 0) continue;
      p.eliminated = true;
      const stillIn = [...t.players.values()].filter((pl) => !pl.eliminated).length;
      p.position = stillIn + 1;
      unseatPlayer(t, p);
    }
  }
}

/** Everyone currently associated with this table — dealt in or queued in `waiting` — regardless of whether a hand is mid-flight. */
function playersAt(t, tb) {
  return [...t.players.values()].filter((p) => p.tableId === tb.id);
}

/**
 * Empties `from` completely, spreading its players one at a time onto
 * whichever other table currently has the fewest (greedy, keeps the result
 * about as even as a single pass can) — then drops `from` from the
 * registry. This is the only place a table is removed while it still has
 * (or just had) real players on it, which matters more than it looks:
 * table.mjs's `tryStartHand` only rebuilds a table's `game.seats` — the
 * thing that actually drops a disconnected seat's now-stale chip count —
 * when at least two real players are present to deal to (see its own
 * `combined.length < 2` early return). A table stuck at 0 or 1 real
 * players never reaches that rebuild on its own, so its last departed
 * seat's chips would otherwise sit there, counted, forever. Deleting the
 * table outright the moment it can no longer deal removes that stale
 * seat's memory along with it instead of leaving a ghost this file, or a
 * chip-conservation check, would still be counting.
 */
function empty(t, from) {
  const byCount = (a, b) => playersAt(t, a).length - playersAt(t, b).length;
  for (const p of playersAt(t, from)) {
    unseatPlayer(t, p);
    const dest = [...t.tables.values()].filter((tb) => tb.id !== from.id).sort(byCount)[0];
    seatPlayer(t, dest, p);
  }
  t.tables.delete(from.id);
}

/**
 * Standard MTT table balancing, kept deliberately simple (see the task
 * brief): first make sure no table is stuck below the two players it needs
 * to deal a hand, then consolidate onto fewer tables once the remaining
 * field fits into them, otherwise even out any table that has run two or
 * more players ahead of the shortest one. Every kind of move here only
 * ever pulls a player OUT of a table that just finished a hand
 * (`phase === 'idle'`) — moving someone out mid-hand would mean folding a
 * hand they never chose to fold, so nothing here does that; an unbalanced
 * table with a hand still in flight just waits for the next tick. There is
 * no such restriction on where a moved player lands: joining `waiting` is
 * exactly what a spectator does while a hand runs at the destination
 * table, and is safe at any time.
 */
function rebalance(t) {
  for (const tb of [...t.tables.values()]) if (playersAt(t, tb).length === 0) t.tables.delete(tb.id);
  let tables = [...t.tables.values()];
  if (tables.length <= 1) return;

  const idle = (tb) => tb.phase === 'idle';
  const byCount = (a, b) => playersAt(t, a).length - playersAt(t, b).length;

  // A table with exactly one real player left (from a bust, or a previous
  // rebalance move) can never deal another hand and must not be left
  // standing — see `empty`'s comment for why leaving it be is actually
  // unsafe, not just untidy.
  const stub = tables.filter(idle).find((tb) => playersAt(t, tb).length === 1);
  if (stub) { empty(t, stub); return; }

  const totalPlayers = tables.reduce((n, tb) => n + playersAt(t, tb).length, 0);
  const neededTables = Math.max(1, Math.ceil(totalPlayers / t.seatsPerTable));
  if (neededTables < tables.length) {
    // Break the shortest table (fewest players), if it is safe to pull from
    // right now.
    const breaking = tables.filter(idle).sort(byCount)[0];
    if (breaking) empty(t, breaking); // nothing idle to break this tick otherwise; try again next tick
    return; // one break per tick; re-evaluate from a clean snapshot next time
  }

  // Otherwise, a minor one-at-a-time rebalance: whenever the fullest table
  // we can safely pull from — and that has more than two players, so
  // pulling one does not just create the stub handled above — has at least
  // two more players than the shortest table anywhere, move exactly one
  // across.
  tables = [...t.tables.values()];
  const fullest = tables.filter((tb) => idle(tb) && playersAt(t, tb).length > 2).sort(byCount).at(-1);
  const shortest = [...tables].sort(byCount)[0];
  if (!fullest || fullest.id === shortest.id) return;
  if (playersAt(t, fullest).length - playersAt(t, shortest).length < 2) return;
  const [mover] = playersAt(t, fullest);
  unseatPlayer(t, mover);
  seatPlayer(t, shortest, mover);
}

function maybeAdvanceLevel(t) {
  const level = currentLevel(t);
  if (!Number.isFinite(level.durationMs)) return;
  if (t.now() - t.levelStartedAt < level.durationMs) return;
  if (t.levelIndex >= t.levels.length - 1) return; // final level holds forever
  t.levelIndex++;
  t.levelStartedAt = t.now();
  const next = currentLevel(t);
  for (const tb of t.tables.values()) { tb.smallBlind = next.smallBlind; tb.bigBlind = next.bigBlind; }
}

/** One player left who hasn't busted: the tournament is over. */
function maybeFinish(t) {
  if (t.status !== 'running') return;
  const remaining = [...t.players.values()].filter((p) => !p.eliminated);
  if (remaining.length !== 1) return; // >1: still playing. 0: shouldn't happen — never crash into a winnerless finish
  const winner = remaining[0];
  winner.eliminated = true;
  winner.position = 1;
  t.standings = [...t.players.values()]
    .sort((a, b) => a.position - b.position)
    .map((p) => ({ id: p.id, name: p.name, position: p.position, chips: p.chips }));
  t.status = 'done';
  for (const tb of t.tables.values()) tableHandleDisconnect(tb, winner.ws); // stop broadcasting the now-pointless lone-survivor table
  t.tables.clear();
}

/**
 * The driver: called on an interval by index.mjs for the real server, and
 * directly by tests instead of waiting on that interval — the same
 * "drive it synchronously, the delay is UX pacing not a rule" pattern
 * table.mjs's own tests use for its setTimeout. Sweeps bust-outs, advances
 * the blind level on schedule, rebalances tables, and starts the next hand
 * wherever one is due; `processOutcomes` (called after every action and
 * disconnect) already gives players prompt standings updates between ticks.
 */
export function tick(t) {
  if (t.status !== 'running') return;
  recordBustouts(t);
  maybeFinish(t);
  if (t.status !== 'running') { broadcastAll(t); return; }
  maybeAdvanceLevel(t);
  rebalance(t);
  for (const tb of t.tables.values()) tryStartHand(tb);
  maybeFinish(t);
  broadcastAll(t);
}
