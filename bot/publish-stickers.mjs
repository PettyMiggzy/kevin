#!/usr/bin/env node
// Publish the sticker and custom-emoji packs to Telegram.
//
//   node bot/publish-stickers.mjs --user 123456789 --dry
//   node bot/publish-stickers.mjs --user 123456789
//   node bot/publish-stickers.mjs --user 123456789 --emoji
//   node bot/publish-stickers.mjs --user 123456789 --static
//   node bot/publish-stickers.mjs --user 123456789 --replace fried,wagmi
//   node bot/publish-stickers.mjs --user 123456789 --static --animate
//
// --user is the numeric id of the person who will OWN the set. Telegram requires
// a real user; the bot only gets to edit it afterwards. Get yours by messaging
// the bot and reading `journalctl -u kevin-bot`, or from @userinfobot.
//
// Only stickers listed in js/config.js are published, so the pack and the site
// can never disagree about what exists.
//
// --emoji publishes the same characters as a custom-emoji set: same technology,
// 100x100 instead of 512x512, and a quarter of the file budget. Note that
// custom emoji can only be USED by Telegram Premium accounts — everyone can
// install the set, but a free account sees the fallback emoji instead.
//
// --replace swaps stickers that are already in the live set rather than adding
// duplicates. addStickerToSet is only a no-op for bytes that are already there;
// a re-encoded file is different bytes, so re-running the publisher after
// editing art appends a second copy instead of updating the first.
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, readdirSync } from 'node:fs';
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
const EMOJI_SET = has('emoji');
const STATIC_SET = has('static');
// Swap the Todd-drawn stills for their rigged versions, in place, so the pack
// keeps its link and everyone who installed it gets the animation. A set may
// hold both formats at once — verified against the live API, not assumed.
const ANIMATE = has('animate');
const USER = flag('user');
const REPLACE = (flag('replace') || '').split(',').map((s) => s.trim()).filter(Boolean);
const TITLE = flag('title', EMOJI_SET ? 'Kevin Emoji' : STATIC_SET ? 'Kevin Classic' : 'Kevin');

// Telegram's two budgets. A custom emoji is a twenty-sixth of a sticker's
// pixels but gets a quarter of its bytes, so the ladder in tools/build-emoji.mjs
// has to work much harder than the one in tools/render-sticker.mjs.
//
// The static set is the Todd-drawn art: on-model, and the only Kevin in the
// project that never went near a video model. It is not on the site, so its
// roster comes from the directory tools/build-static-stickers.mjs writes rather
// than from the manifest — the tool decides what is on-model, and the publisher
// ships exactly what the tool made.
const KIND = EMOJI_SET
  ? { dir: 'assets/emoji/animated', ext: 'webm', mime: 'video/webm', format: 'video',
      limit: 64, base: 'kevinemoji', type: 'custom_emoji' }
  : STATIC_SET
  ? { dir: 'assets/stickers/static', ext: 'webp', mime: 'image/webp', format: 'static',
      limit: 512, base: 'kevinclassic', type: 'regular', fromDir: true,
      // The roster still comes from the static directory, because that is what
      // fixes each sticker's POSITION in the live set. Only the bytes change.
      ...(ANIMATE ? { swapDir: 'assets/stickers/animated', swapExt: 'webm',
                      swapMime: 'video/webm', swapFormat: 'video', swapLimit: 256 } : {}) }
  : { dir: 'assets/stickers/animated', ext: 'webm', mime: 'video/webm', format: 'video',
      limit: 256, base: 'kevin', type: 'regular' };

