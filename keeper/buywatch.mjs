// The buy bot, built because the third-party one lied three times in a morning.
//
//   node keeper/buywatch.mjs            watch and print, post nothing
//   LIVE=1 node keeper/buywatch.mjs     actually post to Telegram
//
// WHAT WENT WRONG WITH THE OTHER ONE
//
// Launch morning, three separate people concluded they had been robbed. Nobody
// had. Every case was the alert, not the chain:
//
//   1. An ARBITRAGE BOT was announced as a buy. It bought 5,733,486 KEVIN in
//      the WETH pool and sold every one of them into the KEK pool in the SAME
//      TRANSACTION. A per-hop watcher sees hop one and shouts "buy". Net tokens
//      to a wallet: zero.
//   2. A ROUTED BUY was reported as a fragment. A 0.06 ETH buy went
//      WETH -> KEK -> KEVIN; watching one pool shows you one leg of it.
//   3. TWO BUYS read as one. Somebody bought twice, saw the smaller alert, and
//      thought that was the lot.
//
// ONE RULE FIXES ALL THREE
//
//      Net the whole transaction, per wallet.
//      Announce only when a real wallet ends up holding MORE $KEVIN.
//      Report every wei of ETH that left, across every hop and every pool.
//
// An arb nets to zero, so it is never announced — no blacklist to maintain, no
// address list to keep current, it simply cannot produce an alert. A routed buy
// reports the whole 0.06. And a wallet that buys twice in one transaction gets
// one line with the total.
//
// It watches EVERY pool, because it does not watch pools at all: it watches
// where the tokens ended up.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, defineChain, formatEther, formatUnits, getAddress } from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url));

export const TRANSFER =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Addresses that are plumbing, not people. A token landing here is not somebody
 * buying — it is a pool holding inventory or a router mid-hop.
 */
export const PLUMBING = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0x8366a39cc670b4001a1121b8f6a443a643e40951', // v4 PoolManager
  '0x58daec3116aae6d93017baaea7749052e8a04fa7', // v4 PositionManager
  '0x06afba43fd06227fa663b0daecf536f6eaa6bf99', // Universal Router
  '0xcae82a0059cb441d263170743b82a62e2499c378', // launchpad router
  '0xeb0226f992f959b7fa2ac7c3dafc712915310fea', // launchpad liquidity
  '0x506200532b0a5a7b9d1e7c50d0014680fc3b5b13', // launchpad locker
  '0x000000000022d473030f116ddee9f6b43ac78ba3', // permit2
  '0xe4acdb51b6554246da8488d1e68e8fad1b93f383', // launchpad factory
]);

const addrOf = (topic) => '0x' + topic.slice(26).toLowerCase();

/**
 * Net one transaction's token movement per address.
 *
 * THIS IS THE WHOLE THING, and it is a pure function so it can be tested
 * against transactions that really happened rather than against my idea of one.
 *
 * @param logs   every log in the transaction
 * @param token  the token we care about ($KEVIN)
 * @param weth   the quote token, for working out what was paid
 * @param value  the transaction's native ETH value
 * @param sender the transaction's `from` — the only address that can be
 *               credited with having sent `value`. Without it the ETH figure
 *               is attributed to whoever the tokens landed on, and a contract
 *               that moves one wei of KEVIN to a stranger while refunding its
 *               own msg.value produces a headline buy alert for the price of
 *               gas.
 * @returns {{buyers: Array<{who,tokens,paid}>, sellers: Array}}
 */
