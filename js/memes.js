/* ==========================================================================
   KEVIN — meme page. Gallery + a caption studio that runs entirely in the
   browser: nothing typed here is uploaded, because there is no server.
   ========================================================================== */
(function () {
  'use strict';

  var MEMES = window.KEVIN_MEMES || [];
  var K = window.KEVIN || {};
  var $ = function (s) { return document.querySelector(s); };

  var canvas = $('#canvas');
  var ctx = canvas.getContext('2d');
  var topInput = $('#top-text');
  var bottomInput = $('#bottom-text');
  var pick = $('#pick');
  var note = $('#studio-note');
  var current = null;      // the loaded Image
  var currentName = 'kevin-meme';

  // --- gallery ------------------------------------------------------------
  var grid = $('#meme-grid');
  if (MEMES.length) {
    grid.innerHTML = MEMES.map(function (m, i) {
      return (
        '<figure class="meme" data-i="' + i + '">' +
        '<img src="assets/memes/' + m.file + '" alt="' + m.title + '" ' +
        'width="' + m.w + '" height="' + m.h + '" loading="lazy">' +
        '<figcaption>' + m.title + '</figcaption>' +
        '</figure>'
      );
    }).join('');
    grid.addEventListener('click', function (e) {
      var fig = e.target.closest('.meme');
      if (fig) loadByIndex(Number(fig.dataset.i));
    });
    pick.innerHTML = MEMES.map(function (m, i) {
      return '<option value="' + i + '">' + m.title + '</option>';
    }).join('');
    pick.addEventListener('change', function () { loadByIndex(Number(pick.value)); });
    loadByIndex(0);
  } else {
    $('#meme-empty').style.display = '';
    pick.innerHTML = '<option>No art indexed yet</option>';
    pick.disabled = true;
  }

  function loadByIndex(i) {
    var m = MEMES[i];
    if (!m) return;
    pick.value = String(i);
    currentName = m.file.replace(/\.[^.]+$/, '');
    var img = new Image();
    img.onload = function () { current = img; draw(); };
    img.src = 'assets/memes/' + m.file;
    var empty = $('#studio-empty');
    if (empty) empty.style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --- your own image -----------------------------------------------------
  var own = $('#use-own');
  if (own) {
    own.addEventListener('change', function () {
      var file = own.files && own.files[0];
      if (!file) return;
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        current = img;
        currentName = file.name.replace(/\.[^.]+$/, '') || 'kevin-meme';
        var empty = $('#studio-empty');
        if (empty) empty.style.display = 'none';
        canvas.style.display = 'block';
        draw();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  // --- drawing ------------------------------------------------------------
  function wrap(text, maxWidth, fontSize) {
    ctx.font = '700 ' + fontSize + "px 'Luckiest Guy', 'Arial Black', Impact, sans-serif";
    var words = text.split(/\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawBand(text, position) {
    if (!text) return;
    var W = canvas.width;
    var H = canvas.height;
    var size = Math.round(W * 0.062);
    var lines = wrap(text.toUpperCase(), W * 0.9, size);

    // shrink until it fits in a third of the frame
    while (lines.length * size * 1.15 > H * 0.32 && size > 18) {
      size -= 4;
      lines = wrap(text.toUpperCase(), W * 0.9, size);
    }

    ctx.font = '700 ' + size + "px 'Luckiest Guy', 'Arial Black', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(6, size * 0.16);
    ctx.strokeStyle = '#0B0B0B';
    ctx.fillStyle = '#FFFFFF';

    var lh = size * 1.14;
    var y0 = position === 'top'
      ? H * 0.055 + size
      : H - H * 0.055 - (lines.length - 1) * lh;

    for (var i = 0; i < lines.length; i++) {
      var y = y0 + i * lh;
      ctx.strokeText(lines[i], W / 2, y);
      ctx.fillText(lines[i], W / 2, y);
    }
  }

  function draw() {
    if (!current) return;
    canvas.width = current.naturalWidth || 1600;
    canvas.height = current.naturalHeight || 900;
    ctx.drawImage(current, 0, 0, canvas.width, canvas.height);
    drawBand(topInput.value.trim(), 'top');
    drawBand(bottomInput.value.trim(), 'bottom');
  }

  [topInput, bottomInput].forEach(function (el) {
    el.addEventListener('input', draw);
  });

  $('#clear').addEventListener('click', function () {
    topInput.value = '';
    bottomInput.value = '';
    draw();
  });

  // --- output -------------------------------------------------------------
  function say(msg) {
    note.textContent = msg;
    setTimeout(function () { if (note.textContent === msg) note.textContent = ''; }, 2600);
  }

  /**
   * Opening this page as a file:// URL taints the canvas (every local file is
   * its own origin), which makes toBlob throw. Serving over http fixes it —
   * say so instead of failing silently.
   */
  function exportBlob(cb) {
    try {
      canvas.toBlob(cb, 'image/png');
    } catch (e) {
      say('Open this page over http, not as a local file.');
    }
  }

  $('#download').addEventListener('click', function () {
    if (!current) return say('Load a picture first.');
    exportBlob(function (blob) {
      if (!blob) return say('Open this page over http, not as a local file.');
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = currentName + '-kevin.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      say('Saved. Go be petty.');
    });
  });

  $('#copy').addEventListener('click', function () {
    if (!current) return say('Load a picture first.');
    if (!navigator.clipboard || !window.ClipboardItem) return say('This browser will not copy images. Use download.');
    exportBlob(function (blob) {
      if (!blob) return say('Open this page over http, not as a local file.');
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { say('Copied. Paste it somewhere it will hurt.'); })
        .catch(function () { say('Copy blocked. Use download instead.'); });
    });
  });

  // fonts land after first paint; redraw once they do so text is not fallback
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { draw(); });
  }

  // --- footer -------------------------------------------------------------
  var footer = $('#footer-links');
  if (footer) {
    var links = K.links || {};
    var out = [];
    if (links.launchpad) out.push(['Kekfun', links.launchpad]);
    if (links.telegram) out.push(['Telegram', links.telegram]);
    if (links.x) out.push(['X', links.x]);
    out.push(['Home', 'index.html']);
    out.push(['GitHub', 'https://github.com/PettyMiggzy/kevin']);
    footer.innerHTML = out.map(function (l) {
      return '<a class="btn btn--sm btn--ghost" href="' + l[1] + '" target="_blank" rel="noopener">' + l[0] + '</a>';
    }).join('');
  }

  document.querySelectorAll('[data-link]').forEach(function (el) {
    var url = (K.links || {})[el.getAttribute('data-link')];
    if (url) el.setAttribute('href', url);
  });
})();
