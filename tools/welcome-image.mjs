#!/usr/bin/env node
// Set brand type over an image and save it as a bot welcome card.
//
//   node tools/welcome-image.mjs <source> "WELCOME" [out.png]
//
// The bot posts one of these with every greeting and uses the generated words
// as the caption, so the words ON the image have to stay generic — the caption
// is where the variety lives. Type is Luckiest Guy in white over a heavy black
// stroke, which is what the site and the sticker plates use; a welcome card set
// in anything else reads as somebody else's asset.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [src, word = 'WELCOME', out] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/welcome-image.mjs <source> [WORD] [out.png]');
  process.exit(1);
}
const dest = out || join(ROOT, 'bot/assets/welcome/welcome.png');

const img = (await readFile(src)).toString('base64');
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
const font = (await readFile(join(ROOT, 'assets/fonts/luckiest-guy-400.woff2'))).toString('base64');

// Telegram scales a group photo down hard, so the type has to survive being
// read at thumbnail size — hence the size and the stroke rather than a
// tasteful caption.
const W = 1288;
const H = 1221;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<style>
  @font-face{font-family:'LG';src:url(data:font/woff2;base64,${font}) format('woff2')}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000}
  #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  /* A band under the type: the art behind it is busy and pale in places, and
     white-on-pale is unreadable however heavy the stroke. */
  #band{position:absolute;left:0;right:0;bottom:0;height:26%;
    background:linear-gradient(to top,rgba(0,0,0,.72),rgba(0,0,0,.45) 55%,rgba(0,0,0,0))}
  #w{position:absolute;left:4%;right:4%;bottom:5.5%;text-align:center;
    font-family:'LG',sans-serif;color:#fff;line-height:.96;white-space:nowrap;
    -webkit-text-stroke:18px #0B0B0B;paint-order:stroke fill;
    letter-spacing:2px}
  #accent{position:absolute;left:0;right:0;bottom:0;height:14px;background:#FFE500}
</style>
<img id="bg" src="data:${mime};base64,${img}">
<div id="band"></div>
<div id="w">${word}</div>
<div id="accent"></div>`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

// Fit the word to the frame. Inline measurement needs the element sized to its
// content, and the stroke straddles the glyph edge so half of it sits outside
// the measured box — count it or the widest letters clip.
await page.evaluate((frameW) => {
  const el = document.getElementById('w');
  el.style.display = 'inline-block';
  el.style.left = '0';
  el.style.right = '0';
  el.style.width = '100%';
  const inner = document.createElement('span');
  inner.textContent = el.textContent;
  inner.style.display = 'inline-block';
  el.textContent = '';
  el.appendChild(inner);
  const available = frameW * 0.88;
  for (let size = 190; size > 40; size -= 2) {
    el.style.fontSize = `${size}px`;
    const stroke = Math.round(size * 0.095);
    el.style.webkitTextStroke = `${stroke}px #0B0B0B`;
    if (inner.getBoundingClientRect().width + stroke * 2 <= available) break;
  }
}, W);

await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, await page.screenshot({ type: 'png' }));
await browser.close();
console.log(`  ${dest.replace(ROOT + '/', '')}  "${word}"`);
