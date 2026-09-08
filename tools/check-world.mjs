#!/usr/bin/env node
// Lints world/zones.js against the one rule that matters: can Kevin actually
// get to the thing?
//
//   node tools/check-world.mjs
//
// Every coordinate in zones.js is typed by hand off a painting, so the failure
// mode is not a crash — it is a label on a shelf he can never stand close
// enough to read, or a tray dropped inside a table. Both look like the world is
// broken and neither throws. This walks a grid over each floor polygon and
// checks it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
new Function('window', readFileSync(join(ROOT, 'world/zones.js'), 'utf8'))(win);
const ZONES = win.KEVIN_ZONES;

// Same maths as the engine: point-in-polygon, and distance in the squashed
// space the character actually walks in.
const inside = (F, x, y) => {
  let hit = false;
  for (let i = 0, j = F.length - 1; i < F.length; j = i++) {
    const [xi, yi] = F[i], [xj, yj] = F[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const reach = (x, y, px, py) => Math.hypot(px - x, (py - y) / 0.62);

const problems = [];
const say = (zone, msg) => problems.push(`${zone}: ${msg}`);

for (const [name, Z] of Object.entries(ZONES)) {
  // every walkable point, on a 10px grid
  const walk = [];
  for (let y = 0; y <= 864; y += 10)
    for (let x = 0; x <= 1536; x += 10)
      if (inside(Z.floor, x, y)) walk.push([x, y]);
  if (walk.length < 200) say(name, `floor is tiny (${walk.length} sample points) — check the polygon`);

  const nearest = (x, y) => Math.min(...walk.map(([wx, wy]) => reach(x, y, wx, wy)));

  for (const s of Z.spots ?? []) {
    const d = nearest(s.x, s.y);
    if (d > s.r) say(name, `spot "${s.name}" needs r>=${Math.ceil(d)} to be reachable (has ${s.r})`);
    if (s.to && !ZONES[s.to]) say(name, `spot "${s.name}" leads to unknown zone "${s.to}"`);
    if (s.to && s.at && !inside(ZONES[s.to].floor, s.at.x, s.at.y))
      say(name, `spot "${s.name}" drops you outside the floor of ${s.to}`);
  }

  for (const e of Z.exits ?? []) {
    if (!ZONES[e.to]) { say(name, `exit "${e.label}" leads to unknown zone "${e.to}"`); continue; }
    if (nearest(e.x, e.y) > e.r) say(name, `exit "${e.label}" can never be walked into`);
    const at = e.at ?? ZONES[e.to].spawn;
    if (!inside(ZONES[e.to].floor, at.x, at.y))
      say(name, `exit "${e.label}" drops you outside the floor of ${e.to}`);
  }

  // Arriving ON a doorway is the subtle one. The engine locks the exit until
  // you step off it, so you do not bounce — but if you land on the exit at the
  // bottom of a room, walking DOWN never gets you off it, and the door looks
  // broken. Land inside the room instead.
  const lands = [{ p: Z.spawn, why: 'spawn' }];
  for (const [n2, Z2] of Object.entries(ZONES))
    for (const e of [...(Z2.exits ?? []), ...(Z2.spots ?? [])])
      if (e.to === name) lands.push({ p: e.at ?? Z.spawn, why: `arrival from ${n2}` });
  for (const { p, why } of lands)
    for (const e of Z.exits ?? [])
      if (reach(e.x, e.y, p.x, p.y) < e.r)
        say(name, `${why} lands on the "${e.label}" exit`);

  if (!inside(Z.floor, Z.spawn.x, Z.spawn.y)) say(name, 'spawn is not on the floor');

  if (Z.job) {
    const J = Z.job;
    if (nearest(J.pickup.x, J.pickup.y) > J.pickup.r) say(name, `job pickup "${J.pickup.label}" is out of reach`);
    J.drops.forEach(([x, y], i) => {
      if (!inside(Z.floor, x, y)) say(name, `job drop ${i + 1} (${x},${y}) is off the floor`);
      // a drop sitting on the pickup would be collected the instant you load up
      if (reach(x, y, J.pickup.x, J.pickup.y) < J.pickup.r) say(name, `job drop ${i + 1} overlaps the pickup`);
    });
  }
}

for (const p of problems) console.log('  ' + p);
console.log(problems.length ? `\n${problems.length} problem(s)` : 'world ok');
process.exit(problems.length ? 1 : 0);
