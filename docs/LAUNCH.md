# LAUNCH CHECKLIST

Everything that has to be true before the auction opens, in the order it has
to be true.

---

## 1. The token image (kekfun needs a URL, not a file)

The launcher's **IMAGE URL** field wants a publicly reachable square PNG. Once
this branch is merged and Pages is live, use:

```
https://iamkevin.lol/assets/png/logo-512.png
```

Before DNS resolves, this works immediately off GitHub:

```
https://raw.githubusercontent.com/PettyMiggzy/kevin/main/assets/png/logo-512.png
```

Both are the badge — head in a circle on the void, 512×512, reads at 24px in a
token list. `logo-1024.png` is there if anything wants larger.

## 2. Ship the site

1. Merge this branch to the default branch.
2. Settings → Pages → **Deploy from a branch**, branch = default, folder = `/`.
3. `CNAME` is already committed with `iamkevin.lol`, so add the DNS records at
   your registrar:
   - `A` records for the apex → `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
   - `CNAME` for `www` → `pettymiggzy.github.io`
4. Wait for the certificate, then tick **Enforce HTTPS**.

## 3. Fill in `js/config.js`

This is the only file that changes on launch day. Everything left `null`
renders as "TBA" rather than a placeholder that looks like a real number —
keep it that way until each value is real.

- [ ] `links.telegram` — the group
- [ ] `links.x` — the account
- [ ] `auction.startsAt` / `auction.endsAt` — ISO-8601 **with timezone**
      (`2026-03-04T18:00:00Z`), which switches the countdown on
- [ ] `burn.wallet` — **publish this before the auction opens**, not after
- [ ] `contract` — the moment the token address exists
- [ ] `links.chart` — once it's graduated and trading
- [ ] `pools[].weight` — only if the composition changes from 45 / 40 / 15

## 4. Brand accounts

- [ ] X avatar → `assets/png/pfp-1000.png`
- [ ] X header → `assets/png/banner-1500x500.png`
- [ ] Telegram group photo → `assets/png/logo-512.png`
- [ ] Static sticker pack → @Stickers → `/newpack`, upload
      `assets/stickers/*.png` (18, transparent, 512×512)
- [ ] Animated pack → @Stickers → `/newvideopack`, upload
      `assets/stickers/animated/*.webm` (8, VP9 + alpha, all under 256KB)
- [ ] Pin the spot (`assets/video/kevin-spot.mp4`) in the group

## 5. The burn commitment

The site states this publicly, so it has to actually happen or the whole
premise is dead:

- [ ] Publish the bidding wallet **before** the auction opens
- [ ] Bid from that wallet only
- [ ] After settle, claim daily across the 30-day vest
- [ ] Send each claim to `0x…dEaD` and post the hash
- [ ] Add each one to `burn.receipts` in `config.js` as
      `{ date: '2026-03-09', amount: '4,166,666', tx: 'https://robinhoodchain.blockscout.com/tx/0x…' }`
      — the burn log on the site renders straight from that array
- [ ] Update `burn.burned` with the running total

Thirty days, thirty receipts. If one gets missed, say so publicly rather than
quietly skipping it — a religion built on receipts dies the first time someone
fakes one.

## 6. Protocol facts worth knowing before you press create

From the kekfun docs — these are contract-enforced, not preferences:

| | |
|---|---|
| Total supply | 1,000,000,000 (hard cap, 18 decimals) |
| Project split | 40% sold · 60% locked LP · **0% creator** |
| Sale | 4 days × 10% of supply per day |
| Vest | 30-day linear from settle, partial claims fine |
| KEK floor | ≥10% of composition, always |
| Max legs | 8 |
| Chain | Robinhood Chain · 4663 |
| LP | Full-range Uniswap V4, locked forever in LPLocker |
| Fees | Trading fees on locked positions go to the creator via `claimFees` |

Two things worth internalising because people will ask:

- **Allocations move until the window shuts.** Bid early and get outbid later
  and your allocation shrinks. That's the VRGDA, it's the same for everybody,
  and it's the reason there are no snipers.
- **Dead days aren't wasted.** A day with zero deposits folds its tranche into
  locked LP instead of minting claims. Quiet windows make the pool deeper.

## 7. Before you post anything

- [ ] Read `docs/BRAND.md` → Voice. No exclamation marks, no price talk, no
      promises.
- [ ] The contract address goes in the group **first**. Everything else is a
      scam until it matches.
- [ ] Nobody explains the Robinhood joke. Rule three.
