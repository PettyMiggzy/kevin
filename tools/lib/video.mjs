// Venice video: queue -> poll -> retrieve.
//
// Two things the docs make you find out the hard way: the source image is
// passed as a public URL (image_url), not base64, and /video/retrieve answers
// with the raw mp4 bytes rather than JSON once the job is done.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://api.venice.ai/api/v1';

/** Price a job before running it. Video is not cheap; always quote first. */
export async function quote(key, { model, duration = '5s', resolution = '720p', aspect_ratio = '16:9' }) {
  const r = await fetch(`${API}/video/quote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, duration, resolution, aspect_ratio }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`quote: ${JSON.stringify(j.details || j.error).slice(0, 200)}`);
  return j.quote;
}

export async function queue(key, body) {
  const r = await fetch(`${API}/video/queue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`queue ${r.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  if (!j.queue_id) throw new Error(`queue: no id — ${text.slice(0, 200)}`);
  return j.queue_id;
}

/**
 * Poll until the job produces video bytes. While it is still working the
 * endpoint answers JSON with a status; when it is done the body IS the mp4,
 * so a JSON parse failure is the success signal.
 */
export async function retrieve(key, { model, queue_id, timeoutMs = 900000, everyMs = 15000, onTick }) {
  const started = Date.now();
  let tick = 0;
  while (Date.now() - started < timeoutMs) {
    const r = await fetch(`${API}/video/retrieve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, queue_id }),
    });
    const type = r.headers.get('content-type') || '';
    if (type.includes('video') || type.includes('octet-stream')) {
      return Buffer.from(await r.arrayBuffer());
    }
    const buf = Buffer.from(await r.arrayBuffer());
    // an mp4 starts with a size box then 'ftyp' at offset 4
    if (buf.length > 5000 && buf.slice(4, 8).toString() === 'ftyp') return buf;
    let status = 'PROCESSING';
    try {
      const j = JSON.parse(buf.toString('utf8'));
      status = j.status || JSON.stringify(j).slice(0, 120);
      if (/fail|error/i.test(status)) throw new Error(`video failed: ${status}`);
    } catch (e) {
      if (e.message.startsWith('video failed')) throw e;
    }
    if (onTick) onTick(++tick, status);
    await new Promise((res) => setTimeout(res, everyMs));
  }
  throw new Error('video timed out');
}

export async function save(buf, dir, name) {
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  await writeFile(p, buf);
  return p;
}
