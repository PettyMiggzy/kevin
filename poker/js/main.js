// The room: seats, cards, chips, and the bots that sit in them.
import { createGame, startHand, act, options, toCall, potTotal } from './holdem.js';
import { ROSTER, STYLES, byId, portrait } from './characters.js';
import { bestOfSeven } from './cards.js';

const $ = (s) => document.querySelector(s);
const room = $('#room');
const START_CHIPS = 2000;
const SEAT_COUNT = 6;

// You are always seat 0 and always at the bottom of the table; the rest are
// spread round the oval from there. Positions are percentages so the table
// scales with the viewport.
// A seat is anchored at its portrait, and its name, chips and cards hang
// roughly 90px BELOW that, so the anchors sit high inside the oval rather than
// on its edge — the top seat at 8% put its head through the page title.
const SPOTS = [
  [50, 84], [15, 64], [15, 26], [50, 15], [85, 26], [85, 64],
];

const line = (t) => {
  const el = document.createElement('div');
  el.textContent = t;
  $('#log').append(el);
  $('#log').scrollTop = $('#log').scrollHeight;
};

const roster = ROSTER.slice(1, SEAT_COUNT);
const game = createGame({
  seats: [
    { id: 'you', name: 'You', character: byId('kevin'), chips: START_CHIPS, human: true },
    ...roster.map((c) => ({ id: c.id, name: c.name, character: c, chips: START_CHIPS, human: false })),
  ],
  smallBlind: 10,
  bigBlind: 20,
});

// --- rendering ---------------------------------------------------------------
const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
function cardEl(code, { small = false, faceDown = false, dim = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '') + (faceDown ? ' back' : '') + (dim ? ' muck' : '');
  if (faceDown) { el.textContent = '★'; return el; }
  const r = code[0] === 'T' ? '10' : code[0];
  const s = code[1];
  if (s === 'h' || s === 'd') el.classList.add('red');
  el.innerHTML = `<div>${r}</div><div class="suit">${SUIT_GLYPH[s]}</div>`;
  return el;
}

let seatEls = [];
function buildSeats() {
  for (const el of seatEls) el.remove();
  seatEls = game.seats.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'seat';
    el.style.left = SPOTS[i][0] + '%';
    el.style.top = SPOTS[i][1] + '%';
    el.innerHTML = `<div class="bet" hidden></div><div class="pic"></div>
      <div class="name"></div><div class="chips"></div>
      <div class="hole"></div><div class="tag"></div>`;
    room.append(el);
    if (s.character) portrait(s.character).then((c) => { if (c) el.querySelector('.pic').append(c); });
    return el;
  });
}

function render() {
  const board = $('#board');
  board.innerHTML = '';
  for (const c of game.board) board.append(cardEl(c));
  // Placeholders so the table does not jump around as cards land.
  for (let i = game.board.length; i < 5; i++) {
    const ghost = document.createElement('div');
    ghost.className = 'card';
    ghost.style.visibility = 'hidden';
    board.append(ghost);
  }
  $('#pot').textContent = `POT ${potTotal(game).toLocaleString()} KEVIN`;

  game.seats.forEach((s, i) => {
    const el = seatEls[i];
    el.classList.toggle('turn', game.turn === i);
    el.classList.toggle('folded', s.folded || s.out);
    el.querySelector('.name').textContent = s.name + (s.human ? '' : ` · ${s.character?.style ?? ''}`);
    el.querySelector('.chips').textContent = s.out ? 'BUSTED' : `${s.chips.toLocaleString()}`;
    const bet = el.querySelector('.bet');
    bet.hidden = !s.bet;
    bet.textContent = s.bet;
    const hole = el.querySelector('.hole');
    hole.innerHTML = '';
    // Bots' cards stay face down until a showdown that they are still in.
    const show = s.human || (game.street === 'showdown' && !s.folded && game.board.length === 5);
    for (const c of s.hole) hole.append(cardEl(c, { small: true, faceDown: !show, dim: s.folded }));
    el.querySelector('.tag').textContent =
      game.street === 'showdown' && !s.folded && s.result ? s.result.name : '';
    let d = el.querySelector('.dealer');
    if (game.button === i && !s.out) {
      if (!d) { d = document.createElement('div'); d.className = 'dealer'; d.textContent = 'D'; el.append(d); }
    } else if (d) d.remove();
  });

  drawControls();
}

