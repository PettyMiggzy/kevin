// Texas Hold'em: the rules, with no UI in them.
//
// Kept separate from the table so it can be tested headlessly and so a future
// server can run the same file — an engine that only exists inside a render
// loop cannot be checked, and a betting game that cannot be checked should not
// take bets.
import { newDeck, shuffle, bestOfSeven, compareScores } from './cards.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];

/**
 * @param {Array} seats  [{ id, name, character, chips, human }]
 */
export function createGame({ seats, smallBlind = 10, bigBlind = 20 }) {
  return {
    seats: seats.map((s, i) => ({
      ...s, seat: i, hole: [], bet: 0, committed: 0,
      folded: false, allIn: false, acted: false, out: s.chips <= 0,
    })),
    button: 0, smallBlind, bigBlind,
    deck: [], board: [], pots: [], street: 'preflop',
    turn: -1, lastRaise: 0, minRaise: bigBlind, hand: 0, log: [],
  };
}

const live = (g) => g.seats.filter((s) => !s.out && !s.folded);
/** Players who can still act — all-in players are live but cannot bet. */
const actors = (g) => live(g).filter((s) => !s.allIn);

function say(g, text) {
  g.log.push(text);
  if (g.log.length > 200) g.log.shift();
}

export function startHand(g) {
  g.hand++;
  g.deck = shuffle(newDeck());
  g.board = [];
  g.pots = [];
  g.street = 'preflop';
  g.minRaise = g.bigBlind;
  for (const s of g.seats) {
    s.hole = [];
    s.bet = 0;
    s.committed = 0;
    s.folded = false;
    s.allIn = false;
    s.acted = false;
    s.out = s.chips <= 0;
    s.result = null;
  }
  const playing = g.seats.filter((s) => !s.out);
  if (playing.length < 2) { g.street = 'over'; return g; }

  // Move the button to the next player still holding chips.
  do { g.button = (g.button + 1) % g.seats.length; } while (g.seats[g.button].out);

  // seatOrder starts AFTER the button, so order[0] IS the small blind, order[1]
  // the big blind and order[2] the first to act. This read order[1] and
  // order[2] and opened on order[3] — every blind posted by the wrong player
  // and the whole table acting one seat out of position, at every seat count.
  //
  // Heads-up is the exception the rest of poker is written around: the button
  // posts the small blind and acts first before the flop. seatOrder puts the
  // button LAST in a two-handed order, so heads-up reads from the other end.
  const order = seatOrder(g, g.button);
  const heads = order.length === 2;
  const sbSeat = heads ? order[1] : order[0];
  const bbSeat = heads ? order[0] : order[1];
  post(g, sbSeat, g.smallBlind);
  post(g, bbSeat, g.bigBlind);
  say(g, `${sbSeat.name} posts ${g.smallBlind}, ${bbSeat.name} posts ${g.bigBlind}`);

  for (let r = 0; r < 2; r++) for (const s of order) s.hole.push(g.deck.pop());

  g.lastRaise = g.bigBlind;
  // A BLIND CAN BE ALL-IN. Posting it was their last chip, and an all-in
  // player cannot act — so handing them the turn froze the hand where it
  // stood: act() correctly refused, nothing advanced, and the pot sat on the
  // table forever. Heads-up against a short stack it happened on the deal.
  //
  // The turn walks on to the first seat that can actually act. If nobody can,
  // the hand has already bet itself and just needs dealing out.
  const first = heads ? 1 : 2 % order.length;
  const opener = order.slice(first).concat(order.slice(0, first)).find((s) => !s.allIn);
  if (!opener) return nextStreet(g);
  g.turn = opener.seat;
  return g;
}

/** Seats in acting order starting after `from`, skipping busted players. */
function seatOrder(g, from) {
  const out = [];
  for (let i = 1; i <= g.seats.length; i++) {
    const s = g.seats[(from + i) % g.seats.length];
    if (!s.out) out.push(s);
  }
  return out;
}

function post(g, s, amount) {
  const put = Math.min(amount, s.chips);
  s.chips -= put;
  s.bet += put;
  s.committed += put;
  if (s.chips === 0) s.allIn = true;
}

export const toCall = (g, s) => Math.max(0, highBet(g) - s.bet);
const highBet = (g) => Math.max(0, ...g.seats.map((s) => s.bet));

/** What this player may legally do right now. */
export function options(g, s) {
  const need = toCall(g, s);
  const opts = ['fold'];
  if (need === 0) opts.push('check');
  if (need > 0 && s.chips > 0) opts.push('call');
  if (s.chips > need) opts.push(need === 0 ? 'bet' : 'raise');
  return opts;
}

/**
 * Apply an action. `amount` is the TOTAL this player will have in front of
 * them after a bet or raise, which is how a poker room states it — "raise to
 * 200", not "raise by 140".
 */
