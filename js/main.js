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

  // --- everything that changes when the clock passes a date ------------------
  //
  // ALL OF THIS WAS COMPUTED ONCE, ON LOAD, next to a countdown that ticks
  // every second. The moment contractLiveAt passed, an open tab showed a
  // countdown at zero above a hero reading "launches 7 September · not trading
  // yet", a chain line reading "Launching on", an address labelled "do not try
  // to buy yet", and a sentence saying the auction "has not opened yet".
  //
  // The people it fails are exactly the people who care most: somebody who
  // opens the page before the launch and leaves it open waiting for the
  // countdown to run out. It runs out, and the page goes on telling them not
  // to buy until they think to reload. Same tick as the countdown; it costs
  // nothing to be right.
  var utcDay = function (iso) {
    // timeZone UTC: a midnight-Z instant renders as the previous day for every
    // visitor west of Greenwich without it.
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  };
  var contractLive = function () {
    return !K.contractLiveAt || Date.now() >= Date.parse(K.contractLiveAt);
  };

  var heroState = $('#heroState');
  var chainVerb = $('#heroChainVerb');
  var caValue = $('#ca-value');
  var caCopy = $('#ca-copy');
  var caNote = null;

  function renderLaunchState() {
    var live = contractLive();
    var when = K.contractLiveAt ? utcDay(K.contractLiveAt) : null;

    // The eyebrow used to read "the auction is open" as hardcoded text, with
    // nothing anywhere updating it — a false claim about a financial event, on
    // the one line under the masthead.
    if (heroState) {
      // The chain is already the middle segment, so "live on " + K.chain read
      // "Fry cook · Robinhood Chain · live on Robinhood Chain". Said once.
      var state = live
        ? (K.contract ? 'live now' : 'launching soon')
        : (when ? 'launches ' + when + ' \u00b7 not trading yet' : 'not trading yet');
      heroState.textContent = 'Fry cook \u00b7 ' + K.chain + ' \u00b7 ' + state;
    }

    // The hero's chain line carries the same truth. Hardcoding "Live on" in the
    // markup is how the site claimed the token was tradeable while config said
    // it was not — the one place a visitor is most likely to read.
    if (chainVerb) chainVerb.textContent = live && K.contract ? 'Live on' : 'Launching on';

    // Before it trades, say so next to the address. An address on a token site
    // reads as "buy this now" unless something states otherwise, and for the
    // next few days that would send people somewhere nothing is listed.
    //
    // Created once and then shown or hidden, rather than appended each pass —
    // on a one-second tick, appending would stack a new line every second.
    if (caValue && K.contract && K.contractLiveAt) {
      if (!caNote) {
        caNote = document.createElement('span');
        caNote.className = 'ca__pending';
        caNote.textContent = 'Not live until ' + utcDay(K.contractLiveAt) +
          '. Verify it here now; do not try to buy yet.';
        caValue.parentNode.appendChild(caNote);
      }
      caNote.hidden = live;
    }
  }

  if (caValue && K.contract) {
    caValue.textContent = K.contract;
    caCopy.disabled = false;
  }
  renderLaunchState();
  // Once a second, alongside the countdown. If there is no date to cross, the
  // state cannot change and there is nothing to tick.
  if (K.contractLiveAt && !contractLive()) setInterval(renderLaunchState, 1000);

  if (caValue && K.contract) {
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

  // --- the composition, wherever it is written down -------------------------
  // The weights appeared in FOUR places: the pools grid below (from config),
  // an ordered list in the chain section, a line under it, and a figcaption
  // two sections further down — the last three typed by hand. They had already
  // drifted: the line said EIGHTEEN percent under a list that said fifteen, and
  // it was spelled out in words, so nobody grepping for "18" was ever going to
  // find it. There is one source now.
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function inWords(n) {
    if (n === 100) return 'one hundred';
    if (n < 20) return WORDS[n] || String(n);
    var t = TENS[Math.floor(n / 10)];
    var u = n % 10;
    return u ? t + '-' + WORDS[u] : t;
  }

  var gme = (K.pools || []).filter(function (p) { return p.ticker === 'GME'; })[0];
  if (gme) {
    var heroWeight = $('#heroGmeWeight');
    if (heroWeight) heroWeight.textContent = gme.weight + '%';
    var gmeWords = $('#gme-words');
    if (gmeWords) gmeWords.textContent = inWords(gme.weight);
    var share = $('#gme-share');
    if (share) {
      share.textContent = inWords(gme.weight).replace(/^./, function (c) { return c.toUpperCase(); })
        + ' percent of the liquidity. One hundred percent of the point.';
    }
  }

  // The sticker section said "fifteen moods" over a grid that renders twenty
  // of them from the same config this reads. Another hand-typed count.
  var stickerCount = $('#stickerCount');
  if (stickerCount && K.animated) stickerCount.textContent = inWords(K.animated.length);

  var order = $('#chain-order');
  if (order && K.pools) {
    order.innerHTML = K.pools
      .map(function (p) {
        return '<li><b>' + p.ticker + '<em>' + p.weight + '%</em></b><span>'
          + p.nickname + '. ' + p.note + '</span></li>';
      })
      .join('');
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

    // THREE states, not two. `target` is the END once the auction has started,
    // so `now > target` means the auction has FINISHED — and this branch used to
    // render that as LIVE and tell people to go and bid, permanently, because
    // `now > start` stays true forever afterwards. A four-day window means that
    // would have started lying about five days after launch.
    var closed = end && !isNaN(end) && now > end;
    if (closed) {
      countdown.innerHTML = '<div class="count count--tba"><b>CLOSED</b><span>Auction</span></div>';
      if (note) note.textContent = 'The auction window has closed.';
      return;
    }
    if (!target || isNaN(target)) {
      // Started, with no end published. Live, but do not invent a deadline.
      var open = now >= start;
      countdown.innerHTML = '<div class="count count--tba"><b>' + (open ? 'LIVE' : 'TBA') + '</b><span>Auction</span></div>';
      if (note) note.textContent = open ? 'Auction window is open. Bid on kekfun.xyz.' : '';
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

  // The launch section asserted "The auction is open now" in hardcoded markup,
  // three sections below a countdown reading TBA and a contract address saying
  // not live. Whatever the config actually says, it says here too — and it says
  // it on the same tick as the countdown, so the sentence and the clock above
  // it cannot disagree the second the window opens or shuts.
  var auctionState = $('#auctionState');
  function renderAuctionState() {
    if (!auctionState) return;
    var aStart = auction.startsAt ? new Date(auction.startsAt) : null;
    var aEnd = auction.endsAt ? new Date(auction.endsAt) : null;
    var nowA = new Date();
    auctionState.textContent =
      !aStart || isNaN(aStart)        ? 'has not opened yet'
      : nowA < aStart                 ? 'has not opened yet'
      : aEnd && !isNaN(aEnd) && nowA > aEnd ? 'has closed'
      :                                 'is open now';
  }

  function tick() { renderCountdown(); renderAuctionState(); }

  tick();
  if (auction.startsAt) setInterval(tick, 1000);

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
