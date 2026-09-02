#!/usr/bin/env node
// Renders the Kevin launch spot frame by frame in headless Chromium, then
// muxes with the ffmpeg that ships alongside the browser.
//
//   node tools/gen-video.mjs            # full spot + looping gif
//   node tools/gen-video.mjs --preview  # contact sheet of key frames only
//
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import { existsSync } from 'node:fs';
// The ffmpeg bundled with the browser is VP8/WebM only — no H.264, no gif
// muxer. Prefer a system build when one is available.
const FFMPEG =
  process.env.FFMPEG_PATH ||
  ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ||
  '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TMP = join(ROOT, '.frames');
const OUT = join(ROOT, 'assets/video');

const SIZE = 1080;
const FPS = 24;
const SPOT_SECONDS = 14;
const LOOP_SECONDS = 4;

async function embedFont(file) {
  const buf = await readFile(join(ROOT, 'assets/fonts', file));
  return `url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2')`;
}

async function buildPage(kevinSvg, wordmarkSvg) {
  // Fonts go in as data URIs: setContent has no base URL, so any path — file://
  // or relative — silently falls back to Arial and the spot looks generic.
  const display = await embedFont('luckiest-guy-400.woff2');
  const mono = await embedFont('space-mono-700.woff2');
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family:'Luckiest Guy'; src:${display}; }
  @font-face { font-family:'Space Mono'; src:${mono}; font-weight:700; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${SIZE}px; height:${SIZE}px; overflow:hidden; background:#000; }
  #stage { position:relative; width:${SIZE}px; height:${SIZE}px; background:#0b0b0b; overflow:hidden; }
  .layer { position:absolute; inset:0; }
  #void { background:#ffe500; clip-path:circle(0% at 50% 55%); }
  #void::after {
    content:''; position:absolute; inset:0;
    background:repeating-linear-gradient(0deg, transparent 0 34px, rgba(0,0,0,.04) 34px 38px);
  }
  #kevin { display:flex; align-items:center; justify-content:center; opacity:0; }
  #kevin svg { width:66%; height:auto; filter:drop-shadow(18px 18px 0 rgba(0,0,0,.18)); }

  /* the dialog */
  #dialog { display:flex; align-items:center; justify-content:center; opacity:0; }
  .win { width:660px; background:#d6d3ce; border:3px solid #000; box-shadow:12px 12px 0 rgba(0,0,0,.6); font-family:'Space Mono',monospace; }
  .win__bar { background:#000080; color:#fff; padding:10px 14px; font-size:22px; font-weight:700; display:flex; justify-content:space-between; }
  .win__body { padding:38px 34px 30px; font-size:30px; color:#000; }
  .win__row { display:flex; gap:16px; padding:0 34px 30px; }
  .win__btn { flex:1; text-align:center; padding:14px 0; font-size:24px; border:3px solid #000; background:#d6d3ce; font-weight:700; }
  .win__btn.hot { background:#fff; box-shadow:inset 0 0 0 3px #000; }
  #cursor { position:absolute; width:34px; height:auto; z-index:9; opacity:0; }

  /* type */
  .type {
    position:absolute; left:0; right:0; text-align:center;
    font-family:'Luckiest Guy',sans-serif; line-height:.95; opacity:0;
  }
  #beat { top:46%; font-size:78px; color:#ffe500; font-family:'Space Mono',monospace; font-weight:700; letter-spacing:.02em; }
  #l1 { top:8%; font-size:132px; color:#0b0b0b; }
  #l2 { top:20.5%; font-size:132px; color:#e8232b; -webkit-text-stroke:9px #0b0b0b; paint-order:stroke; }
  #pools { bottom:12%; font-size:60px; color:#0b0b0b; letter-spacing:.04em; }
  #site { bottom:5%; font-size:44px; color:#0b0b0b; font-family:'Space Mono',monospace; font-weight:700; letter-spacing:.1em; }
  #pools { bottom:9%; }
  #card { background:#0b0b0b; opacity:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; }
  #card .c1 { font-family:'Luckiest Guy',sans-serif; font-size:88px; color:#ffe500; text-align:center; max-width:94%; line-height:1.02; }
  #card .c2 { font-family:'Luckiest Guy',sans-serif; font-size:88px; color:#e8232b; -webkit-text-stroke:8px #ffe500; paint-order:stroke; text-align:center; max-width:94%; line-height:1.02; }
  #card .c3 { font-family:'Space Mono',monospace; font-weight:700; font-size:34px; color:#ffe500; opacity:.65; margin-top:26px; letter-spacing:.04em; }
  #mark { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; }
  #mark svg { width:74%; height:auto; }
  #flash { background:#fff; opacity:0; }
</style></head><body>
<div id="stage">
  <div class="layer" id="void"></div>
  <div class="layer" id="kevin">${kevinSvg}</div>
  <div class="type" id="l1">TOLD NO.</div>
  <div class="type" id="l2">STAYED ANYWAY.</div>
  <div class="type" id="pools">WETH 46 · KEK 36 · GME 18</div>
  <div class="type" id="site">IAMKEVIN.LOL</div>
  <div class="layer" id="mark">${wordmarkSvg}</div>
  <div class="layer" id="dialog">
    <div class="win">
      <div class="win__bar"><span>untitled - Paint</span><span>_ □ ✕</span></div>
      <div class="win__body">Save changes to Untitled?</div>
      <div class="win__row">
        <div class="win__btn" id="btn-yes">Yes</div>
        <div class="win__btn" id="btn-no">No</div>
        <div class="win__btn">Cancel</div>
      </div>
    </div>
  </div>
  <svg id="cursor" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
    <path d="M2,1 L2,26 L8,20 L12,30 L16,28 L12,19 L20,19 Z" fill="#fff" stroke="#000" stroke-width="2"/>
  </svg>
  <div class="layer" id="card">
    <div class="c1">A GME POOL.</div>
    <div class="c2">ON ROBINHOOD'S CHAIN.</div>
    <div class="c3">we're not going to explain that</div>
  </div>
  <div class="layer" id="beat"></div>
  <div class="layer" id="flash"></div>
</div>
<script>
  var S = {
    stage: document.getElementById('stage'),
    voidL: document.getElementById('void'),
    kevin: document.getElementById('kevin'),
    dialog: document.getElementById('dialog'),
    cursor: document.getElementById('cursor'),
    no: document.getElementById('btn-no'),
    beat: document.getElementById('beat'),
    flash: document.getElementById('flash'),
    l1: document.getElementById('l1'),
    l2: document.getElementById('l2'),
    pools: document.getElementById('pools'),
    site: document.getElementById('site'),
    mark: document.getElementById('mark'),
    card: document.getElementById('card'),
  };

  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  // 0 before "from", 1 after "to", eased in between
  var ramp = function (t, from, to) {
    if (to <= from) return t >= to ? 1 : 0;
    var x = clamp((t - from) / (to - from), 0, 1);
    return x * x * (3 - 2 * x);
  };
  // fade up then back down
  var pulse = function (t, a, b, c, d) { return Math.min(ramp(t, a, b), 1 - ramp(t, c, d)); };
  var pop = function (t, at, dur) {
    var x = clamp((t - at) / dur, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  };

  window.renderFrame = function (t) {
    // --- act one: the dialog -------------------------------------------
    var dlg = pulse(t, 0.25, 0.7, 2.15, 2.35);
    S.dialog.style.opacity = dlg;

    // cursor slides to No, lands at 1.85
    var cur = pulse(t, 0.5, 0.8, 2.15, 2.3);
    S.cursor.style.opacity = cur;
    var travel = ramp(t, 0.9, 1.85);
    var cx = 250 + (600 - 250) * travel;
    var cy = 880 + (628 - 880) * travel;
    var press = t >= 1.9 && t < 2.05 ? 6 : 0;
    S.cursor.style.left = (cx + press) + 'px';
    S.cursor.style.top = (cy + press) + 'px';
    S.no.className = 'win__btn' + (t >= 1.85 && t < 2.15 ? ' hot' : '');

    // --- the beat: "he saved anyway." ----------------------------------
    var beatOn = pulse(t, 2.5, 2.9, 3.7, 3.95);
    S.beat.style.opacity = beatOn;
    S.beat.textContent = 'he saved anyway.';
    S.beat.style.display = 'flex';
    S.beat.style.alignItems = 'center';
    S.beat.style.justifyContent = 'center';
    S.beat.style.top = '0';

    // --- the void opens -------------------------------------------------
    var open = ramp(t, 3.9, 5.0);
    S.voidL.style.clipPath = 'circle(' + (open * 78) + '% at 50% 55%)';

    // --- kevin ----------------------------------------------------------
    var kOn = ramp(t, 4.3, 4.9);
    S.kevin.style.opacity = kOn;
    var bob = Math.sin(t * 2.1) * 16;
    var tilt = Math.sin(t * 1.3) * 1.1;
    var settle = 1 - Math.pow(1 - clamp((t - 4.3) / 0.8, 0, 1), 3);
    var yOff = (1 - settle) * 90 + bob;
    // once the headline lands he steps down and back so the type has air
    var step = ramp(t, 6.2, 6.9);
    var drift = step * 168;
    var shrink = 1 - step * 0.34;
    S.kevin.style.transform =
      'translate(0,' + (yOff + drift) + 'px) rotate(' + tilt + 'deg) scale(' + (0.88 + settle * 0.12) * shrink + ')';

    // --- headline -------------------------------------------------------
    var p1 = pop(t, 6.3, 0.45);
    S.l1.style.opacity = p1 > 0 ? 1 : 0;
    S.l1.style.transform = 'translateY(' + (1 - p1) * -70 + 'px) scale(' + (0.86 + p1 * 0.14) + ')';
    var p2 = pop(t, 6.75, 0.45);
    S.l2.style.opacity = p2 > 0 ? 1 : 0;
    S.l2.style.transform = 'translateY(' + (1 - p2) * -70 + 'px) scale(' + (0.86 + p2 * 0.14) + ')';

    // --- pools + site ---------------------------------------------------
    var p3 = pop(t, 8.1, 0.4);
    S.pools.style.opacity = p3 > 0 ? 1 : 0;
    S.pools.style.transform = 'translateY(' + (1 - p3) * 40 + 'px)';

    // --- the punchline card ---------------------------------------------
    // Hard cut in, hold, hard cut out. The joke does not need a transition.
    var card = pulse(t, 9.5, 9.56, 11.5, 11.62);
    S.card.style.opacity = card;
    var cardIn = pop(t, 9.56, 0.35);
    S.card.style.transform = 'scale(' + (0.97 + cardIn * 0.03) + ')';

    // --- end card -------------------------------------------------------
    var end = ramp(t, 11.6, 12.0);
    S.mark.style.opacity = end;
    S.mark.style.transform = 'scale(' + (0.9 + end * 0.1) + ')';
    if (card > 0.5 || end > 0.5) {
      S.l1.style.opacity = 0;
      S.l2.style.opacity = 0;
      S.pools.style.opacity = 0;
      S.kevin.style.opacity = Math.max(0, kOn - Math.max(card, end));
    }
    var p4 = pop(t, 12.1, 0.4);
    S.site.style.opacity = p4 > 0 ? 1 : 0;
    S.site.style.transform = 'translateY(' + (1 - p4) * 30 + 'px)';

    // --- click flash ----------------------------------------------------
    S.flash.style.opacity = t >= 1.9 && t < 1.97 ? 0.75 : 0;
  };

  // A short seamless loop for the gif: he just stands there, being petty.
  window.renderLoop = function (t, total) {
    S.dialog.style.opacity = 0;
    S.cursor.style.opacity = 0;
    S.beat.style.opacity = 0;
    S.flash.style.opacity = 0;
    S.mark.style.opacity = 0;
    S.card.style.opacity = 0;
    S.l1.style.opacity = 0;
    S.l2.style.opacity = 0;
    S.pools.style.opacity = 0;
    S.site.style.opacity = 0;
    S.voidL.style.clipPath = 'circle(150% at 50% 55%)';
    S.kevin.style.opacity = 1;
    var a = (t / total) * Math.PI * 2;
    S.kevin.style.transform =
      'translate(0,' + Math.sin(a) * 22 + 'px) rotate(' + Math.sin(a * 2) * 1.6 + 'deg)';
  };
</script></body></html>`;
}

async function frames(page, count, fn, label) {
  await mkdir(TMP, { recursive: true });
  for (let i = 0; i < count; i++) {
    await page.evaluate(fn, i);
    await page.screenshot({ path: join(TMP, `${label}_${String(i).padStart(4, '0')}.png`) });
  }
}

async function main() {
  const preview = process.argv.includes('--preview');
  const kevinSvg = await readFile(join(ROOT, 'assets/art/kevin-petty.svg'), 'utf8');
  const wordmarkSvg = await readFile(join(ROOT, 'assets/art/wordmark.svg'), 'utf8');
  const html = await buildPage(kevinSvg, wordmarkSvg);

  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  if (preview) {
    const keys = [1.6, 2.7, 5.2, 6.9, 8.6, 10.2, 12.4, 13.6];
    for (let i = 0; i < keys.length; i++) {
      await page.evaluate((t) => window.renderFrame(t), keys[i]);
      await page.screenshot({ path: join(TMP, `key_${i}_${keys[i]}.png`) });
    }
    console.log('preview frames in', TMP);
    await browser.close();
    return;
  }

  const spotFrames = SPOT_SECONDS * FPS;
  console.log(`rendering ${spotFrames} spot frames…`);
  await frames(page, spotFrames, (i) => window.renderFrame(i / 24), 'spot');

  const loopFrames = LOOP_SECONDS * FPS;
  console.log(`rendering ${loopFrames} loop frames…`);
  await frames(page, loopFrames, (i) => window.renderLoop(i / 24, 4), 'loop');

  await browser.close();

  // --- mux -----------------------------------------------------------------
  const mp4 = join(OUT, 'kevin-spot.mp4');
  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(TMP, 'spot_%04d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', mp4]);

  // WebM alongside the MP4: Chromium builds without proprietary codecs (and
  // some embedded webviews) can't decode H.264, and the site offers both.
  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(TMP, 'spot_%04d.png'),
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-an',
    join(OUT, 'kevin-spot.webm')]);

  const loopMp4 = join(OUT, 'kevin-loop.mp4');
  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(TMP, 'loop_%04d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', loopMp4]);

  // gif via a generated palette, or it looks like 1998
  const palette = join(TMP, 'palette.png');
  await run(FFMPEG, ['-y', '-i', join(TMP, 'loop_%04d.png'),
    '-vf', 'fps=16,scale=480:-1:flags=lanczos,palettegen=max_colors=64', palette]);
  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(TMP, 'loop_%04d.png'), '-i', palette,
    '-lavfi', 'fps=16,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', join(OUT, 'kevin-loop.gif')]);

  await rm(TMP, { recursive: true, force: true });

  for (const f of await readdir(OUT)) console.log('  ', f);
}

await main();
