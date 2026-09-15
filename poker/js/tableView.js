// The felt, extracted from js/multiplayer.js so js/tournament.js can draw the
// exact same table (same markup, same poker/css/table.css classes) without a
// second copy of ~150 lines of rendering code to drift out of sync with it.
//
// Same rule as multiplayer.js itself: this file runs NO rules. It only
// draws whatever `{type:'state', ...}` object table.mjs's `viewFor` last
// broadcast (see poker/server/table.mjs) and, on a button press, calls the
// `send(action, amount)` callback its caller supplied — it never touches a
// WebSocket directly and never imports createGame/startHand/act. `options`
// is used purely to grey out buttons the server would refuse anyway; the
// server re-checks every action for itself, so a bug here can make the UI
// wrong but can never let an illegal action through and is never handed a
// card that is not either this browser's own or already showing.
import { options } from './holdem.js';

const SPOTS = [
  [50, 84], [15, 64], [15, 26], [50, 15], [85, 26], [85, 64],
];
const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function cardEl(code, { small = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '');
  if (!code) { el.classList.add('back'); el.textContent = '★'; return el; }
  const r = code[0] === 'T' ? '10' : code[0];
  const s = code[1];
  if (s === 'h' || s === 'd') el.classList.add('red');
  el.innerHTML = `<div>${r}</div><div class="suit">${SUIT_GLYPH[s]}</div>`;
  return el;
}

/**
 * @param {{room:HTMLElement, board:HTMLElement, pot:HTMLElement, controls:HTMLElement, log:HTMLElement}} dom
 * @returns {{render:(state:object, send:(action:string, amount?:number)=>void)=>void}}
 */
export function createTableView({ room, board, pot, controls, log }) {
  let seatEls = [];
  let logged = 0;

  function buildSeats(n) {
    if (seatEls.length === n) return;
    for (const el of seatEls) el.remove();
    seatEls = Array.from({ length: n }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'seat';
      el.style.left = SPOTS[i][0] + '%';
      el.style.top = SPOTS[i][1] + '%';
      el.innerHTML = `<div class="bet" hidden></div><div class="pic"><span class="initial"></span><span class="botTag" hidden>BOT</span></div>
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
  function syncLog(state) {
    if (!log) return;
    if (state.log.length < logged) { log.innerHTML = ''; logged = 0; }
    while (logged < state.log.length) {
      const el = document.createElement('div');
      el.textContent = state.log[logged++];
      log.append(el);
    }
    log.scrollTop = log.scrollHeight;
  }

  function drawControls(state, send) {
    if (!controls) return;
    controls.innerHTML = '';
    const g = state;
    const you = g.you;

    if (!g || g.seats.length === 0) { controls.textContent = 'Waiting for another player to join…'; return; }
    if (you === null) { controls.textContent = `Watching — you'll be dealt into the next hand (${g.waitingCount ?? 0} others waiting).`; return; }
    if (g.street === 'over') { controls.textContent = 'Waiting for one more player…'; return; }
    if (g.street === 'showdown') { controls.textContent = 'Hand over — next hand starting…'; return; }
    if (g.turn !== you) { controls.textContent = `Waiting on ${g.seats[g.turn]?.name ?? '…'}`; return; }

    const seat = g.seats[you];
    // A pure client-side echo of options()/toCall() from holdem.js against
    // the PUBLIC bets and stacks the server already sent everyone — no rule
    // is decided here, only which buttons to draw. See the file header.
    const fakeGame = { seats: g.seats.map((s) => ({ bet: s.bet, chips: s.chips })) };
    const legal = options(fakeGame, { bet: seat.bet, chips: seat.chips });
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = fn;
      controls.append(b);
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
      controls.append(wrap);
      mk(legal.includes('bet') ? 'BET' : 'RAISE', '', () => send(legal.includes('bet') ? 'bet' : 'raise', Number(slider.value)));
      mk('ALL IN', 'red', () => send('raise', max));
    }
  }

  function render(state, send) {
    if (!state) return;
    const g = state;
    buildSeats(g.seats.length);

    if (board) {
      board.innerHTML = '';
      for (const c of g.board) board.append(cardEl(c));
      for (let i = g.board.length; i < 5; i++) {
        const ghost = document.createElement('div');
        ghost.className = 'card';
        ghost.style.visibility = 'hidden';
        board.append(ghost);
      }
    }
    if (pot) {
      const total = g.pots.reduce((a, p) => a + p.amount, 0) + g.seats.reduce((a, s) => a + s.bet, 0);
      pot.textContent = `POT ${total.toLocaleString()} KEVIN`;
    }

    g.seats.forEach((s, i) => {
      const el = seatEls[i];
      el.classList.toggle('turn', g.turn === i && g.street !== 'showdown');
      el.classList.toggle('folded', s.folded || s.out);
      el.querySelector('.initial').textContent = (s.name || '?')[0]?.toUpperCase() ?? '?';
      el.querySelector('.botTag').hidden = !s.bot;
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

    syncLog(g);
    drawControls(g, send);
  }

  return { render };
}
