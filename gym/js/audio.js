// Sound, synthesised. No files, so nothing to load and nothing to 404.
//
// A gym is metal hitting metal, so almost everything here is a short noise
// burst through a bandpass filter with a fast decay. Tones are for the UI only
// — the moment a rep sounds like a xylophone it stops sounding like a weight.
//
// Browsers refuse to start audio without a gesture, so the context is created
// on the first play() and every call is a no-op until then. Muted is honoured
// and remembered.

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  return ctx;
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.55;
}
export const isMuted = () => muted;

/** A burst of filtered noise — the basis of every physical sound in here. */
function noise(when, dur, freq, q, gain, type = 'bandpass') {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f).connect(g).connect(master);
  src.start(when);
  src.stop(when + dur);
}

function tone(when, dur, from, to, gain, type = 'square') {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, when);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + dur);
}

export function play(name) {
  if (muted || !ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;

  switch (name) {
    case 'perfect':
      // Metal, then a short rising confirmation on top of it.
      noise(t, 0.16, 2400, 3, 0.5);
      noise(t + 0.01, 0.30, 420, 6, 0.42);
      tone(t + 0.02, 0.16, 880, 1320, 0.16, 'triangle');
      break;
    case 'good':
      noise(t, 0.14, 1800, 3, 0.38);
      noise(t + 0.01, 0.24, 360, 5, 0.32);
      break;
    case 'miss':
      // A dropped plate: low, dead, and slightly too long.
      noise(t, 0.30, 190, 1.4, 0.46, 'lowpass');
      tone(t, 0.22, 200, 90, 0.10, 'sawtooth');
      break;
    case 'rack':
      noise(t, 0.22, 3000, 2.5, 0.34);
      noise(t + 0.05, 0.34, 300, 5, 0.30);
      break;
    case 'step':
      noise(t, 0.05, 900, 1.2, 0.10, 'lowpass');
      break;
    case 'set':
      // Set complete: three rising notes, the only melodic thing in the game.
      tone(t, 0.10, 523, 523, 0.14, 'triangle');
      tone(t + 0.09, 0.10, 659, 659, 0.14, 'triangle');
      tone(t + 0.18, 0.20, 784, 784, 0.16, 'triangle');
      break;
    case 'rank':
      for (let i = 0; i < 4; i++) tone(t + i * 0.11, 0.24, 392 * Math.pow(1.26, i), 392 * Math.pow(1.26, i), 0.15, 'triangle');
      break;
    case 'buy':
      tone(t, 0.07, 660, 660, 0.13, 'square');
      tone(t + 0.07, 0.14, 990, 990, 0.13, 'square');
      break;
    case 'deny':
      tone(t, 0.14, 200, 140, 0.13, 'square');
      break;
    case 'ui':
      tone(t, 0.04, 740, 740, 0.07, 'square');
      break;
    default:
  }
}
