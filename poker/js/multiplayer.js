// The multiplayer table: same felt as the single-player room, a real server
// on the other end of the wire instead of a local `game` object.
//
// This file runs NO rules — it never calls createGame/startHand/act. It
// sends actions and renders whatever poker/server/table.mjs's `viewFor` last
// broadcast, using js/tableView.js's shared felt renderer (the same one
// js/tournament.js draws a tournament table with) so a bug in the rendering
// code cannot drift between the two. It is never handed a card that is not
// either this browser's own or already showing.
import { createTableView } from './tableView.js';

const $ = (s) => document.querySelector(s);
const room = $('#room');
const view = createTableView({
  room, board: $('#board'), pot: $('#pot'), controls: $('#controls'), log: $('#log'),
});

// --- the table id, which is the entire "lobby" for phase 1 -------------------
// A shared link with a table id in it still works exactly as it always did
// — see poker/README.md — but poker/lobby.html is now the easier way to
// arrive at a table without one.
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

const send = (action, amount = 0) => ws.send(JSON.stringify({ type: 'action', action, amount }));

function connect() {
  ws = new WebSocket(`${WS_BASE}/ws/${encodeURIComponent(tableId)}`);
  ws.addEventListener('open', () => { setStatus(''); tryJoin(); });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'state') view.render(msg, send);
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
