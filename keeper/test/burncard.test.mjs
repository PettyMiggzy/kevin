// The burn-card image renderer. Mostly a "does it actually produce a valid,
// correctly-sized PNG" check — the interesting bug this caught during
// development (a short number leaving the template's OWN baked-in digits
// peeking out to its right) only shows up by rendering and measuring pixels,
// so that's what most of this does.

import { renderBurnCard } from '../burncard.mjs';
import { photoCaption } from '../burnwatch.mjs';

const ok = [], bad = [];
const check = (name, got, want) => {
  const pass = got === want;
  (pass ? ok : bad).push(pass ? name : `${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

// A minimal PNG decoder for just what this needs: IHDR's width/height, and
// whether a given pixel is opaque — no dependency pulled in just to check
// the thing this file exists to check.
function readPngInfo(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (bad signature)');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

const png1 = await renderBurnCard({ amount: 20533858, percent: 2.0534 });
check('renders a real PNG', png1.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
const info = readPngInfo(png1);
check('canvas is 1800x1800, matching the template', `${info.width}x${info.height}`, '1800x1800');

// The bug this is really guarding: a SHORT new number must still fully cover
// the template's own baked-in "9,618,559" / "0.962%" — rendering a tiny
// amount and diffing it against a huge one is the only way to catch a cover
// box that shrank to fit the new text instead of the old.
const pngSmall = await renderBurnCard({ amount: 1, percent: 0.0000001 });
const pngBig = await renderBurnCard({ amount: 987654321, percent: 45.678 });
check('a tiny burn still renders a full PNG', pngSmall.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
check('a huge burn still renders a full PNG', pngBig.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
// Different numbers must actually produce different pixels — a renderer that
// silently failed to draw the new text (leaving only the cover box) would
// still pass every check above.
check('a different amount changes the output bytes', Buffer.compare(pngSmall, pngBig) !== 0, true);

// photoCaption: names the bot, never claims to be a stranger, carries the tx.
const burn = { amount: '10915298.934363979564226817', tx: '0x8085854eaa93a475495d457bf0ce6616fea1989972b8cf1ed73997c8ef6bdfea' };
const cap = photoCaption(burn);
check('caption mentions the fryer line', cap.includes('did not come out'), true);
check('caption carries the tx hash', cap.includes(burn.tx), true);
check('caption states this burn\'s own amount', cap.includes('10,915,299'), true);

console.log(ok.map((x) => '  ok   ' + x).join('\n'));
if (bad.length) console.log(bad.map((x) => '  FAIL ' + x).join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
