// Tripo 3D client.
//
// Endpoint shape matters and is easy to get wrong:
//   GENERATION  -> v2   POST https://api.tripo3d.ai/v2/openapi/task
//                       body { type, prompt, texture, pbr }   (no "model" field)
//   POLL        -> v2   GET  https://api.tripo3d.ai/v2/openapi/task/<id>
//   RIGGING     -> v3   https://openapi.tripo3d.ai/v3/animations/rig
//
// A generation POST spends credits the moment it succeeds, so preflight() uses a
// GET instead: 401 means the key is bad, 404 means the key is good and the id
// simply does not exist. That distinguishes the two for free.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = 'https://api.tripo3d.ai/v2/openapi';
const V3 = 'https://openapi.tripo3d.ai/v3';

export async function loadKey() {
  if (process.env.TRIPO_KEY) return process.env.TRIPO_KEY.trim();
  try {
    return (await readFile(join(ROOT, 'tools/.tripo.key'), 'utf8')).trim();
  } catch {
    throw new Error('No Tripo key. Set TRIPO_KEY, or put it in tools/.tripo.key (gitignored). Expect ~46 chars starting tsk_.');
  }
}

/** Verify a key without spending credits. */
export async function preflight(key) {
  const r = await fetch(`${V2}/task/preflight-probe-not-a-real-id`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (r.status === 401) return { ok: false, reason: 'key rejected (401)' };
  return { ok: true, status: r.status };
}

const api = async (key, url, init = {}) => {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url.replace(V2, 'v2').replace(V3, 'v3')}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
};

/** Queue a generation. Costs credits. */
export async function textToModel(key, prompt, { texture = true, pbr = true } = {}) {
  const j = await api(key, `${V2}/task`, {
    method: 'POST',
    body: JSON.stringify({ type: 'text_to_model', prompt, texture, pbr }),
  });
  return j.data.task_id;
}

export async function imageToModel(key, imageToken, { texture = true, pbr = true } = {}) {
  const j = await api(key, `${V2}/task`, {
    method: 'POST',
    body: JSON.stringify({ type: 'image_to_model', file: { type: 'jpg', file_token: imageToken }, texture, pbr }),
  });
  return j.data.task_id;
}

export async function poll(key, taskId, { everyMs = 8000, timeoutMs = 900000, onTick } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const j = await api(key, `${V2}/task/${taskId}`);
    const d = j.data;
    if (d.status === 'success') return d;
    if (['failed', 'banned', 'expired', 'cancelled'].includes(d.status)) {
      throw new Error(`task ${taskId} ${d.status}`);
    }
    if (onTick) onTick(d.status, d.progress);
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`task ${taskId} timed out`);
}

/**
 * Cache keyed by prompt so a re-run never pays twice for a prop that exists.
 * Losing this file is losing money, so it is committed, not gitignored.
 */
const STATE = join(ROOT, 'game/assets/props/state.json');

export async function loadState() {
  if (!existsSync(STATE)) return {};
  try {
    return JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveState(state) {
  await mkdir(dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(state, null, 2) + '\n');
}

export { V2, V3 };