export function act(g, seatIndex, action, amount = 0) {
  const s = g.seats[seatIndex];
  if (!s || s.folded || s.out || g.turn !== seatIndex) return g;
  const need = toCall(g, s);

  if (action === 'fold') {
    s.folded = true;
    say(g, `${s.name} folds`);
  } else if (action === 'check') {
    if (need > 0) return g;
    say(g, `${s.name} checks`);
  } else if (action === 'call') {
    // What they could actually put in, not what was asked of them. A player
    // calling 200 with 50 left is all-in for 50, and the hand history said 200.
    const had = s.chips;
    post(g, s, need);
    const put = had - s.chips;
    say(g, `${s.name} calls ${put}${s.allIn ? ' and is all in' : ''}`);
  } else {
    // A raise must be to at least the last raise size more than the current
    // high bet — unless the player is putting their last chip in, which is
    // always legal and does not reopen the betting.
    const target = Math.max(amount, highBet(g) + g.minRaise);
    const capped = Math.min(target, s.bet + s.chips);
    const raiseBy = capped - highBet(g);
    post(g, s, capped - s.bet);
    if (raiseBy >= g.minRaise) {
      g.minRaise = raiseBy;
      // A legal raise gives everyone else another turn.
      for (const o of g.seats) if (o !== s && !o.folded && !o.out && !o.allIn) o.acted = false;
    }
    say(g, `${s.name} ${need === 0 ? 'bets' : 'raises to'} ${capped}`);
  }
  s.acted = true;
  advance(g);
  return g;
}

function advance(g) {
  if (live(g).length === 1) return finish(g);
  const pending = actors(g).filter((s) => !s.acted || toCall(g, s) > 0);
  if (pending.length === 0) return nextStreet(g);
  // Next live player who still has chips to act with.
  let i = g.turn;
  for (let n = 0; n < g.seats.length; n++) {
    i = (i + 1) % g.seats.length;
    const s = g.seats[i];
    if (!s.out && !s.folded && !s.allIn && (!s.acted || toCall(g, s) > 0)) { g.turn = i; return g; }
  }
  return nextStreet(g);
}

function nextStreet(g) {
  collect(g);
  for (const s of g.seats) { s.bet = 0; s.acted = false; }
  g.minRaise = g.bigBlind;

  if (g.street === 'preflop') { g.street = 'flop'; g.deck.pop(); g.board.push(g.deck.pop(), g.deck.pop(), g.deck.pop()); }
  else if (g.street === 'flop') { g.street = 'turn'; g.deck.pop(); g.board.push(g.deck.pop()); }
  else if (g.street === 'turn') { g.street = 'river'; g.deck.pop(); g.board.push(g.deck.pop()); }
  else return finish(g);

  say(g, `--- ${g.street}: ${g.board.join(' ')}`);
  // With everyone all-in there is nobody left to act; deal out to the river.
  if (actors(g).length < 2) return nextStreet(g);
  // First player left of the button WHO CAN ACT. seatOrder only skips busted
  // seats, so taking its first entry handed the turn to someone who had
  // folded — act() correctly refused, nothing advanced, and the hand stalled
  // with the pot still on the table. The fuzzer saw it as chips leaking out of
  // the game.
  const next = seatOrder(g, g.button).find((s) => !s.folded && !s.allIn);
  if (!next) return finish(g);
  g.turn = next.seat;
  return g;
}

/**
 * Sweep bets into pots, splitting off a side pot at every all-in level.
 *
 * This is the part that quietly pays the wrong player if it is skipped: a
 * short stack can only win the portion each opponent matched, and the rest
 * belongs to whoever wins among the players who could still cover it.
 */
function collect(g) {
  const contributors = g.seats.filter((s) => s.bet > 0);
  if (!contributors.length) return;
  const levels = [...new Set(contributors.map((s) => s.bet))].sort((a, b) => a - b);
  let prev = 0;
  for (const level of levels) {
    const slice = level - prev;
    let amount = 0;
    const eligible = [];
    for (const s of g.seats) {
      if (s.bet <= prev) continue;
      amount += Math.min(slice, s.bet - prev);
      if (!s.folded) eligible.push(s.seat);
    }
    if (amount > 0) {
      const same = g.pots.find((p) => sameSet(p.eligible, eligible));
      if (same) same.amount += amount;
      else g.pots.push({ amount, eligible });
    }
    prev = level;
  }
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function finish(g) {
  collect(g);
  // AND CLEAR THEM, which nextStreet does on every other street and this did
  // not. collect() SWEEPS the bets into g.pots; it does not zero them, so from
  // the moment a hand ended until the next one was dealt, potTotal() — pots
  // plus live bets — counted the final street's money twice and the readout
  // over the table jumped to roughly double at exactly the moment the player
  // was looking at it to see what they had just won. The chips were always
  // right; only the number on the felt was wrong.
  for (const s of g.seats) s.bet = 0;
  const contenders = live(g);
  for (const s of contenders) {
    s.result = bestOfSeven([...s.hole, ...g.board]);
  }
  for (const pot of g.pots) {
    // Everyone eligible for this pot may since have folded — a side pot built
    // on the flop between two players who both give up on the turn. The money
    // does not evaporate; it goes to whoever is left. Skipping it here leaked
    // chips out of the game, which the fuzzer caught on the second hand.
    let inPot = contenders.filter((s) => pot.eligible.includes(s.seat));
    if (!inPot.length) inPot = contenders;
    if (!inPot.length) continue;
    let winners = [inPot[0]];
    for (const s of inPot.slice(1)) {
      if (!s.result || !winners[0].result) continue;
      const d = compareScores(s.result.score, winners[0].result.score);
      if (d > 0) winners = [s];
      else if (d === 0) winners.push(s);
    }
    // Odd chips go to the first winner left of the button, as in a card room.
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      w.chips += share;
      if (remainder > 0) { w.chips += 1; remainder--; }
    }
    const how = winners[0].result ? ` with ${winners[0].result.name}` : '';
    say(g, `${winners.map((w) => w.name).join(' and ')} win ${pot.amount}${how}`);
  }
  g.street = 'showdown';
  g.turn = -1;
  return g;
}

export const potTotal = (g) =>
  g.pots.reduce((n, p) => n + p.amount, 0) + g.seats.reduce((n, s) => n + s.bet, 0);
