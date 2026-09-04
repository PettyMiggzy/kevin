#!/usr/bin/env node
// KEVIN, in Telegram.
//
//   node bot/index.mjs              run it
//   node bot/index.mjs --dry        assemble everything and print it, call nothing
//   node bot/index.mjs --models     list the models this Groq key can use
//   node bot/index.mjs --ask "..."  one question on the command line
//
// Long polling, not a webhook: no public URL, no TLS certificate, no hosting
// decision needed to get it running. It is the slower design and it is the one
// you can start on a laptop in a minute.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrief } from './brief.mjs';
import { systemPrompt, commandReply } from './persona.mjs';
import { loadKey, listModels, checkModel, chat, DEFAULT_MODEL } from './groq.mjs';
import { welcome, cleanName } from './welcome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const argOf = (f) => {
  const i = args.indexOf(`--${f}`);
  return i === -1 ? null : args[i + 1];
};

// How much of a conversation Kevin carries. Short on purpose: a group chat is
// not a thread, and a long history mostly buys the model more chances to drift
// out of character.
const MEMORY_TURNS = 6;
const MIN_GAP_MS = 2500;          // per chat, so one person cannot spin the bot
const MAX_INPUT = 600;            // characters of a user message worth sending

/**
 * Groups the bot will talk in. DMs are always allowed.
 *
 * Without this, anybody can add the bot to their own group and spend the Groq
 * quota, or stand up a convincing fake "official" chat with the real Kevin bot
 * answering in it. A group id is not a secret — every member can see it — so
 * this lives in the repo rather than in a key file.
 */
const ALLOWED_CHATS = new Set(
  (process.env.KEVIN_CHATS || '-1002229054100')      // @kevinRBH
    .split(',').map((s) => s.trim()).filter(Boolean)
);

// Raids: twenty people joining at once must not become twenty messages.
const WELCOME_WINDOW_MS = 8000;   // joins inside this are greeted together
const WELCOME_GAP_MS = 20000;     // and no faster than this per chat

async function loadTelegramToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim();
  try {
    return (await readFile(join(HERE, '.telegram.key'), 'utf8')).trim();
  } catch {
    throw new Error(
      'No Telegram token. Put it in bot/.telegram.key (gitignored) or set TELEGRAM_BOT_TOKEN.'
    );
  }
}

