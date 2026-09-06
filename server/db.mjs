// Storage. SQLite, which ships inside Node 22 — no dependency, one file on
// disk, and it survives a restart, which a Map in memory does not.
//
// Small enough that a 1GB droplet will not notice it, and if it ever outgrows
// that the shape below moves to Postgres unchanged.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function open(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  // WAL so a read for the leaderboard cannot block a write from a player.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id          INTEGER PRIMARY KEY,
      token       TEXT UNIQUE NOT NULL,   -- what the game sends to prove who it is
      tg_id       INTEGER UNIQUE,         -- Telegram user, once linked
      name        TEXT NOT NULL DEFAULT '?',
      muscle      REAL NOT NULL DEFAULT 12,
      stamina     REAL NOT NULL DEFAULT 8,
      coin        INTEGER NOT NULL DEFAULT 40,
      sets        INTEGER NOT NULL DEFAULT 0,
      shifts      INTEGER NOT NULL DEFAULT 0,
      served      INTEGER NOT NULL DEFAULT 0,
      last_seen   INTEGER NOT NULL,       -- ms, OUR clock, for decay
      last_event  INTEGER NOT NULL DEFAULT 0,
      created     INTEGER NOT NULL
    );

    -- One row per credited event. Kept because a leaderboard that pays out
    -- needs to be auditable: "why is this person top" has to have an answer
    -- better than "the number says so".
    CREATE TABLE IF NOT EXISTS events (
      id      INTEGER PRIMARY KEY,
      player  INTEGER NOT NULL REFERENCES players(id),
      kind    TEXT NOT NULL,
      detail  TEXT,
      at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_player_at ON events(player, at);

    -- Short-lived codes the bot hands out so a game can attach to a Telegram
    -- account without the game ever seeing a Telegram token.
    CREATE TABLE IF NOT EXISTS link_codes (
      code    TEXT PRIMARY KEY,
      tg_id   INTEGER NOT NULL,
      name    TEXT NOT NULL,
      expires INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS players_muscle ON players(muscle DESC);
    CREATE INDEX IF NOT EXISTS players_coin ON players(coin DESC);
  `);

  return {
    db,

    playerByToken: db.prepare('SELECT * FROM players WHERE token = ?'),
    playerByTg: db.prepare('SELECT * FROM players WHERE tg_id = ?'),

    createPlayer: db.prepare(
      `INSERT INTO players (token, name, last_seen, created) VALUES (?, ?, ?, ?)`
    ),

    /** Only the columns an event can move. Never name, never tg_id. */
    updateScores: db.prepare(`
      UPDATE players
         SET muscle = ?, stamina = ?, coin = ?, sets = ?, shifts = ?, served = ?,
             last_seen = ?, last_event = ?
       WHERE id = ?
    `),

    logEvent: db.prepare('INSERT INTO events (player, kind, detail, at) VALUES (?, ?, ?, ?)'),
    // Per kind, because the cap that used this counted sets and only sets, so
    // shift events were never counted against anything at all.
    eventsSince: db.prepare(
      'SELECT COUNT(*) AS n FROM events WHERE player = ? AND kind = ? AND at > ?'
    ),

    // Boards. Only players who have linked a Telegram account appear: a name
    // nobody can be held to is a name somebody will use to say something
    // unpleasant on a public leaderboard.
    topMuscle: db.prepare(
      `SELECT name, muscle AS score FROM players
        WHERE tg_id IS NOT NULL AND sets > 0
        ORDER BY muscle DESC LIMIT ?`
    ),
    topCoin: db.prepare(
      `SELECT name, coin AS score FROM players
        WHERE tg_id IS NOT NULL AND shifts > 0
        ORDER BY coin DESC LIMIT ?`
    ),

    makeCode: db.prepare(
      'INSERT OR REPLACE INTO link_codes (code, tg_id, name, expires) VALUES (?, ?, ?, ?)'
    ),
    takeCode: db.prepare('SELECT * FROM link_codes WHERE code = ? AND expires > ?'),
    dropCode: db.prepare('DELETE FROM link_codes WHERE code = ?'),
    linkPlayer: db.prepare('UPDATE players SET tg_id = ?, name = ? WHERE id = ?'),
    unlinkOthers: db.prepare('UPDATE players SET tg_id = NULL WHERE tg_id = ? AND id != ?'),
  };
}
