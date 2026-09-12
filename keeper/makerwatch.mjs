/**
 * KEVIN MARKET MAKER — the announcer.
 *
 * Posts what the market maker did, in the group, labelled as itself.
 *
 * WHY THIS IS SEPARATE FROM THE BUY WATCH. A bid from the floor keeper looks,
 * to anything netting ERC-20 transfers, exactly like a stranger buying. Run it
 * through buywatch and the group is told "Somebody buy KEVIN" for the treasury
 * buying its own token. That is the sort of thing that is indistinguishable
 * from lying, whether or not anybody meant it. So the two are split: buywatch
 * announces other people, this announces us, and neither can be mistaken for
 * the other.
 *
 * It reads the CONTRACT'S OWN EVENTS rather than netting transfers, because
 * Sold and Bought carry the exact amounts in the right units — including the
 * part reserved for the war chest, which no amount of transfer-watching would
 * reveal. On a KEK-quoted pool a transfer-netter also sees no WETH at all and
 * would report the price paid as zero.
 *
 *   FLOOR_ADDRESS   the market maker to watch
 *   QUOTE_SYMBOL    what the pool is quoted in, for the text (default KEK)
 *   MAKER_CHAT_ID   the Telegram chat
 *   LIVE=1          actually post; otherwise it prints and sends nothing
 *   ANNOUNCE_BUYS=1   post to the group when it buys (off by default)
 *   ANNOUNCE_SELLS=1  post to the group when it sells (off by default)
 *
 * It holds no key that can spend anything. It reads the chain and posts text.
 */
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, defineChain, formatUnits } from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  floor: process.env.FLOOR_ADDRESS || '0x47Dd22f76129d4AeC0c93668b905BC360657A29C',
  qsym: process.env.QUOTE_SYMBOL || 'KEK',
  chat: process.env.MAKER_CHAT_ID || '',
  // ANNOUNCE NEITHER SIDE BY DEFAULT — the owner's call.
  //
  // Both buys and sells post only on explicit opt-in (ANNOUNCE_BUYS=1 /
  // ANNOUNCE_SELLS=1). Buys used to be hardcoded on; on a volatile day the
  // floor keeper can bid dozens of times, and each one posted immediately —
  // that read as spam, not as news, so it got the same off-by-default
  // treatment sells already had.
  //
  // The log prints both regardless, so the operator always sees everything
  // even when the group does not.
  announceBuys: process.env.ANNOUNCE_BUYS === '1',
  announceSells: process.env.ANNOUNCE_SELLS === '1',
  live: process.env.LIVE === '1',
  everyMs: Number(process.env.TICK_MS || 60_000),
  // How far back to look on a cold start. Not the whole chain: this posts to a
  // group, and a fresh install replaying a week of trades at 3am is worse than
  // missing them.
  backfill: BigInt(process.env.BACKFILL_BLOCKS || 20_000),
  state: join(HERE, '.makerwatch.json'),
};

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

// keccak of the two events, computed with cast and pinned here so a typo in a
// signature string cannot silently match nothing forever.
export const SOLD   = '0x4ca6be2b3c843ca003df5d18354719814a19f896851552b26b609e67b92efa49';
export const BOUGHT = '0x0406530d308b7576be2d67926b6a51005e3a740fb1a76bba25e8b9552ada48dd';

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (...a) => console.log(stamp(), ...a);
const warn = (...a) => console.error(stamp(), '!!', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Words for a number of tokens, without a wall of decimals. */
const human = (v, dp = 18) =>
  Number(formatUnits(v, dp)).toLocaleString('en-GB', { maximumFractionDigits: 0 });

/** sqrtPriceX96 -> $KEVIN priced in the quote, for a pool where $KEVIN is currency1. */
export function priceFrom(sqrtPriceX96) {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  return s === 0 ? 0 : 1 / (s * s);
}

/**
 * Decode one Sold or Bought log into the numbers the message needs.
 * Pure, so it can be tested against events that really happened.
 */
export function decode(log) {
  const d = (log.data || '0x').slice(2);
  const word = (i) => BigInt('0x' + (d.slice(i * 64, (i + 1) * 64) || '0'));
  const topic = (log.topics?.[0] || '').toLowerCase();
  if (topic === SOLD) {
    // Sold(tokensIn, quoteOut, reserved, spotAfter)
    return { kind: 'sold', tokens: word(0), quote: word(1), reserved: word(2), spot: word(3) };
  }
  if (topic === BOUGHT) {
    // Bought(quoteIn, tokensOut, spotAfter)
    return { kind: 'bought', quote: word(0), tokens: word(1), reserved: 0n, spot: word(2) };
  }
  return null;
}

/**
 * The message. Says what it is, in Kevin's voice, and never pretends to be
 * anybody else — the whole reason this file exists.
 */
export function announce(t, qsym = 'KEK') {
  const px = priceFrom(t.spot);
  if (t.kind === 'sold') {
    return [
      '🤖🍟',
      '',
      'Kevin Market Maker sold into the room above the floor.',
      '',
      `  ${human(t.tokens)} KEVIN out`,
      `  ${human(t.quote)} ${qsym} in`,
      t.reserved > 0n ? `  ${human(t.reserved)} ${qsym} put aside to buy the next dip` : null,
      `  price now ${px.toFixed(4)} ${qsym}`,
      '',
      'That the bot, not somebody. It stop at the floor. It always stop at the floor.',
    ].filter((x) => x !== null).join('\n');
  }
  return [
    '🤖🟢',
    '',
    'Kevin Market Maker bought the dip.',
    '',
    `  ${human(t.quote)} ${qsym} out`,
    `  ${human(t.tokens)} KEVIN back`,
    `  price now ${px.toFixed(4)} ${qsym}`,
    '',
    'That the bot spending the war chest. Kevin buy when it cheap.',
  ].join('\n');
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`telegram ${method} ${r.status}`);
  return r.json();
}

