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
import { ROSTER } from '../js/characters.js';
import { botMove } from './bots.mjs';
import { randomUUID } from 'node:crypto';

export const MAX_SEATS = 6;
const OPEN = 1; // WebSocket.OPEN, without importing the library for one constant
const noop = () => {};

/**
 * @param {string} id
 * @param {{smallBlind?:number, bigBlind?:number, startChips?:number, name?:string, mode?:string,
 *   onHandSettled?:(table:object, deltas:Array<{name:string,bot:boolean,delta:number}>)=>void}} [opts]
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
    game: null,           // the live holdem.js game, or the last finished one
    waiting: [],           // [{ id, ws, name, chips?, bot?, style? }] — not
                            // dealt in yet; an explicit `chips` (set by
                            // tournament.mjs when it seats a player with
                            // their existing stack) wins over the table's own
                            // startChips — see handleJoin. `bot`/`style` mark
                            // a seat pushed on by `addBots` rather than a
                            // real join.
    sockets: new Set(),    // every connection that should receive broadcasts
    phase: 'idle',         // 'idle' | 'playing'
    nextTimer: null,
    botTimer: null,        // scheduleBotTurn's pending "it's a bot's turn" timer
    closed: false,          // set once every human socket is gone — see handleDisconnect
    handChipsBefore: null, // Map(seat -> chips) snapshotted right before this
                            // hand's startHand(), consumed by settleIfDone —
                            // see its own comment and onHandSettled below.
    // Storage lives outside this file entirely — see this file's own header
    // comment on why — so the leaderboard is wired in as a callback the
    // caller supplies (index.mjs, closing over its own SQLite handle) rather
    // than an import here. Defaults to a no-op so every existing caller
    // (tests, tournament.mjs's internal tables) is unaffected.
    onHandSettled: opts.onHandSettled || noop,
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
        bot: !!s.bot, // not sensitive — just lets the client badge a bot seat, same as `name`
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

    // `street === 'over'` is startHand's own "not enough players with
    // chips" early exit — no card was dealt and no chip moved, so there is
    // nothing to record. A real conclusion (however the hand actually
    // ended — a fold-out or a genuine showdown) always sets `street` to
    // 'showdown', see holdem.js's `finish()`. Diffing against the snapshot
    // tryStartHand took immediately before this hand's own startHand() is
    // exactly the "before/after" the leaderboard needs, and works no matter
    // which caller's settleIfDone() call actually closes out the hand
    // (a normal action, or a disconnect/leave auto-folding it shut).
    if (table.game.street === 'showdown' && table.handChipsBefore) {
      const before = table.handChipsBefore;
      const deltas = table.game.seats
        .filter((s) => !s.bot)
        .map((s) => ({ name: s.name, bot: false, delta: s.chips - (before.get(s.seat) ?? s.chips) }));
      table.onHandSettled(table, deltas);
    }
    table.handChipsBefore = null;
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
  if (table.phase === 'playing') { broadcast(table); scheduleBotTurn(table); return; }
  const survivors = (table.game?.seats ?? [])
    .filter((s) => s.connected && s.chips > 0)
    .map((s) => ({ id: s.id, ws: s.ws, name: s.name, chips: s.chips, bot: s.bot, style: s.style }));
  const newcomers = table.waiting.filter((w) => isOpen(w.ws));
  const combined = [...survivors, ...newcomers.map((w) => (
    { id: w.id, ws: w.ws, name: w.name, chips: w.chips ?? table.startChips, bot: w.bot, style: w.style }
  ))];

  if (combined.length < 2) {
    table.waiting = newcomers; // drop only the closed sockets; keep waiting for a second player
    broadcast(table);
    scheduleBotTurn(table);
    return;
  }

  const seatsIn = combined.slice(0, MAX_SEATS);
  // Preserve `chips`/`bot`/`style` for anyone bumped back to waiting by an
  // over-full table (a tournament seating more than MAX_SEATS at once, or in
  // principle more bots than addBots itself should ever be asked to add) —
  // dropping any of this here would silently reset a rejoining stack, or
  // turn a bot back into a human, the next time they made it off the
  // waiting list.
  table.waiting = combined.slice(MAX_SEATS).map(({ id, ws, name, chips, bot, style }) => ({ id, ws, name, chips, bot, style }));

  if (!sameComposition(table.game, seatsIn)) {
    table.game = createGame({
      seats: seatsIn.map((s) => ({
        id: s.id, name: s.name, chips: s.chips, human: !s.bot, ws: s.ws, connected: true,
        bot: !!s.bot, style: s.style,
      })),
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
  // The "before" side of the leaderboard diff — see settleIfDone, which
  // reads this back once the hand it belongs to actually concludes (that
  // can be many handleAction calls later, or synchronously right below via
  // autoActForDisconnected, so it has to live on `table`, not a local).
  table.handChipsBefore = new Map(table.game.seats.map((s) => [s.seat, s.chips]));
  startHand(table.game);
  autoActForDisconnected(table);
  settleIfDone(table);
  broadcast(table);
  scheduleBotTurn(table);
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
  autoActForDisconnected(table);
  settleIfDone(table);
  broadcast(table);
  // Self-chaining: if the seat this just handed the turn to is ALSO a bot
  // (an all-remaining-bots street, or several bots in a row), this schedules
  // the next one exactly the way this call was itself scheduled — no extra
  // loop anywhere. A real player's action reaches here through the exact
  // same path (index.mjs's `case 'action'`), so a bot's move is never a
  // parallel, less-checked code path — see scheduleBotTurn.
  scheduleBotTurn(table);
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
  scheduleBotTurn(table);
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
  if (table.sockets.size === 0) {
    // Bots never occupy `table.sockets` (see addBots) — only real browser
    // tabs do — so this is genuinely "every human is gone", not "everyone is
    // gone". Without this, an all-bot-remaining table would otherwise keep
    // scheduleBotTurn's timer chain running forever, on a droplet that
    // cannot afford an orphaned setTimeout per abandoned table: index.mjs
    // deletes this table from its own registry the instant this returns
    // true, but nothing would otherwise stop the timer chain still holding
    // a reference to it.
    table.closed = true;
    clearTimeout(table.botTimer);
    return true;
  }
  scheduleBotTurn(table);
  return false;
}

/**
 * Chains a bot's action onto its own "thinking" timer instead of a loop, so
 * an all-remaining-bots street — or a whole table of nothing but bots —
 * plays itself out one `handleAction` call at a time, each one going
 * through the exact same turn-ownership and options()-legality checks a
 * real WebSocket message gets (see handleAction's own comment). Re-checked
 * at fire time: the same seat, the same hand, and the same turn this timer
 * was set for, because anything can happen in the pause — everyone else
 * could fold the hand shut, the table could close (see handleDisconnect),
 * or (composition changed) a new game object could already be in play.
 * Idempotent to call repeatedly for the same still-pending turn — every
 * mutating function in this file calls this right after its own broadcast,
 * so it just resets the pending timer to whoever's turn it currently is.
 */
