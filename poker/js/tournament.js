// The tournament table: registration, then the same felt js/multiplayer.js
// draws for a practice table (js/tableView.js — identical rendering code,
// shared rather than duplicated), plus a status bar for the parts a single
// table doesn't have: blind level, players remaining, and — once it is
// over — final standings.
//
// One WebSocket for the whole tournament, opened once at registration and
// never re-pointed at a different URL: poker/server/tournament.mjs moves a
// player between its own internal tables by reseating this SAME socket
// (see its header comment), so the `type:'state'` messages arriving here
// can be for a different table.mjs table than the last one, tagged by
// their own `tableId` — this file just draws whatever the most recent one
// says, the same way it would for a practice table that never moves at
// all. `type:'tournament'` messages (registration, standings, blind level)
// arrive interleaved on the same socket, never containing another
// player's hole cards — table state and tournament state are always two
// distinct message types.
import { createTableView } from './tableView.js';

const $ = (s) => document.querySelector(s);
const view = createTableView({
  room: $('#room'), board: $('#board'), pot: $('#pot'), controls: $('#controls'), log: $('#log'),
});

const params = new URLSearchParams(location.search);
const tourneyId = params.get('id');
if (!tourneyId) {
  document.body.innerHTML = '<p class="hint">No tournament id in the link. <a href="lobby.html">Back to the lobby</a></p>';
  throw new Error('no tournament id');
}

$('#tourneyLink').href = location.href;
$('#tourneyLink').textContent = 'Share this link so others can register too.';

const WS_BASE = window.KEVIN_POKER_WS
  || (['localhost', '127.0.0.1', ''].includes(location.hostname)
    ? `ws://${location.hostname || 'localhost'}:8788`
    : 'wss://poker.iamkevin.lol');

function setStatus(text, isError = false) {
  const el = $('#lobbyStatus');
  el.textContent = text;
  el.classList.toggle('err', isError);
}

let ws = null;
let myName = null;
let registered = false;
let latest = null; // most recent {type:'tournament', ...}

function connect() {
  ws = new WebSocket(`${WS_BASE}/tournament/${encodeURIComponent(tourneyId)}`);
  ws.addEventListener('close', (ev) => {
    if (ev.code === 4004) {
      setStatus("This tournament doesn't exist — it may have been created on a different server, or the link is stale.", true);
      return;
    }
    // Unlike a practice table (js/multiplayer.js), this does not
    // auto-reconnect: phase 1.5 still has no session token to prove a new
    // socket is the same player coming back, and re-registering on a fresh
    // socket once the tournament has already started would just be
    // refused (see tournament.mjs's handleRegister) — so a dropped
    // connection here is simply the end of this player's run, same as
    // walking away from a real table mid-tournament.
    setStatus(registered ? 'Connection lost — this tab has left the tournament.' : 'Connection lost.', true);
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'tournament') onTournament(msg);
    else if (msg.type === 'state') view.render(msg, send);
    else if (msg.type === 'error') setStatus(msg.message, true);
  });
}
connect();

const send = (action, amount = 0) => ws.send(JSON.stringify({ type: 'action', action, amount }));

$('#registerBtn').onclick = () => {
  const name = $('#nameInput').value.trim().slice(0, 20) || 'Player';
  myName = name;
  sessionStorage.setItem('kevin-poker-name', name);
  ws.send(JSON.stringify({ type: 'register', name }));
};
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#registerBtn').click(); });
const remembered = sessionStorage.getItem('kevin-poker-name');
if (remembered) $('#nameInput').value = remembered;

$('#startBtn').onclick = () => ws.send(JSON.stringify({ type: 'start' }));

function fmtCountdown(endsAt) {
  if (!endsAt) return 'final level';
  const ms = endsAt - Date.now();
  if (ms <= 0) return 'next level any moment';
  const s = Math.ceil(ms / 1000);
  return `next level in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function onTournament(msg) {
  latest = msg;
  registered = !!msg.you;
  $('#tourneyName').textContent = msg.name;
  document.title = `${msg.name} — Kevin's Card Room`;

  if (msg.status === 'registering') {
    const reg = $('#registered');
    reg.innerHTML = '';
    for (const p of msg.registered ?? []) {
      const span = document.createElement('span');
      span.textContent = p.name + (p.connected ? '' : ' (left)');
      reg.append(span);
    }
    setStatus(registered
      ? `Registered as ${msg.you.name}. ${msg.totalPlayers}/${msg.minPlayers}+ needed.`
      : '');
    $('#startBtn').hidden = !(registered && msg.totalPlayers >= msg.minPlayers);
    $('#nameInput').disabled = registered;
    $('#registerBtn').disabled = registered;
    return;
  }

  // Running or done: the registration screen is done its job.
  $('#lobby').hidden = true;
  $('#tourneyBar').hidden = false;
  $('#room').hidden = false;
  renderBar(msg);

  if (msg.status === 'done') {
    $('#controls').hidden = true;
    $('#standings').hidden = false;
    const list = $('#standingsList');
    list.innerHTML = '';
    for (const s of msg.standings ?? []) {
      const li = document.createElement('li');
      const mine = msg.you && s.id === msg.you.id;
      li.innerHTML = `<span>#${s.position} ${s.name}${mine ? ' (you)' : ''}</span><span>${s.chips.toLocaleString()}</span>`;
      list.append(li);
    }
  } else {
    $('#controls').hidden = false;
    $('#log').hidden = false;
  }
}

function renderBar(msg) {
  const bar = $('#tourneyBar');
  const you = msg.you;
  const yourStatus = !you ? ''
    : you.eliminated ? `<span class="stat eliminated">You finished <b>#${you.position}</b></span>`
      : `<span class="stat">You: <b>${you.chips.toLocaleString()}</b> chips</span>`;
  bar.innerHTML = `
    <span class="stat">Level <b>${msg.level + 1}</b> — blinds <b>${msg.smallBlind}/${msg.bigBlind}</b></span>
    <span class="stat">${fmtCountdown(msg.levelEndsAt)}</span>
    <span class="stat"><b>${msg.playersRemaining}</b>/${msg.totalPlayers} players left</span>
    <span class="stat"><b>${msg.tables.length}</b> table${msg.tables.length === 1 ? '' : 's'} running</span>
    ${yourStatus}
  `;
}

// The countdown text is derived from a timestamp, not re-sent every second
// — tick it locally between broadcasts so it counts down smoothly instead
// of jumping once per tournament.mjs tick.
setInterval(() => { if (latest && latest.status === 'running') renderBar(latest); }, 1000);
