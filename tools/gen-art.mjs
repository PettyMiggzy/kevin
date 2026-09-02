#!/usr/bin/env node
// Generates every brand asset in the repo. Deterministic: re-running produces
// byte-identical files, so `git status` stays quiet unless the art actually changed.
//
//   node tools/gen-art.mjs
//
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kevin, C } from './lib/kevin-vector.mjs';
import { wordmark, logoMark, favicon, poolCoin, banner, ogCard, voidPattern } from './lib/marks.mjs';
import { withBrowser, svgToPng } from './lib/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(ROOT, 'assets/art');
const PNG = join(ROOT, 'assets/png');
const STICKERS = join(ROOT, 'assets/stickers');

// --- the cast --------------------------------------------------------------
// caption is what goes on the sticker; slug is the filename.
export const CAST = [
  { slug: 'petty',      name: 'Petty Kevin',      caption: 'PETTY',       eyes: 'side',   mouth: 'smirk', props: ['arms'] },
  { slug: 'og',         name: 'OG Kevin',         caption: null,          eyes: 'normal', mouth: 'tri' },
  { slug: 'noted',      name: 'Noted Kevin',      caption: 'NOTED',       eyes: 'side',   mouth: 'flat',  props: ['arms'] },
  { slug: 'receipts',   name: 'Receipts Kevin',   caption: 'RECEIPTS',    eyes: 'side',   mouth: 'smirk', props: ['arms'] },
  { slug: 'told-no',    name: 'Told No Kevin',    caption: 'TOLD NO',     eyes: 'side',   mouth: 'smirk' },
  { slug: 'laser',      name: 'Laser Kevin',      caption: 'SEND IT',     eyes: 'laser',  mouth: 'big' },
  { slug: 'rekt',       name: 'Rekt Kevin',       caption: 'REKT',        eyes: 'x',      mouth: 'frown' },
  { slug: 'smoothbrain',name: 'Smoothbrain Kevin',caption: 'SMOOTHBRAIN', eyes: 'derp',   mouth: 'drool', props: ['brain'] },
  { slug: 'chad',       name: 'Gigachad Kevin',   caption: 'NO COMMENT',  eyes: 'normal', mouth: 'smirk', props: ['shades', 'chain'] },
  { slug: 'thinking',   name: 'Thinking Kevin',   caption: 'HMMM',        eyes: 'wide',   mouth: 'flat',  props: ['think'] },
  { slug: 'cope',       name: 'Cope Kevin',       caption: 'COPE',        eyes: 'cry',    mouth: 'frown' },
  { slug: 'gm',         name: 'GM Kevin',         caption: 'GM',          eyes: 'closed', mouth: 'smirk', props: ['coffee'] },
  { slug: 'wen',        name: 'Wen Kevin',        caption: 'WEN',         eyes: 'wide',   mouth: 'big' },
  { slug: 'diamond',    name: 'Diamond Kevin',    caption: 'STILL HERE',  eyes: 'normal', mouth: 'flat',  props: ['diamond'] },
  { slug: 'mine',       name: 'Mine Now Kevin',   caption: 'MINE NOW',    eyes: 'money',  mouth: 'big',   props: ['diamond'] },
  { slug: 'fine',       name: 'Fine Kevin',       caption: "I'M FINE",    eyes: 'spiral', mouth: 'flat' },
  { slug: 'kek',        name: 'Kek Kevin',        caption: 'KEK',         eyes: 'wide',   mouth: 'big' },
  { slug: 'ngmi',       name: 'Ngmi Kevin',       caption: 'NGMI',        eyes: 'x',      mouth: 'flat' },
];

const write = async (dir, file, contents) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), contents);
  return join(dir, file);
};

async function main() {
  const made = [];

  // ---- character SVGs (transparent + void backgrounds) --------------------
  for (const c of CAST) {
    const opts = { eyes: c.eyes, mouth: c.mouth, props: c.props ?? [] };
    made.push(await write(ART, `kevin-${c.slug}.svg`, kevin({ ...opts, background: null })));
    made.push(await write(ART, `kevin-${c.slug}-void.svg`, kevin({ ...opts, background: C.void })));
  }

  // ---- marks --------------------------------------------------------------
  made.push(await write(ART, 'wordmark.svg', wordmark('KEVIN')));
  made.push(await write(ART, 'wordmark-white.svg', wordmark('KEVIN', { fill: '#FFFFFF' })));
  made.push(await write(ART, 'wordmark-petty.svg', wordmark('KING PETTY', { size: 110 })));
  made.push(await write(ART, 'logo.svg', logoMark({})));
  made.push(await write(ART, 'logo-plain.svg', logoMark({ background: null, ring: false })));
  made.push(await write(ART, 'favicon.svg', favicon()));
  made.push(await write(ART, 'banner.svg', banner()));
  made.push(await write(ART, 'og.svg', ogCard()));
  made.push(await write(ART, 'void-pattern.svg', voidPattern()));
  for (const k of ['kek', 'gme', 'weth']) made.push(await write(ART, `coin-${k}.svg`, poolCoin(k)));

  // ---- rasters ------------------------------------------------------------
  await withBrowser(async (browser) => {
    // Telegram sticker pack: 512x512, transparent, captioned in white.
    for (const c of CAST) {
      const svg = kevin({
        eyes: c.eyes,
        mouth: c.mouth,
        props: c.props ?? [],
        background: null,
        caption: c.caption,
        captionColor: '#FFFFFF',
      });
      await mkdir(STICKERS, { recursive: true });
      made.push(await svgToPng(browser, svg, join(STICKERS, `${c.slug}.png`), 512, 512));
    }

    await mkdir(PNG, { recursive: true });
    const raster = async (name, svg, w, h) => made.push(await svgToPng(browser, svg, join(PNG, name), w, h));

    await raster('pfp-1000.png', kevin({ eyes: 'side', mouth: 'smirk', props: ['arms'], background: C.void }), 1000, 1000);
    await raster('pfp-og-1000.png', kevin({ background: C.void }), 1000, 1000);
    await raster('logo-512.png', logoMark({}), 512, 512);
    await raster('logo-1024.png', logoMark({}), 1024, 1024);
    await raster('banner-1500x500.png', banner(), 1500, 500);
    await raster('og-1200x630.png', ogCard(), 1200, 630);
    await raster('favicon-180.png', favicon(), 180, 180);
    await raster('favicon-32.png', favicon(), 32, 32);
    for (const k of ['kek', 'gme', 'weth']) await raster(`coin-${k}-512.png`, poolCoin(k), 512, 512);
  });

  console.log(`generated ${made.length} files`);
  return made;
}

await main();
