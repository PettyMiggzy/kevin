#!/usr/bin/env node
// Plays /world in a real browser and checks it can actually be played.
//
//   python3 -m http.server 8099 &          # from the repo root
//   node tools/play-world.mjs              # or: --base http://iamkevin.lol
//
// tools/check-world.mjs proves the geometry is sane without opening anything.
// This is the other half: it walks Kevin around, finishes both jobs, opens a
// door with the keyboard and again with a tap, and fails if any of it silently
// stops working. Every bug this found was invisible from reading the code — a
// one-frame keypress the loop never saw, a doorway you spawn on top of.
import { chromium } from 'playwright';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://127.0.0.1:8099');
const SHOTS = arg('shots', null);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 760 } });
const fails = [], errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

const ok = (cond, what) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); if (!cond) fails.push(what); };
const hud = () => page.evaluate(() => document.getElementById('job').textContent.replace(/\s+/g, ' '));
const zone = () => page.evaluate(() => location.hash.slice(1));

// the same cover-fit the engine does, so a world coordinate can be tapped
const S = Math.max(1280 / 1536, 760 / 864);
const screen = (x, y) => ({ x: x * S + (1280 - 1536 * S) / 2, y: y * S + (760 - 864 * S) / 2 });
const walkTo = async (x, y) => {
  const s = screen(x, y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(3800);
};
const open = async (z, tag) => {
  await page.goto(`${BASE}/world/?${tag}#${z}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
};

// --- every zone renders --------------------------------------------------
const ZONES = ['block','downtown','neighbourhood','mckevins','gameshop','brokerage','house'];
for (const z of ZONES) {
  await open(z, 'r');
  const name = await page.evaluate(() => document.getElementById('where').firstChild.textContent);
  ok(await zone() === z && name.length > 2, `${z} loads (${name})`);
  const painted = await page.evaluate(() => {
    const c = document.getElementById('stage');
    // if the painting is missing the engine falls back to flat yellow
    const d = c.getContext('2d').getImageData(c.width/2, c.height*0.42, 1, 1).data;
    return !(d[0] > 245 && d[1] > 215 && d[2] < 40);
  });
  ok(painted, `${z} is painted`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/world-${z}.png` });
}

// --- both jobs can be finished -------------------------------------------
async function play(z, pickup, drops, tag) {
  await open(z, 'j');
  for (let pass = 0; pass < 4; pass++) {
    for (const [x, y] of drops) {
      if ((await hud()).includes('·')) { await walkTo(pickup[0], pickup[1]); await walkTo(x, y); }
    }
    if (!(await hud()).includes('·')) break;   // the done line has no counter
  }
  const end = await hud();
  ok(!end.includes('·'), `${tag} can be finished — "${end}"`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-${z}.png` });
}
await play('mckevins', [790, 372],
  [[480,440],[430,560],[420,680],[1120,440],[1150,560],[1190,680]], 'the shift');
await play('neighbourhood', [940, 600],
  [[250,580],[520,580],[790,592],[1180,600],[1350,700]], 'the paper round');

// --- doors open both ways people have --------------------------------------
for (const how of ['key', 'tap']) {
  await open('downtown', how);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1800); await page.keyboard.up('ArrowUp');
  const tip = await page.evaluate(() => document.getElementById('tip').textContent);
  if (how === 'key') await page.keyboard.press('e'); else await page.click('#tip');
  await page.waitForTimeout(900);
  ok(await zone() === 'mckevins', `${how} opens the door (prompt: "${tip.slice(0, 40)}…")`);
}

// --- walking out of a room puts you back on the street ---------------------
await open('gameshop', 'x');
await page.keyboard.down('ArrowDown'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowDown');
ok(await zone() === 'downtown', 'walking down leaves the game shop');

ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
await b.close();
console.log(fails.length ? `\n${fails.length} failure(s)` : '\nworld plays');
process.exit(fails.length ? 1 : 0);
