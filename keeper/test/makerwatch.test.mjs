// Tested against the two trades the market maker really made on 9 Sep, not
// against my idea of one. The raw logs are pasted from the chain.
//
// The point of this file is that the group is never told the treasury's own
// bot is "somebody". Both messages must name it.

import { decode, announce, priceFrom, SOLD, BOUGHT } from '../makerwatch.mjs';
import { MARKET_MAKERS } from '../buywatch.mjs';

const ok = [], bad = [];
// BigInt does not survive JSON.stringify, and these are all BigInts.
const show = (v) => (typeof v === 'bigint' ? v.toString() + 'n' : JSON.stringify(v));
const check = (name, got, want) => {
  const g = show(got), w = show(want);
  (g === w ? ok : bad).push(g === w ? name : `${name}\n     got  ${g}\n     want ${w}`);
};
const has = (name, hay, needle) => check(name, String(hay).includes(needle), true);

// The real first sale: 1,511,252.803832552606971719 KEVIN out, 998,200 KEK in.
// tx 0xb608ee00715e1da5d4d469a96ce83a5ee85ab1a7f1c8b7c37276f73e62b34b51
const soldLog = {
  topics: [SOLD],
  data: '0x'
    + (1511252803832552606971719n).toString(16).padStart(64, '0')
    + (998200038255996866879954n).toString(16).padStart(64, '0')
    + (299460011476799060063986n).toString(16).padStart(64, '0')
    + (97957068028031267543059442799n).toString(16).padStart(64, '0'),
};

const s = decode(soldLog);
check('a Sold log decodes as a sale', s.kind, 'sold');
check('  tokens out', s.tokens, 1511252803832552606971719n);
check('  quote in', s.quote, 998200038255996866879954n);
check('  reserved for the war chest', s.reserved, 299460011476799060063986n);

const sm = announce(s, 'KEK');
has('the sale names the market maker', sm, 'Kevin Market Maker');
has('  and says it sold', sm, 'sold');
has('  with the token amount', sm, '1,511,253');
has('  the quote amount', sm, '998,200');
has('  and what went to the war chest', sm, 'buy the next dip');
has('  and says plainly it is not a stranger', sm, 'not somebody');

// A bid, in the shape Bought emits: quoteIn, tokensOut, spotAfter.
const boughtLog = {
  topics: [BOUGHT],
  data: '0x'
    + (150000000000000000000000n).toString(16).padStart(64, '0')
    + (206000000000000000000000n).toString(16).padStart(64, '0')
    + (97957068028031267543059442799n).toString(16).padStart(64, '0'),
};
const b = decode(boughtLog);
check('a Bought log decodes as a purchase', b.kind, 'bought');
check('  quote spent', b.quote, 150000000000000000000000n);
check('  tokens received', b.tokens, 206000000000000000000000n);

const bm = announce(b, 'KEK');
has('the bid names the market maker', bm, 'Kevin Market Maker');
has('  and says it bought', bm, 'bought the dip');
has('  and says it is the bot', bm, 'That the bot');

// Neither message may ever read like the buy watch's organic alert.
check('the sale never says "Somebody"', sm.includes('Somebody'), false);
check('the bid never says "Somebody"', bm.includes('Somebody'), false);

// An unrelated log must be ignored rather than mis-decoded.
check('an unrelated topic decodes to nothing',
  decode({ topics: ['0xdead'], data: '0x' }), null);

// Price orientation: $KEVIN is currency1, so a LARGER sqrt price is a LOWER
// $KEVIN price. Getting this backwards would print the move the wrong way.
const lo = priceFrom(92132045029981785029052974797n);
const hi = priceFrom(97957068028031267543059442799n);
check('a larger sqrt price means a cheaper $KEVIN', hi < lo, true);
check('and the sale above printed about 0.654 KEK', hi.toFixed(3), '0.654');

// The two market makers must be excluded from the organic buyer list.
check('the KEK market maker is known to the buy watch',
  MARKET_MAKERS.has('0x47dd22f76129d4aec0c93668b905bc360657a29c'), true);
check('the WETH one too',
  MARKET_MAKERS.has('0xd7309cc9383feb44d09202764a72951b962a25ab'), true);

console.log(ok.map((x) => '  ok   ' + x).join('\n'));
if (bad.length) console.log(bad.map((x) => '  FAIL ' + x).join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
