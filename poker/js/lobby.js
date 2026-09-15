// The lobby: what phase 1 was missing per poker/server/README.md's own "What
// this phase does NOT defend against" — a way to see what is open and join
// it, instead of already knowing (or making up) a table id. This file talks
// HTTP only (GET /lobby, POST /tables, POST /tournaments — see
// poker/server/index.mjs); it never opens a WebSocket itself. Joining a
// table or registering for a tournament happens on table.html /
// tournament.html, which this page only links to.
const $ = (s) => document.querySelector(s);

// Same host-detection convention as js/multiplayer.js's WS_BASE, but for
// plain HTTP — window.KEVIN_POKER_HTTP overrides it the same way
// window.KEVIN_POKER_WS overrides that one.
const HTTP_BASE = window.KEVIN_POKER_HTTP
  || (['localhost', '127.0.0.1', ''].includes(location.hostname)
    ? `http://${location.hostname || 'localhost'}:8788`
    : 'https://poker.iamkevin.lol');

function showErr(text) {
  const el = $('#lobbyErr');
  el.textContent = text;
  el.hidden = !text;
}

function fmtCountdown(endsAt) {
  if (!endsAt) return '';
  const ms = endsAt - Date.now();
  if (ms <= 0) return 'next level any moment';
  const s = Math.ceil(ms / 1000);
  return `next level in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tableRow(t) {
  const el = document.createElement('div');
  el.className = 'row';
  const full = t.seatedCount >= t.maxSeats;
  el.innerHTML = `
    <span class="pill practice">PRACTICE</span>
    <span class="rowName">${escapeHtml(t.name)}</span>
    <span class="rowMeta">${t.seatedCount}/${t.maxSeats} seated · blinds ${t.smallBlind}/${t.bigBlind} · ${t.phase === 'playing' ? 'hand in progress' : 'waiting'}</span>
    <button ${full ? 'disabled' : ''}>${full ? 'FULL' : 'JOIN'}</button>
  `;
  el.querySelector('button').onclick = () => { location.href = `table.html?t=${encodeURIComponent(t.id)}`; };
  return el;
}

function tourneyRow(t) {
  const el = document.createElement('div');
  el.className = 'row';
  let meta = '';
  let label = 'REGISTER';
  let disabled = false;
  if (t.status === 'registering') {
    meta = `${t.totalPlayers} registered · needs ${t.minPlayers}+`;
  } else if (t.status === 'running') {
    meta = `running · ${t.playersRemaining}/${t.totalPlayers} left · blinds ${t.smallBlind}/${t.bigBlind}${t.levelEndsAt ? ' · ' + fmtCountdown(t.levelEndsAt) : ''}`;
    label = 'WATCH';
  } else {
    meta = `finished · winner: ${t.standings?.[0]?.name ?? '?'}`;
    label = 'RESULTS';
  }
  el.innerHTML = `
    <span class="pill tournament">TOURNAMENT</span>
    <span class="rowName">${escapeHtml(t.name)}</span>
    <span class="rowMeta">${meta}</span>
    <button ${disabled ? 'disabled' : ''}>${label}</button>
  `;
  el.querySelector('button').onclick = () => { location.href = `tournament.html?id=${encodeURIComponent(t.id)}`; };
  return el;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refresh() {
  let data;
  try {
    data = await fetch(`${HTTP_BASE}/lobby`).then((r) => r.json());
  } catch {
    showErr('Could not reach the poker server — is it running?');
    return;
  }
  showErr('');

  const tableList = $('#tableList');
  tableList.innerHTML = '';
  if (!data.tables.length) tableList.append(Object.assign(document.createElement('p'), { className: 'rowEmpty', textContent: 'No open tables yet — start one.' }));
  else for (const t of data.tables) tableList.append(tableRow(t));

  const tourneyList = $('#tourneyList');
  tourneyList.innerHTML = '';
  if (!data.tournaments.length) tourneyList.append(Object.assign(document.createElement('p'), { className: 'rowEmpty', textContent: 'No tournaments yet — start one.' }));
  else for (const t of data.tournaments) tourneyList.append(tourneyRow(t));
}

function wireCreateForm(toggleId, formId, cancelSelector, inputId, onSubmit) {
  const toggle = $(toggleId), form = $(formId);
  toggle.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) $(inputId).focus(); };
  form.querySelector('[data-cancel]').onclick = () => { form.hidden = true; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = $(inputId).value.trim();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await onSubmit(name); } catch (err) { showErr(err.message); } finally { btn.disabled = false; }
  };
}

wireCreateForm('#newTableToggle', '#newTableForm', '[data-cancel]', '#newTableName', async (name) => {
  const r = await fetch(`${HTTP_BASE}/tables`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  }).then((res) => res.json());
  if (!r.id) throw new Error(r.error || 'could not create table');
  location.href = `table.html?t=${encodeURIComponent(r.id)}`;
});

wireCreateForm('#newTourneyToggle', '#newTourneyForm', '[data-cancel]', '#newTourneyName', async (name) => {
  const r = await fetch(`${HTTP_BASE}/tournaments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  }).then((res) => res.json());
  if (!r.id) throw new Error(r.error || 'could not create tournament');
  location.href = `tournament.html?id=${encodeURIComponent(r.id)}`;
});

refresh();
setInterval(refresh, 3000);
