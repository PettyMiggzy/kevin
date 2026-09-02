#!/usr/bin/env node
// The promo spot, cut from the reference art in assets/refs/.
//
// Rendered frame by frame in headless Chromium so the typography is real
// (the brand display face, embedded) and the moves are exact, then muxed with
// ffmpeg. Deterministic: same input, same output, every time.
//
//   node tools/gen-promo.mjs             # 16:9 + 1:1 + gif
//   node tools/gen-promo.mjs --preview   # key frames only, no encode
//
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFS = join(ROOT, 'assets/refs');
const TMP = join(ROOT, '.promo');
const OUT = join(ROOT, 'assets/video');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG =
  process.env.FFMPEG_PATH ||
  ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ||
  '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

const W = 1920;
const H = 1080;
const FPS = 24;
const DURATION = 24;

/**
 * The cut. Each shot names a reference image, a camera move, and the line that
 * sits over it. Editing the film means editing this array and nothing else.
 *
 * move: [startScale, endScale, startX%, endX%, startY%, endY%]
 */
const SHOTS = [
  { at: 0.0,  img: '01-hero-portrait.jpg',   move: [1.30, 1.06,  0,  0,  0,  0], lines: [] },
  { at: 1.9,  img: '01-hero-portrait.jpg',   move: [1.06, 1.12,  0,  0,  0,  0], lines: [{ t: 'KEVIN', size: 200, red: true, at: 0.15 }] },
  { at: 3.7,  img: '06-toxic-graffiti.jpg',  move: [1.18, 1.04, -6,  4,  0,  0], lines: [{ t: 'TOLD NO.', size: 130, at: 0.2 }] },
  { at: 5.8,  img: '07-moon-action.jpg',     move: [1.02, 1.26,  0,  0,  2, -3], lines: [{ t: 'STAYED ANYWAY.', size: 120, red: true, at: 0.2 }] },
  { at: 8.1,  img: '04-robinhood-hq.jpg',    move: [1.04, 1.20,  4, -4,  0,  0], lines: [{ t: 'A GME POOL.', size: 120, at: 0.25 }] },
  { at: 10.2, img: '04-robinhood-hq.jpg',    move: [1.20, 1.32, -4, -8,  0,  0], lines: [{ t: "ON ROBINHOOD'S CHAIN.", size: 96, red: true, at: 0.1 }] },
  { at: 12.3, black: true, lines: [{ t: "WE'RE NOT GOING TO", size: 84, y: 44, at: 0.15 }, { t: 'EXPLAIN THAT.', size: 84, y: 56, yellow: true, at: 0.35 }] },
  { at: 14.0, img: '03-gym.jpg',             move: [1.24, 1.06,  6, -5,  0,  0], lines: [{ t: 'NO MARKETING.', size: 118, at: 0.2 }] },
  { at: 15.9, img: '05-cereal.jpg',          move: [1.06, 1.22, -5,  5,  0,  0], lines: [{ t: 'ONLY GRUDGES.', size: 118, red: true, at: 0.2 }] },
  { at: 17.8, img: '02-mcdonalds-getaway.jpg', move: [1.22, 1.04,  5, -6,  0,  0], lines: [{ t: 'WHATEVER WE GET,', size: 104, at: 0.2 }] },
  { at: 19.6, img: '06-toxic-graffiti.jpg',  move: [1.10, 1.30,  4, -2,  0,  0], lines: [{ t: 'WE BURN.', size: 150, red: true, at: 0.15 }] },
  { at: 21.4, img: '01-hero-portrait.jpg',   move: [1.22, 1.00,  0,  0,  0,  0], lines: [] },
  { at: 22.4, end: true, lines: [] },
];

const b64 = async (p, mime) => `data:${mime};base64,${(await readFile(p)).toString('base64')}`;

