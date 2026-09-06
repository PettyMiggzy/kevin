/* ==========================================================================
   KEVIN — site behaviour. No framework, no build step, no dependencies.
   Everything reads from window.KEVIN in js/config.js.
   ========================================================================== */
(function () {
  'use strict';

  var K = window.KEVIN || {};
  var $ = function (sel) { return document.querySelector(sel); };

  // --- ticker -------------------------------------------------------------
  // The track is duplicated so the CSS -50% translate loops seamlessly.
  var ticker = $('#ticker');
  if (ticker && K.ticker) {
    var once = K.ticker.map(function (t) { return '<span>' + t + '</span>'; }).join('');
    ticker.innerHTML = once + once;
  }

  // --- external links -----------------------------------------------------
  // Any [data-link="x"] points at K.links.x, or is dropped if that's null.
  document.querySelectorAll('[data-link]').forEach(function (el) {
    var url = (K.links || {})[el.getAttribute('data-link')];
    if (url) el.setAttribute('href', url);
  });

  // --- hero state ----------------------------------------------------------
  // The eyebrow used to read "the auction is open" as hardcoded text, with
  // nothing anywhere updating it. It said that while the contract was null and
  // the launch was still days away — a false claim about a financial event, on
  // the one line under the masthead. It is driven off config now, so it cannot
  // drift from reality again.
  var heroState = $('#heroState');
  if (heroState) {
    var live = !K.contractLiveAt || Date.now() >= Date.parse(K.contractLiveAt);
    var when = K.contractLiveAt
      // timeZone UTC: a midnight-Z instant renders as the previous day for
      // every visitor west of Greenwich without it.
      ? new Date(K.contractLiveAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
      : null;
    var state = live
      ? (K.contract ? 'live on ' + K.chain : 'launching soon')
      : (when ? 'launches ' + when + ' \u00b7 not trading yet' : 'not trading yet');
    heroState.textContent = 'Fry cook \u00b7 ' + K.chain + ' \u00b7 ' + state;
  }

  // The hero's chain line carries the same truth. Hardcoding "Live on" in the
  // markup is how the site claimed the token was tradeable while config said it
  // was not — the one place a visitor is most likely to read.
  var chainVerb = $('#heroChainVerb');
  if (chainVerb) {
    var chainLive = !K.contractLiveAt || Date.now() >= Date.parse(K.contractLiveAt);
    chainVerb.textContent = chainLive && K.contract ? 'Live on' : 'Launching on';
  }

  // --- contract address ---------------------------------------------------
  var caValue = $('#ca-value');
  var caCopy = $('#ca-copy');
  var caLive = !K.contractLiveAt || Date.now() >= Date.parse(K.contractLiveAt);
  if (caValue && K.contract) {
    caValue.textContent = K.contract;
    caCopy.disabled = false;
    // Before it trades, say so next to it. An address on a token site reads as
    // "buy this now" unless something states otherwise, and for the next few
    // days that would send people somewhere nothing is listed.
    if (!caLive) {
      var note = document.createElement('span');
      note.className = 'ca__pending';
      note.textContent = 'Not live until ' + new Date(K.contractLiveAt)
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) +
        '. Verify it here now; do not try to buy yet.';
      caValue.parentNode.appendChild(note);
    }
    caCopy.addEventListener('click', function () {
      var done = function () {
        caCopy.textContent = 'Copied';
        setTimeout(function () { caCopy.textContent = 'Copy'; }, 1600);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(K.contract).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = K.contract;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        // execCommand returns false rather than throwing, so calling done()
        // unconditionally told people "Copied" when nothing had been. For a
        // contract address that is worse than no button: they paste whatever
        // was already on the clipboard and send funds to it.
        try {
          if (document.execCommand('copy')) done();
          else caCopy.textContent = 'Press Ctrl+C';
        } catch (e) {
          caCopy.textContent = 'Press Ctrl+C';
        }
        document.body.removeChild(ta);
      }
    });
  }

  // --- pools --------------------------------------------------------------
  var poolsGrid = $('#pools-grid');
  if (poolsGrid && K.pools) {
    poolsGrid.innerHTML = K.pools
      .map(function (p) {
        return [
          '<div class="card pool pool--' + p.key + '">',
          '<div class="pool__bar"></div>',
          '<img class="pool__coin" src="assets/art/coin-' + p.key + '.svg" alt="' + p.ticker + '" width="110" height="110">',
          '<h3>' + p.ticker + '</h3>',
          '<div class="pool__nick">' + p.nickname + '</div>',
          p.weight ? '<div class="pool__weight">' + p.weight + '%</div>' : '',
          p.weight ? '<div class="pool__meter"><i style="width:' + p.weight + '%"></i></div>' : '',
          '<div class="pool__body"><p>' + p.blurb + '</p><p style="opacity:.7;font-size:13px;margin:0">' + p.note + '</p></div>',
          '</div>',
        ].join('');
      })
      .join('');
  }

  // --- countdown ----------------------------------------------------------
  var countdown = $('#countdown');
  var note = $('#countdown-note');
  var auction = K.auction || {};

  function box(value, label) {
    return '<div class="count"><b>' + value + '</b><span>' + label + '</span></div>';
  }

  function renderCountdown() {
    if (!countdown) return;
    var start = auction.startsAt ? new Date(auction.startsAt) : null;
    var end = auction.endsAt ? new Date(auction.endsAt) : null;
    var now = new Date();

    if (!start || isNaN(start)) {
      countdown.innerHTML = '<div class="count count--tba"><b>TBA</b><span>Auction date</span></div>';
      if (note) note.textContent = 'Date not announced yet. It gets posted in the group first — nowhere else.';
      return;
    }

    var target = now < start ? start : end;
    var label = now < start ? 'until the auction opens' : 'until the auction closes';

    if (!target || isNaN(target) || now > target) {
      countdown.innerHTML = '<div class="count count--tba"><b>' + (now > start ? 'LIVE' : 'TBA') + '</b><span>Auction</span></div>';
      if (note) note.textContent = now > start ? 'Auction window is open. Bid on kekfun.xyz.' : '';
      return;
    }

    var ms = target - now;
    var d = Math.floor(ms / 86400000);
    var h = Math.floor(ms / 3600000) % 24;
    var m = Math.floor(ms / 60000) % 60;
    var s = Math.floor(ms / 1000) % 60;

    countdown.innerHTML = box(d, 'days') + box(pad(h), 'hours') + box(pad(m), 'mins') + box(pad(s), 'secs');
    if (note) note.textContent = label.charAt(0).toUpperCase() + label.slice(1) + ' · ' + (auction.durationDays || 4) + '-day window.';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  renderCountdown();
  if (auction.startsAt) setInterval(renderCountdown, 1000);

  // --- stickers -----------------------------------------------------------
  // One grid. The webm autoplays inline as its own preview; png / webm / gif
  // are the three things anybody actually wants to download.
  var anim = $('#animated-grid');
  if (anim && K.animated) {
    anim.innerHTML = K.animated
      .map(function (a) {
        var base = 'assets/stickers/animated/' + a.slug;
        return (
          '<div class="sticker sticker--anim">' +
          '<video src="' + base + '.webm" autoplay loop muted playsinline ' +
          'aria-label="' + a.name + ' Kevin, animated"></video>' +
          '<b>' + a.name + '</b>' +
          '<span class="sticker__dl">' +
          '<a href="assets/stickers/png/' + a.slug + '.png" download>png</a>' +
          '<a href="' + base + '.webm" download>webm</a>' +
          '<a href="' + base + '.gif" download>gif</a>' +
          '</span></div>'
        );
      })
      .join('');
  }

  // --- footer links -------------------------------------------------------
  var footer = $('#footer-links');
  if (footer) {
    var links = K.links || {};
    var out = [];
    if (links.launchpad) out.push(['Kekfun', links.launchpad]);
    if (links.telegram) out.push(['Telegram', links.telegram]);
    if (links.x) out.push(['X', links.x]);
    if (links.chart) out.push(['Chart', links.chart]);
    out.push(['Lore', 'docs/LORE.md']);
    out.push(['GitHub', 'https://github.com/PettyMiggzy/kevin']);
    footer.innerHTML = out
      .map(function (l) {
        return '<a class="btn btn--sm btn--ghost" href="' + l[1] + '" target="_blank" rel="noopener">' + l[0] + '</a>';
      })
      .join('');
  }

  // --- the grudge clock ---------------------------------------------------
  // Counts up from The Click. It has never been reset and never will be.
  var clock = document.getElementById('grudge-clock');
  if (clock) {
    var click = new Date(K.theClick || '2009-05-14T15:41:00');
    var tick = function () {
      var ms = Date.now() - click.getTime();
      if (ms < 0) return;
      var s = Math.floor(ms / 1000);
      var years = Math.floor(s / 31557600);
      var days = Math.floor((s % 31557600) / 86400);
      var h = Math.floor((s % 86400) / 3600);
      var m = Math.floor((s % 3600) / 60);
      var sec = s % 60;
      clock.innerHTML =
        years + ' <i>years</i> ' + days + ' <i>days</i> ' +
        pad(h) + '<i>:</i>' + pad(m) + '<i>:</i>' + pad(sec);
    };
    tick();
    setInterval(tick, 1000);
  }

  // --- the burn -----------------------------------------------------------
  // Everything here stays "TBA" until real values land in config.js. Nothing
  // on this page should ever claim a burn that hasn't happened.
  var burn = K.burn || {};
  var burnTotal = document.getElementById('burn-total');
  if (burnTotal) burnTotal.textContent = burn.burned ? burn.burned + ' KEVIN' : 'Nothing yet';

  var burnWallet = document.getElementById('burn-wallet');
  if (burnWallet && burn.wallet) burnWallet.textContent = burn.wallet;

  var burnAddr = document.getElementById('burn-addr');
  if (burnAddr && burn.burnAddr) burnAddr.textContent = burn.burnAddr;

  var burnLog = document.getElementById('burn-log');
  if (burnLog && burn.receipts && burn.receipts.length) {
    burnLog.innerHTML = burn.receipts
      .map(function (r) {
        var label = '<span>' + r.date + '</span><span>' + r.amount + '</span>';
        return r.tx ? '<a href="' + r.tx + '" target="_blank" rel="noopener">' + label + '</a>' : '<a>' + label + '</a>';
      })
      .join('');
  }

  // --- gta 6 --------------------------------------------------------------
  // The other grudge. This one has a release date, which is the funny part.
  var gtaClock = document.getElementById('gta-clock');
  var gtaNote = document.getElementById('gta-note');
  if (gtaClock) {
    var target = K.gta6 ? new Date(K.gta6) : null;
    var gtaTick = function () {
      if (!target || isNaN(target)) {
        gtaClock.innerHTML = 'DELAYED';
        if (gtaNote) gtaNote.textContent = 'No date. He is not going to say anything.';
        return;
      }
      var ms = target - Date.now();
      if (ms <= 0) {
        gtaClock.innerHTML = "IT'S OUT";
        if (gtaNote) gtaNote.textContent = 'He is unavailable. Do not contact him.';
        return;
      }
      var s = Math.floor(ms / 1000);
      gtaClock.innerHTML =
        Math.floor(s / 86400) + ' <i>days</i> ' +
        pad(Math.floor((s % 86400) / 3600)) + '<i>:</i>' +
        pad(Math.floor((s % 3600) / 60)) + '<i>:</i>' + pad(s % 60);
      if (gtaNote) gtaNote.textContent = 'Assuming it does not move again. It has moved before. He knows exactly how many times.';
    };
    gtaTick();
    setInterval(gtaTick, 1000);
  }

  // --- noted --------------------------------------------------------------
  // He remembers you. Entirely in your own browser — there is no server here,
  // nothing is sent anywhere, and clearing site data wipes it. The joke only
  // works because it is true.
  var STORE = 'kevin.grudge.v1';

  function loadMemory() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch (e) {
      return null;
    }
  }

  function saveMemory(mem) {
    try { localStorage.setItem(STORE, JSON.stringify(mem)); } catch (e) { /* private mode. fine. */ }
  }

  function daysAgo(iso) {
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d <= 0) return 'earlier today';
    if (d === 1) return 'yesterday';
    return d + ' days ago';
  }

  var noted = document.getElementById('noted');
  var notedBody = document.getElementById('noted-body');
  var memory = loadMemory();
  var isReturning = !!(memory && memory.visits);

  var current = memory || { first: new Date().toISOString(), visits: 0, clickedAuction: false };
  current.visits += 1;
  current.last = new Date().toISOString();
  saveMemory(current);

  if (noted && notedBody && isReturning) {
    var lines = ['Visit number ' + current.visits + '. First one was ' + daysAgo(current.first) + '.'];
    lines.push(current.clickedAuction
      ? 'You did click through to the auction last time, which has been recorded in your favour.'
      : "You still haven't clicked the auction button. No pressure. Just noting it.");
    notedBody.textContent = ' ' + lines.join(' ');
    noted.hidden = false;
  }

  document.querySelectorAll('[data-link="launchpad"]').forEach(function (el) {
    el.addEventListener('click', function () {
      current.clickedAuction = true;
      saveMemory(current);
    });
  });

  var how = document.getElementById('noted-how');
  if (how) {
    how.addEventListener('click', function () {
      notedBody.textContent =
        " localStorage, in your own browser. There is no server, no analytics and no cookie — " +
        "nothing about you leaves this page. He just writes it down, like everything else.";
      how.remove();
    });
  }

  // "Forget me" says No the first time. Obviously. Then it actually forgets,
  // because a joke is a joke and your data is your data.
  var forget = document.getElementById('noted-forget');
  if (forget) {
    var asked = false;
    forget.addEventListener('click', function () {
      if (!asked) {
        asked = true;
        forget.textContent = 'No.';
        notedBody.textContent = ' He was asked to forget something once before. Ask again if you mean it.';
        return;
      }
      try { localStorage.removeItem(STORE); } catch (e) { /* nothing to remove */ }
      notedBody.textContent = ' Forgotten. Under protest.';
      forget.remove();
      if (how) how.remove();
    });
  }

  // --- petty tab title ----------------------------------------------------
  var realTitle = document.title;
  var awayTimer = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      document.title = 'you left.';
      awayTimer = setTimeout(function () { document.title = 'noted.'; }, 8000);
    } else {
      clearTimeout(awayTimer);
      document.title = realTitle;
    }
  });

  // --- easter egg ---------------------------------------------------------
  // Type "petty" anywhere and he stops pretending he isn't looking at you.
  var buffer = '';
  document.addEventListener('keydown', function (e) {
    if (e.key.length !== 1) return;
    buffer = (buffer + e.key.toLowerCase()).slice(-5);
    if (buffer !== 'petty') return;
    var art = document.querySelector('.hero__art img');
    if (!art) return;
    art.src = 'assets/art/kevin-laser-void.svg';
    art.alt = 'Kevin, done pretending he is not looking at you';
    var stamp = document.querySelector('.hero__stamp');
    if (stamp) stamp.innerHTML = 'HE IS LOOKING<br>RIGHT AT YOU';
    document.querySelector('.tape').textContent = 'HE REMEMBERS WHAT YOU SAID IN MARCH';
  });
})();
