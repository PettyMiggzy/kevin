#!/usr/bin/env node
// Publish the animated pack to Telegram.
//
// Needs a bot token — a user id alone cannot create a pack, the Bot API
// requires a bot to own it. Make one with @BotFather (/newbot), then:
//
//   TG_BOT_TOKEN=123:ABC node tools/publish-stickers.mjs
//   TG_BOT_TOKEN=123:ABC node tools/publish-stickers.mjs --add   # add to existing
//
// Name slugs to act on just those — otherwise it takes every webm in the
// directory, which on --add would re-add the ones already in the pack:
//
//   TG_BOT_TOKEN=123:ABC node tools/publish-stickers.mjs --add fried on-break
//
// The pack is created for TG_USER_ID, so it shows up as yours and you can
// manage it in @Stickers afterwards.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets/stickers/animated');

const TOKEN = process.env.TG_BOT_TOKEN;
const USER_ID = process.env.TG_USER_ID || '6820752140';
// The live pack is https://t.me/addstickers/kevin_by_robinlabsbot — this has
// to match it exactly or addStickerToSet comes back STICKERSET_INVALID.
const NAME = process.env.TG_PACK_NAME || 'kevin';
const TITLE = process.env.TG_PACK_TITLE || 'KEVIN';

// Emoji shown under each sticker in the picker. Order matches the slugs.
const EMOJI = {
  wagmi: '🤝', gm: '☕', lfg: '🚀', buy: '🟢', 'send-it': '🔥',
  hodl: '💎', ngmi: '😹', rekt: '💀', wen: '⏰', 'pump-it': '📈',
  'printer-go-brrr': '🖨️', 'ceo-of-chaos': '👑',
  // the fryer set
  'time-to-cook': '🍟', 'let-him-cook': '🍳', fried: '🥵',
  'shift-over': '🏃', 'order-up': '🛎️', 'on-break': '📱',
};

// Telegram rejects a video sticker over 256KB, so catch it here rather than
// halfway through uploading a batch.
const MAX_BYTES = 256 * 1024;

const api = async (method, form, query = '') => {
  // A POST with an empty body comes back empty through the proxy, so calls
  // without parameters go as GET.
  const opts = form ? { method: 'POST', body: form } : { method: 'GET' };
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}${query ? `?${query}` : ''}`, opts);
  const text = await r.text();
  if (!text) throw new Error(`${method}: empty response (HTTP ${r.status})`);
  const j = JSON.parse(text);
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
};

async function main() {
  if (!TOKEN) {
    console.error(
      'No TG_BOT_TOKEN.\n\n' +
      '  1. Open @BotFather on Telegram, send /newbot, follow the prompts\n' +
      '  2. It gives you a token like 123456:ABC-DEF...\n' +
      '  3. TG_BOT_TOKEN=<that> node tools/publish-stickers.mjs\n\n' +
      `The pack is created for user ${USER_ID} and will be yours to manage.`
    );
    process.exit(1);
  }

  const me = await api('getMe');
  // Telegram requires the pack short name to end in _by_<botusername>
  const shortName = `${NAME}_by_${me.username}`;

  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let files = (await readdir(DIR)).filter((f) => f.endsWith('.webm')).sort();
  if (only.length) {
    const missing = only.filter((slug) => !files.includes(`${slug}.webm`));
    if (missing.length) throw new Error(`no webm for: ${missing.join(', ')}`);
    files = only.map((slug) => `${slug}.webm`);
  }
  if (!files.length) throw new Error(`no .webm in ${DIR}`);

  const add = process.argv.includes('--add');
  const replace = process.argv.includes('--replace');
  console.log(`bot @${me.username} · pack ${shortName} · ${files.length} stickers\n`);

  // uploadStickerFile first, so each sticker is referenced by file_id
  const uploaded = [];
  for (const f of files) {
    const slug = basename(f, '.webm');
    const bytes = await readFile(join(DIR, f));
    if (bytes.length > MAX_BYTES) {
      throw new Error(
        `${slug} is ${(bytes.length / 1024).toFixed(0)}KB, over Telegram's 256KB ` +
        'ceiling — re-cut it smaller before publishing'
      );
    }
    const form = new FormData();
    form.append('user_id', USER_ID);
    form.append('sticker_format', 'video');
    form.append('sticker', new Blob([bytes], { type: 'video/webm' }), f);
    const res = await api('uploadStickerFile', form);
    uploaded.push({ slug, file_id: res.file_id });
    console.log(`  uploaded ${slug}`);
  }

  const stickerList = uploaded.map((u) => ({
    sticker: u.file_id,
    format: 'video',
    emoji_list: [EMOJI[u.slug] || '🔴'],
  }));

  if (replace) {
    // Swap a sticker's file in place. delete+add would work too and would
    // reshuffle the pack; anyone who has it installed sees the order change.
    const set = await api('getStickerSet', null, `name=${shortName}`);
    const byEmoji = new Map();
    for (const st of set.stickers) byEmoji.set(st.emoji, st.file_id);
    for (const u of uploaded) {
      const old = byEmoji.get(EMOJI[u.slug]);
      if (!old) { console.log(`  ${u.slug.padEnd(16)} not in the pack, skipped`); continue; }
      const form = new FormData();
      form.append('user_id', USER_ID);
      form.append('name', shortName);
      form.append('old_sticker', old);
      form.append('sticker', JSON.stringify({ sticker: u.file_id, format: 'video', emoji_list: [EMOJI[u.slug]] }));
      await api('replaceStickerInSet', form);
      console.log(`  ${u.slug.padEnd(16)} replaced`);
    }
    console.log(`\nupdated: https://t.me/addstickers/${shortName}`);
  } else if (!add) {
    const form = new FormData();
    form.append('user_id', USER_ID);
    form.append('name', shortName);
    form.append('title', TITLE);
    form.append('stickers', JSON.stringify(stickerList));
    await api('createNewStickerSet', form);
    console.log(`\ncreated: https://t.me/addstickers/${shortName}`);
  } else {
    for (const s of stickerList) {
      const form = new FormData();
      form.append('user_id', USER_ID);
      form.append('name', shortName);
      form.append('sticker', JSON.stringify(s));
      await api('addStickerToSet', form);
    }
    console.log(`\nadded to: https://t.me/addstickers/${shortName}`);
  }
}

await main();
