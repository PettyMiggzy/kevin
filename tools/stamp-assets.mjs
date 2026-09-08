#!/usr/bin/env node
// Version-stamp every local <script src> and <link href> in the site's HTML.
//
//   node tools/stamp-assets.mjs --check     # report, change nothing
//   node tools/stamp-assets.mjs             # rewrite the HTML in place
//
// WHY
//
// The HTML is served must-revalidate, so a browser always re-checks it. The
// JS and CSS it points at are served the same way — in theory. In practice an
// in-app browser (Telegram's, X's), a phone that has been offline, or a proxy
// that ignores must-revalidate will happily hand back yesterday's js/main.js
// under today's index.html. New markup plus old script is not "slightly
// stale": it is a page whose panels never fill in, which reads as broken and
// gives the reader nothing to act on.
//
// A content hash in the query string removes the question. Change a file and
// its URL changes with it, so there is no version of the browser's cache that
// can answer for it. Nothing changes if nothing changed, so re-running this is
// a no-op and a dirty tree means a real edit.
//
// RUN IT AFTER EDITING ANYTHING IN js/ OR css/.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// Every page a reader can land on. The gym and poker builds carry their own
// bundles and their own cache story, so they are left alone.
const PAGES = [
  'index.html', 'memes.html', 'dos.html',
  'claim/index.html', 'docs/index.html', 'docs/lore.html',
  'kit/index.html', 'world/index.html',
];

const hashOf = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 8);

let changed = 0, stamped = 0, missing = [];

for (const page of PAGES) {
  const abs = join(ROOT, page);
  if (!existsSync(abs)) { missing.push(page); continue; }
  const before = await readFile(abs, 'utf8');
  const dir = dirname(abs);

  // src="js/main.js"  href="../css/style.css"  — local, relative, no protocol.
  const re = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"]+?\.(?:js|css))(\?v=[0-9a-f]+)?(")/g;
  const jobs = [];
  let m;
  while ((m = re.exec(before)) !== null) {
    const url = m[2];
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) continue;
    jobs.push({ full: m[0], head: m[1], url, tail: m[4], had: m[3] || '' });
  }

  let after = before;
  for (const j of jobs) {
    const target = resolve(dir, j.url);
    if (!existsSync(target)) { missing.push(`${page} -> ${j.url}`); continue; }
    const v = await hashOf(target);
    const next = `${j.head}${j.url}?v=${v}${j.tail}`;
    if (next !== j.full) changed++;
    after = after.split(j.full).join(next);
    stamped++;
  }

  if (after !== before && !CHECK) await writeFile(abs, after);
  const note = after === before ? 'up to date' : (CHECK ? 'WOULD CHANGE' : 'rewritten');
  console.log(`  ${page.padEnd(20)} ${String(jobs.length).padStart(2)} asset(s)  ${note}`);
}

// The world's paintings are loaded by script, not by markup, so no <link> or
// <script> stamp reaches them. A cached downtown.jpg is the sign still reading
// "M" a day after it was changed to "Mc", with nothing on the page to say so.
const DATA = 'world/zones.js';
{
  const abs = join(ROOT, DATA);
  if (existsSync(abs)) {
    const before = await readFile(abs, 'utf8');
    let after = before;
    const re = /(art:\s*')([^']+?\.(?:jpg|jpeg|png|webp))(\?v=[0-9a-f]+)?(')/g;
    const jobs = [];
    let m;
    while ((m = re.exec(before)) !== null) jobs.push({ full: m[0], head: m[1], url: m[2], tail: m[4] });
    for (const j of jobs) {
      const target = resolve(join(ROOT, 'world'), j.url);
      if (!existsSync(target)) { missing.push(`${DATA} -> ${j.url}`); continue; }
      const next = `${j.head}${j.url}?v=${await hashOf(target)}${j.tail}`;
      if (next !== j.full) changed++;
      after = after.split(j.full).join(next);
      stamped++;
    }
    if (after !== before && !CHECK) await writeFile(abs, after);
    console.log(`  ${DATA.padEnd(20)} ${String(jobs.length).padStart(2)} painting(s)  ` +
      (after === before ? 'up to date' : (CHECK ? 'WOULD CHANGE' : 'rewritten')));
  }
}

if (missing.length) {
  console.log('');
  for (const x of missing) console.log(`  MISSING  ${x}`);
}
console.log('');
console.log(`${stamped} reference(s) stamped, ${changed} changed`);
if (CHECK && changed) {
  console.log('Run without --check to write them.');
  process.exit(1);
}
