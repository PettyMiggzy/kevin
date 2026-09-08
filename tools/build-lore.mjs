#!/usr/bin/env node
// Renders docs/LORE.md into docs/lore.html, in the site's own stylesheet.
//
//   node tools/build-lore.mjs
//
// WHY THIS EXISTS
//
// The front page has a button saying "Read the full Book of Kevin". It pointed
// at docs/LORE.md — a raw markdown file, which the host serves as
// text/markdown, which no browser renders. Chrome, Edge and Safari all DOWNLOAD
// it. The most quotable thing on the site was a file in somebody's Downloads
// folder.
//
// The markdown stays the source of truth, because that is what gets edited and
// what the bot and the brief quote from. This turns it into a page. Run it
// after editing the lore; the page says which commit it came from so a stale
// build is visible rather than silent.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs/LORE.md');
const OUT = join(ROOT, 'docs/lore.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The inline subset this document actually uses. Escaped first, always. */
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, t, h) => `<a href="${h}"${/^https?:/.test(h) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/** Slug for a heading, so every section is linkable. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function render(md) {
  const lines = md.split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  const flushList = (tag, items) =>
    out.push(`<${tag}>` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);

  while (i < lines.length) {
    const l = lines[i];

    if (l.startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre class="lore__pre"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const h = l.match(/^(#{1,4}) (.+)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = slug(text);
      if (level === 2) toc.push({ id, text });
      out.push(level === 1 ? '' : `<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (l.trim() === '---') { out.push('<hr>'); i++; continue; }

    if (l.startsWith('> ')) {
      const raw = [];
      while (i < lines.length && lines[i].startsWith('>')) raw.push(lines[i++].replace(/^>\s?/, ''));
      // Join each paragraph's lines BEFORE running inline formatting. A **bold**
      // span that opens on one line and closes on the next matches nothing when
      // the lines are formatted separately, and the asterisks reach the page.
      const paras = [];
      let cur = [];
      for (const t of raw) {
        if (t.trim() === '') { if (cur.length) { paras.push(cur.join(' ')); cur = []; } }
        else cur.push(t);
      }
      if (cur.length) paras.push(cur.join(' '));
      out.push(`<blockquote>${paras.map((t) => `<p>${inline(t)}</p>`).join('')}</blockquote>`);
      continue;
    }

    if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<div class="lore__scroll"><table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    if (/^[-*] /.test(l)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) items.push(lines[i++].slice(2));
      flushList('ul', items);
      continue;
    }

    if (/^\d+\. /.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s/, ''));
      flushList('ol', items);
      continue;
    }

    if (l.trim() === '') { i++; continue; }

    const para = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^(#{1,4} |> |```|\||[-*] |\d+\. )/.test(lines[i]) && lines[i].trim() !== '---') {
      para.push(lines[i++]);
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { body: out.filter(Boolean).join('\n'), toc };
}

const md = readFileSync(SRC, 'utf8');
const { body, toc } = render(md);
// The stylesheet reference is stamped here rather than by
// tools/stamp-assets.mjs, because this file is regenerated and would
// otherwise come back unstamped every time the lore is edited.
const cssVersion = createHash('sha256')
  .update(readFileSync(join(ROOT, 'css/style.css')))
  .digest('hex').slice(0, 8);
let stamp = 'uncommitted';
try { stamp = execSync('git log -1 --format=%h\\ %cs -- docs/LORE.md', { cwd: ROOT }).toString().trim(); } catch {}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KEVIN — The Book of Kevin</title>
<meta name="description" content="Who Kevin is, how he talks, what he believes, and the one line that is the whole thing. The full lore, in his own words.">
<link rel="icon" type="image/png" sizes="32x32" href="../assets/png/favicon-32.png">
<link rel="icon" type="image/png" sizes="512x512" href="../assets/png/favicon-512.png">
<link rel="apple-touch-icon" href="../assets/png/favicon-180.png">
<link rel="canonical" href="https://www.iamkevin.lol/docs/lore.html">
<meta property="og:type" content="article">
<meta property="og:url" content="https://www.iamkevin.lol/docs/lore.html">
<meta property="og:title" content="THE BOOK OF KEVIN">
<meta property="og:description" content="I am Kevin. I work the fryer. I have WiFi. One of these is going to work out.">
<meta property="og:image" content="https://www.iamkevin.lol/assets/png/og-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="KEVIN, arms folded, on brand yellow — iamkevin.lol">
<meta property="og:site_name" content="KEVIN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@Iamkevinonrh">
<meta name="twitter:image" content="https://www.iamkevin.lol/assets/png/og-1200x630.png">
<meta name="twitter:image:alt" content="KEVIN, arms folded, on brand yellow — iamkevin.lol">
<meta name="theme-color" content="#ffe500">
<!-- Both faces are used above the fold; discovering them only after the
     stylesheet parses swaps them in late and reflows the hero. -->