async function tg(token, method, params) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram ${method}: ${body.description || r.status}`);
  return body.result;
}

/**
 * Should Kevin answer this at all?
 *
 * In a DM, yes. In a group, ONLY when spoken to — a bot that replies to every
 * message in a token group gets muted within the hour, and being muted is the
 * same as not existing.
 */
function allowed(chat) {
  if (chat?.type === 'private') return true;
  if (!ALLOWED_CHATS.size) return true;
  return ALLOWED_CHATS.has(String(chat?.id));
}

function addressed(msg, me) {
  const chatType = msg.chat?.type;
  const text = msg.text || '';
  if (chatType === 'private') return true;
  if (msg.reply_to_message?.from?.id === me.id) return true;
  if (text.includes('@' + me.username)) return true;
  if (/^\/\w+/.test(text)) return true;
  // Called by name, at the start, the way you would in a room.
  if (/^\s*kevin\b/i.test(text)) return true;
  return false;
}

/** Strip the @mention and the /command@botname suffix before the model sees it. */
function clean(text, me) {
  return text
    .replace(new RegExp('@' + me.username, 'gi'), '')
    .replace(/^\s*kevin[\s,:!-]*/i, '')
    .trim()
    .slice(0, MAX_INPUT);
}

function parseCommand(text, me) {
  const m = /^\/([a-z_]+)(?:@(\S+))?/i.exec(text || '');
  if (!m) return null;
  if (m[2] && m[2].toLowerCase() !== me.username.toLowerCase()) return null;  // aimed at another bot
  return m[1].toLowerCase();
}

async function main() {
  const { config, brief, gaps } = await buildBrief();
  const system = systemPrompt(brief);

  if (has('dry')) {
    console.log(system);
    console.log('\n' + '='.repeat(70));
    console.log(`system prompt: ${system.length} chars (~${Math.round(system.length / 4)} tokens)`);
    console.log(`gaps Kevin must admit: ${gaps.join(', ')}`);
    console.log(`contract in facts: ${config.contract ?? 'null (bot will refuse to give one)'}`);
    for (const c of ['start', 'help', 'ca', 'links', 'pools', 'burn', 'gym']) {
      console.log(`\n--- /${c} ---\n${commandReply(c, config)}`);
    }
    return;
  }

  const key = await loadKey();

  if (has('models')) {
    for (const id of await listModels(key)) console.log(id);
    return;
  }

  const model = await checkModel(key, DEFAULT_MODEL);

  if (has('ask')) {
    const q = argOf('ask') || 'who are you';
    const { text } = await chat(key, {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: q }],
    });
    console.log(text);
    return;
  }

  const token = await loadTelegramToken();
  const me = await tg(token, 'getMe');
  console.log(`Kevin is on the fryer as @${me.username} (model ${model})`);
  if (!config.contract) console.log('No contract in config.js — /ca will refuse to give an address. Correct.');

  const memory = new Map();       // chatId -> [{role, content}]
  const lastReply = new Map();    // chatId -> ms
  const joins = new Map();        // chatId -> {names[], timer, lastAt, lastOpener}
  let offset = 0;
  let backoff = 1000;

  /**
   * Greet whoever has arrived, once, a beat after they arrive.
   *
   * Buffered rather than immediate: people arrive in clumps, and eight
   * separate hellos in eight seconds is what makes a group mute a bot. One
   * message naming them all is warmer anyway.
   */
  function greet(chatId, users) {
    const j = joins.get(chatId) ?? { names: [], timer: null, lastAt: 0, lastOpener: null };
    joins.set(chatId, j);
    for (const u of users) j.names.push(cleanName(u));
    if (j.timer) return;

    const wait = Math.max(WELCOME_WINDOW_MS, WELCOME_GAP_MS - (Date.now() - j.lastAt));
    j.timer = setTimeout(async () => {
      const names = j.names.splice(0, j.names.length);
      j.timer = null;
      j.lastAt = Date.now();
      if (!names.length) return;
      const { text, opener } = welcome(names, config, j.lastOpener);
      j.lastOpener = opener;
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }).catch((e) => console.error('welcome failed:', e.message));
    }, wait);
    j.timer.unref?.();
  }

  for (;;) {
    let updates;
    try {
      updates = await tg(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      // 'message' covers joins too — new_chat_members arrives as a service
      // message on the same update type, which is why the filter stays as it is.
      backoff = 1000;
    } catch (e) {
      // A network blip must not end the bot. Back off, then carry on.
      console.error('poll failed:', e.message);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60000);
      continue;
    }

    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg) continue;
      if (!allowed(msg.chat)) continue;

      // Somebody joined. Never greet the bot's own arrival, and never greet a
      // bot — a group full of them would greet each other forever.
      const arrivals = (msg.new_chat_members || []).filter((x) => x.id !== me.id && !x.is_bot);
      if (arrivals.length) greet(msg.chat.id, arrivals);

      if (!msg.text || !addressed(msg, me)) continue;

      const chatId = msg.chat.id;
      const now = Date.now();
      if (now - (lastReply.get(chatId) ?? 0) < MIN_GAP_MS) continue;
      lastReply.set(chatId, now);

      const reply = (text) =>
        tg(token, 'sendMessage', {
          chat_id: chatId,
          text,
          reply_to_message_id: msg.message_id,
          disable_web_page_preview: true,
        }).catch((e) => console.error('send failed:', e.message));

      // Canned answers first: they are the questions that get asked most, they
      // must never vary, and the contract one must never go near a model.
      const cmd = parseCommand(msg.text, me);
      if (cmd) {
        const canned = commandReply(cmd, config);
        if (canned) { await reply(canned); continue; }
      }

      const question = clean(msg.text, me);
      if (!question) continue;

      const history = memory.get(chatId) ?? [];
      try {
        await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
        const { text } = await chat(key, {
          model,
          messages: [
            { role: 'system', content: system },
            ...history,
            { role: 'user', content: question },
          ],
        });
        await reply(text);
        memory.set(chatId, [
          ...history,
          { role: 'user', content: question },
          { role: 'assistant', content: text },
        ].slice(-MEMORY_TURNS * 2));
      } catch (e) {
        console.error('groq failed:', e.message);
        await reply('Kevin is on the fryer. Ask Kevin again in a minute.');
      }
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
