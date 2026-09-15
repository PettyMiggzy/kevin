// One multiplayer table, wrapping the same holdem.js the single-player room
// uses. This is the only file in the project that is allowed to look at
// `seat.hole` for a seat that is not asking — everything it sends outward
// goes through `viewFor`, which redacts every hand but the viewer's own (and
// everyone's at a legitimate multi-way showdown) before it leaves this
// process. See ../README.md and poker/README.md for why that boundary
// exists at all.
//
// Deliberately transport-agnostic: a "connection" here is anything with
// `.send(string)` and `.readyState === 1`, so this file does not import `ws`
// and can be driven directly by a test with a fake socket — the same reason
// holdem.js does not import a DOM.
import { createGame, startHand, act, options } from '../js/holdem.js';
import { randomUUID } from 'node:crypto';

export const MAX_SEATS = 6;
const OPEN = 1; // WebSocket.OPEN, without importing the library for one constant

/**
 * @param {string} id
 * @param {{smallBlind?:number, bigBlind?:number, startChips?:number}} [opts]
 */
export function createTable(id, opts = {}) {
  return {
    id,
    smallBlind: opts.smallBlind ?? 10,
    bigBlind: opts.bigBlind ?? 20,
    startChips: opts.startChips ?? 2000,
    game: null,           // the live holdem.js game, or the last finished one
    waiting: [],           // [{ id, ws, name }] — not dealt in yet
    sockets: new Set(),    // every connection that should receive broadcasts
    phase: 'idle',         // 'idle' | 'playing'
    nextTimer: null,
  };
}

const isOpen = (ws) => !!ws && ws.readyState === OPEN;
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';

function send(ws, obj) {
  if (!isOpen(ws)) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* socket died mid-send; close() will follow */ }
}

function broadcast(table) {
  for (const ws of table.sockets) send(ws, { type: 'state', ...viewFor(table, ws) });
}

/**
 * The per-viewer redacted state. THE SECURITY BOUNDARY OF THE WHOLE SERVER
 * IS HERE: `table.game.deck` is never read, let alone sent (the remaining
 * deck is exactly the next cards to be dealt), and a seat's `hole` is only
 * ever copied into the output when it belongs to this viewer or the hand is
 * a genuine multi-way showdown they were part of. Everything else — chips,
 * bets, pot, board, whose turn it is — is public poker information and goes
 * out untouched.
 */
export function viewFor(table, ws) {
  const g = table.game;
  const seated = g ? g.seats.findIndex((s) => s.ws === ws) : -1;
  // A hand that ended because everyone else folded is not a showdown — the
  // last player standing never has to show, in a card room or here. Only
  // reveal hole cards when more than one live hand actually got compared.
  const contenders = g ? g.seats.filter((s) => !s.folded && !s.out) : [];
  const revealAll = !!g && g.street === 'showdown' && contenders.length > 1;

  return {
    tableId: table.id,
    phase: table.phase,
    you: seated >= 0 ? seated : null,
    waitingCount: table.waiting.length,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    hand: g?.hand ?? 0,
    button: g?.button ?? -1,
    street: g?.street ?? 'idle',
    board: g?.board ?? [],
    pots: g?.pots ?? [],
    turn: g?.turn ?? -1,
    minRaise: g?.minRaise ?? table.bigBlind,
    log: g?.log ?? [],
    seats: (g?.seats ?? []).map((s, i) => {
      const mine = s.ws === ws;
      const show = mine || (revealAll && !s.folded && !s.out);
      return {
        seat: i,
        name: s.name,
        chips: s.chips,
        bet: s.bet,
        committed: s.committed,
        folded: s.folded,
        allIn: s.allIn,
        out: s.out,
        connected: s.connected !== false,
        mine,
        hole: show ? s.hole : s.hole.map(() => null),
        result: g.street === 'showdown' && show ? (s.result ?? null) : null,
      };
    }),
  };
}

/** Same seats, same order, same sockets — reuse the game so the button keeps rotating. */
function sameComposition(oldGame, seatsIn) {
  if (!oldGame) return false;
  if (oldGame.seats.length !== seatsIn.length) return false;
  return oldGame.seats.every((s, i) => s.ws === seatsIn[i].ws);
}

/**
 * Whenever it is someone's turn who is no longer connected, act for them —
 * check if that costs nothing, fold otherwise — and keep doing it for
 * whoever is next, in case the rest of the table has also scattered. This is
 * the entire disconnect story: no reconnect tokens, no grace period, just
 * "the hand does not hang because one browser tab closed."
 */
function autoActForDisconnected(table) {
  const g = table.game;
  if (!g) return;
  let guard = 0;
  while (g.turn >= 0 && g.street !== 'showdown' && g.street !== 'over' && guard++ < g.seats.length + 4) {
    const s = g.seats[g.turn];
    if (!s || s.connected) break;
    const legal = options(g, s);
    act(g, g.turn, legal.includes('check') ? 'check' : 'fold');
  }
}

function settleIfDone(table) {
  if (table.phase === 'playing' && table.game && (table.game.street === 'showdown' || table.game.street === 'over')) {
    table.phase = 'idle';
    clearTimeout(table.nextTimer);
    // Long enough to read the showdown, short when the hand ended because
    // nobody was left to deal to (so the lobby does not sit there for 4s).
    const delay = table.game.street === 'showdown' ? 4000 : 1200;
    table.nextTimer = setTimeout(() => tryStartHand(table), delay);
  }
}

