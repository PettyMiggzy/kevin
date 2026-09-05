// Leaderboards from the gym and the fry house.
//
// NOTHING SERVES THIS YET, and that is the honest state of it. The game keeps
// progress in localStorage on the player's own device — there is no account,
// no server, and therefore no board to read. Two people playing have two
// private numbers that have never met.
//
// So this is the seam, not the feature. Point KEVIN_SCORES_URL at something
// that returns the shape below and the commands start working; until then they
// say plainly that there is no board rather than inventing one, because a
// leaderboard with made-up names on it is worse than no leaderboard.
//
// EXPECTED SHAPE — whoever builds the server, build this:
//
//   GET <base>/top?board=gym&limit=10
//   {
//     "board": "gym",
//     "updated": "2026-09-04T17:00:00Z",
//     "rows": [ { "name": "Big Mike", "score": 96 } ]
//   }
//
// `board` is "gym" (muscle) or "job" (shift pay). `name` is whatever the player
// chose and is UNTRUSTED — it is rendered as plain text and never as markup,
// and never goes into a model prompt.

const BOARDS = {
  gym: { label: 'the gym', unit: 'muscle' },
  job: { label: "McKevin's", unit: '$KEVIN' },
};

export const hasScores = () => Boolean(process.env.KEVIN_SCORES_URL);

/** Same treatment usernames get: it is text somebody else chose. */
function cleanRow(r) {
  const name = String(r?.name ?? '?').replace(/\s+/g, ' ').trim().slice(0, 24) || '?';
  const score = Number(r?.score);
  return { name, score: Number.isFinite(score) ? Math.round(score) : 0 };
}

/**
 * Fetch a board. Returns null when nothing is configured or the call fails —
 * callers say "no board yet" rather than showing a stale or partial one.
 */
export async function top(board = 'gym', limit = 10) {
  const base = process.env.KEVIN_SCORES_URL;
  if (!base || !BOARDS[board]) return null;
  try {
    const url = new URL('/top', base);
    url.searchParams.set('board', board);
    url.searchParams.set('limit', String(limit));
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const body = await r.json();
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0, limit).map(cleanRow) : [];
    return rows.length ? { board, rows } : null;
  } catch {
    return null;                    // a dead scores box must not break the bot
  }
}

/** The board as Kevin would read it out. */
export function render(board, result) {
  const meta = BOARDS[board] ?? BOARDS.gym;
  if (!result) {
    return hasScores()
      ? `Kevin cannot see the board right now. Kevin try again in a bit.`
      : `There is no board yet. Everybody number live in their own phone and Kevin cannot see them.\n\nPlay at iamkevin.lol/gym anyway. Kevin will know when there is a board.`;
  }
  const lines = result.rows.map((r, i) =>
    `${String(i + 1).padStart(2, ' ')}  ${r.name.padEnd(18)} ${r.score}`
  );
  return `Top of ${meta.label} (${meta.unit}):\n\n${lines.join('\n')}`;
}
