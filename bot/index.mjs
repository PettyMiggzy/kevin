#!/usr/bin/env node
// KEVIN, in Telegram.
//
//   node bot/index.mjs              run it
//   node bot/index.mjs --dry        assemble everything and print it, call nothing
//   node bot/index.mjs --models     list the models this Groq key can use
//   node bot/index.mjs --ask "..."  one question on the command line
//   node bot/index.mjs --sniff      log every message other bots post, and stop
//                                   there. Use this to see what Radar actually
//                                   sends before writing a parser for it.
//
// Long polling, not a webhook: no public URL, no TLS certificate, no hosting
// decision needed to get it running. It is the slower design and it is the one
// you can start on a laptop in a minute.
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrief } from './brief.mjs';
import { systemPrompt, commandReply, guardModelReply } from './persona.mjs';
import { loadKey, listModels, checkModel, chat, DEFAULT_MODEL } from './groq.mjs';
import { welcome, cleanName, loadImages, pickImage, liftLine } from './welcome.mjs';
import { top, render, hasScores } from './scores.mjs';
import { makeSeen, fromOtherBot, sniff, parseLeaderboard } from './botwatch.mjs';

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

/**
 * The unprompted "do you even lift bro?".
 *
 * Every number here exists to make it rare. A bot that speaks on a schedule
 * gets muted, and muted is the same as absent — so it needs the room to be
 * awake, needs to have been quiet itself for a long while, and then still only
 * fires some of the time.
 */
const LIFT_MIN_GAP_MS = 6 * 3600e3;   // never twice inside six hours — four let a
                                      // busy group get it nearly six times a day
const LIFT_CHAT_ALIVE_MS = 10 * 60e3; // somebody must have spoken this recently
const LIFT_BOT_QUIET_MS = 90 * 60e3;  // and the bot must not have
const LIFT_CHANCE = 0.05;             // then a 6% roll, checked about once a minute
const LIFT_ROLL_EVERY_MS = 60e3;

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

/**
 * Mint a code that ties somebody's game save to their Telegram account.
 *
 * The code goes by DM, never into the group. Posted in a room, anybody could
 * grab it and attach THEIR save to the requester's name — which is the whole
 * leaderboard compromised by a five-second copy and paste.
 */
async function linkCode(tgToken, msg) {
  const base = process.env.KEVIN_SCORES_URL;
  const admin = process.env.KEVIN_ADMIN_KEY;
  if (!base || !admin) return 'Kevin cannot do that yet. There is no board.';
  try {
    const r = await fetch(new URL('/link/code', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify({ tgId: msg.from.id, name: cleanName(msg.from) }),
      signal: AbortSignal.timeout(6000),
    });
    const body = await r.json();
    if (!body.code) return 'Kevin could not make a code. Try again in a bit.';

    const dm = await tg(tgToken, 'sendMessage', {
      chat_id: msg.from.id,
      text: `Your code is ${body.code}\n\nPut it in the gym at iamkevin.lol/gym to put your name on the board. It last fifteen minute. Do not give it to anybody.`,
    }).catch(() => null);

    return dm
      ? 'Kevin send you the code in a message.'
      : 'Kevin cannot message you until you talk to Kevin first. Open @' + (process.env.KEVIN_BOT || 'the bot') + ' and press start, then ask again.';
  } catch {
    return 'Kevin cannot reach the board right now.';
  }
}

/**
 * sendPhoto, which unlike every other call here needs multipart rather than
 * JSON because it carries a file.
 */
