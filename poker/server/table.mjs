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
 * @param {{smallBlind?:number, bigBlind?:number, startChips?:number, name?:string, mode?:string, turnClockMs?:number}} [opts]
 */
export function createTable(id, opts = {}) {
  return {
    id,
    // A cosmetic label for the lobby ('mode' is the seam a future real-money
    // table plugs into — see summarizeTable and poker/server/README.md's
    // "What phase 2 needs". Nothing in this file branches on it; it is
    // metadata for the lobby and the client, not a rule.
    name: opts.name || id,
    mode: opts.mode === 'tournament' ? 'tournament' : 'practice',
    smallBlind: opts.smallBlind ?? 10,
    bigBlind: opts.bigBlind ?? 20,
    startChips: opts.startChips ?? 2000,
    // Overridable only so a test can use a millisecond-scale clock instead
    // of actually waiting 60s — nothing in the client or lobby sets this.
    turnClockMs: opts.turnClockMs ?? 60_000,
    game: null,           // the live holdem.js game, or the last finished one
    waiting: [],           // [{ id, ws, name, chips? }] — not dealt in yet; an
                            // explicit `chips` (set by tournament.mjs when it
                            // seats a player with their existing stack) wins
                            // over the table's own startChips — see handleJoin.
    sockets: new Set(),    // every connection that should receive broadcasts
    phase: 'idle',         // 'idle' | 'playing'
    nextTimer: null,
    turnTimer: null,       // forces the acting seat's turn once turnClockMs elapses — see scheduleTurnTimer
    turnExpiresAt: null,   // ms epoch, mirrored into viewFor so the client can draw a countdown
  };
}

/**
 * Public, non-secret summary for a lobby listing: names, counts, phase.
 * Never touches `hole` or `deck` — there is nothing here viewFor would need
 * to redact, which is exactly why this is safe to expose to anyone, seated
 * or not.
 */
export function summarizeTable(table) {
  const seated = (table.game?.seats ?? []).filter((s) => s.connected && s.chips > 0);
  return {
    id: table.id,
    name: table.name,
    mode: table.mode,
    phase: table.phase,
    maxSeats: MAX_SEATS,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    players: [...seated, ...table.waiting].map((s) => s.name),
    seatedCount: seated.length + table.waiting.length,
  };
}

const isOpen = (ws) => !!ws && ws.readyState === OPEN;
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';

function send(ws, obj) {
  if (!isOpen(ws)) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* socket died mid-send; close() will follow */ }
}

function broadcast(table) {
  // "State just changed" and "whoever must act next gets a fresh clock" are
  // the same moment, so re-arming here means no call site has to remember to
  // do it separately — every broadcast already means one of: a new hand
  // started, someone acted, or someone joined/left, all of which either move
  // the turn on or end the hand outright. Must run BEFORE the send loop below
  // — viewFor reads table.turnExpiresAt, so scheduling after sending would
  // publish every broadcast one clock behind.
  scheduleTurnTimer(table);
  for (const ws of table.sockets) send(ws, { type: 'state', ...viewFor(table, ws) });
}

function clearTurnTimer(table) {
  clearTimeout(table.turnTimer);
  table.turnTimer = null;
  table.turnExpiresAt = null;
}

/**
 * A player who does not act within turnClockMs is forced to act for
 * themselves, exactly like autoActForDisconnected treats a dropped socket
 * (check if that costs nothing, fold otherwise) — being AFK at the table is
 * not different from being disconnected as far as the other players waiting
 * on you are concerned.
 */
function scheduleTurnTimer(table) {
  clearTurnTimer(table);
  const g = table.game;
  if (!g || table.phase !== 'playing' || g.turn < 0) return;
  const ws = g.seats[g.turn].ws;
  table.turnExpiresAt = Date.now() + table.turnClockMs;
  table.turnTimer = setTimeout(() => {
    const g2 = table.game;
    // The turn may have already moved on by the time this fires (the player
    // acted just under the wire, or the hand ended some other way) — only
    // force an action if it is still, right now, the exact seat this timer
    // was armed for.
    if (!g2 || table.phase !== 'playing' || g2.turn < 0 || g2.seats[g2.turn].ws !== ws) return;
    const seat = g2.seats[g2.turn];
    const legal = options(g2, seat);
    act(g2, g2.turn, legal.includes('check') ? 'check' : 'fold');
    settleAndBroadcast(table);
  }, table.turnClockMs);
}

/** The tail every action-applying path shares: let disconnected seats play
 * themselves out, check whether the hand is now over, and publish — which
 * also re-arms the next actor's clock (see broadcast's own comment). */
