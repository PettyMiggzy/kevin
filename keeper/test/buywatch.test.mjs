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
const run = (k) => netTransaction(TX[k].logs, KEVIN, WETH, BigInt(TX[k].value));

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
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
