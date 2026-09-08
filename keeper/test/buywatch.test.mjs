// Tested against transactions that really happened on launch morning, not
// against my idea of one. The fixtures in fixtures/real-txs.json are the actual
// receipts pulled off Robinhood Chain — the arbitrage bot that got announced as
// a buy, and the three real buys that got announced wrong or not at all.
//
// If this file passes, the three things that confused people that morning
// cannot happen again.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { netTransaction, announce, PLUMBING } from '../buywatch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TX = JSON.parse(readFileSync(join(HERE, 'fixtures/real-txs.json'), 'utf8'));
const KEVIN = '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

const ok = [];
const fail = [];
const check = (name, got, want) => {
  const g = JSON.stringify(got, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  const w = JSON.stringify(want, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  (g === w ? ok : fail).push(`${g === w ? 'ok  ' : 'FAIL'} ${name}${g === w ? '' : `\n       got  ${g}\n       want ${w}`}`);
};
// The transaction's `from` is part of the fixture because it is part of the
// answer: only the wallet that actually sent the ETH may be credited with
// having paid it. See section 5.
const run = (k) => netTransaction(TX[k].logs, KEVIN, WETH, BigInt(TX[k].value), TX[k].from);

// --- 1. THE ARBITRAGE BOT MUST NOT BE ANNOUNCED -----------------------------
// It bought 5,733,486 KEVIN in the WETH pool and sold every one into the KEK
// pool in the same transaction. A per-hop watcher shouts "buy 0.021 WETH".
// Three people read that alert and thought they had been robbed.
{
  const { buyers, sellers } = run('arb');
  check('the arb produces no buyer at all', buyers.length, 0);
  check('and no seller either — it netted to nothing', sellers.length, 0);
}

// --- 2. A ROUTED BUY IS REPORTED WHOLE, NOT PER HOP -------------------------
// This one went WETH -> KEK -> KEVIN. Watching one pool shows one leg.
{
  const { buyers } = run('buy_0594');
  check('one buyer, not one per hop', buyers.length, 1);
  check('the buyer is the wallet, not the router',
    buyers[0].who, '0xcc22de8C4914976a735A602dDeD970c64f1B68C2');
  // Not a rounded figure: this is that wallet's balanceOf() on chain, to the wei.
  check('every token of the fill', buyers[0].tokens, 15216879600714472794037779n);
  check('and the whole 0.06 he actually sent, not the 0.0594 that reached the pool',
    buyers[0].paid, 60000000000000000n);
  // The KEK it passed through must not look like a purchase of anything.
  check('the intermediate hop is invisible', buyers.filter((b) => b.tokens === 0n).length, 0);
}

// --- 3. TWO BUYS ARE TWO LINES, EACH COMPLETE -------------------------------
// Somebody bought twice, saw only the smaller alert, and thought that was the
// lot. Each transaction reports its own full total.
{
  const a = run('buy_030').buyers;
  const b = run('buy_020').buyers;
  check('first buy stands alone', [a.length, a[0].tokens, a[0].paid],
    [1, 9172643275278114438115663n, 30000000000000000n]);
  check('second buy stands alone', [b.length, b[0].tokens, b[0].paid],
    [1, 5848597590581296608155265n, 20000000000000000n]);
  check('same wallet both times', a[0].who === b[0].who, true);
  // THE STRONGEST CHECK IN THIS FILE. Netting the two transactions gives that
  // wallet's real balanceOf() on chain, to the wei — so the function is not
  // merely self-consistent, it agrees with the chain.
  check('together they are exactly what he holds',
    a[0].tokens + b[0].tokens, 15021240865859411046270928n);
}

// --- the plumbing list is doing its job -------------------------------------
{
  check('the PoolManager is plumbing', PLUMBING.has('0x8366a39cc670b4001a1121b8f6a443a643e40951'), true);
  check('the universal router is plumbing', PLUMBING.has('0x06afba43fd06227fa663b0daecf536f6eaa6bf99'), true);
  check('burn is plumbing', PLUMBING.has('0x000000000000000000000000000000000000dead'), true);
  // A real buyer must never be on it, however the alert is generated.
  check('a real buyer is not', PLUMBING.has('0xcc22de8c4914976a735a602dded970c64f1b68c2'), false);
}

// --- the message itself ------------------------------------------------------
{
  const { buyers } = run('buy_0594');
  const text = announce(buyers[0]);
  check('says the real amount', /0\.0600 ETH/.test(text), true);
  check('says the real token count', /15,216,880/.test(text), true);
  check('never mentions a price', /price|worth \$|\$\d/.test(text), false);
  check('stays in Kevin voice', /Kevin/.test(text) && !/\bI\b/.test(text), true);
}

for (const l of [...ok, ...fail]) console.log('  ' + l);

// --- 5. A STRANGER'S ETH IS NOT YOUR BUY ------------------------------------
// `paid` used to be the transaction's native value, handed to every wallet
// whose KEVIN balance went up. So a contract that moves one wei of KEVIN to a
// bystander and refunds its own msg.value produces a headline "somebody bought
// 10 ETH of KEVIN" for the price of gas — and there is no cheaper way to fake
// a buy bot than one that quotes a number nobody spent.
{
  const T = (from, to, v, token) => ({
    address: token,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x' + from.slice(2).padStart(64, '0'),
      '0x' + to.slice(2).padStart(64, '0'),
    ],
    data: '0x' + v.toString(16).padStart(64, '0'),
  });
  const attacker = '0x1111111111111111111111111111111111111111';
  const bystander = '0x2222222222222222222222222222222222222222';
  const logs = [T(attacker, bystander, 1n, KEVIN)];

  const spoof = netTransaction(logs, KEVIN, WETH, 10n * 10n ** 18n, attacker);
  const credited = spoof.buyers.find((b) => b.who.toLowerCase() === bystander.toLowerCase());
  check('the bystander is not credited with the sender\'s ETH', credited?.paid ?? 0n, 0n);

  // And the sender, who really did send it, still is — as long as tokens
  // actually reached them.
  const real = netTransaction([T(bystander, attacker, 10n ** 19n, KEVIN)],
    KEVIN, WETH, 10n * 10n ** 18n, attacker);
  check('the wallet that sent the ETH keeps it', real.buyers[0].paid, 10n * 10n ** 18n);

  // WETH given up always wins over native value, because that is what the
  // wallet actually parted with.
  const viaWeth = netTransaction(
    [T(bystander, attacker, 10n ** 19n, KEVIN), T(attacker, bystander, 5n * 10n ** 17n, WETH)],
    KEVIN, WETH, 10n * 10n ** 18n, attacker);
  check('WETH out beats the transaction value', viaWeth.buyers[0].paid, 5n * 10n ** 17n);
}

console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