function settleAndBroadcast(table) {
  autoActForDisconnected(table);
  settleIfDone(table);
  broadcast(table);
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
    turnExpiresAt: table.turnExpiresAt ?? null,
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
  // A hand already under way is not restarted, but every caller of this
  // function — handleJoin chief among them — relies on it to always send a
  // fresh broadcast, e.g. so a spectator added while a hand is already in
  // progress (a third player joining a two-handed table, or a tournament
  // seating someone mid-flight elsewhere) sees SOMETHING immediately
  // instead of a blank screen until whoever's turn it already is happens
  // to act. Broadcasting here is a no-op in cost (the same state everyone
  // else already has) and closes that gap for anyone whose socket was just
  // added to `table.sockets`.
  if (table.phase === 'playing') { broadcast(table); return; }
  const survivors = (table.game?.seats ?? [])
    .filter((s) => s.connected && s.chips > 0)
    .map((s) => ({ id: s.id, ws: s.ws, name: s.name, chips: s.chips }));
  const newcomers = table.waiting.filter((w) => isOpen(w.ws));
  const combined = [...survivors, ...newcomers.map((w) => ({ id: w.id, ws: w.ws, name: w.name, chips: w.chips ?? table.startChips }))];

  if (combined.length < 2) {
    table.waiting = newcomers; // drop only the closed sockets; keep waiting for a second player
    broadcast(table);
    return;
  }

  const seatsIn = combined.slice(0, MAX_SEATS);
  // Preserve `chips` for anyone bumped back to waiting by an over-full table
  // (a tournament seating more than MAX_SEATS at once) — dropping it here
  // would have silently reset their stack to table.startChips next time
  // they made it off the waiting list.
  table.waiting = combined.slice(MAX_SEATS).map(({ id, ws, name, chips }) => ({ id, ws, name, chips }));

  if (!sameComposition(table.game, seatsIn)) {
    table.game = createGame({
      seats: seatsIn.map((s) => ({ id: s.id, name: s.name, chips: s.chips, human: true, ws: s.ws, connected: true })),
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
    });
  }
  // A stable seating reuses the same game object (see sameComposition's
  // comment above) rather than calling createGame again — but a tournament
  // table's blinds change out from under it on a level clock while the
  // seating can stay perfectly stable for many hands in a row. Re-reading
  // them from `table` here, every hand, is what makes a blind increase
  // actually reach a hand in progress instead of only ever taking effect the
  // next time someone joins or busts. A no-op for practice tables, whose
  // blinds never change after creation.
  table.game.smallBlind = table.smallBlind;
  table.game.bigBlind = table.bigBlind;
  table.phase = 'playing';
  startHand(table.game);
  settleAndBroadcast(table);
}

/**
 * A browser asks to sit down. Chips reset to the table's own starting stack
 * if this socket was never seated before, or was seated and busted —
 * reconnecting (a fresh WebSocket, which is what a page reload gets you) is
 * the only "rebuy" phase 1 has.
 *
 * `chips`, when given, overrides that default — this is how tournament.mjs
 * seats a player with the stack they actually have (not the table's
 * `startChips`, which means nothing for a tournament table) whenever it
 * assigns or rebalances them onto one of its tables. A practice-table client
 * never sends a fourth argument, so this is a no-op for the phase-1 protocol.
 */
export function handleJoin(table, ws, name, chips) {
  if (table.waiting.some((w) => w.ws === ws)) return;
  if (table.game?.seats.some((s) => s.ws === ws && s.chips > 0)) return;
  const seatedCount = table.game?.seats.filter((s) => s.connected && s.chips > 0).length ?? 0;
  if (seatedCount + table.waiting.length >= MAX_SEATS) {
    send(ws, { type: 'error', message: 'table is full' });
    return;
  }
  table.waiting.push({ id: randomUUID(), ws, name: cleanName(name), chips });
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
  settleAndBroadcast(table);
}

/** Voluntarily stand up without closing the tab: sit out of future hands,
 * and if it is your turn right now, act for you exactly like a disconnect. */
export function handleLeave(table, ws) {
  table.waiting = table.waiting.filter((w) => w.ws !== ws);
  const seat = table.game?.seats.find((s) => s.ws === ws);
  if (seat) { seat.connected = false; settleAndBroadcast(table); return; }
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
  const empty = table.sockets.size === 0;
  // Nobody left to see the clock run out — broadcast() just re-armed it
  // (scheduleTurnTimer does not know the table is about to be dropped from
  // index.mjs's registry), so cancel it rather than let a timer outlive the
  // table it was scheduled for.
  if (empty) clearTurnTimer(table);
  return empty;
}
