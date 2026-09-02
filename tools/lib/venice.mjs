// Venice image API client.
//
// The key is read from VENICE_API_KEY (or tools/.venice.key, which is
// gitignored). It is never written into any generated file, logged, or
// committed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.venice.ai/api/v1';

export async function loadKey() {
  if (process.env.VENICE_API_KEY) return process.env.VENICE_API_KEY.trim();
  try {
    return (await readFile(join(ROOT, 'tools/.venice.key'), 'utf8')).trim();
  } catch {
    throw new Error(
      'No Venice key. Set VENICE_API_KEY, or put the key in tools/.venice.key (gitignored).'
    );
  }
}

/**
 * Build a style_references array from local image files. Venice takes a raw
 * base64 string or a data URI, under 8MB each. Only models with
 * supportsStyleReferences honour these — krea-v2-*, luma-uni-1*.
 */
export async function styleRefs(paths, strength = 0.5) {
  const out = [];
  for (const p of paths) {
    const buf = await readFile(p);
    if (buf.length > 8 * 1024 * 1024) throw new Error(`${p} is over Venice's 8MB reference limit`);
    const mime = extname(p).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    out.push({ image: `data:${mime};base64,${buf.toString('base64')}`, strength });
  }
  return out;
}

export async function listModels(key) {
  const r = await fetch(`${API}/models?type=image`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`models ${r.status}: ${await r.text()}`);
  return (await r.json()).data;
}

/**
 * Generate one image. Returns a Buffer.
 * Venice caps width/height at 1280; models like Nano Banana take aspect_ratio
 * instead, so both are passed through and the model uses what it understands.
 */
export async function generate(key, opts) {
  const {
    model = 'ideogram-v4',
    prompt,
    negative_prompt,
    width = 1280,
    height = 720,
    aspect_ratio,
    format = 'png',
    seed,
    steps,
    cfg_scale,
    style_preset,
    style_references,
    quality,
    variants,
    safe_mode = false,
    hide_watermark = true,
    enhance_prompt,
  } = opts;

  const body = { model, prompt, format, safe_mode, hide_watermark, return_binary: false };
  if (negative_prompt) body.negative_prompt = negative_prompt;
  if (width) body.width = width;
  if (height) body.height = height;
  if (aspect_ratio) body.aspect_ratio = aspect_ratio;
  if (seed !== undefined) body.seed = seed;
  if (steps) body.steps = steps;
  if (cfg_scale) body.cfg_scale = cfg_scale;
  if (style_preset) body.style_preset = style_preset;
  if (style_references) body.style_references = style_references;
  if (quality) body.quality = quality;
  if (variants) body.variants = variants;
  if (enhance_prompt !== undefined) body.enhance_prompt = enhance_prompt;

  const r = await fetch(`${API}/image/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  if (!r.ok) {
    // 401 = bad key, 402 = no credit, 429 = rate limited. Say which.
    throw new Error(`venice ${r.status}: ${text.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`venice returned non-JSON: ${text.slice(0, 200)}`);
  }
  const b64 = (json.images || json.data || [])[0];
  if (!b64) throw new Error(`venice returned no image: ${JSON.stringify(json).slice(0, 300)}`);
  return Buffer.from(typeof b64 === 'string' ? b64 : b64.b64_json, 'base64');
}

export async function save(buf, outDir, name) {
  await mkdir(outDir, { recursive: true });
  const p = join(outDir, name);
  await writeFile(p, buf);
  return p;
}
