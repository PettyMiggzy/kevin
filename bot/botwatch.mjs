// Listening to other bots.
//
// Bot API 10.0 (8 May 2026) added bot-to-bot communication. Verified against
// core.telegram.org/api/bots/bot-to-bot rather than taken on trust, because
// the previous rule held for a decade and building on a wrong version of it
// would have wasted a week.
//
// To receive another bot's ordinary group posts — Radar's leaderboard, say —
// with no cooperation from that bot, THIS bot needs Bot-to-Bot Communication
// Mode on in @BotFather, AND EITHER Group Privacy off OR admin in the group.
// core.telegram.org/bots/features words that second pair as an "or"; the
// lower-level api/bots/bot-to-bot page lists them as bullets that read as an
// "and". Doing both costs nothing and settles it.
//
// Without the mode itself, it only sees bot messages that /command@ThisBot or
// reply to it directly. The mode is not optional for passive reading.
//
// Telegram's own docs ask for loop safeguards, and they are right to: two bots
// that answer each other will do so forever at machine speed. Everything below
// is that — dedupe, a rate limit, and Kevin never replying to a bot at all.

/**
 * A ring of seen message ids. Telegram can redeliver an update, and an edited
 * leaderboard arrives as a second event for the same message; both would
 * otherwise be counted twice.
 */
export function makeSeen(limit = 500) {
  const ids = new Set();
  const order = [];
  return (key) => {
    if (ids.has(key)) return true;
    ids.add(key);
    order.push(key);
    if (order.length > limit) ids.delete(order.shift());
    return false;
  };
}

/**
 * Is this a bot message worth looking at?
 *
 * Kevin's own messages come back as updates too, and treating those as input is
 * the first half of an infinite loop.
 */
export function fromOtherBot(msg, me) {
  return Boolean(msg?.from?.is_bot) && msg.from.id !== me.id;
}

/**
 * One line per bot message, to the log, so a parser can be written against what
 * Radar ACTUALLY posts rather than against a guess at it.
 *
 * Formats vary: some campaign bots post a numbered list, some a table, some put
 * the whole thing in an inline keyboard where the text field is nearly empty.
 * That last case is the reason this prints the keyboard too — if the standings
 * are in buttons, no amount of parsing message.text will find them.
 */
export function sniff(msg) {
  const from = msg.from?.username || msg.from?.first_name || msg.from?.id;
  const text = msg.text ?? msg.caption ?? '';
  const buttons = (msg.reply_markup?.inline_keyboard || [])
    .flat()
    .map((b) => b.text)
    .filter(Boolean);

  return [
    '',
    '─'.repeat(64),
    `FROM @${from}   msg ${msg.message_id}   ${msg.edit_date ? 'EDITED' : 'new'}`,
    `chat ${msg.chat?.id}`,
    text ? `TEXT (${text.length} chars):\n${text}` : 'TEXT: (none)',
    buttons.length ? `BUTTONS: ${JSON.stringify(buttons)}` : 'BUTTONS: (none)',
    msg.entities?.length ? `ENTITIES: ${JSON.stringify(msg.entities)}` : '',
    '─'.repeat(64),
  ].filter(Boolean).join('\n');
}

/**
 * Pull @handles and their positions out of a leaderboard-shaped message.
 *
 * DELIBERATELY GENERIC and deliberately not finished. Campaign bots do not
 * share a format, so this handles the shapes that are common — "1. @name — 42",
 * "#1 @name 42 pts" — and returns nothing when it is unsure. Run --sniff
 * against the real Radar posts and tighten it to what actually arrives; a
 * parser that guesses wrong pays the wrong people, which is worse than a
 * parser that returns nothing.
 */
export function parseLeaderboard(text) {
  if (!text) return [];
  const rows = [];

  for (const line of text.split('\n')) {
    const handle = /@([A-Za-z0-9_]{3,32})/.exec(line);
    if (!handle) continue;

    // Every number on the line, then work out which one is the score. Matching
    // rank, handle and score in one expression looked tidy and quietly dropped
    // any handle under four characters and any line ending in "pts".
    const nums = line.match(/\d[\d,]*(?:\.\d+)?/g) || [];
    if (!nums.length) continue;

    // A leading "1." or "#3" is a rank, not a score.
    const lead = /^\s*#?(\d{1,3})[.)\]]?\s/.exec(line);
    const rank = lead ? Number(lead[1]) : rows.length + 1;
    const pool = lead && nums.length > 1 ? nums.slice(1) : nums;

    // The score is the largest remaining number: campaign lines carry decoration
    // ("x2", "3 days") and the standing is the big one.
    const score = Math.max(...pool.map((n) => Number(n.replace(/,/g, ''))));
    if (!Number.isFinite(score)) continue;

    rows.push({ rank, handle: handle[1].toLowerCase(), score });
  }

  // A board has several rows. One or two matches is far more likely to be a
  // sentence that happened to contain a handle and a number.
  return rows.length >= 3 ? rows : [];
}