export function netTransaction(logs, token, weth, value = 0n, sender = null) {
  const tok = token.toLowerCase();
  const wet = weth.toLowerCase();
  const dTok = new Map();
  const dWeth = new Map();

  const bump = (m, who, v) => m.set(who, (m.get(who) ?? 0n) + v);

  for (const l of logs) {
    if ((l.topics?.[0] ?? '').toLowerCase() !== TRANSFER) continue;
    if (l.topics.length < 3) continue;
    const addr = l.address.toLowerCase();
    if (addr !== tok && addr !== wet) continue;
    const from = addrOf(l.topics[1]);
    const to = addrOf(l.topics[2]);
    const v = BigInt(l.data === '0x' ? '0x0' : l.data);
    const m = addr === tok ? dTok : dWeth;
    bump(m, from, -v);
    bump(m, to, v);
  }

  const buyers = [];
  const sellers = [];
  const from = (sender || '').toLowerCase();
  for (const [who, net] of dTok) {
    if (PLUMBING.has(who)) continue;
    if (net === 0n) continue; // an arb: in and straight back out
    // What this wallet paid: the WETH IT gave up, and the transaction's native
    // value only when this wallet is the one that sent it. Crediting `value` to
    // anybody whose balance happened to rise means the ETH number in the alert
    // is not the ETH that wallet spent.
    const wethOut = -(dWeth.get(who) ?? 0n);
    const ownValue = from && who === from ? value : 0n;
    const paid = wethOut > 0n ? wethOut : ownValue;
    if (net > 0n) buyers.push({ who: getAddress(who), tokens: net, paid });
    else sellers.push({ who: getAddress(who), tokens: -net, got: wethOut < 0n ? -wethOut : (dWeth.get(who) ?? 0n) });
  }
  return { buyers, sellers };
}

// --- the runner --------------------------------------------------------------

const cfg = {
  rpc: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  chainId: Number(process.env.CHAIN_ID || 4663),
  token: process.env.KEVIN_TOKEN || '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A',
  weth: process.env.WETH || '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  live: process.env.LIVE === '1',
  chat: process.env.BUY_CHAT_ID,
  everyMs: Number(process.env.TICK_MS || 20_000),
  chunk: Number(process.env.CHUNK || 2000),
  minEth: BigInt(process.env.MIN_ETH_WEI || 1_000_000_000_000_000n), // 0.001
  // A buy of a fraction of a token is not a buy, and pairing a dust amount with
  // a headline ETH figure is how a cheap transaction becomes a loud alert.
  minTokens: BigInt(process.env.MIN_TOKENS_WEI || 1_000_000_000_000_000_000n), // 1 KEVIN
  confirmations: Number(process.env.CONFIRMATIONS || 2),
  state: join(HERE, '.buywatch.state'),
};

