#!/usr/bin/env node
// Puts "Mc" on the fast-food sign downtown, in the site's own display face.
//
//   python3 -m http.server 8099 &     # from the repo root, for the webfont
//   node tools/sign-mc.mjs            # --check to only report, --wide to widen the board
//
// WHY A TOOL AND NOT A REGENERATION
//
// The downtown plate is a good painting and the model will not paint the same
// street twice. Asking it for lettering is also the one thing it reliably gets
// wrong — the game shop came back with BACHOME and DEMLS. So the board is
// repainted here instead: find the cream sign panel by colour, wipe it, and
// composite lettering rendered from assets/fonts/luckiest-guy-400.woff2, which
// is the face the rest of the site is already set in.
//
// The mark is deliberately "Mc" and nothing else. No arches, no golden M, no
// second colour — the joke is the name, and the name is where it stops.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLATE = join(ROOT, 'assets/png/world/downtown.jpg');
const argv = process.argv.slice(2);
const WIDE = argv.includes('--wide');
// Luckiest Guy has no lowercase — every letter comes out a capital — so a
// literal "Mc" sets as "MC", which reads as initials rather than a name. The
// small c is faked with a tspan at 62%, sitting on the same baseline. --caps
// keeps the plain two-capital version for comparison.
const CAPS = argv.includes('--caps');
const MARKUP = CAPS ? 'Mc' : 'M<tspan font-size="62%">c</tspan>';

// The board. Typed in, because it is one board on one hand-painted plate and
// colour-detection kept finding the fascia beside it — but checked before
// anything is drawn, so a re-render that moves the building refuses instead of
// painting over the roof.
const BOARD = { x0: 319, y0: 211, x1: 369, y1: 261 };   // the cream field, inside its border
const CREAM = [253, 244, 184];
const OUTLINE = [72, 8, 0];

const py = `
import sys, json
import numpy as np
from PIL import Image
a = np.asarray(Image.open(${JSON.stringify(PLATE)}).convert('RGB')).astype(int)
b = ${JSON.stringify(BOARD)}
inner = a[b['y0']:b['y1']+1, b['x0']:b['x1']+1].reshape(-1,3)
cream = ((inner[:,0]>210)&(inner[:,1]>190)&(inner[:,2]>140)).mean()
ring = np.concatenate([a[b['y0']-4:b['y0']-1, b['x0']:b['x1']+1].reshape(-1,3),
                       a[b['y1']+2:b['y1']+5, b['x0']:b['x1']+1].reshape(-1,3)])
dark = ((ring[:,0]<130)&(ring[:,1]<120)&(ring[:,2]<120)).mean()
print(json.dumps({'cream': round(float(cream),3), 'darkRing': round(float(dark),3)}))
`;
const seen = JSON.parse(execFileSync('python3', ['-c', py]).toString());
const bw = BOARD.x1 - BOARD.x0 + 1, bh = BOARD.y1 - BOARD.y0 + 1;
console.log(`board ${bw}x${bh} at ${BOARD.x0},${BOARD.y0} — ` +
            `${Math.round(seen.cream*100)}% cream inside, ${Math.round(seen.darkRing*100)}% dark around`);
if (seen.cream < 0.15 || seen.darkRing < 0.45)
  throw new Error('that is not the sign board any more — the plate changed, fix BOARD before running this');
const bx0 = BOARD.x0, by0 = BOARD.y0, bx1 = BOARD.x1, by1 = BOARD.y1;
const found = { box: [bx0, by0, bx1, by1], fill: CREAM };
if (argv.includes('--check')) process.exit(0);

// Lettering, rendered by the browser so the woff2 needs no conversion. 8x, then
// downsampled — the plate is 1536 wide and the board is about fifty pixels of
// it, so anything less shows its stair-steps.
const SCALE = 8;
const inset = WIDE ? 3 : 4;                 // breathing room inside the border
const boxW = (WIDE ? bw + 22 : bw) - inset * 2;
const boxH = bh - inset * 2;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1600, height: 700 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8099/world/');   // same origin as the font file
await page.setContent(`<!doctype html><meta charset=utf-8>
<style>
  @font-face{font-family:'LG';src:url('/assets/fonts/luckiest-guy-400.woff2') format('woff2')}
  html,body{margin:0;background:transparent}
  svg{display:block}
  text{font-family:'LG';font-size:400px;fill:#d83727;stroke:#480800;stroke-width:34px;
       stroke-linejoin:round;paint-order:stroke fill}
</style>
<svg id="s" width="1600" height="700"><text id="t" x="800" y="520" text-anchor="middle">${MARKUP}</text></svg>`,
  { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const g = await page.evaluate(() => { const r = document.getElementById('t').getBBox();
  return { x: r.x, y: r.y, w: r.width, h: r.height }; });
if (g.w < 50) { await b.close(); throw new Error('the webfont did not load — is the server running?'); }
// Crop by shrinking the SVG onto the glyphs. Playwright's `clip` is ignored on
// an element screenshot, which quietly hands back the whole 1600x700 canvas —
// it then scales down to the right box with the lettering lost inside it.
await page.evaluate(({x,y,w,h}) => {
  const s = document.getElementById('s');
  s.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  s.setAttribute('width', w); s.setAttribute('height', h);
}, g);
await page.waitForTimeout(120);

// Scale so the lettering fills the board on whichever axis runs out first.
const k = Math.min((boxW * SCALE) / g.w, (boxH * SCALE) / g.h);
const outW = Math.round(g.w * k), outH = Math.round(g.h * k);
const png = join(ROOT, '.mc-lettering.png');
await page.locator('#s').screenshot({ path: png, omitBackground: true });
await b.close();

const comp = `
from PIL import Image
plate = Image.open(${JSON.stringify(PLATE)}).convert('RGB')
mark  = Image.open(${JSON.stringify(png)}).convert('RGBA').resize((${outW}//${SCALE}, ${outH}//${SCALE}), Image.LANCZOS)
bx0,by0,bx1,by1 = ${JSON.stringify(found.box)}
fill = tuple(${JSON.stringify(found.fill)})
wide = ${WIDE ? 'True' : 'False'}
from PIL import ImageDraw
d = ImageDraw.Draw(plate)
if wide:
    # a longer board, extended left along the fascia — the building's corner is
    # hard up against the right edge, so there is nowhere to go that way
    d.rounded_rectangle([bx0-24, by0-3, bx1+2, by1+3], radius=3, fill=fill, outline=(72,8,0), width=3)
    bx0 -= 22
d.rectangle([bx0, by0, bx1, by1], fill=fill)
w,h = mark.size
plate.paste(mark, ((bx0+bx1)//2 - w//2, (by0+by1)//2 - h//2 + 1), mark)
plate.save(${JSON.stringify(PLATE)}, quality=90, optimize=True, progressive=True)
print('wrote', ${JSON.stringify(PLATE)}, plate.size, 'mark', mark.size)
`;
console.log(execFileSync('python3', ['-c', comp]).toString().trim());
unlinkSync(png);