async function buildPage() {
  const display = await b64(join(ROOT, 'assets/fonts/luckiest-guy-400.woff2'), 'font/woff2');
  const mono = await b64(join(ROOT, 'assets/fonts/space-mono-700.woff2'), 'font/woff2');

  const files = (await readdir(REFS)).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  const imgs = {};
  for (const f of files) imgs[f] = await b64(join(REFS, f), f.endsWith('.png') ? 'image/png' : 'image/jpeg');

  const layers = Object.entries(imgs)
    .map(([f, src]) => `<div class="shot" data-img="${f}"><img src="${src}"></div>`)
    .join('');

  return `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:'LG';src:url(${display}) format('woff2')}
  @font-face{font-family:'SM';src:url(${mono}) format('woff2');font-weight:700}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000}
  #stage{position:relative;width:${W}px;height:${H}px;background:#000;overflow:hidden}
  .shot{position:absolute;inset:0;opacity:0;will-change:transform,opacity}
  .shot img{width:100%;height:100%;object-fit:cover;display:block}
  #vig{position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.55) 100%)}
  #grade{position:absolute;inset:0;pointer-events:none;background:rgba(0,0,0,0);}
  .cap{position:absolute;left:0;right:0;text-align:center;font-family:'LG',sans-serif;
    line-height:.98;color:#fff;-webkit-text-stroke:14px #0B0B0B;paint-order:stroke fill;
    opacity:0;will-change:transform,opacity;padding:0 60px}
  .cap.red{color:#E8232B}
  .cap.yellow{color:#FFE500}
  #flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
  #end{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;
    justify-content:center;gap:26px;background:#FFE500}
  #end .mark{font-family:'LG',sans-serif;font-size:250px;color:#E8232B;
    -webkit-text-stroke:18px #0B0B0B;paint-order:stroke fill;line-height:.9}
  #end .url{font-family:'LG',sans-serif;font-size:82px;color:#0B0B0B}
  #end .pools{font-family:'SM',monospace;font-weight:700;font-size:38px;letter-spacing:.28em;color:#0B0B0B}
  #end .pad{font-family:'SM',monospace;font-weight:700;font-size:26px;letter-spacing:.2em;opacity:.62;color:#0B0B0B}
</style>
<div id="stage">
  ${layers}
  <div id="grade"></div>
  <div id="vig"></div>
  <div class="cap" id="c1"></div>
  <div class="cap" id="c2"></div>
  <div id="end">
    <div class="mark">KEVIN</div>
    <div class="url">IAMKEVIN.LOL</div>
    <div class="pools">WETH · KEK · GME</div>
    <div class="pad">LAUNCHING ON KEKFUN · ROBINHOOD CHAIN</div>
  </div>
  <div id="flash"></div>
</div>
<script>
const SHOTS = ${JSON.stringify(SHOTS)};
const DUR = ${DURATION};
const shots = {};
document.querySelectorAll('.shot').forEach(el => { shots[el.dataset.img] = el; });
const caps = [document.getElementById('c1'), document.getElementById('c2')];
const endCard = document.getElementById('end');
const flash = document.getElementById('flash');
const grade = document.getElementById('grade');

const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const ease = x => 1 - Math.pow(1 - x, 3);
const lerp = (a,b,t) => a + (b-a)*t;

window.renderFrame = function (t) {
  // which shot are we in
  let i = 0;
  for (let k = 0; k < SHOTS.length; k++) if (t >= SHOTS[k].at) i = k;
  const shot = SHOTS[i];
  const next = SHOTS[i+1];
  const end = next ? next.at : DUR;
  const len = end - shot.at;
  const p = clamp((t - shot.at) / len, 0, 1);   // 0..1 within the shot

  for (const k in shots) shots[k].style.opacity = 0;
  endCard.style.display = 'none';
  caps.forEach(c => { c.style.opacity = 0; });

  if (shot.end) {
    endCard.style.display = 'flex';
    const pop = ease(clamp(p / 0.12, 0, 1));
    endCard.style.transform = 'scale(' + lerp(0.94, 1, pop) + ')';
  } else if (shot.black) {
    // nothing behind the type
  } else {
    const el = shots[shot.img];
    if (el) {
      el.style.opacity = 1;
      const [s0,s1,x0,x1,y0,y1] = shot.move;
      const e = p; // linear inside a shot reads steadier than eased
      el.style.transform =
        'scale(' + lerp(s0,s1,e) + ') translate(' + lerp(x0,x1,e) + '%,' + lerp(y0,y1,e) + '%)';
    }
  }

  // captions
  (shot.lines || []).forEach((line, n) => {
    const c = caps[n];
    if (!c) return;
    const inAt = line.at ?? 0.15;
    const a = ease(clamp((p - inAt) / 0.12, 0, 1));
    const out = 1 - clamp((p - 0.88) / 0.12, 0, 1);
    c.textContent = line.t;
    c.className = 'cap' + (line.red ? ' red' : '') + (line.yellow ? ' yellow' : '');
    c.style.fontSize = line.size + 'px';
    c.style.top = (line.y ?? (n === 0 ? 41 : 55)) + '%';
    c.style.opacity = a * out;
    c.style.transform = 'translateY(' + lerp(34, 0, a) + 'px) scale(' + lerp(0.94, 1, a) + ')';
  });

  // a hard white flash on every cut sells the edit
  const sinceCut = t - shot.at;
  flash.style.opacity = sinceCut < 0.05 && shot.at > 0 ? 0.55 : 0;

  // fade up from black at the top
  grade.style.background = t < 0.5 ? 'rgba(0,0,0,' + (1 - t/0.5) + ')' : 'rgba(0,0,0,0)';
};
</script>`;
}

async function main() {
  const preview = process.argv.includes('--preview');
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(await buildPage(), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  if (preview) {
    const keys = [0.4, 2.6, 4.4, 6.6, 9.0, 11.0, 12.9, 14.8, 16.7, 18.6, 20.3, 23.0];
    for (let i = 0; i < keys.length; i++) {
      await page.evaluate((t) => window.renderFrame(t), keys[i]);
      await page.screenshot({ path: join(TMP, `key_${String(i).padStart(2, '0')}_${keys[i]}s.png`) });
    }
    console.log('preview frames in .promo/');
    await browser.close();
    return;
  }

  const total = DURATION * FPS;
  console.log(`rendering ${total} frames at ${W}x${H}…`);
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.renderFrame(t), f / FPS);
    await page.screenshot({ path: join(TMP, `f_${String(f).padStart(4, '0')}.png`) });
    if (f % 96 === 0) process.stdout.write(`  ${f}/${total}\r`);
  }
  await browser.close();

  console.log('\nencoding…');
  const mp4 = join(OUT, 'kevin-promo.mp4');
  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(TMP, 'f_%04d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', mp4]);

  await run(FFMPEG, ['-y', '-framerate', String(FPS), '-i', join(TMP, 'f_%04d.png'),
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-an',
    join(OUT, 'kevin-promo.webm')]);

  // square cut for feeds — centre crop, no re-render
  await run(FFMPEG, ['-y', '-i', mp4, '-vf', 'crop=1080:1080:(iw-1080)/2:(ih-1080)/2',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', join(OUT, 'kevin-promo-square.mp4')]);

  await rm(TMP, { recursive: true, force: true });
  for (const f of await readdir(OUT)) console.log('  ', f);
}

await main();
