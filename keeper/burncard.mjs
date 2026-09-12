// Burn announcement image — the fixed vault/fire template with the live
// amount and percent-of-supply stamped over it.
//
//   import { renderBurnCard } from './burncard.mjs';
//   const png = await renderBurnCard({ amount: 20533858, percent: 2.0534 });
//
// WHY A TEMPLATE AND A COVER-BOX, NOT A BLANK BACKGROUND
//
// The template (assets/png/burn-announce.jpg) already has a number baked
// into it from the source design — there was no blank version to start
// from. So every render draws an opaque box over the ORIGINAL text first,
// then the real number on top. That box must always be at least as wide as
// the original baked-in text ("9,618,559" / "0.962% of supply · gone for
// good"), never just as wide as the new text — a short new number sized to
// itself leaves the old digits peeking out to its right. This was a real
// bug in the first pass, caught by rendering a short number and looking.
//
// Widths are measured by actually rendering each string and finding its
// rightmost opaque pixel, not estimated from a per-character width — Space
// Mono and Luckiest Guy don't reliably follow a fixed advance at these
// sizes, and a wrong guess is exactly the same bug from the other
// direction (box too narrow, old text shows through).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FONTS_DIR = join(ROOT, 'assets', 'fonts');
const TEMPLATE = join(ROOT, 'assets', 'png', 'burn-announce.jpg');

// A fontconfig scoped to just these two files, so this renders identically
// wherever it runs — a droplet with no fonts installed included — instead
// of depending on whatever fontconfig setup happens to exist on the host.
const FC_DIR = join(HERE, '.fontconfig');
const FC_FILE = join(FC_DIR, 'fonts.conf');
function ensureFontconfig() {
  if (existsSync(FC_FILE)) return;
  mkdirSync(FC_DIR, { recursive: true });
  writeFileSync(FC_FILE, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONTS_DIR}</dir>
  <cachedir>${join(FC_DIR, 'cache')}</cachedir>
</fontconfig>
`);
}
// Must happen before sharp's native addon (and the fontconfig it links
// against) initializes — a dynamic import guarantees the env var is set
// first, rather than relying on how a static import gets hoisted.
ensureFontconfig();
process.env.FONTCONFIG_FILE = FC_FILE;
const { default: sharp } = await import('sharp');

const NUM_FONT = 'Luckiest Guy';
const PCT_FONT = 'Space Mono';

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render `text` off-screen and return the x-coordinate of its rightmost opaque pixel. */
async function measureWidth(text, fontFamily, fontSize, fontWeight = 'normal') {
  const svg = `<svg width="1700" height="200" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="150" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}">${text}</text>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let maxX = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = info.width - 1; x > maxX; x--) {
      if (data[y * info.width + x] > 10) { maxX = x; break; }
    }
  }
  return maxX - 10;
}

// The template's own baked-in text, measured once per process and reused —
// this is the floor every cover box must meet, per the note above.
let originalWidths = null;
async function getOriginalWidths() {
  if (originalWidths) return originalWidths;
  originalWidths = {
    num: await measureWidth('9,618,559', NUM_FONT, 118),
    pct: await measureWidth('0.962% of supply &#183; gone for good', PCT_FONT, 34, '700'),
  };
  return originalWidths;
}

/**
 * @param {number} amount - KEVIN burned, whole tokens (already floor'd/rounded by the caller as wanted)
 * @param {number} percent - that amount's share of total supply, 0-100
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderBurnCard({ amount, percent }) {
  const amountText = escapeXml(Math.round(amount).toLocaleString('en-US'));
  const percentText = escapeXml(`${percent.toFixed(3)}% of supply · gone for good`);

  const orig = await getOriginalWidths();
  const numTextW = Math.max(orig.num, await measureWidth(amountText, NUM_FONT, 118));
  const pctTextW = Math.max(orig.pct, await measureWidth(percentText, PCT_FONT, 34, '700'));
  const numBoxW = Math.min(1650, numTextW + 130);
  const pctBoxW = Math.min(1650, pctTextW + 100);

  const svg = `
  <svg width="1800" height="1800" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gNum" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgb(40,24,12)"/>
        <stop offset="100%" stop-color="rgb(20,15,11)"/>
      </linearGradient>
      <linearGradient id="gPct" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgb(24,17,13)"/>
        <stop offset="100%" stop-color="rgb(35,23,13)"/>
      </linearGradient>
    </defs>
    <rect x="85" y="180" width="${numBoxW}" height="160" fill="url(#gNum)"/>
    <text x="112" y="300" font-family="${NUM_FONT}" font-size="118" fill="#ffffff">${amountText}</text>

    <rect x="85" y="468" width="${pctBoxW}" height="58" fill="url(#gPct)"/>
    <text x="112" y="515" font-family="${PCT_FONT}" font-weight="700" font-size="34" fill="#cfc9c2">${percentText}</text>
  </svg>`;

  return sharp(TEMPLATE)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}
