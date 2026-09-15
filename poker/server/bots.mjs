// The bot AI, ported server-side from poker/js/main.js — the existing
// standalone single-player room. That file is left completely untouched (see
// poker/server/README.md and the task this shipped under); this is the same
// strength()/botMove() math, just with `game` made an explicit argument
// instead of a module-level global, because table.mjs holds many concurrent
// games and main.js only ever holds one. Do not let this drift from
// main.js's own copy without a reason — a multiplayer bot and a
// single-player bot should play identically.
import { toCall, potTotal, options } from '../js/holdem.js';
import { STYLES } from '../js/characters.js';
import { bestOfSeven } from '../js/cards.js';

/**
 * A rough hand strength in [0,1].
 *
 * Preflop this is a Chen-like read on the two cards; afterwards it is the real
 * evaluated category scaled down. It is not a solver and does not pretend to
 * be — it is enough that a rock folds rags and a maniac does not.
 */
export function strength(s, board) {
  const val = (c) => '23456789TJQKA'.indexOf(c[0]) + 2;
  const [a, b] = s.hole;
  if (!board.length) {
    const hi = Math.max(val(a), val(b));
    const lo = Math.min(val(a), val(b));
    const pair = a[0] === b[0];
    const suited = a[1] === b[1];
    const gap = hi - lo;
    let v = (hi - 2) / 12 * 0.55 + (pair ? 0.38 : 0);
    if (suited) v += 0.08;
    if (!pair && gap <= 2) v += 0.06;
    if (!pair && gap >= 6) v -= 0.10;
    return Math.max(0, Math.min(1, v));
  }
  const best = bestOfSeven([...s.hole, ...board]);
  if (!best) return 0.2;
  // Category 0-8 mapped into a usable band; a bare high card is not zero
  // because it still wins unimproved pots.
  return Math.max(0.08, Math.min(1, 0.12 + best.score[0] / 8 * 0.88));
}

/**
 * Decide a bot seat's move. Returns `[action, amount]`, the exact same shape
 * `handleAction` in table.mjs expects from a real WebSocket message — a bot's
 * move goes through that one function, with the same options()-legality
 * check any human's action gets, rather than a separate trusted code path.
 * `s.style` is one of STYLES's keys (see poker/js/characters.js), set once
 * per bot seat by table.mjs's `addBots`.
 */
export function botMove(game, s) {
  const style = STYLES[s.style] || STYLES.caller;
  const need = toCall(game, s);
  const pot = Math.max(1, potTotal(game));
  const v = strength(s, game.board);
  const opts = options(game, s);
  const odds = need / (pot + need);
  const bluff = Math.random() < style.bluff;

  if (need === 0) {
    // Free to see the next card. Bet good hands, occasionally bluff.
    if ((v > 0.55 && Math.random() < style.raise + style.aggression * 0.2) || bluff) {
      if (opts.includes('bet')) {
        const size = Math.round((pot * (0.4 + style.aggression * 0.25)) / 10) * 10;
        return ['bet', Math.max(game.bigBlind, Math.min(s.bet + s.chips, s.bet + size))];
      }
    }
    return ['check', 0];
  }
  // Facing a bet: raise strong hands, call when the price is right, else fold.
  if (v > 0.7 && Math.random() < style.raise && opts.includes('raise')) {
    const size = Math.round((pot * (0.5 + style.aggression * 0.3)) / 10) * 10;
    return ['raise', Math.min(s.bet + s.chips, s.bet + need + Math.max(game.minRaise, size))];
  }
  if (v > odds + (0.5 - style.call) * 0.5 || bluff) return ['call', 0];
  return ['fold', 0];
}