<link rel="preload" href="../assets/fonts/luckiest-guy-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="../assets/fonts/space-mono-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../css/style.css?v=${cssVersion}">
<style>
  .lore { max-width: 72ch; }
  .lore h2 {
    margin: 54px 0 6px; font-size: clamp(26px, 4.4vw, 40px);
    border-top: var(--edge) solid var(--ink); padding-top: 30px;
  }
  .lore h2:first-of-type { border-top: 0; padding-top: 0; margin-top: 8px; }
  .lore h3 { margin: 30px 0 4px; }
  .lore p { margin: 0 0 16px; }
  .lore blockquote {
    margin: 22px 0; padding: 18px 22px; background: var(--void);
    border: var(--edge) solid var(--ink); border-radius: var(--radius);
    box-shadow: var(--shadow); font-family: var(--display);
    font-size: clamp(19px, 3vw, 26px); line-height: 1.25;
  }
  .lore blockquote p { margin: 0 0 6px; }
  .lore blockquote p:last-child { margin: 0; }
  .lore__pre {
    background: var(--ink); color: var(--void); border-radius: var(--radius);
    padding: 18px 20px; overflow-x: auto; font-size: 14px; line-height: 1.7;
  }
  .lore hr { border: 0; border-top: 3px dashed rgba(0,0,0,.3); margin: 34px 0; }
  .lore table { border-collapse: collapse; width: 100%; font-size: 15px; }
  .lore th, .lore td { border: 3px solid var(--ink); padding: 10px 12px; text-align: left; }
  .lore th { background: var(--ink); color: var(--void); font-family: var(--display); }
  /* A wide table must scroll inside its own box, never the page. */
  .lore__scroll { overflow-x: auto; margin: 20px 0; }
  .lore__toc { list-style: none; margin: 0; padding: 0; }
  .lore__toc li { border-bottom: 2px dashed rgba(0,0,0,.25); }
  .lore__toc a { display: block; padding: 10px 4px; text-decoration: none; font-weight: 700; }
  .lore__toc a:hover { background: var(--cream); }
  .built { font-size: 12px; opacity: .6; letter-spacing: .1em; text-transform: uppercase; }
</style>
</head>
<body>

<nav class="nav">
  <div class="wrap nav__inner">
    <a class="nav__brand" href="../">
      <img src="../assets/png/favicon-180.png" alt="" width="46" height="46">
      <span>KEVIN</span>
    </a>
    <div class="nav__links">
      <a href="./">Docs</a>
      <a href="../world/">World</a>
      <a href="../memes.html">Memes</a>
      <a href="../#burn">Burns</a>
    </div>
    <div class="nav__social">
      <a class="btn btn--sm btn--ghost" href="https://t.me/kevinRBH" target="_blank" rel="noopener">Telegram</a>
    </div>
  </div>
</nav>

<header class="hero">
  <div class="wrap lore">
    <p class="eyebrow">The lore, in full</p>
    <h1>The Book of Kevin</h1>
    <p class="hero__sub">
      Who he is, how he talks, what he believes, and the one line that is the
      whole thing. Take any of it. It is the same text the bot is built on.
    </p>
    <p class="built">Built from docs/LORE.md &middot; ${stamp}</p>
  </div>
</header>

<section class="section section--cream">
  <div class="wrap lore">
    <p class="eyebrow">Contents</p>
    <ul class="lore__toc">
${toc.map((t) => `      <li><a href="#${t.id}">${t.text}</a></li>`).join('\n')}
    </ul>
  </div>
</section>

<section class="section">
  <div class="wrap lore">
${body.split('\n').map((l) => '    ' + l).join('\n')}
  </div>
</section>

<section class="section section--ink">
  <div class="wrap lore">
    <p class="lead">This page is generated from <code>docs/LORE.md</code>. If you are quoting
    Kevin, quote that file — it is the one the bot, the brief and this page all read.</p>
    <p><a class="btn btn--sm" href="./">The documentation &rarr;</a>
       <a class="btn btn--sm btn--ghost" href="../world/">The world &rarr;</a></p>
  </div>
</section>

</body>
</html>
`;

writeFileSync(OUT, page);
console.log(`wrote ${OUT.replace(ROOT + '/', '')}  (${toc.length} sections, ${page.length} bytes)`);
