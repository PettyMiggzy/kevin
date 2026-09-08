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

  // If js/config.js did not load, K is {} and every line below asserts
  // something it cannot know — "Fry cook · undefined · launching soon", and an
  // auction state that overwrites the served "has closed" with "has not opened
  // yet". The served HTML is already correct and already honest. Leave it.
  if (!window.KEVIN) return;

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
      heroState.textContent = 'Fry cook' + (K.chain ? ' \u00b7 ' + K.chain : '') + ' \u00b7 ' + state;
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
    // §VI's lead carried a FIFTH hand-typed copy of this number, while the
    // errata claimed both copies now come from one place so they cannot
    // disagree again. Now they do.
    var gmeLead = $('#gme-words-lead');
    if (gmeLead) gmeLead.textContent = inWords(gme.weight);
    var share = $('#gme-share');
    if (share) {
      share.textContent = inWords(gme.weight).replace(/^./, function (c) { return c.toUpperCase(); })
        + ' percent of the liquidity. One hundred percent of the point.';
    }
  }

  // The launch mechanics, from config, exactly as the docs page does it. The
  // markup carries the same numbers as its no-JavaScript fallback; this stops
  // the two copies drifting when config changes.
  var m = K.mechanics || {};
  var put = function (id, v) {
    var el = $('#' + id);
    if (el && v !== null && v !== undefined) el.textContent = v;
  };
  put('m-supply', m.supply);
  if (m.sold !== undefined) put('m-sold', m.sold + '%');
  if (m.lockedLp !== undefined) put('m-lp', m.lockedLp + '%');
  if (m.creator !== undefined) put('m-creator', m.creator + '%');
  put('m-saledays', m.saleDays);
  if (m.saleDays !== undefined) put('m-saledays2', inWords(m.saleDays));
  put('m-perday', m.perDay);
  put('m-vest', m.vestDays);
  put('m-vest2', m.vestDays);

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

    // A MISSING START DATE IS NOT EVIDENCE THE AUCTION HAS NOT HAPPENED.
    //
    // This used to fall through to "has not opened yet" whenever startsAt was
    // null — which it still is, because nobody filled the dates in after the
    // fact. So the live front page told every visitor the auction had not
    // opened while the token had been trading for a day. The token being live
    // is proof the auction settled; trust that over an unfilled field.
    if (contractLive() && K.contract) {
      auctionState.textContent = 'has closed';
      return;
    }
    auctionState.textContent =
      !aStart || isNaN(aStart)        ? 'has not opened yet'
      : nowA < aStart                 ? 'has not opened yet'
      : aEnd && !isNaN(aEnd) && nowA > aEnd ? 'has closed'
      :                                 'is open now';
  }

  function tick() { renderCountdown(); renderAuctionState(); }

  // With no auction dates and a live token there is nothing to count down to,
  // and an empty countdown box under a closed auction reads as broken.
  if (contractLive() && K.contract && !auction.startsAt) {
    if (countdown) countdown.hidden = true;
    if (note) note.hidden = true;
  }

  tick();
  if (auction.startsAt) setInterval(tick, 1000);

  // --- footer links -------------------------------------------------------
  var footer = $('#footer-links');
  if (footer) {
    var links = K.links || {};
    var out = [];
    if (links.launchpad) out.push(['Kekfun', links.launchpad]);
    if (links.telegram) out.push(['Telegram', links.telegram]);
    if (links.x) out.push(['X', links.x]);
    if (links.chart) out.push(['Chart', links.chart]);
    out.push(['Docs', K.links && K.links.docs ? K.links.docs : 'docs/']);
    out.push(['GitHub', 'https://github.com/PettyMiggzy/kevin']);
    footer.innerHTML = out
      .map(function (l) {
        return '<a class="btn btn--sm btn--ghost" href="' + l[1] + '" target="_blank" rel="noopener">' + l[0] + '</a>';
      })
      .join('');
  }

  // --- LP fees ------------------------------------------------------------
  // Reads data/fees.json, which keeper/feewatch.mjs writes from chain logs.
  // Nothing here computes a total: the file carries totals derived from the
  // same rows the table prints, so the headline and the list cannot disagree.
  // (They have disagreed before on this site, when a total was typed by hand.)
  var feesPanel = document.getElementById('fees-panel');
  if (feesPanel) {
    var esc = function (v) {
      return String(v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };
    var short = function (h) { return h.slice(0, 10) + '…' + h.slice(-8); };
    var day = function (iso) {
      var d = new Date(iso);
      return isNaN(d) ? '—' : d.toISOString().slice(0, 10);
    };
    var num = function (a) {
      var n = Number(a);
      if (!isFinite(n)) return a;
      return n.toLocaleString('en-GB', { maximumFractionDigits: n < 1 ? 6 : 4 });
    };

    fetch('data/fees.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var claims = d.claims || [];
        var totals = d.totals || {};
        var syms = Object.keys(totals);
        var base = d.explorer || 'https://robinhoodchain.blockscout.com/tx/';

        if (!claims.length) {
          feesPanel.innerHTML =
            '<p class="fees__empty">No fees have been claimed yet.<br>' +
            'When they are, every one will be listed here with its transaction.</p>' +
            '<p class="fees__when">Watching from block ' + esc(d.watchedFrom) +
            '. Last checked block ' + esc(d.lastBlock) + '.</p>';
          return;
        }

        var head = syms.map(function (k) {
          return '<div class="fees__total"><span>' + esc(k) + '</span><b>' +
            esc(num(totals[k].amount)) + '</b></div>';
        }).join('');

        var rows = claims.map(function (c) {
          return '<tr>' +
            '<td>' + esc(day(c.at)) + '</td>' +
            '<td class="fees__amt">' + esc(num(c.amount)) + ' ' + esc(c.symbol) + '</td>' +
            '<td>' + esc(c.source) + '</td>' +
            '<td><a href="' + esc(base + c.tx) + '" target="_blank" rel="noopener">' +
              esc(short(c.tx)) + ' ↗</a></td>' +
          '</tr>';
        }).join('');

        feesPanel.innerHTML =
          '<div class="fees__totals">' + head + '</div>' +
          '<div class="table-scroll"><table>' +
            '<thead><tr><th>Date</th><th>Amount</th><th>From</th><th>Transaction</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
          '<p class="fees__when">' + claims.length + ' claim' + (claims.length === 1 ? '' : 's') +
          ', watched from block ' + esc(d.watchedFrom) + ' to ' + esc(d.lastBlock) + '.</p>';
      })
      .catch(function () {
        // A missing or unreadable file must never render as "zero fees" — that
        // would be a claim, and it would be one nobody checked.
        feesPanel.innerHTML =
          '<p class="fees__empty">The fee receipts could not be loaded right now.<br>' +
          'That is this page failing, not a statement about what has been collected.</p>';
      });
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
  // The burn counter reads data/burns.json, which keeper/burnwatch.mjs writes
  // from chain logs — every transfer of $KEVIN into an address nobody holds
  // the key to. It is NOT a number typed into the config, because a burn
  // counter somebody can type is the same sentence as "trust me".
  var burnTotal = document.getElementById('burn-total');
  var burnAddr = document.getElementById('burn-addr');
  var burnLog = document.getElementById('burn-log');
  var burnPct = document.getElementById('burn-pct');
  if (burnAddr && burn.burnAddr) burnAddr.textContent = burn.burnAddr;

  if (burnTotal) {
    var nf = function (v) {
      var x = Number(v);
      return isFinite(x) ? x.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : v;
    };
    fetch('data/burns.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var rows = d.burns || [];
        var t = d.total || {};
        burnTotal.textContent = rows.length ? nf(t.tokens) + ' KEVIN' : 'Nothing yet';
        if (burnPct) {
          burnPct.textContent = rows.length
            ? t.percentOfSupply.toFixed(3) + '% of supply, gone'
            : 'Checked against the chain, not typed here';
        }
        if (burnAddr && d.burnAddresses && d.burnAddresses.length) burnAddr.textContent = d.burnAddresses[0];
        if (!burnLog) return;
        if (!rows.length) {
          burnLog.innerHTML = '<a><span>No burns yet</span><span>—</span></a>';
          return;
        }
        var base = d.explorer || 'https://robinhoodchain.blockscout.com/tx/';
        burnLog.innerHTML = rows.map(function (b) {
          var label = '<span>' + String(b.at || '').slice(0, 10) + '</span><span>' + nf(b.amount) + ' KEVIN</span>';
          return '<a href="' + base + b.tx + '" target="_blank" rel="noopener">' + label + '</a>';
        }).join('');
      })
      .catch(function () {
        // Never render a failure as zero. Zero is a claim, and it would be one
        // nobody checked.
        burnTotal.textContent = '—';
        if (burnPct) burnPct.textContent = 'Could not reach the receipts just now.';
      });
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
