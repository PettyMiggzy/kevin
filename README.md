# KEVIN

**Told no. Stayed anyway.**

Brand, art system, sticker packs, launch spot and website for Kevin — a meme
coin launching through the [kekfun](https://kekfun.xyz) launchpad on Robinhood
Chain.

Everything here is generated from code. No image models, no stock assets, no
licensing questions: the character is built from vector primitives in
`tools/`, so any mood, prop or caption is a few lines away and re-running the
generator produces byte-identical output.

![The Kevin art system](docs/preview.png)

- **Site** → [pettykev.fun](https://pettykev.fun)
- **Lore** → [`docs/LORE.md`](docs/LORE.md) — read this before writing a single word of copy
- **Brand rules** → [`docs/BRAND.md`](docs/BRAND.md)
- **Launch checklist** → [`docs/LAUNCH.md`](docs/LAUNCH.md)

---

## Run the site

It's static — no build step, no dependencies, no framework.

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Open `index.html` directly and it works too, though the download attributes
behave better over HTTP.

## Change launch details

**Edit `js/config.js` and nothing else.** Contract address, socials, auction
dates, pool weights, burn receipts and ticker lines all live there. Anything
left `null` renders as "TBA" on the page rather than a made-up number — that
is deliberate, so please keep it that way.

```js
window.KEVIN = {
  contract: null,                    // paste the CA here; copy button enables itself
  auction: { startsAt: null, ... },  // ISO-8601 with a timezone; drives the countdown
  burn: { wallet: null, receipts: [] },
  pools: [ { key: 'weth', weight: 46 }, ... ],
};
```

## Regenerate the art

```bash
cd tools
npm install
node gen-art.mjs             # 18 characters, marks, coins, banner, OG card, stickers
node gen-video.mjs           # the 14s spot + looping mp4/gif
node gen-stickers-anim.mjs   # 8 animated Telegram stickers (webm + gif)
```

Rendering uses headless Chromium via `playwright-core`. On a machine without
the preinstalled browser, point it at your own:

```bash
CHROMIUM_PATH=/path/to/chrome node gen-art.mjs
FFMPEG_PATH=/path/to/ffmpeg  node gen-video.mjs
```

`gen-video.mjs` needs an ffmpeg with libx264 and libvpx-vp9. The one bundled
with Playwright is VP8-only and won't do — install a normal build.

### Adding a new Kevin

Moods and props compose, so most new characters are one line in the `CAST`
array in `tools/gen-art.mjs`:

```js
{ slug: 'ngmi', name: 'Ngmi Kevin', caption: 'NGMI', eyes: 'x', mouth: 'flat' }
```

Available `eyes`: `normal · side · laser · x · closed · wide · derp · cry ·
money · spiral`
Available `mouth`: `tri · big · flat · smirk · frown · drool · o · none`
Available `props`: `arms · shades · chain · brain · think · coffee · diamond`

New expressions go in `tools/lib/kevin-vector.mjs`. Keep the wonk — read the
First Law in the lore before you straighten anything.

## Layout

```
index.html            the whole site, one page
css/style.css         design system
js/config.js          ← every launch value lives here
js/main.js            grudge clock, visitor memory, countdowns, sticker grids
assets/art/           source SVGs — infinitely scalable, print safe
assets/png/           rasters: PFPs, banner, OG card, favicons, coins
assets/stickers/      18 static stickers, transparent 512×512
assets/stickers/animated/  8 animated: .webm (Telegram) + .gif (X, Discord)
assets/video/         the 14s spot, the 4s loop
assets/fonts/         self-hosted woff2 — no third-party requests
tools/                the generators
docs/                 lore, brand rules, launch checklist
```

## Deploy

The site is plain static files at the repo root, so anything works. For GitHub
Pages: Settings → Pages → deploy from branch, root folder. `CNAME` already
points at `pettykev.fun`; set the DNS records and Pages picks it up.

## Licence

Code in `tools/` is MIT. **The art is public domain — take it, edit it, print
it, sell it, draw him worse.** He was made by a kid who didn't sign it, so
nobody here is going to start signing it now.