async function sendPhoto(token, chatId, path, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('photo', new Blob([await readFile(path)]), basename(path));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram sendPhoto: ${body.description || r.status}`);
  return body.result;
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
  // Case-insensitively. Telegram resolves @iamkevinzbot and @Iamkevinzbot to
  // the same bot, and people type whichever their keyboard offers — but
  // me.username is whatever case it was registered in, so a plain includes()
  // silently ignored every mention that did not match it exactly. That is a
  // bot that looks broken to the one person who tried to talk to it.
  if (text.toLowerCase().includes('@' + me.username.toLowerCase())) return true;
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
    for (const c of ['start', 'help', 'ca', 'links', 'pools', 'burn', 'gym', 'cards']) {
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

  // Art for the welcomes, if any has been dropped in. Read once — adding a
  // picture is a restart either way.
  const welcomeImages = await loadImages(join(HERE, 'assets/welcome'));
  if (welcomeImages.length) console.log(`${welcomeImages.length} welcome image(s) loaded`);

  const sniffing = has('sniff');
  if (sniffing) console.log('SNIFF MODE — logging what other bots post, replying to nobody.');
  const seen = makeSeen();

  const memory = new Map();       // chatId -> [{role, content}]
  const lastReply = new Map();    // chatId -> ms
  const joins = new Map();        // chatId -> {names[], timer, lastAt, lastOpener}
  const rooms = new Map();        // chatId -> {lastHuman, lastBot, lastLift}
  const room = (id) => {
    if (!rooms.has(id)) rooms.set(id, { lastHuman: 0, lastBot: 0, lastLift: 0 });
    return rooms.get(id);
  };
  let offset = 0;
  let backoff = 1000;

  const liftTimer = setInterval(() => {
    const now = Date.now();
    for (const [chatId, r] of rooms) {
      if (String(chatId).startsWith('-') === false) continue;      // groups only
      if (now - r.lastHuman > LIFT_CHAT_ALIVE_MS) continue;        // room is asleep
      if (now - r.lastBot < LIFT_BOT_QUIET_MS) continue;           // bot just spoke
      if (now - r.lastLift < LIFT_MIN_GAP_MS) continue;            // asked recently
      if (Math.random() > LIFT_CHANCE) continue;
      r.lastLift = now;
      r.lastBot = now;
      tg(token, 'sendMessage', { chat_id: chatId, text: liftLine(), disable_web_page_preview: true })
        .catch((e) => console.error('lift failed:', e.message));
    }
  }, LIFT_ROLL_EVERY_MS);
  liftTimer.unref?.();

  /**
   * Has this person already been greeted here, recently?
   *
   * Being added to a group can produce BOTH a new_chat_members service message
   * and a chat_member update, and a rejoin produces a fresh pair. Without this
   * the same arrival gets welcomed twice, which looks worse than not welcoming
   * them at all.
   */
  const greeted = new Map();
  const GREETED_TTL_MS = 10 * 60 * 1000;
  function joined(chatId, userId) {
    const key = `${chatId}:${userId}`;
    const at = greeted.get(key) ?? 0;
    const now = Date.now();
    if (now - at < GREETED_TTL_MS) return true;
    greeted.set(key, now);
    if (greeted.size > 2000) {
      for (const [k, t] of greeted) if (now - t > GREETED_TTL_MS) greeted.delete(k);
    }
    return false;
  }

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

      // With art, the greeting rides as the caption so it is one message
      // rather than two. Telegram caps a caption at 1024 characters; these are
      // nowhere near it, but send them apart rather than truncate if that ever
      // changes.
      const image = pickImage(welcomeImages, j.lastImage);
      if (image && text.length <= 1024) {
        j.lastImage = image;
        const sent = await sendPhoto(token, chatId, image, text)
          .catch((e) => { console.error('welcome photo failed:', e.message); return null; });
        if (sent) return;
        // Fall through to text — a group with no greeting because an image
        // failed is worse than a greeting with no image.
      }
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
      updates = await tg(token, 'getUpdates', {
        offset, timeout: 25,
        // edited_message matters: a campaign bot that edits its leaderboard in
        // place rather than reposting produces no new message at all.
        allowed_updates: ['message', 'edited_message', 'chat_member'],
      });
      // Joins arrive by TWO different routes and the bot has to watch both.
      //
      // new_chat_members is a service message on a 'message' update, and it
      // fires when somebody is ADDED to the group — which is what the API docs
      // actually say: "New members that were added to the group or supergroup".
      // Someone who joins a supergroup themselves, off an invite link or out of
      // search, was not added by anybody and produces no such message. That is
      // the common case for a public group, and it is why nobody was greeted.
      //
      // Those self-joins come through as 'chat_member' instead, which the docs
      // are explicit about: "The bot must be an administrator in the chat and
      // must explicitly specify chat_member in the list of allowed_updates."
      // It is excluded from the default set, so it has to be asked for by name
      // — and asking for one update type by name means naming them all, which
      // is why 'message' and 'edited_message' are listed here too.
      //
      // Privacy mode is NOT the culprit and turning it off will not fix this:
      // "All bots will also receive, regardless of privacy mode: All service
      // messages.
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

      // --- somebody joined by themselves ------------------------------------
      // A status change into the group off an invite link or a search. Only
      // count a transition INTO membership: chat_member also fires for
      // promotions, restrictions and leaving, and greeting somebody for being
      // made an admin reads as a bot that is not paying attention.
      if (u.chat_member) {
        const cm = u.chat_member;
        if (!allowed(cm.chat)) continue;
        const was = cm.old_chat_member?.status;
        const now2 = cm.new_chat_member?.status;
        const inNow = now2 === 'member' || now2 === 'administrator' || now2 === 'creator';
        const inBefore = was === 'member' || was === 'administrator' || was === 'creator';
        const who = cm.new_chat_member?.user;
        if (inNow && !inBefore && who && !who.is_bot && who.id !== me.id && !joined(cm.chat.id, who.id)) {
          greet(cm.chat.id, [who]);
        }
        continue;
      }

      const msg = u.message || u.edited_message;
      if (!msg) continue;
      if (!allowed(msg.chat)) continue;

      // --- another bot said something ---------------------------------------
      // Kevin never REPLIES to a bot. Telegram's own guidance is that two bots
      // answering each other will do it forever at machine speed, so this reads
      // and records and says nothing back.
      if (fromOtherBot(msg, me)) {
        const key = `${msg.chat.id}:${msg.message_id}:${msg.edit_date || 0}`;
        if (seen(key)) continue;
        if (sniffing) { console.log(sniff(msg)); continue; }
        const board = parseLeaderboard(msg.text ?? msg.caption ?? '');
        if (board.length) {
          console.log(`leaderboard from @${msg.from.username}: ${board.length} rows`);
          // Recording only. Nothing is paid out on this yet, and it should not
          // be until the parser has been checked against real posts.
          for (const r of board) console.log(`   ${r.rank}. @${r.handle} ${r.score}`);
        }
        continue;
      }

      // Somebody joined. Never greet the bot's own arrival, and never greet a
      // bot — a group full of them would greet each other forever.
      const arrivals = (msg.new_chat_members || [])
        .filter((x) => x.id !== me.id && !x.is_bot && !joined(msg.chat.id, x.id));
      if (arrivals.length) greet(msg.chat.id, arrivals);

      if (!msg.text) continue;
      // Every human line keeps the room marked awake, whether or not it was
      // aimed at the bot — that is what the lift roll checks against.
      if (!msg.from?.is_bot) room(msg.chat.id).lastHuman = Date.now();
      if (!addressed(msg, me)) continue;

      const chatId = msg.chat.id;
      const now = Date.now();
      if (now - (lastReply.get(chatId) ?? 0) < MIN_GAP_MS) continue;
      lastReply.set(chatId, now);
      room(chatId).lastBot = now;

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

      // /welcometest — render a welcome to yourself, without waiting for a join.
      //
      // Welcomes are the one feature that cannot be checked by using the bot:
      // they only fire when somebody new arrives, and by then it is in front of
      // the group. Admins only, and it deliberately reuses greet() rather than
      // reimplementing it, so what you see is exactly what a real arrival gets
      // — same wording pool, same image, same buffering.
      if (cmd === 'welcometest') {
        // In a DM there are no administrators and the call just errors, so
        // check the chat type first rather than asking and swallowing it.
        let isAdmin = msg.chat.type === 'private';
        if (!isAdmin) {
          const admins = await tg(token, 'getChatAdministrators', { chat_id: msg.chat.id })
            .catch(() => []);
          isAdmin = admins.some((a) => a.user?.id === msg.from?.id);
        }
        if (!isAdmin) { await reply('Kevin only does that for the people who run the place.'); continue; }
        // Skip the ten-minute dedupe, or a second test in the same window is
        // silently swallowed and looks like the feature is broken.
        greeted.delete(`${msg.chat.id}:${msg.from.id}`);
        greet(msg.chat.id, [msg.from]);
        continue;
      }

      if (cmd === 'link') { await reply(await linkCode(token, msg)); continue; }
      if (cmd === 'top' || cmd === 'lifts') { await reply(render('gym', await top('gym'))); continue; }
      if (cmd === 'shifts' || cmd === 'topjob') { await reply(render('job', await top('job'))); continue; }
      if (cmd) {
        const canned = commandReply(cmd, config);
        if (canned) { await reply(canned); continue; }
      }

      // A COMMAND NEVER REACHES THE MODEL. parseCommand returns null when the
      // /cmd@suffix names some other bot, and commandReply returns nothing for a
      // command it does not know — and in both cases this fell through to the
      // model. So "/ca@anyone" answered from a model instead of from config,
      // defeating the one property /ca exists to have.
      if (/^\s*\//.test(msg.text || '')) {
        if (msg.chat.type === 'private') await reply(commandReply('help', config));
        continue;
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
        // Deterministic gate: see guardModelReply. A model that invents or is
        // talked into an address does not get to say it.
        const safe = guardModelReply(text, config.contract);
        if (safe.blocked) console.error('blocked model reply:', safe.blocked);
        await reply(safe.text);
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
