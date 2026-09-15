// The multiplayer table: same felt as the single-player room, a real server
// on the other end of the wire instead of a local `game` object.
//
// This file runs NO rules — it never calls createGame/startHand/act. It
// sends actions and renders whatever poker/server/table.mjs's `viewFor` last
// broadcast. The only import from holdem.js is `options`, used purely to
// grey out buttons the server would refuse anyway; the server re-checks
// every action for itself (see table.mjs), so a bug in this file can make
// the UI wrong but can never let an illegal action through, and it is never
// handed a card that is not either this browser's own or already showing.
import { options } from './holdem.js';

const $ = (s) => document.querySelector(s);
const room = $('#room');
// Same six spots as the single-player table (js/main.js), so the felt reads
// identically whether the other five seats are bots or real people.
const SPOTS = [
  [50, 84], [15, 64], [15, 26], [50, 15], [85, 26], [85, 64],
];
const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };

// --- the table id, which is the entire "lobby" for phase 1 -------------------
// Whoever has this link is at this table. Sharing it IS inviting someone in
// — see poker/README.md for why that is an intentionally small first step.
const params = new URLSearchParams(location.search);
let tableId = params.get('t');
if (!tableId) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/O/1/l/i — read off a phone easily
  tableId = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  params.set('t', tableId);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
$('#tableCode').textContent = tableId;
$('#tableLink').href = location.href;
$('#tableLink').textContent = location.href;

// Production expects a Caddy reverse proxy on a subdomain, the same pattern
// server/README.md documents for the scores service — see poker/server/README.md.
// window.KEVIN_POKER_WS overrides this for local testing against a
// non-default port or host.
const WS_BASE = window.KEVIN_POKER_WS
  || (['localhost', '127.0.0.1', ''].includes(location.hostname)
    ? `ws://${location.hostname || 'localhost'}:8788`
    : 'wss://poker.iamkevin.lol');

// --- connecting ---------------------------------------------------------------
let ws = null;
let you = null;   // my seat index this hand, or null while I'm not dealt in
let last = null;   // the most recent redacted state from the server
let myName = null;
let reconnectTimer = null;

function setStatus(text, isError = false) {
  const el = $('#lobbyStatus');
  el.textContent = text;
  el.classList.toggle('err', isError);
}

function tryJoin() {
  if (myName && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'join', name: myName }));
  }
}

function connect() {
  ws = new WebSocket(`${WS_BASE}/ws/${encodeURIComponent(tableId)}`);
  ws.addEventListener('open', () => { setStatus(''); tryJoin(); });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'state') { last = msg; you = msg.you; render(); }
    else if (msg.type === 'error') setStatus(msg.message, true);
  });
  ws.addEventListener('close', () => {
    // A closed socket forfeits whatever stack it had at the table (see
    // table.mjs) — reconnecting is a fresh seat next hand, not a resumed
    // one, because phase 1 has no session token to prove it is the same
    // person coming back. Reconnecting automatically at least means a
    // dropped wifi bar does not require a manual reload.
    if (myName) setStatus('Disconnected — reconnecting…', true);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });
  ws.addEventListener('error', () => {});
}

$('#joinBtn').onclick = () => {
  const name = $('#nameInput').value.trim().slice(0, 20) || 'Player';
  myName = name;
  sessionStorage.setItem('kevin-poker-name', name);
  $('#lobby').hidden = true;
  room.hidden = false;
  $('#controls').hidden = false;
  $('#log').hidden = false;
  tryJoin();
};
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
const remembered = sessionStorage.getItem('kevin-poker-name');
if (remembered) $('#nameInput').value = remembered;

connect();

// --- rendering ------------------------------------------------------------
function cardEl(code, { small = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '');
  if (!code) { el.classList.add('back'); el.textContent = '★'; return el; }
  const r = code[0] === 'T' ? '10' : code[0];
  const s = code[1];
  if (s === 'h' || s === 'd') el.classList.add('red');
  el.innerHTML = `<div>${r}</div><div class="suit">${SUIT_GLYPH[s]}</div>`;
  return el;
}

let seatEls = [];
function buildSeats(n) {
  if (seatEls.length === n) return;
  for (const el of seatEls) el.remove();
  seatEls = Array.from({ length: n }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'seat';
    el.style.left = SPOTS[i][0] + '%';
    el.style.top = SPOTS[i][1] + '%';
    el.innerHTML = `<div class="bet" hidden></div><div class="pic"><span class="initial"></span></div>
      <div class="name"></div><div class="chips"></div>
      <div class="hole"></div><div class="tag"></div>`;
    room.append(el);
    return el;
  });
}