// --- controls ----------------------------------------------------------------
function drawControls() {
  const c = $('#controls');
  c.innerHTML = '';
  const you = game.seats[0];

  if (game.street === 'showdown' || game.street === 'over') {
    const playing = game.seats.filter((s) => s.chips > 0).length;
    const b = document.createElement('button');
    b.textContent = you.chips <= 0 ? 'REBUY' : playing < 2 ? 'NEW TABLE' : 'NEXT HAND';
    b.onclick = () => {
      if (you.chips <= 0) { you.chips = START_CHIPS; line('You rebuy for ' + START_CHIPS); }
      if (game.seats.filter((s) => s.chips > 0).length < 2) {
        for (const s of game.seats) s.chips = START_CHIPS;
        line('Table reset.');
      }
      deal();
    };
    c.append(b);
    return;
  }
  if (game.turn !== 0) return;

  const need = toCall(game, you);
  const opts = options(game, you);
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = fn;
    c.append(b);
    return b;
  };
  if (opts.includes('fold')) mk('FOLD', 'red', () => human('fold'));
  if (opts.includes('check')) mk('CHECK', 'ghost', () => human('check'));
  if (opts.includes('call')) mk(`CALL ${Math.min(need, you.chips)}`, '', () => human('call'));

  if (opts.includes('bet') || opts.includes('raise')) {
    const high = Math.max(...game.seats.map((s) => s.bet));
    const min = Math.min(you.bet + you.chips, high + game.minRaise);
    const max = you.bet + you.chips;
    const wrap = document.createElement('div');
    wrap.id = 'raiseWrap';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = '10';
    slider.value = String(min);
    const val = document.createElement('span');
    val.id = 'raiseVal';
    val.textContent = min.toLocaleString();
    slider.oninput = () => { val.textContent = Number(slider.value).toLocaleString(); };
    wrap.append(slider, val);
    c.append(wrap);
    mk(need === 0 ? 'BET' : 'RAISE', '', () => human(need === 0 ? 'bet' : 'raise', Number(slider.value)));
    mk('ALL IN', 'red', () => human('raise', max));
  }
}

function human(action, amount = 0) {
  act(game, 0, action, amount);
  render();
  tick();
}

// --- the bots ----------------------------------------------------------------
/**
 * A rough hand strength in [0,1].
 *
 * Preflop this is a Chen-like read on the two cards; afterwards it is the real
 * evaluated category scaled down. It is not a solver and does not pretend to
 * be — it is enough that a rock folds rags and a maniac does not.
 */
function strength(s, board) {
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

function botMove(s) {
  const style = STYLES[s.character?.style] || STYLES.caller;
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

let thinking = null;
function tick() {
  clearTimeout(thinking);
  if (game.turn < 0 || game.street === 'showdown' || game.street === 'over') { render(); return; }
  if (game.turn === 0) { render(); return; }
  // A pause, so the table reads as people acting rather than a wall of text.
  thinking = setTimeout(() => {
    const s = game.seats[game.turn];
    const [action, amount] = botMove(s);
    act(game, game.turn, action, amount);
    render();
    tick();
  }, 520 + Math.random() * 420);
}

function deal() {
  $('#log').innerHTML = '';
  startHand(game);
  if (game.street === 'over') { line('Not enough players with chips.'); render(); return; }
  syncLog();
  render();
  tick();
}

let logged = 0;
function syncLog() { logged = 0; }
const origLine = line;
setInterval(() => {
  while (logged < game.log.length) origLine(game.log[logged++]);
}, 120);

buildSeats();
deal();
