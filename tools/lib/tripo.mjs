// Tripo 3D — text/image to model.
//
// Verified working 2026-09-03. The two things that cost a day to find out:
//
//   * Generation is v2, at api.tripo3d.ai. The v3 host (openapi.tripo3d.ai)
//     serves rigging and task reads, not creation.
//   * The API key is the `tsk_...` one. A `tcli_...` string is the ACCOUNT id
//     — it shows up in asset URLs, it is not a credential, and sending it as
//     a bearer token is why this was rejected for so long.
//
// Every generation costs credits, so `state.json` is committed rather than
// ignored: a cached task id is the difference between re-reading a model and
// paying for it twice.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const V2 = 'https://api.tripo3d.ai/v2/openapi';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadKey() {
  const fromEnv = process.env.TRIPO_KEY;
  if (fromEnv) return fromEnv.trim();
  for (const p of [join(ROOT, 'tools/.tripo.key'), join(ROOT, '.tripo.key')]) {
    if (existsSync(p)) return (await readFile(p, 'utf8')).trim();
  }
  throw new Error('No Tripo key. Put the tsk_... key in tools/.tripo.key or set TRIPO_KEY.');
}

async function call(key, path, { method = 'GET', body } = {}) {
  const r = await fetch(`${V2}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`${path}: HTTP ${r.status}, non-JSON: ${text.slice(0, 160)}`);
  }
  if (j.code !== 0) throw new Error(`${path}: code ${j.code} — ${j.message || text.slice(0, 160)}`);
  return j.data;
}

/** Credits left. Free to call, and worth calling before any batch. */
export const balance = (key) => call(key, 'user/balance');

/** Queue a text-to-model job. Returns the task id. */
export async function textToModel(key, prompt, { texture = true, pbr = true, ...rest } = {}) {
  const d = await call(key, 'task', {
    method: 'POST',
    body: { type: 'text_to_model', prompt, texture, pbr, ...rest },
  });
  return d.task_id;
}

export const task = (key, id) => call(key, `task/${id}`);

/** Poll until the task lands. Tripo takes 60-120s for a textured model. */
export async function wait(key, id, { onTick = null, timeoutMs = 600000 } = {}) {
  const started = Date.now();
  for (;;) {
    const d = await task(key, id);
    onTick?.(d);
    if (d.status === 'success') return d;
    if (['failed', 'cancelled', 'banned', 'expired'].includes(d.status)) {
      throw new Error(`task ${id} ${d.status}`);
    }
    if (Date.now() - started > timeoutMs) throw new Error(`task ${id} timed out`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Pull the model file out of a finished task and write it to disk. */
export async function download(data, outPath) {
  const out = data.output || data.result || {};
  const url =
    out.pbr_model?.url || out.pbr_model ||
    out.model?.url || out.model ||
    out.base_model?.url || out.base_model;
  if (!url) throw new Error(`no model url in ${JSON.stringify(Object.keys(out))}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
  return outPath;
}

// --- the paid-work cache ---------------------------------------------------
// Keyed by the exact prompt, so editing a prompt re-generates and leaving it
// alone never does.

export async function loadState(file) {
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
}

export async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2) + '\n');
}
