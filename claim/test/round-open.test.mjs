// The prose swap that announces an open round was DEAD CODE: it was guarded by
// roundIsOpen(), which requires roundLive === true, but it ran synchronously in
// the round.json handler where roundLive is still null. The page would have
// said "the round is not open yet" on the day a round opened, above a working
// Claim button.
//
// These assertions are structural because the bug was structural: a fact the
// chain owns was being rendered before the chain had been asked.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const ok = [], bad = [];
const at = (n) => { const i = SRC.indexOf(n); if (i < 0) bad.push(`marker missing: ${n}`); return i; };
const check = (name, cond) => (cond ? ok : bad).push(cond ? name : name);
const before = (name, a, b) => {
  const ia = at(a), ib = at(b);
  check(name, ia >= 0 && ib >= 0 && ia < ib);
};

// 1. The swap must happen where the chain answers, not before.
check('showRoundOpen exists', SRC.includes('function showRoundOpen('));
check('it is called from the roundLive = true branch',
  /roundLive = true;[\s\S]{0,900}?showRoundOpen\(\);/.test(SRC));
before('readRoundState is reached before the swap runs', 'readRoundState(', 'showRoundOpen();');

// 2. The old unreachable form must not come back.
check('no synchronous "var open = roundIsOpen(d)" in the file handler',
  !/var open = roundIsOpen\(d\);/.test(SRC));
check('the lead is not rewritten anywhere outside showRoundOpen',
  (SRC.match(/lead\.innerHTML =/g) || []).length === 1);

// 3. It must be safe to call twice — renderEveryone can fire again.
check('guarded so a second call cannot strip more text',
  /lead\.dataset\.open === '1'/.test(SRC) && /lead\.dataset\.open = '1';/.test(SRC));

// 4. Every other read of roundLive must still default to closed.
check('roundIsOpen still requires roundLive === true',
  /function roundIsOpen\(d\) \{ return fileNamesADistributor\(d\) && roundLive === true; \}/.test(SRC));
check('a failed chain read stays closed',
  /catch\(function \(\) \{[\s\S]{0,200}roundLive = false;/.test(SRC));
check('a root mismatch stays closed', /disagree[\s\S]{0,400}|roundLive = false;/.test(SRC));

console.log(ok.map((s) => '  ok   ' + s).join('\n'));
if (bad.length) console.log(bad.map((s) => '  FAIL ' + s).join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
