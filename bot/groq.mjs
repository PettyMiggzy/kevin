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
export const DEFAULT_MODEL = process.env.GROQ_MODEL || null;

/**
 * Chat models worth using, best first. Which of these a key can actually see
 * varies by account and changes without notice, so this is a preference order
 * resolved against the live list rather than a fixed choice.
 */
const PREFERRED = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'llama-3.3-70b-versatile',
  'groq/compound',
  'groq/compound-mini',
  'allam-2-7b',
];

/**
 * Not everything a key lists can hold a conversation. Whisper transcribes,
 * orpheus speaks, and the guard models are classifiers that answer "safe" or
 * "unsafe" — point the bot at one of those and it starts replying with one
 * word and nothing explains why.
 */
const NOT_CHAT = /whisper|orpheus|tts|prompt-guard|safeguard|embed|moderat/i;

/** Pick a model: the configured one if it exists, else the best that does. */
export function pickModel(ids, configured) {
  if (configured && ids.includes(configured)) return configured;
  for (const id of PREFERRED) if (ids.includes(id)) return id;
  const any = ids.find((id) => !NOT_CHAT.test(id));
  if (any) return any;
  return null;
}

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
 * Resolve the model at startup against what the key can actually see.
 *
 * The first version of this threw when the configured model was missing, which
 * under systemd's Restart=always meant a crash loop printing the same list
 * every five seconds forever. A bot that quietly picks the best available chat
 * model and says which is strictly better than one that refuses to start:
 * these ids get retired on the provider's schedule, not ours.
 */
export async function checkModel(key, configured) {
  const ids = await listModels(key);
  const model = pickModel(ids, configured);
  if (!model) {
    throw new Error(
      `This Groq key exposes no chat model.\nIt can see:\n  ${ids.join('\n  ')}`
    );
  }
  if (configured && model !== configured) {
    console.log(`GROQ_MODEL "${configured}" is not on this key — using ${model} instead.`);
  } else if (!configured) {
    console.log(`Model: ${model} (auto-picked; set GROQ_MODEL to override)`);
  }
  return model;
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
