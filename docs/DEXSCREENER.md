# DEX Screener — token profile submission pack

Paste-ready copy, links and assets for the $KEVIN "Enhanced Token Info" submission.
Everything below is copy. Nothing here is code.

---

## 0. Where it goes

Token page (all three pools roll up here):

    https://dexscreener.com/robinhood/0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A

Chain id on DEX Screener is `robinhood`. Contract address to enter in the form:

    0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A

Verified live and indexed (checked 7 Sep 2026 via `api.dexscreener.com`):

| pool | poolId | status |
|---|---|---|
| KEVIN / KEK  | `0x2d36afcddd3abe0f09a560a45e19e6f709bcfd49d249116c2c471c0091dfd05b` | indexed |
| KEVIN / WETH | `0xd3ca7f46595df4eb7a3af7c12fdc0d7bd5bf7a2b98f1369282a278ef8283af63` | indexed |
| KEVIN / GME  | `0x3af7e5d7ef962f99c4bfa54285ee705c61e11ecbd42cf1ddaea240c4acf49743` | indexed |

All three currently return `info: null` — that is the empty profile this pack fills.
The submission is per **token**, not per pool, so one submission covers all three.

---

## 1. Description

### A — primary (316 chars)

```
I am Kevin. I work the fryer. I have WiFi. One of these is going to work out.

$KEVIN is a character on Robinhood Chain — original art, actual lore, and a Telegram that talks back. Three pools: WETH, KEK and GME. Launched on Kekfun. No roadmap, no promises, no shift covered. Just Kevin, being early about something.
```

### B — short (181 chars), if the field is tighter than expected

```
I am Kevin. I work the fryer. I have WiFi. One of these is going to work out.

Original art, real lore, and three pools — WETH, KEK and GME — on Robinhood Chain. Launched on Kekfun.
```

### C — one-liner (92 chars), for anywhere with a hard single-line limit

```
I work the fryer. I have WiFi. One of these is going to work out. $KEVIN on Robinhood Chain.
```

Sizing note: the longest description observed live in the DEX Screener token-profile
API is 589 chars, 90th percentile is 191, median 50. DEX Screener does not publish
the limit. A is safely inside the observed ceiling; B is around the 90th percentile.

---

## 2. Links

Enter exactly these. All three returned HTTP 200 on 7 Sep 2026.

| slot | value |
|---|---|
| Website | `https://iamkevin.lol` |
| Docs | `https://iamkevin.lol/docs` |
| Twitter / X | `https://x.com/Iamkevinonrh` |
| Telegram | `https://t.me/kevinRBH` |

The API stores known socials with a `type` (`twitter`, `telegram`, `discord`,
`instagram`) and everything else as a `label` + url pair, so "Website" and
"Docs" are labelled links, not typed ones. In the form that distinction is
just which row you fill.

`/docs` is served by `docs/index.html` — a real page, not a raw markdown file.
It resolves with or without the trailing slash.

Do **not** list: the launchpad, the block explorer, or a chart link. DEX Screener
renders those itself and a duplicate row looks like filler.

---

## 3. Images

Already in the repo at the right sizes. Nothing needs regenerating.

| slot | file | size | why it fits |
|---|---|---|---|
| Icon / logo | `assets/png/logo-512.png` | 512×512, 40 KB | DEX Screener serves the icon through `?width=64&height=64&fit=crop`, so it wants a square. 512 is oversized on purpose and downsamples clean. |
| Header / banner | `assets/png/header-1500x500.png` | 1500×500, 54 KB | The red script wordmark. Served through `?width=600&height=200&fit=crop` — exactly 3:1, so the crop takes nothing. Built from the owner's original by thresholding out the JPEG ringing, so the strokes stay crisp down at 600px. Meets the stated rules: 3:1, ≥600px wide, PNG, well under 4.5 MB. |
| Header — alternative | `assets/png/banner-1500x500.png` | 1500×500, 126 KB | The yellow-void banner with the character and WETH / KEK / GME. Busier at 600×200; use it if the header should carry the tagline rather than just the name. |
| Open Graph | usually not needed | — | For every profile sampled, DEX Screener generated the OG card itself from the token images (`cdn.dexscreener.com/token-images/og/...`). If the form offers a slot anyway, use `assets/png/og-1200x630.png` (1200×630, 122 KB). |

Fallbacks if a square with more face in it reads better at 64px:
`assets/png/pfp-1000.png` (1000×1000) or `assets/logo/image-512.png`.

DEX Screener's stated header rules, for the record: 3:1 aspect, minimum width
600px, png / jpg / webp / gif, maximum 4.5 MB.

DEX Screener does not publish max file sizes or accepted formats. All of the
above are PNG and none exceeds 130 KB, which is well under any plausible cap.

---

## 4. Cost and route

The paid route is the DEX Screener marketplace product "Enhanced Token Info":

    https://marketplace.dexscreener.com/product/token-info

Listed at **$299** at time of writing (shown as reduced from $499). Paid by
connecting a wallet or by card. That page does not publish the form's field
specs — the specs in §1 and §3 above are inferred from live profile data, not
quoted from docs.

Before paying, check whether Kekfun already pushes token metadata that
DEX Screener picks up for free. If the profile fills in on its own from the
launchpad, the $299 buys nothing you don't already have.

---

## 5. Rules for this copy — do not break these when editing

- **Never call it a floor.** Not in the bio, not in a reply, not in a tweet
  quoting the bio. See `docs/FLOOR.md`. The contract guarantees are one-sided
  and the bid side is small; "floor" promises something the code does not.
- **No price, no market cap, no dollar figures.** Same rule the bot runs under.
- **No returns, no targets, no "next 100x", no "guaranteed".**
- **No roadmap dates.** Kevin does not have a roadmap. That is the joke.
- **The GME round is not open** and must not appear in the bio.
  `js/config.js` has it as `confirmed: false` — the snapshot is taken and
  published at /claim, but nothing is deployed and there is no date. Kevin
  may hint at it in Telegram, in his voice. A token profile is not a hint,
  it is a claim.
- Third person is fine, first person is better. Kevin talks like Kevin.
