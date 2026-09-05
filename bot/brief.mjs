// What Kevin knows, assembled from the repo at startup.
//
// Read from the real files rather than retyped here on purpose. The pool
// weights have already changed once in this project's life, and a bot
// confidently quoting last week's numbers in the official group is worse than
// a bot that says nothing. js/config.js is the single source the site renders
// from; this reads the same file, so the two cannot disagree.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInNewContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * js/config.js is a browser file — it assigns to `window`, it does not export.
 * Rather than keep a second copy in sync, run it against a fake window and take
 * the object back out.
 */
export async function loadConfig() {
  const src = await readFile(join(ROOT, 'js/config.js'), 'utf8');
  const sandbox = { window: {} };
  createContext(sandbox);
  runInNewContext(src, sandbox);
  return sandbox.window.KEVIN;
}

const fmt = (v, fallback = 'not published yet') =>
  v === null || v === undefined || v === '' ? fallback : String(v);

/** Is the contract actually trading yet? */
export const contractLive = (c) =>
  Boolean(c.contract) && (!c.contractLiveAt || Date.now() >= Date.parse(c.contractLiveAt));

/**
 * The address exists before it trades, and those are different facts. Stating
 * only the address for three days would have people buying at a contract that
 * is not listed anywhere.
 */
function contractNote(c) {
  if (!c.contract || contractLive(c)) return '';
  const when = new Date(c.contractLiveAt).toUTCString();
  return `\n  IT IS NOT LIVE YET. It starts trading ${when}. Until then the address is\n` +
    `  published only so people can check the real one against the fakes that\n` +
    `  will appear. Kevin must say it is not live and that nobody should try to\n` +
    `  buy yet.`;
}

/** The hard facts, stated plainly. The persona layer makes them sound like him. */
function factSheet(c) {
  const pools = c.pools.map((p) => `${p.ticker} ${p.weight}%`).join(' / ');
  const total = c.pools.reduce((n, p) => n + p.weight, 0);
  const m = c.mechanics;

  return `THE TOKEN
- Name: KEVIN. Chain: ${c.chain} (chain id ${m.chainId}).
- Launchpad: kekfun (${c.links.launchpad}). Auction type: ${m.auctionType}.
- Supply ${m.supply}. ${m.sold}% sold through the auction, ${m.lockedLp}% into
  locked LP, ${m.creator}% to the creator — zero, enforced by the token factory,
  not a promise anyone is making.
- Sale runs ${m.saleDays} days, ${m.perDay}% of supply released per day.
  Buyers vest linearly over ${m.vestDays} days from settle.
- Explorer: ${m.explorer}
- CONTRACT ADDRESS: ${fmt(c.contract)}${contractNote(c)}
- Auction opens: ${fmt(c.auction.startsAt, 'already open — it is live now')}
- Auction closes: ${fmt(c.auction.endsAt, 'not announced')}

THE POOLS (open when the auction settles)
- ${pools}  (adds up to ${total}%)
${c.pools.map((p) => `- ${p.ticker}, "${p.nickname}": ${p.note}`).join('\n')}

THE BURN
- The creator's own auction allocation gets bought and then destroyed.
- Bidding wallet: ${fmt(c.burn.wallet)}
- Burn address: ${c.burn.burnAddr}
- Burned so far: ${fmt(c.burn.burned, 'nothing published yet')}

WHERE TO GO
- Site: https://iamkevin.lol
- Game: https://iamkevin.lol/gym  (also /game and /play)
- Card room: https://iamkevin.lol/poker  (also inside the game, at Kevin's Crib)
- Telegram: ${c.links.telegram}
- X: ${c.links.x}
- Chart: ${fmt(c.links.chart, 'no chart yet — nothing is trading')}

THE CARD ROOM (a free browser game, built by the team)
- Texas hold'em at https://iamkevin.lol/poker. Six seats, works on a phone, free.
- The other five seats are Kevin characters with real playing styles — a rock
  folds weak hands, a caller pays you off, a shark bets hard, a maniac raises
  with anything.
- The chips are a score in the player's own browser. They are NOT the token and
  they touch no wallet and no chain.

THE GAME (free, in a browser, built by the team) — three places on one street
- It starts at KEVIN'S CRIB, his home. The card table is there, and the telly is
  a map that takes you to the other two.
- KEVIN'S GYM is down the street. McKEVIN'S is at the far end.
- Walk into it at https://iamkevin.lol/gym. Works on a phone. Free.
- Bench, dumbbells and treadmill. Five reps to a set; each rep is a timing hit —
  land the marker in the green band.
- Miss a day and muscle comes off. That is the whole point of it.
- Out the front: a market with a supplement stall and a crew stall, and
  McKevin's, where you clock in and serve six customers a shift.
- The $KEVIN you earn in the game is a SCORE. It is not the token, it is not
  supply, nothing in the game mints or moves anything on a chain.
- Progress saves in your own browser only. There is no account and no server.
- You play as Kevin. If you want, you can switch to any of the crew faces at
  the crew stall.

THINGS KEVIN SAYS (the lines on the site — Kevin may repeat these)
${c.ticker.map((t) => `- ${t}`).join('\n')}

STICKERS
- There is a Telegram sticker pack: ${c.animated.map((a) => a.name).join(', ')}.

KEVIN'S CREW (the NFT collection)
- 32x32 pixel characters, the people Kevin works with.
- NOT MINTED. There is no contract, no sale and no mint date. Anyone saying
  otherwise is lying.`;
}

/** The things Kevin must admit he does not know, listed so he cannot invent them. */
function unknowns(c) {
  const gaps = [];
  if (!c.contract) gaps.push('the contract address');
  if (c.contract && !contractLive(c)) gaps.push('where to buy it — it is not trading yet');
  if (!c.auction.endsAt) gaps.push('when exactly the auction closes');
  if (!c.burn.wallet) gaps.push('the burn wallet address');
  if (!c.links.chart) gaps.push('a chart link');
  gaps.push('the price, now or ever');
  gaps.push('when the NFTs mint');
  return gaps;
}

/**
 * Trim a markdown doc down to something worth spending context on. Keeps the
 * prose, drops the tables of file paths and the asset inventories — Kevin does
 * not need to know where the favicon lives to answer a question in a group.
 */
function trimDoc(md, maxChars) {
  const out = md
    .split('\n')
    .filter((l) => !/^\|/.test(l))            // markdown tables
    .filter((l) => !/^\s*```/.test(l) === false || true)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out.length > maxChars ? out.slice(0, maxChars) + '\n[...]' : out;
}

/** Everything Kevin knows, as one block of text for the system prompt. */
export async function buildBrief() {
  const config = await loadConfig();
  const [lore, launch, brand] = await Promise.all([
    readFile(join(ROOT, 'docs/LORE.md'), 'utf8').catch(() => ''),
    readFile(join(ROOT, 'docs/LAUNCH.md'), 'utf8').catch(() => ''),
    readFile(join(ROOT, 'docs/BRAND.md'), 'utf8').catch(() => ''),
  ]);

  const gaps = unknowns(config);
  const brief = `${factSheet(config)}

THINGS KEVIN DOES NOT KNOW — say so plainly, never guess:
${gaps.map((g) => `- ${g}`).join('\n')}

--- BACKGROUND: THE BOOK OF KEVIN ---
${trimDoc(lore, 5200)}

--- BACKGROUND: HOW THE LAUNCH WORKS ---
${trimDoc(launch, 3600)}

--- BACKGROUND: WHO KEVIN IS TO LOOK AT ---
${trimDoc(brand, 2200)}`;

  return { config, brief, gaps };
}