const chain = defineChain({
  id: cfg.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (...a) => console.log(stamp(), ...a);
const warn = (...a) => console.error(stamp(), '!!', ...a);

function loadKey(name) {
  const p = join(HERE, '..', 'bot', name);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim() || null;
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'telegram said no');
  return j.result;
}

/** Kevin's voice, because it is Kevin's group. Never a price, never a promise. */
export function announce(b, mcapEth) {
  const eth = Number(formatEther(b.paid));
  const tokens = Number(formatUnits(b.tokens, 18));
  const size = eth >= 0.5 ? '🍟'.repeat(10) : '🍟'.repeat(Math.max(1, Math.ceil(eth * 20)));
  const lines = [
    `${size}`,
    ``,
    `Somebody buy KEVIN.`,
    ``,
    `  ${eth.toFixed(4)} ETH`,
    `  ${tokens.toLocaleString('en-GB', { maximumFractionDigits: 0 })} KEVIN`,
    mcapEth ? `  ${mcapEth.toFixed(2)} ETH is what all of it is worth now` : null,
    ``,
    `Kevin is on the fryer. Kevin see it though.`,
  ].filter((x) => x !== null);
  return lines.join('\n');
}

async function main() {
  if (!cfg.chat && cfg.live) {
    warn('LIVE=1 but BUY_CHAT_ID is not set. Refusing to start.');
    process.exit(1);
  }
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const botToken = loadKey('.telegram.key');
  if (cfg.live && !botToken) {
    warn('LIVE=1 but bot/.telegram.key is missing. Refusing to start.');
    process.exit(1);
  }

  say('buy watch starting');
  say('  token   ', cfg.token);
  say('  chain   ', cfg.chainId, cfg.rpc);
  say('  chat    ', cfg.chat || '(none — dry run)');
  say('  mode    ', cfg.live ? 'LIVE, it will post' : 'DRY RUN, it will post nothing');
  say('  floor   ', formatEther(cfg.minEth), 'ETH and',
      formatUnits(cfg.minTokens, 18), 'KEVIN — smaller buys are not announced');

  // The cursor alone is not enough. It only advances when a whole chunk has
  // been processed, so a single RPC hiccup mid-chunk replays every transaction
  // in it — and every buy in it gets announced a second time. Remember which
  // transactions have actually been posted.
  let cursor = 0n;
  let seen = new Set();
  if (existsSync(cfg.state)) {
    const raw = readFileSync(cfg.state, 'utf8').trim();
    try {
      const j = JSON.parse(raw);
      cursor = BigInt(j.cursor || 0);
      seen = new Set(j.seen || []);
    } catch {
      cursor = BigInt(raw || '0');   // the old format was a bare block number
    }
  }
  if (cursor === 0n) cursor = (await pub.getBlockNumber()) - 200n;
  const SEEN_MAX = 4000;
  const saveState = () => {
    const keep = [...seen].slice(-SEEN_MAX);
    seen = new Set(keep);
    writeFileSync(cfg.state, JSON.stringify({ cursor: String(cursor), seen: keep }));
  };

  // The receipt and transaction fetches had no retry at all, and a throw here
  // aborted the chunk before the cursor moved.
  const tries = async (fn, what) => {
    let last;
    for (let i = 0; i < 4; i++) {
      try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * 2 ** i)); }
    }
    throw new Error(`${what}: ${last?.shortMessage || last?.message}`);
  };

  for (;;) {
    try {
      const head = (await pub.getBlockNumber()) - BigInt(cfg.confirmations);
      while (cursor <= head) {
        const to = cursor + BigInt(cfg.chunk) > head ? head : cursor + BigInt(cfg.chunk);
        const logs = await pub.getLogs({
          address: cfg.token, fromBlock: cursor, toBlock: to,
        });
        // Group by transaction: netting only means anything per transaction.
        const byTx = new Map();
        for (const l of logs) {
          if (!byTx.has(l.transactionHash)) byTx.set(l.transactionHash, []);
          byTx.get(l.transactionHash).push(l);
        }
        for (const [hash] of byTx) {
          if (seen.has(hash)) continue;
          const rc = await tries(() => pub.getTransactionReceipt({ hash }), 'receipt');
          const tx = await tries(() => pub.getTransaction({ hash }), 'transaction');
          const { buyers } = netTransaction(rc.logs, cfg.token, cfg.weth, tx.value, tx.from);
          seen.add(hash);
          for (const b of buyers) {
            if (b.paid < cfg.minEth) continue;
            if (b.tokens < cfg.minTokens) continue;
            const text = announce(b);
            say(`BUY  ${formatEther(b.paid)} ETH -> ${formatUnits(b.tokens, 18)} KEVIN  ${b.who}  ${hash.slice(0, 18)}`);
            if (!cfg.live) { console.log(text.split('\n').map((l) => '      ' + l).join('\n')); continue; }
            await tg(botToken, 'sendMessage', {
              chat_id: cfg.chat, text, disable_web_page_preview: true,
            }).catch((e) => warn('post failed:', e.message));
          }
        }
        cursor = to + 1n;
        saveState();
      }
    } catch (e) {
      warn('tick failed:', e.shortMessage || e.message);
    }
    await new Promise((r) => setTimeout(r, cfg.everyMs));
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { warn('fatal:', e.stack || e.message); process.exit(1); });
}
