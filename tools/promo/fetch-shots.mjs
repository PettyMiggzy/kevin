#!/usr/bin/env node
/**
 * Poll Venice for queued shots and save the finished mp4s.
 *   node tools/promo/fetch-shots.mjs
 *
 * Kling O3 averages ~10 minutes a shot, so this is a long poll, not a request.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'assets/video/shots');
const API = 'https://api.venice.ai/api/v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const key = (await readFile(join(ROOT, 'tools/.venice.key'), 'utf8')).trim();
  const jobs = [];
  for (const f of (await readdir(OUT)).filter((f) => f.endsWith('.queue.json'))) {
    const j = JSON.parse(await readFile(join(OUT, f), 'utf8'));
    jobs.push({ id: j.id, queue_id: j.queue_id, model: j.model, done: false });
  }
  console.log(`polling ${jobs.length} shots`);

  const deadline = Date.now() + 30 * 60 * 1000;
  while (jobs.some((j) => !j.done) && Date.now() < deadline) {
    for (const j of jobs) {
      if (j.done) continue;
      const r = await fetch(`${API}/video/retrieve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: j.model, queue_id: j.queue_id }),
      });
      const ct = r.headers.get('content-type') || '';
      // A finished job answers with the mp4 itself rather than JSON status.
      if (r.ok && !ct.includes('application/json')) {
        const buf = Buffer.from(await r.arrayBuffer());
        await writeFile(join(OUT, `${j.id}.mp4`), buf);
        j.done = true;
        console.log(`${j.id}  DONE  ${(buf.length / 1048576).toFixed(1)} MB`);
        continue;
      }
      const t = await r.text();
      let s; try { s = JSON.parse(t); } catch { s = { raw: t.slice(0, 160) }; }
      if (s.status && s.status !== 'PROCESSING' && s.status !== 'PENDING' && s.status !== 'IN_QUEUE') {
        console.log(`${j.id}  status=${s.status} ${JSON.stringify(s).slice(0, 200)}`);
        if (s.status === 'FAILED' || s.status === 'ERROR') j.done = true;
      }
    }
    if (jobs.some((j) => !j.done)) await sleep(20000);
  }
  const left = jobs.filter((j) => !j.done).map((j) => j.id);
  if (left.length) console.log(`still processing after 30 min: ${left.join(', ')}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