/**
 * Start a hand if two or more people are actually here for one. Composition
 * — who is seated, in what order — is fixed for the life of a holdem.js
 * game object, so this is also the only place seats are added or removed:
 * survivors of the last hand plus anyone who has been waiting, rebuilt into
 * a fresh `createGame` only when who is playing has actually changed. That
 * means the button keeps rotating normally across a stable table and only
 * resets (to seat 0, same as a brand new table) on a hand where the seating
 * itself changed — a deliberately simple rule for phase 1 rather than
 * tracking a button seat through arbitrary joins and leaves.
 */
export function tryStartHand(table) {
  if (table.phase === 'playing') return;
  const survivors = (table.game?.seats ?? [])
    .filter((s) => s.connected && s.chips > 0)
    .map((s) => ({ id: s.id, ws: s.ws, name: s.name, chips: s.chips }));
  const newcomers = table.waiting.filter((w) => isOpen(w.ws));
  const combined = [...survivors, ...newcomers.map((w) => ({ id: w.id, ws: w.ws, name: w.name, chips: table.startChips }))];

  if (combined.length < 2) {
    table.waiting = newcomers; // drop only the closed sockets; keep waiting for a second player
    broadcast(table);
    return;
  }

  const seatsIn = combined.slice(0, MAX_SEATS);
  table.waiting = combined.slice(MAX_SEATS).map(({ id, ws, name }) => ({ id, ws, name }));

  if (!sameComposition(table.game, seatsIn)) {
    table.game = createGame({
      seats: seatsIn.map((s) => ({ id: s.id, name: s.name, chips: s.chips, human: true, ws: s.ws, connected: true })),
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
    });
  }
  table.phase = 'playing';
  startHand(table.game);
  autoActForDisconnected(table);
  settleIfDone(table);
  broadcast(table);
}

/** A browser asks to sit down. Chips reset if this socket was never seated
 * before, or was seated and busted — reconnecting (a fresh WebSocket, which
 * is what a page reload gets you) is the only "rebuy" phase 1 has. */
export function handleJoin(table, ws, name) {
  if (table.waiting.some((w) => w.ws === ws)) return;
  if (table.game?.seats.some((s) => s.ws === ws && s.chips > 0)) return;
  const seatedCount = table.game?.seats.filter((s) => s.connected && s.chips > 0).length ?? 0;
  if (seatedCount + table.waiting.length >= MAX_SEATS) {
    send(ws, { type: 'error', message: 'table is full' });
    return;
  }
  table.waiting.push({ id: randomUUID(), ws, name: cleanName(name) });
  table.sockets.add(ws);
  tryStartHand(table); // broadcasts either way — a new hand, or just the updated waiting count
}

/**
 * Apply a player's action. Every check the client cannot be trusted to have
 * made itself: that this socket owns the seat whose turn it is, and that the
 * action is one `options()` actually allows right now — holdem.js degrades
 * an illegal call fairly gracefully on its own (see its comments), but
 * refusing it here means the client gets a real error instead of a silent
 * no-op.
 */
export function handleAction(table, ws, action, amount) {
  const g = table.game;
  if (!g || table.phase !== 'playing') return send(ws, { type: 'error', message: 'no hand in progress' });
  const seatIndex = g.seats.findIndex((s) => s.ws === ws);
  if (seatIndex === -1) return send(ws, { type: 'error', message: 'you are not seated' });
  if (g.turn !== seatIndex) return send(ws, { type: 'error', message: 'not your turn' });
  const seat = g.seats[seatIndex];
  const legal = options(g, seat);
  if (!legal.includes(action)) return send(ws, { type: 'error', message: `cannot ${action} right now` });

  const amt = Number.isFinite(Number(amount)) ? Math.trunc(Number(amount)) : 0;
  act(g, seatIndex, action, amt);
  autoActForDisconnected(table);
  settleIfDone(table);
  broadcast(table);
}

/** Voluntarily stand up without closing the tab: sit out of future hands,
 * and if it is your turn right now, act for you exactly like a disconnect. */
export function handleLeave(table, ws) {
  table.waiting = table.waiting.filter((w) => w.ws !== ws);
  const seat = table.game?.seats.find((s) => s.ws === ws);
  if (seat) {
    seat.connected = false;
    autoActForDisconnected(table);
    settleIfDone(table);
  }
  broadcast(table);
}

/**
 * The socket actually closed. Same engine-side effect as `handleLeave`, plus
 * the bookkeeping a live connection does not need: drop it from broadcasts,
 * and null the seat's `ws` so a stale reference can never again satisfy the
 * `s.ws === ws` "is this mine" check in `viewFor` (an object that has been
 * garbage-collected still `===` itself, so this is not defensive for
 * nothing).
 *
 * Returns true when the table has nobody left at all, so the caller can drop
 * it from the registry — nothing here is persisted, so an empty table is
 * exactly as expensive to keep around as it looks.
 */
export function handleDisconnect(table, ws) {
  table.sockets.delete(ws);
  table.waiting = table.waiting.filter((w) => w.ws !== ws);
  const seat = table.game?.seats.find((s) => s.ws === ws);
  if (seat) {
    seat.connected = false;
    seat.ws = null;
    autoActForDisconnected(table);
    settleIfDone(table);
  }
  broadcast(table);
  return table.sockets.size === 0;
}