// The server's log is the whole rolling window (capped at 200 lines, see
// holdem.js's `say()`), not a diff — so if it is ever SHORTER than what we
// have already printed, the cap trimmed old lines off the front and the
// simplest correct move is to redraw from scratch rather than guess which
// lines survived.
let logged = 0;
function syncLog() {
  if (last.log.length < logged) { $('#log').innerHTML = ''; logged = 0; }
  while (logged < last.log.length) {
    const el = document.createElement('div');
    el.textContent = last.log[logged++];
    $('#log').append(el);
  }
  $('#log').scrollTop = $('#log').scrollHeight;
}

function render() {
  if (!last) return;
  const g = last;
  buildSeats(g.seats.length);

  const board = $('#board');
  board.innerHTML = '';
  for (const c of g.board) board.append(cardEl(c));
  for (let i = g.board.length; i < 5; i++) {
    const ghost = document.createElement('div');
    ghost.className = 'card';
    ghost.style.visibility = 'hidden';
    board.append(ghost);
  }
  const pot = g.pots.reduce((a, p) => a + p.amount, 0) + g.seats.reduce((a, s) => a + s.bet, 0);
  $('#pot').textContent = `POT ${pot.toLocaleString()} KEVIN`;

  g.seats.forEach((s, i) => {
    const el = seatEls[i];
    el.classList.toggle('turn', g.turn === i && g.street !== 'showdown');
    el.classList.toggle('folded', s.folded || s.out);
    el.querySelector('.initial').textContent = (s.name || '?')[0]?.toUpperCase() ?? '?';
    el.querySelector('.name').textContent =
      s.name + (s.mine ? ' (you)' : '') + (s.connected ? '' : ' · away');
    el.querySelector('.chips').textContent = s.out ? 'BUSTED' : s.chips.toLocaleString();
    const bet = el.querySelector('.bet');
    bet.hidden = !s.bet;
    bet.textContent = s.bet;
    const hole = el.querySelector('.hole');
    hole.innerHTML = '';
    for (const c of s.hole) hole.append(cardEl(c, { small: true }));
    el.querySelector('.tag').textContent =
      g.street === 'showdown' && !s.folded && s.result ? s.result.name : '';
    let d = el.querySelector('.dealer');
    if (g.button === i && !s.out) {
      if (!d) { d = document.createElement('div'); d.className = 'dealer'; d.textContent = 'D'; el.append(d); }
    } else if (d) d.remove();
  });

  syncLog();
  drawControls();
}

// --- controls ------------------------------------------------------------
function drawControls() {
  const c = $('#controls');
  c.innerHTML = '';
  const g = last;

  if (!g || g.seats.length === 0) { c.textContent = 'Waiting for another player to join…'; return; }
  if (you === null) { c.textContent = `Watching — you'll be dealt into the next hand (${g.waitingCount} others waiting).`; return; }
  if (g.street === 'over') { c.textContent = 'Waiting for one more player…'; return; }
  if (g.street === 'showdown') { c.textContent = 'Hand over — next hand starting…'; return; }
  if (g.turn !== you) { c.textContent = `Waiting on ${g.seats[g.turn]?.name ?? '…'}`; return; }

  const seat = g.seats[you];
  // A pure client-side echo of options()/toCall() from holdem.js against the
  // PUBLIC bets and stacks the server already sent everyone — no rule is
  // decided here, only which buttons to draw. See the file header.
  const fakeGame = { seats: g.seats.map((s) => ({ bet: s.bet, chips: s.chips })) };
  const legal = options(fakeGame, { bet: seat.bet, chips: seat.chips });
  const send = (action, amount = 0) => ws.send(JSON.stringify({ type: 'action', action, amount }));
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = fn;
    c.append(b);
    return b;
  };

  if (legal.includes('fold')) mk('FOLD', 'red', () => send('fold'));
  if (legal.includes('check')) mk('CHECK', 'ghost', () => send('check'));
  if (legal.includes('call')) {
    const high = Math.max(...g.seats.map((s) => s.bet));
    const need = Math.max(0, high - seat.bet);
    mk(`CALL ${Math.min(need, seat.chips).toLocaleString()}`, '', () => send('call'));
  }
  if (legal.includes('bet') || legal.includes('raise')) {
    const high = Math.max(...g.seats.map((s) => s.bet));
    const min = Math.min(seat.bet + seat.chips, high + g.minRaise);
    const max = seat.bet + seat.chips;
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
    mk(legal.includes('bet') ? 'BET' : 'RAISE', '', () => send(legal.includes('bet') ? 'bet' : 'raise', Number(slider.value)));
    mk('ALL IN', 'red', () => send('raise', max));
  }
}
