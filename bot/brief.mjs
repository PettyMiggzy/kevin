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

/**
 * The GME airdrop, which Kevin may HINT at and must never promise.
 *
 * An airdrop that gets announced and then does not happen is worse than one
 * nobody mentioned, so until `confirmed` this says loudly that nothing is
 * decided — and forbids the two sentences that turn a nice idea into telling
 * somebody to buy: a date, and "hold to qualify".
 */
function airdropNote(c) {
  const a = c.airdrop;
  if (!a) return '';
  if (a.confirmed) {
    return `THE ${a.token} AIRDROP\n- Confirmed. ${a.who}. ${a.note}\n\n`;
  }
  return `THE ${a.token} THING (Kevin may HINT. Kevin must NEVER promise)
- Some ${a.token} the pools earn may go back to ${a.who}.
- NOTHING IS DECIDED. ${a.note} Nothing is claimable. Kevin never says it is
  confirmed, never gives a date or amount, never says to buy or hold to
  qualify. Kevin heard people talking, that is all.
- Kevin like GameStop because Kevin like games.

`;
}

/**
 * The site's ticker-tape slogans used to be in here as "things Kevin may
 * repeat". They came out: the prompt is resent on every reply, so its length
 * IS the group's replies-per-minute, and a list of marketing lines is the
 * least useful thing to spend that on when the persona already forbids Kevin
 * from advertising. The site still renders them from config.ticker.
 */
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
- Auction opens: ${fmt(c.auction.startsAt, 'not announced yet')}
- Auction closes: ${fmt(c.auction.endsAt, 'not announced')}

THE POOLS (open when the auction settles)
- ${pools}  (adds up to ${total}%)
${c.pools.map((p) => `- ${p.ticker}, "${p.nickname}": ${p.note}`).join('\n')}

THE BURN
- The creator's own auction allocation gets bought and then destroyed.
- Bidding wallet: ${fmt(c.burn.wallet)}
- Burn address: ${c.burn.burnAddr}
- Burned so far: ${fmt(c.burn.burned, 'nothing published yet')}

${airdropNote(c)}WHERE TO GO
- Site: https://iamkevin.lol
- Game: https://iamkevin.lol/gym  (also /game and /play)
- Card room: https://iamkevin.lol/poker  (also inside the game, at Kevin's Crib)
- Telegram: ${c.links.telegram}
- X: ${c.links.x}
- Chart: ${fmt(c.links.chart, 'no chart yet — nothing is trading')}

THE CARD ROOM (a free browser game, built by the team)
- Texas hold'em at https://iamkevin.lol/poker. Six seats, free, works on a phone.
  The other five are Kevin characters and they each play differently.
- The chips are a score in the player's own browser. NOT the token, no wallet,
  no chain.

THE GAME (free, in a browser, at https://iamkevin.lol/gym) — three places
- KEVIN'S CRIB, his home, first person, with the card table and a telly that
  takes you to the other two. KEVIN'S GYM, inside and out. McKEVIN'S, the fry
  house, where the shift is.
- Bench, dumbbells, treadmill. Five reps to a set, each rep a timing hit. Miss
  a day and muscle comes off — that is the whole point of it. A market out front.
- The $KEVIN you earn is a SCORE. Not the token, not supply, and nothing in the
  game mints or moves anything on a chain. Saves in your browser only.

STICKERS
- There is a Telegram sticker pack, ${c.animated.length} animated stickers, free, in the group.
  Kevin does not list them out.

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
 * Take only the named `## ` sections out of a markdown doc.
 *
 * The docs in this repo are written for the PEOPLE who build Kevin, and three
 * of them used to be dumped into the prompt whole, truncated at a character
 * count. That was two thirds of everything Kevin knew, and it was the wrong
 * two thirds:
 *
 *   docs/LAUNCH.md is the runbook — DNS records, GitHub Pages settings, the
 *   repo URL, a checklist of things not done yet. None of it answers anything
 *   a person in the group can ask, and all of it is ours rather than theirs.
 *
 *   docs/BRAND.md is art direction — which woff2 files to self-host, which
 *   module draws the in-art lettering. Same again.
 *
 *   docs/LORE.md is mostly craft direction, and it CONTRADICTED the prompt it
 *   was inside: "Do: First person. Present tense." sat about four thousand
 *   characters above "Third person, always — if a sentence contains 'I', 'me'
 *   or 'my', write it again with 'Kevin' instead." A prompt arguing with
 *   itself gets whichever half the model reaches for.
 *
 * What survives is the part a stranger can actually ask about: who he is and
 * the facts of his life. The register is carried by VOICE, RULES and twelve
 * worked examples in persona.mjs, which is where register belongs.
 *
 * Reading the sections rather than retyping them keeps the single source this
 * file exists for: change LORE.md and the bot changes with it.
 */
function sections(md, wanted) {
  const want = new Set(wanted);
  const out = [];
  let keep = false;
  for (const line of md.split('\n')) {
    const h = /^##\s+(?:[IVX]+\.\s*)?(.+?)\s*$/.exec(line);
    if (h) { keep = want.has(h[1].toUpperCase()); continue; }
    if (keep) out.push(line);
  }
  // Markdown furniture only a renderer cares about. It is not free — every
  // asterisk and fence is a token spent on nothing, and a model reading
  // "*No pain, only Kevin.*" will happily type the asterisks back into a group.
  return out.join('\n')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*```.*$/gm, '')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n*---\n*/g, '\n')
    .trim();
}

/** Everything Kevin knows, as one block of text for the system prompt. */
export async function buildBrief() {
  const config = await loadConfig();
  const lore = await readFile(join(ROOT, 'docs/LORE.md'), 'utf8').catch(() => '');

  const gaps = unknowns(config);
  const brief = `${factSheet(config)}

THINGS KEVIN DOES NOT KNOW — say so plainly, never guess:
${gaps.map((g) => `- ${g}`).join('\n')}

--- KEVIN'S LIFE (facts, not a script) ---
${sections(lore, ['WHO HE IS', 'THE FACTS OF HIS LIFE'])}`;

  return { config, brief, gaps };
}
