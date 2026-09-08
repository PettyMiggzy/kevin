#!/usr/bin/env node
/**
 * Generate promo shots through Venice's video API.
 *
 *   node tools/promo/gen-shots.mjs --set preview
 *   node tools/promo/gen-shots.mjs --set preview --dry     # price it, generate nothing
 *
 * Reference-to-video rather than image-to-video ON PURPOSE. The hard part of
 * "cartoon character in a real world" is not the world, it is that the
 * character has to still be the same character in shot nine. R2V takes
 * reference stills and locks him across every generation; image-to-video only
 * animates one frame and drifts.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.venice.ai/api/v1';
const OUT = join(ROOT, 'assets/video/shots');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);

// Every prompt inherits this. The arches clause is not decoration: a generated
// fast-food interior defaults to the chain everybody has seen a million
// pictures of, and that is the one thing that gets a paid campaign pulled.
const WORLD = `Photorealistic live-action environment, real cinema camera, natural lighting, \
shallow depth of field, film grain, 35mm. The environment and every object in it is REAL and \
PHOTOGRAPHIC. Only the character is drawn.`;

const NEG = `golden arches, McDonald's, Burger King, KFC, Wendy's, any real restaurant chain logo \
or wordmark or trade dress, brand logos, watermark, text overlay, subtitles, distorted anatomy, \
extra limbs, human face on the character, realistic fur, photorealistic creature`;

const KEVIN_2D = `KEVIN is a FLAT 2D HAND-DRAWN CARTOON: solid red body, thick black outlines, \
flat unshaded fills, a swept-back crest of red spikes, two huge white oval eyes with small black \
pupils, a cream muzzle and a simple black triangle mouth. He is drawn, not rendered — he looks \
like a sticker composited into the shot, deliberately not belonging.`;

const KEVIN_3D = `KEVIN is a physical 3D character present in the scene: the same red creature with \
the swept-back crest, huge white eyes and cream muzzle, but rendered with real volume, real \
lighting, contact shadows and reflections that match the room, like a practical puppet or a Pixar \
character shot on location.`;

const SETS = {
  preview: [
    { id: 'p1-fryer-2d', treat: KEVIN_2D, duration: '5s',
      scene: `A cramped, real fast-food kitchen at night. Stainless steel fryers, oil haze in the \
air, harsh overhead strip lighting, grease on the tiles, an unbranded paper hat on a hook. KEVIN \
stands at the fryer basket, completely calm, doing his job.` },
    { id: 'p2-fryer-3d', treat: KEVIN_3D, duration: '5s',
      scene: `A cramped, real fast-food kitchen at night. Stainless steel fryers, oil haze in the \
air, harsh overhead strip lighting, grease on the tiles. KEVIN stands at the fryer basket, \
completely calm, doing his job.` },
    { id: 'p3-storeroom', treat: KEVIN_2D, duration: '5s',
      scene: `A real stockroom: metal shelving, cardboard boxes, a mop bucket, one bare bulb. A \
whiteboard on the wall with a handwritten list, three items ticked. KEVIN stands looking at the \
whiteboard with his back half to camera, arms folded, entirely serious.` },
  ],
};

async function key() {
  return (await readFile(join(ROOT, 'tools/.venice.key'), 'utf8')).trim();
}

const dataUrl = async (f) => {
  const buf = await readFile(join(ROOT, f));
  const mime = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
};

/**
 * Kling O3 takes ELEMENTS, not a flat list of reference images: one element is
 * one identity, with a frontal image plus up to three more angles. Kevin is a
 * single element, so he stays one character rather than three lookalikes.
 * Referred to in the prompt as @Element1.
 */
async function elements() {
  return [{
    frontal_image_url: await dataUrl('assets/memes/face.jpg'),
    reference_image_urls: [
      await dataUrl('assets/refs/13-kevin-canon.jpg'),
      await dataUrl('assets/refs/16-kevin-idle.png'),
    ],
  }];
}

const post = async (k, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { ok: r.ok, status: r.status, j };
};

async function main() {
  const k = await key();
  const set = SETS[flag('set', 'preview')];
  if (!set) throw new Error(`unknown set`);
  const model = flag('model', 'kling-o3-pro-reference-to-video');
  const dry = has('dry');

  // Price the whole run BEFORE generating any of it.
  let total = 0;
  for (const s of set) {
    const { j } = await post(k, '/video/quote',
      { model, duration: s.duration, aspect_ratio: '16:9' });
    if (typeof j.quote !== 'number') { console.error(`quote failed for ${s.id}:`, JSON.stringify(j).slice(0, 200)); return; }
    total += j.quote;
    console.log(`  ${s.id.padEnd(16)} ${s.duration}  $${j.quote.toFixed(2)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(16)}      $${total.toFixed(2)}`);
  if (dry) return;

  await mkdir(OUT, { recursive: true });
  const els = await elements();

  for (const s of set) {
    // @Element1 is Kevin. The syntax is what binds the reference to the subject
    // of the sentence; describing him in words alone lets the model drift.
    const prompt = `${s.treat}\n\n${WORLD}\n\nSHOT: ${s.scene.replace(/KEVIN/g, '@Element1')}`;
    const { ok, status, j } = await post(k, '/video/queue', {
      model, prompt, negative_prompt: NEG, duration: s.duration,
      aspect_ratio: '16:9', audio: false, elements: els,
    });
    if (!ok) { console.error(`${s.id}: HTTP ${status} ${JSON.stringify(j).slice(0, 300)}`); continue; }
    console.log(`${s.id}  queued  ${j.queue_id || '?'}`);
    await writeFile(join(OUT, `${s.id}.queue.json`), JSON.stringify({ ...j, id: s.id, model, prompt }, null, 2));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
