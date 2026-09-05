#!/usr/bin/env node
// Publish the sticker pack to Telegram.
//
//   node bot/publish-stickers.mjs --user 123456789 --dry
//   node bot/publish-stickers.mjs --user 123456789
//
// --user is the numeric id of the person who will OWN the set. Telegram requires
// a real user; the bot only gets to edit it afterwards. Get yours by messaging
// the bot and reading `journalctl -u kevin-bot`, or from @userinfobot.
//
// Only stickers listed in js/config.js are published, so the pack and the site
// can never disagree about what exists.
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Reuse the loader the bot already uses. Writing a second one is how this got a
// bug on its first run: config.js assigns window.KEVIN, it does not export.
import { loadConfig } from './brief.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const DRY = has('dry');
const USER = flag('user');
const TITLE = flag('title', 'Kevin');

/** An emoji per sticker. Telegram wants 1-20; one apiece is plenty. */
const EMOJI = {
  'walk-front': ['🚶'], 'walk-back': ['🚶'], 'walk-left': ['🚶'],
  'walk-right': ['🚶'], 'walk-diagonal': ['🚶'],
  wagmi: ['👍'], gm: ['☕'], lfg: ['🚀'], buy: ['🟢'], 'send-it': ['🔥'],
  hodl: ['💎'], ngmi: ['😂'], rekt: ['💀'], wen: ['⏰'], 'pump-it': ['📈'],
  'printer-go-brrr': ['💸'], 'ceo-of-chaos': ['👑'], 'time-to-cook': ['🍟'],
  'let-him-cook': ['🔥'], fried: ['😵'],
};

async function tg(token, method, params) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const b = await r.json().catch(() => ({}));
  if (!b.ok) throw new Error(`${method}: ${b.description || r.status}`);
  return b.result;
}

/** Multipart, because animated and video stickers cannot be sent by URL. */
async function upload(token, userId, path) {
  const form = new FormData();
  form.append('user_id', String(userId));
  form.append('sticker_format', 'video');
  form.append('sticker', new Blob([await readFile(path)], { type: 'video/webm' }),
    path.split('/').pop());
  const r = await fetch(`https://api.telegram.org/bot${token}/uploadStickerFile`, {
    method: 'POST', body: form,
  });
  const b = await r.json().catch(() => ({}));
  if (!b.ok) throw new Error(`uploadStickerFile(${path.split('/').pop()}): ${b.description || r.status}`);
  return b.result.file_id;
}

/**
 * The set's short name. Telegram requires it to end in _by_<bot_username>, to
 * start with a letter, and to contain no consecutive underscores — a name that
 * breaks any of those is rejected only once everything has been uploaded.
 */
function setName(base, botUsername) {
  const name = `${base}_by_${botUsername}`;
  const ok = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && !/__/.test(name);
  if (!ok) throw new Error(`"${name}" is not a legal sticker set name`);
  return name;
}

async function main() {
  const config = await loadConfig();
  const slugs = config.animated.map((a) => a.slug);

  // Check every file before touching Telegram: half a pack is worse than none,
  // and a rejection partway through leaves a set that has to be deleted by hand.
  const files = [];
  const problems = [];
  for (const slug of slugs) {
    const p = join(ROOT, 'assets/stickers/animated', `${slug}.webm`);
    if (!existsSync(p)) { problems.push(`${slug}: no webm`); continue; }
    const kb = statSync(p).size / 1024;
    if (kb > 256) problems.push(`${slug}: ${kb.toFixed(0)}KB, over Telegram's 256KB`);
    if (!EMOJI[slug]) problems.push(`${slug}: no emoji assigned`);
    files.push({ slug, path: p, kb });
  }
  if (slugs.length > 50) problems.push(`${slugs.length} stickers; a set takes at most 50 initially`);

  console.log(`${files.length} sticker(s) from the manifest`);
  for (const f of files) console.log(`  ${f.slug.padEnd(18)} ${f.kb.toFixed(0).padStart(4)}KB  ${(EMOJI[f.slug] || ['?']).join('')}`);
  if (problems.length) {
    console.log('\nstopping — fix these first:');
    for (const p of problems) console.log(`  ! ${p}`);
    process.exit(1);
  }

  if (!USER) {
    console.log('\nno --user given, so nothing was uploaded.');
    console.log('Telegram needs the numeric id of the person who will own the set.');
    process.exit(DRY ? 0 : 1);
  }
  if (DRY) { console.log('\n--dry: everything checks out, nothing uploaded'); return; }

  const token = (await readFile(join(ROOT, 'bot/.telegram.key'), 'utf8')).trim();
  const me = await tg(token, 'getMe');
  const name = setName('kevin', me.username);
  console.log(`\nset: ${name}  (t.me/addstickers/${name})`);

  let exists = true;
  try { await tg(token, 'getStickerSet', { name }); }
  catch { exists = false; }

  const uploaded = [];
  for (const f of files) {
    process.stdout.write(`  uploading ${f.slug}…`);
    uploaded.push({ slug: f.slug, fileId: await upload(token, USER, f.path) });
    console.log(`\r  uploaded  ${f.slug}       `);
  }

  const asInput = (u) => ({ sticker: u.fileId, format: 'video', emoji_list: EMOJI[u.slug] });
  if (!exists) {
    await tg(token, 'createNewStickerSet', {
      user_id: Number(USER), name, title: TITLE,
      stickers: uploaded.map(asInput),
    });
    console.log(`\ncreated with ${uploaded.length} stickers`);
  } else {
    // Adding a sticker that is byte-identical to one already in the set is a
    // no-op at Telegram's end, so re-running is safe.
    for (const u of uploaded) {
      await tg(token, 'addStickerToSet', { user_id: Number(USER), name, sticker: asInput(u) });
    }
    console.log(`\nset already existed; added/refreshed ${uploaded.length} stickers`);
  }
  console.log(`\nhttps://t.me/addstickers/${name}`);
}

await main();
