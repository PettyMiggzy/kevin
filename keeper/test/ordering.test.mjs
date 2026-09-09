// A DIAGNOSTIC MUST NEVER SILENCE THE MACHINE IT DESCRIBES.
//
// The "room above the floor, but the contract holds no $KEVIN" note was added
// to make an idle keeper explain itself. It was placed above the ratchet
// branch, so an empty contract returned early on every tick and stopped
// ratcheting altogether. It ran that way for 2.7 hours on the live KEK pool
// while $KEVIN went 0.622 -> 0.726 KEK, and the floor fell from 37% under spot
// to 46% under it. Nothing crashed; the service stayed green the whole time.
//
// This is a structural test on the source rather than a behavioural one,
// because the failure is entirely about ORDER and order is what it checks.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'floor.mjs'), 'utf8');

const ok = [], bad = [];
const at = (needle) => {
  const i = SRC.indexOf(needle);
  if (i < 0) { bad.push(`marker not found in floor.mjs: ${needle}`); return Infinity; }
  return i;
};
const before = (name, a, b) => {
  const ia = at(a), ib = at(b);
  if (ia < ib) ok.push(name);
  else bad.push(`${name}\n     "${a}"\n     must come BEFORE\n     "${b}"`);
};

// The two things that keep the contract honest, and must never be gated.
const RATCHET = 'if (canRatchet && worthRatcheting(';
const RELEASE = 'if (lockRate > 0n) {';

// The notes that merely explain why it is idle.
const NO_KEVIN = 'if (sell && held === 0n) {';
const NO_CHEST = 'if (buy && chest === 0n) {';
const NO_RAILS = 'if (sell && capT === 0n) {';
const BUCKET_T = 'if (sell && sold >= capT) {';
const BUCKET_Q = 'if (buy && spent >= capQ) {';

for (const [label, note] of [
  ['inventory note', NO_KEVIN], ['war chest note', NO_CHEST], ['rails note', NO_RAILS],
  ['sell bucket note', BUCKET_T], ['buy bucket note', BUCKET_Q],
]) {
  before(`ratchet runs before the ${label}`, RATCHET, note);
}

// release() is what FIXES an empty contract, so it cannot sit behind the guard
// that fires when the contract is empty — it could never run when it mattered.
before('lockbox release runs before the inventory note', RELEASE, NO_KEVIN);
before('ratchet runs before the lockbox release', RATCHET, RELEASE);

// These two genuinely do block a ratchet on chain, so they belong up top.
before('paused check comes first', "if (paused) return note(", RATCHET);
before('no-floor check comes first', 'if (floorAt === 0n) return note(', RATCHET);

// The state line is printed by the ratchet branches, so it must be built first.
before('state is built before the ratchet uses it', 'const state =', RATCHET);
before('the drained buckets are computed before state prints them',
  'const sold = drained(storedSold, capT);', 'const state =');

// Selling is last, after the cooldown check.
before('the cooldown is checked before selling', 'if (now < readyAt) return note(', 'if (sell) {');

console.log(ok.map((s) => '  ok   ' + s).join('\n'));
if (bad.length) console.log(bad.map((s) => '  FAIL ' + s).join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