function scheduleBotTurn(table) {
  clearTimeout(table.botTimer);
  if (table.closed) return;
  const g = table.game;
  if (!g || table.phase !== 'playing' || g.turn < 0) return;
  const seat = g.seats[g.turn];
  if (!seat || !seat.bot) return;

  const gameRef = g;
  const hand = g.hand;
  const turnSeat = g.turn;
  // 550-1400ms: the same "thinking pause" feel as the single-player room's
  // own bots (poker/js/main.js's tick()), kept modest on purpose — a
  // resource-constrained droplet running several concurrent bot tables
  // cannot afford that pause to also be a long-lived timer.
  const delay = 550 + Math.random() * 850;
  table.botTimer = setTimeout(() => {
    if (table.closed || table.game !== gameRef || table.phase !== 'playing') return;
    if (table.game.hand !== hand || table.game.turn !== turnSeat) return;
    const s = table.game.seats[turnSeat];
    if (!s || !s.bot) return;
    const [action, amount] = botMove(table.game, s);
    handleAction(table, s.ws, action, amount);
  }, delay);
}

/**
 * Push `count` bot seats onto the waiting list, the same list a real `join`
 * lands on — so a bot goes through `tryStartHand`'s ordinary
 * `waiting`/`combined`/`seatsIn` machinery (MAX_SEATS cap included) exactly
 * like a person, with no parallel seating path to keep in sync. Each bot
 * gets its own fake "always open" socket (`.send`/`.readyState`, this file's
 * own documented transport contract — see the header comment) rather than a
 * shared one, because `s.ws === ws` identity checks are used throughout this
 * file (handleAction's turn-ownership check chief among them) to tell one
 * seat from another; sharing one fake socket across bots would make two bot
 * seats indistinguishable to those checks. Deliberately NOT added to
 * `table.sockets` — nothing is ever listening on the other end, and
 * handleDisconnect's "every human is gone" check depends on `table.sockets`
 * counting only real connections (see its own comment).
 */
export function addBots(table, count) {
  const n = Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0;
  for (let i = 0; i < n; i++) {
    const c = ROSTER[(table.waiting.length + i) % ROSTER.length];
    table.waiting.push({
      id: randomUUID(),
      ws: { readyState: OPEN, send: noop },
      name: c.name,
      bot: true,
      style: c.style,
    });
  }
}