/** An emoji per sticker. Telegram wants 1-20; one apiece is plenty. */
const EMOJI = {
  'walk-front': ['🚶'], 'walk-back': ['🚶'], 'walk-left': ['🚶'],
  'walk-right': ['🚶'], 'walk-diagonal': ['🚶'],
  wagmi: ['👍'], gm: ['☕'], lfg: ['🚀'], buy: ['🟢'], 'send-it': ['🔥'],
  hodl: ['💎'], ngmi: ['😂'], rekt: ['💀'], wen: ['⏰'], 'pump-it': ['📈'],
  'printer-go-brrr': ['💸'], 'ceo-of-chaos': ['👑'], 'time-to-cook': ['🍟'],
  'let-him-cook': ['🔥'], fried: ['😵'],

  // The Todd-drawn static set.
  'gym-bench': ['🏋'], 'gym-curl': ['💪'], 'gym-deadlift': ['🏋'],
  'gym-flex': ['💪'], 'gym-pullup': ['🤸'], 'gym-run': ['🏃'],
  'gym-shake': ['🥤'], 'gym-spot': ['🤝'], 'gym-squat': ['🦵'],
  'gym-wrecked': ['😵'],
  'kek-flex': ['🙌'], 'kek-gm': ['☕'], 'kek-hodl': ['💎'], 'kek-laugh': ['😂'],
  'kek-moon': ['🚀'], 'kek-power': ['⚡'], 'kek-rain': ['🌧'], 'kek-snack': ['😋'],
  'kek-spin': ['🪙'], 'kek-stack': ['🤑'], 'kevin-great': ['🇺🇸'],
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
  form.append('sticker_format', ANIMATE ? KIND.swapFormat : KIND.format);
  form.append('sticker', new Blob([await readFile(path)], { type: ANIMATE ? KIND.swapMime : KIND.mime }),
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
  const slugs = KIND.fromDir
    ? readdirSync(join(ROOT, KIND.dir)).filter((f) => f.endsWith(`.${KIND.ext}`))
        .map((f) => f.replace(`.${KIND.ext}`, '')).sort()
    : (await loadConfig()).animated.map((a) => a.slug);

  // Check every file before touching Telegram: half a pack is worse than none,
  // and a rejection partway through leaves a set that has to be deleted by hand.
  const files = [];
  const problems = [];
  for (const slug of slugs) {
    const p = join(ROOT, KIND.dir, `${slug}.${KIND.ext}`);
    if (!existsSync(p)) { problems.push(`${slug}: no webm`); continue; }
    const kb = statSync(p).size / 1024;
    if (kb > KIND.limit) problems.push(`${slug}: ${kb.toFixed(0)}KB, over Telegram's ${KIND.limit}KB`);
    if (!EMOJI[slug]) problems.push(`${slug}: no emoji assigned`);
    files.push({ slug, path: p, kb });
  }
  if (slugs.length > 50) problems.push(`${slugs.length} stickers; a set takes at most 50 initially`);

  console.log(`${files.length} ${EMOJI_SET ? 'emoji' : 'sticker'}(s) from ` +
    `${KIND.fromDir ? KIND.dir : 'the manifest'}`);
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

  // Env first, so the token can be supplied for one run without ever being
  // written to disk in a public repo.
  const token = (process.env.TELEGRAM_TOKEN
    || await readFile(join(ROOT, 'bot/.telegram.key'), 'utf8')).trim();
  const me = await tg(token, 'getMe');
  const name = setName(KIND.base, me.username);
  console.log(`\nset: ${name}  (t.me/addstickers/${name})`);

  let live = null;
  try { live = await tg(token, 'getStickerSet', { name }); }
  catch { live = null; }

  // Swap art that is already in the set. The set was created in manifest order
  // and the bot is the only thing that edits it, so position i is slug i — but
  // check that before trusting it, because replacing the wrong sticker is not
  // something the API will undo.
  // --animate swaps every sticker that has a rigged version. One that has none
  // — no limb separates from the body on it — is left as the still it is.
  if (ANIMATE) {
    if (!live) throw new Error(`${name} does not exist yet`);
    if (live.stickers.length !== files.length) {
      throw new Error(`set has ${live.stickers.length} but the manifest has ${files.length}; ` +
        `positions cannot be trusted, so nothing was replaced`);
    }
    let done = 0, skipped = [];
    for (let i = 0; i < files.length; i++) {
      const slug = files[i].slug;
      const anim = join(ROOT, KIND.swapDir, `${slug}.${KIND.swapExt}`);
      if (!existsSync(anim)) { skipped.push(slug); continue; }
      const kb = statSync(anim).size / 1024;
      if (kb > KIND.swapLimit) { skipped.push(`${slug} (${kb.toFixed(0)}KB)`); continue; }
      process.stdout.write(`  animating ${slug}…`);
      const fileId = await upload(token, USER, anim);
      await tg(token, 'replaceStickerInSet', {
        user_id: Number(USER), name,
        old_sticker: live.stickers[i].file_id,
        sticker: { sticker: fileId, format: KIND.swapFormat, emoji_list: EMOJI[slug] },
      });
      console.log(`\r  animated  ${slug}       `);
      done++;
    }
    console.log(`\nanimated ${done} in ${name}` +
      (skipped.length ? `; left as stills: ${skipped.join(', ')}` : ''));
    console.log(`\nhttps://t.me/addstickers/${name}`);
    return;
  }

  if (REPLACE.length) {
    if (!live) throw new Error(`${name} does not exist yet — publish it before replacing`);
    if (live.stickers.length !== files.length) {
      throw new Error(`set has ${live.stickers.length} stickers but the manifest has ` +
        `${files.length}; positions cannot be trusted, so nothing was replaced`);
    }
    for (const slug of REPLACE) {
      const i = files.findIndex((f) => f.slug === slug);
      if (i === -1) throw new Error(`${slug} is not in the manifest`);
      process.stdout.write(`  replacing ${slug}…`);
      const fileId = await upload(token, USER, files[i].path);
      await tg(token, 'replaceStickerInSet', {
        user_id: Number(USER), name,
        old_sticker: live.stickers[i].file_id,
        sticker: { sticker: fileId, format: KIND.format, emoji_list: EMOJI[slug] },
      });
      console.log(`\r  replaced  ${slug}       `);
    }
    console.log(`\nreplaced ${REPLACE.length} in ${name}`);
    console.log(`\nhttps://t.me/addstickers/${name}`);
    return;
  }

  const uploaded = [];
  for (const f of files) {
    process.stdout.write(`  uploading ${f.slug}…`);
    uploaded.push({ slug: f.slug, fileId: await upload(token, USER, f.path) });
    console.log(`\r  uploaded  ${f.slug}       `);
  }

  const asInput = (u) => ({ sticker: u.fileId, format: KIND.format, emoji_list: EMOJI[u.slug] });
  if (!live) {
    await tg(token, 'createNewStickerSet', {
      user_id: Number(USER), name, title: TITLE,
      sticker_type: KIND.type,
      stickers: uploaded.map(asInput),
    });
    console.log(`\ncreated with ${uploaded.length} ${EMOJI_SET ? 'emoji' : 'stickers'}`);
  } else {
    // Adding a sticker that is byte-identical to one already in the set is a
    // no-op at Telegram's end, so re-running is safe.
    for (const u of uploaded) {
      await tg(token, 'addStickerToSet', { user_id: Number(USER), name, sticker: asInput(u) });
    }
    console.log(`\nset already existed; added/refreshed ${uploaded.length}`);
  }
  console.log(`\nhttps://t.me/addstickers/${name}`);
}

await main();
