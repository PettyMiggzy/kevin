// Groq, through its OpenAI-compatible endpoint.
//
// No SDK: it is one POST, and a dependency that wraps one POST is a dependency
// that breaks on a Tuesday. Chosen for latency — a group chat bot that takes
// four seconds to answer reads as broken, and Groq is the reason this is
// roughly one.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://api.groq.com/openai/v1';

/**
 * Model ids on hosted-inference providers get retired with little notice, so
 * this is a default rather than a hard-coded truth — `checkModel` below asks
 * the API what actually exists and tells you what to switch to.
 */
export const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/** Key from the environment, or a gitignored file next to this one. */
export async function loadKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
  try {
    return (await readFile(join(HERE, '.groq.key'), 'utf8')).trim();
  } catch {
    throw new Error(
      'No Groq key. Put it in bot/.groq.key (gitignored) or set GROQ_API_KEY.'
    );
  }
}

async function call(path, key, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Groq returned non-JSON (HTTP ${r.status}): ${text.slice(0, 200)}`);
  }
  if (!r.ok) {
    const msg = body?.error?.message || text.slice(0, 200);
    throw new Error(`Groq HTTP ${r.status}: ${msg}`);
  }
  return body;
}

/** Every model this key can actually use, newest-looking first. */
export async function listModels(key) {
  const body = await call('/models', key, { method: 'GET' });
  return (body.data || []).map((m) => m.id).sort();
}

/**
 * Fail loudly at startup rather than on the first message in a live group.
 * Returns the model to use — the configured one if it exists, otherwise throws
 * with the real list, because guessing a replacement silently is worse.
 */
export async function checkModel(key, model) {
  const ids = await listModels(key);
  if (ids.includes(model)) return model;
  throw new Error(
    `Model "${model}" is not available on this key.\nAvailable:\n  ${ids.join('\n  ')}\n` +
    `Set GROQ_MODEL to one of those.`
  );
}

/**
 * One completion.
 *
 * `temperature` is deliberately low-ish. Kevin is a flat, repetitive character;
 * a high temperature makes him witty, and witty is the one thing he is not.
 */
export async function chat(key, { model, messages, temperature = 0.7, maxTokens = 320 }) {
  const body = await call('/chat/completions', key, {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      top_p: 0.9,
    }),
  });
  const choice = body.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error('Groq returned an empty completion');
  return { text, usage: body.usage };
}
