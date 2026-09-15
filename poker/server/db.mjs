// Storage for the practice-table leaderboard, and ONLY the leaderboard —
// everything else about a table is still exactly as poker/server/README.md
// describes ("Nothing is persisted. A server restart loses every table.").
// SQLite via node:sqlite, same shape as the sibling game's server/db.mjs:
// WAL mode (a read for the leaderboard must never block a write from a
// player finishing a hand), a durable table plus an append-only log for
// auditability. This is its own file rather than an extension of the root
// server/db.mjs on purpose — that file belongs to a different game with a
// different schema, and sharing one database between two unrelated games
// means either one's migration can break the other's.
//
// There are no accounts anywhere in this poker system — poker/lobby.html's
// own "no account needed" copy, and the rest of the system already treats
// whatever name a browser typed into `join` as the only identity a seat has
// (see table.mjs: a reconnect is just a fresh socket claiming the same
// name). This file inherits that rule rather than inventing a stronger one:
// `leaderboard` is keyed by name, so two different people who happen to
// type the same name share one row, the same way they would share a seat's
// chip stack across a reconnect. That is a known, pre-existing property of
// "no account needed", not a new gap this file introduces.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function open(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec('PRAGMA journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      name        TEXT PRIMARY KEY,
      hands       INTEGER NOT NULL DEFAULT 0,
      wins        INTEGER NOT NULL DEFAULT 0,
      net_chips   INTEGER NOT NULL DEFAULT 0,
      updated     INTEGER NOT NULL
    );

    -- One row per player per settled hand. Kept for the same reason the
    -- sibling game's server/db.mjs keeps an 'events' table: a leaderboard
    -- that pays out — even in play money — needs "why is this person on
    -- top" to have a better answer than "the running total says so", and a
    -- running total alone cannot be replayed or audited if it is ever
    -- wrong.
    CREATE TABLE IF NOT EXISTS hand_results (
      id        INTEGER PRIMARY KEY,
      table_id  TEXT NOT NULL,
      hand      INTEGER NOT NULL,
      name      TEXT NOT NULL,
      delta     INTEGER NOT NULL,
      at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hand_results_table ON hand_results(table_id, hand);
    CREATE INDEX IF NOT EXISTS leaderboard_net ON leaderboard(net_chips DESC);
  `);

  const getPlayer = db.prepare('SELECT hands, wins, net_chips FROM leaderboard WHERE name = ?');
  const insertPlayer = db.prepare('INSERT INTO leaderboard (name, updated) VALUES (?, ?)');
  const updatePlayer = db.prepare(
    'UPDATE leaderboard SET hands = ?, wins = ?, net_chips = ?, updated = ? WHERE name = ?'
  );
  const logResult = db.prepare(
    'INSERT INTO hand_results (table_id, hand, name, delta, at) VALUES (?, ?, ?, ?, ?)'
  );
  const topByNet = db.prepare(
    'SELECT name, hands, wins, net_chips FROM leaderboard ORDER BY net_chips DESC, wins DESC LIMIT ?'
  );

  return {
    db,

    /**
     * Record one settled hand's outcome for every human seat that played it.
     * `deltas` is `[{name, bot, delta}, ...]` — table.mjs's own shape (see
     * its `onHandSettled` callback) — filtered here to `!bot` again rather
     * than trusted blind, since this is the actual security/product
     * boundary ("a bot's play is not a person's result") and a defensive
     * second check costs nothing.
     */
    recordHand(tableId, hand, deltas) {
      const now = Date.now();
      for (const d of deltas) {
        if (d.bot) continue;
        const name = String(d.name ?? '').slice(0, 20) || 'Player';
        const delta = Number.isFinite(d.delta) ? Math.trunc(d.delta) : 0;
        logResult.run(tableId, hand, name, delta, now);
        const row = getPlayer.get(name);
        if (!row) insertPlayer.run(name, now);
        const base = row || { hands: 0, wins: 0, net_chips: 0 };
        // A hand this player ended up net-up necessarily means they took a
        // pot (a seat cannot gain chips any other way) — good enough for a
        // "hands won" counter without re-deriving who beat whom from the
        // hand history, which this table deliberately does not keep.
        const won = delta > 0 ? 1 : 0;
        updatePlayer.run(base.hands + 1, base.wins + won, base.net_chips + delta, now, name);
      }
    },

    top(limit = 20) {
      return topByNet.all(Math.max(1, Math.min(100, Math.trunc(limit) || 20)));
    },
  };
}