function loadKey(name) {
  const p = join(ROOT, 'bot', name);
  return existsSync(p) ? (readFileSync(p, 'utf8').trim() || null) : null;
}

function writeAtomic(path, text) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

async function main() {
  if (cfg.live && !cfg.chat) {
    warn('LIVE=1 but MAKER_CHAT_ID is not set. Refusing to start.');
    process.exit(1);
  }
  const botToken = loadKey('.telegram.key');
  if (cfg.live && !botToken) {
    warn('LIVE=1 but bot/.telegram.key is missing. Refusing to start.');
    process.exit(1);
  }

  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });

  say('market maker watch starting');
  say('  contract', cfg.floor);
  say('  quoted in', cfg.qsym);
  say('  chain   ', cfg.chainId, cfg.rpc);
  say('  chat    ', cfg.chat || '(none — dry run)');
  say('  mode    ', cfg.live ? 'LIVE, it will post' : 'DRY RUN, it will post nothing');
  say('  posts   ', [
    cfg.announceBuys ? 'buys' : null,
    cfg.announceSells ? 'sells' : null,
  ].filter(Boolean).join(' and ') || 'nothing — logged only, ANNOUNCE_BUYS/ANNOUNCE_SELLS are both off');

  // The cursor alone is not enough: a hiccup mid-chunk replays the chunk, and
  // every trade in it gets announced twice. Remember the hashes too.
  let cursor = 0n;
  let seen = new Set();
  if (existsSync(cfg.state)) {
    try {
      const j = JSON.parse(readFileSync(cfg.state, 'utf8'));
      cursor = BigInt(j.cursor || 0);
      seen = new Set(j.seen || []);
    } catch { /* a corrupt state file is a cold start, not a crash */ }
  }
  if (cursor === 0n) {
    const head = await pub.getBlockNumber();
    cursor = head > cfg.backfill ? head - cfg.backfill : 0n;
    say('  cold start, from block', cursor);
  }

  const save = () => writeAtomic(cfg.state, JSON.stringify({
    cursor: cursor.toString(),
    // Bounded, or this file grows forever.
    seen: [...seen].slice(-500),
  }));

  for (;;) {
    try {
      const head = await pub.getBlockNumber();
      while (cursor <= head) {
        const to = cursor + 4_000n > head ? head : cursor + 4_000n;
        const logs = await pub.getLogs({
          address: cfg.floor, fromBlock: cursor, toBlock: to,
        });
        for (const l of logs) {
          const key = `${l.transactionHash}:${l.logIndex}`;
          if (seen.has(key)) continue;
          const t = decode(l);
          if (!t) continue;
          seen.add(key);
          const text = announce(t, cfg.qsym);
          const quiet = (t.kind === 'sold' && !cfg.announceSells)
            || (t.kind === 'bought' && !cfg.announceBuys);
          // Logged either way. The group's feed is a choice; the operator's
          // record is not.
          say(`${t.kind.toUpperCase()} ${human(t.tokens)} KEVIN / ${human(t.quote)} ${cfg.qsym}`
            + `  ${l.transactionHash.slice(0, 18)}${quiet ? '  (not announced)' : ''}`);
          if (quiet) continue;
          if (!cfg.live) {
            console.log(text.split('\n').map((x) => '      ' + x).join('\n'));
            continue;
          }
          await tg(botToken, 'sendMessage', {
            chat_id: cfg.chat, text, disable_web_page_preview: true,
          }).catch((e) => warn('post failed:', e.message));
        }
        cursor = to + 1n;
        save();
      }
    } catch (e) {
      warn('tick failed:', e.shortMessage || e.message);
    }
    await sleep(cfg.everyMs);
  }
}

// Importable for tests without starting the loop.
if (process.argv[1] && process.argv[1].endsWith('makerwatch.mjs')) {
  main().catch((e) => { warn('fatal:', e.stack || e.message); process.exit(1); });
}
