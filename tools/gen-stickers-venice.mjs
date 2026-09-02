#!/usr/bin/env node
// Sticker pack, generated.
//
// Pipeline per sticker: generate a full-body pose on a flat background with
// margin around it -> Venice background-remove -> trim + pad square -> 512px
// -> optional caption in the brand face.
//
//   node tools/gen-stickers-venice.mjs                 # all
//   node tools/gen-stickers-venice.mjs kek rekt        # some
//   node tools/gen-stickers-venice.mjs --no-caption
//
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKey, generate, removeBackground, toBase64 } from './lib/venice.mjs';
import { KEVIN, NEGATIVE } from './venice-prompts.mjs';
import { withBrowser } from './lib/render.mjs';
import { strokeText, fitSize } from './lib/letters.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets/stickers/venice/raw');
const OUT = join(ROOT, 'assets/stickers/venice');

// Framing instructions matter more than the pose here: models love to crop in
// on a face, and a sticker cropped at the ears is useless.
const FRAMING =
  'FRAMING: full body, head to feet, entire character visible and centred, ' +
  'generous empty margin on all four sides, no cropping of any part of him, ' +
  'flat solid single-colour bright yellow background with nothing else in the ' +
  'frame — no scenery, no props beyond what is described, no text, no border';

export const POSES = [
  { slug: 'petty', caption: 'PETTY', pose: 'standing with his arms folded, head tilted, eyes narrowed to a flat unimpressed side-eye, mouth a small closed line' },
  { slug: 'kek', caption: 'KEK', pose: 'thrown backwards laughing, both eyes squeezed shut, mouth wide open, one mitten hand slapping his knee' },
  { slug: 'rekt', caption: 'REKT', pose: 'flat on his back, limbs sprawled, both eyes replaced by simple black X shapes, mouth a wavy frown' },
  { slug: 'wen', caption: 'WEN', pose: 'leaning eagerly forward on tiptoes, eyes enormous and hopeful, both mitten hands clasped together under his chin' },
  { slug: 'gm', caption: 'GM', pose: 'half asleep and slumped, eyes barely open, holding a steaming white coffee mug in one mitten hand' },
  { slug: 'cope', caption: 'COPE', pose: 'crying with two big blue cartoon tears, mouth turned down, but giving a shaky thumbs up with one mitten hand' },
  { slug: 'send-it', caption: 'SEND IT', pose: 'leaning aggressively forward, glowing bright red laser beams shooting out of both eyes, mouth open in a shout' },
  { slug: 'no-comment', caption: 'NO COMMENT', pose: 'standing calmly wearing tiny black sunglasses and a thick gold chain, mouth a flat closed line, utterly unbothered' },
  { slug: 'noted', caption: 'NOTED', pose: 'holding a small notepad and a pencil in his mitten hands, looking up and sideways at the viewer with a flat expression, mid-note' },
  { slug: 'hmmm', caption: 'HMMM', pose: 'one mitten hand under his chin in a thinking pose, eyes rolled up and to the side, mouth a small pursed line' },
  { slug: 'still-here', caption: 'STILL HERE', pose: 'standing straight with both mitten fists planted on his hips, chest out, chin up, looking defiant' },
  { slug: 'mine', caption: 'MINE NOW', pose: 'hugging an enormous overflowing sack of cash with both arms, eyes wide and greedy, grinning' },
];

const CAP = process.argv.includes('--no-caption') ? false : true;
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** Trim transparent edges, pad to a square, and scale to `size`. */
async function squarePad(browser, pngBuf, size, caption) {
  const b64 = pngBuf.toString('base64');
  const page = await browser.newPage({ viewport: { width: size, height: size } });

  const capSvg = caption
    ? strokeText(caption, {
        x: 256,
        y: 430,
        size: fitSize(caption, 420, { max: 62 }),
        align: 'center',
        fill: '#FFFFFF',
        ink: '#0B0B0B',
        seed: 17,
      }).svg
    : '';

  await page.setContent(
    `<style>html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
       #w{position:relative;width:${size}px;height:${size}px}
       img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
       svg{position:absolute;inset:0;width:100%;height:100%}</style>
     <div id="w"><img src="data:image/png;base64,${b64}">
     ${capSvg ? `<svg viewBox="0 0 512 512">${capSvg}</svg>` : ''}</div>`,
    { waitUntil: 'load' }
  );
  const out = await page.screenshot({ omitBackground: true });
  await page.close();
  return out;
}

async function main() {
  const key = await loadKey();
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const list = only.length ? POSES.filter((p) => only.includes(p.slug)) : POSES;
  console.log(`generating ${list.length} stickers\n`);

  await withBrowser(async (browser) => {
    for (const p of list) {
      process.stdout.write(`  ${p.slug.padEnd(14)}`);
      try {
        const raw = await generate(key, {
          model: 'nano-banana-pro',
          prompt: `${KEVIN}. POSE: Kevin is ${p.pose}. ${FRAMING}.`,
          negative_prompt: NEGATIVE,
          aspect_ratio: '1:1',
          format: 'png',
        });
        await writeFile(join(RAW, `${p.slug}.png`), raw);

        const cut = await removeBackground(key, toBase64(raw));
        const final = await squarePad(browser, cut, 512, CAP ? p.caption : null);
        await writeFile(join(OUT, `${p.slug}.png`), final);
        console.log(` ${(final.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.log(` FAILED — ${e.message.split('\n')[0]}`);
      }
    }
  });
  console.log(`\nwrote to assets/stickers/venice/`);
}

await main();
