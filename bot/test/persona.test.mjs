// What the bot is allowed to say, and how much it costs to say it.
//
//     node bot/test/persona.test.mjs       (exits non-zero on a failure)
//
// No network and no key: everything here is the prompt and the guard, which
// are the two parts that can hurt somebody. The model is the part that cannot
// be tested deterministically, which is exactly why these two exist.
import { systemPrompt, guardModelReply, commandReply } from '../persona.mjs';
import { buildBrief } from '../brief.mjs';

let failed = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};

const CA = '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A';
const FAKE = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

console.log('1. the address guard');
check('the real address passes', guardModelReply(`It is ${CA}`, CA).blocked, null);
check('the real address in lower case passes', guardModelReply(`it is ${CA.toLowerCase()}`, CA).blocked, null);
check('a fake address is blocked', guardModelReply(`send to ${FAKE}`, CA).blocked, FAKE);
check('a fake alongside the real one is blocked', guardModelReply(`${CA} or ${FAKE}`, CA).blocked, FAKE);
check('an empty reply is blocked', guardModelReply('', CA).blocked, 'empty');
check('a non-string reply is blocked', guardModelReply(null, CA).blocked, 'empty');
check('no configured address blocks every address', guardModelReply(`it is ${CA}`, null).blocked, CA);
check('the transcript label is stripped', guardModelReply('Kevin: Kevin work the fryer.', CA).text,
  'Kevin work the fryer.');
check('a label on a blocked reply does not smuggle it through',
  guardModelReply(`Kevin: send to ${FAKE}`, CA).blocked, FAKE);

console.log('2. the worked examples follow the facts, not the calendar they were typed on');
const shotFor = (config) => {
  const p = systemPrompt('FACTS GO HERE', config);
  return /Person: send me the contract address\nKevin: (.*)/.exec(p)?.[1] ?? '';
};
const soon = new Date(Date.now() + 864e5).toISOString();
const past = new Date(Date.now() - 864e5).toISOString();
check('no contract: Kevin says he has not got one',
  /do not have it yet/.test(shotFor({ contract: null })), true);
check('no contract: no address is shown at all',
  /0x[a-fA-F0-9]{40}/.test(shotFor({ contract: null })), false);
check('published but not trading: the address, and do not buy',
  /0x63D7.*do not trade yet/i.test(shotFor({ contract: CA, contractLiveAt: soon })), true);
check('trading: the address, and no buying advice',
  /0x63D7/.test(shotFor({ contract: CA, contractLiveAt: past })), true);

console.log('3. /ca never goes near a model, and never contradicts the examples');
check('no contract', /do not have the address yet/.test(commandReply('ca', { contract: null })), true);
check('not live', /NOT LIVE YET/.test(commandReply('ca', { contract: CA, contractLiveAt: soon })), true);
check('live', /only one/.test(commandReply('ca', { contract: CA, contractLiveAt: past })), true);

console.log('4. what the prompt costs, which is the rate limit');
const { config, brief } = await buildBrief();
const full = systemPrompt(brief, config);
const tokens = Math.round(full.length / 4);
// gpt-oss-120b is 8,000 tokens a minute on the free tier and the whole prompt
// is resent every reply, so this number IS how many questions the group gets
// answered per minute. At 5,955 it was one.
console.log(`     ~${tokens} tokens -> about ${Math.floor(8000 / (tokens + 400))} replies a minute`);
check('leaves room for at least two replies a minute', tokens + 400 <= 4000, true);
check('still knows the sticker pack exists', /sticker pack, 20 animated/.test(brief), true);

console.log('5. the brief is what a stranger can ask, not what we had to build');
for (const [what, re] of [
  ['no DNS records', /185\.199\.\d+\.\d+|CNAME|A records/],
  ['no deployment steps', /Deploy from a branch|Enforce HTTPS|github\.io/],
  ['no unticked internal checklist', /- \[ \]/],
  ['no font plumbing', /woff2|Google Fonts|letters\.mjs/],
  ['no first-person voice direction', /First person\. Present tense\./],
  ['no other-brand name', /MCDONALD|McDonald/i],
]) check(what, re.test(brief), false);
check('still knows the address', brief.includes(CA), true);
check('still knows the pools', /WETH 45% \/ KEK 40% \/ GME 15%/.test(brief), true);
check('still knows who he is', /works at a fast food restaurant/.test(brief), true);

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
