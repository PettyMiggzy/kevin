// The set: five reps, each one a timing hit.
//
// This is the game. Everything else — the room, the decay, the shop — hangs off
// whether pressing the button at the right moment feels good, so the numbers in
// here matter more than anything in the scene.
//
// Shape of it: a marker sweeps a track, you press while it is over the target.
// The target has a hot centre worth more than its edges, so a good player is
// not merely hitting the zone, they are hitting the middle of it. The sweep
// speeds up each rep, which is what turns five presses into a set with an arc.

export const REPS_PER_SET = 5;

/** Landed in the hot centre. */
const PERFECT = 0.34;

export const GRADES = {
  perfect: { mult: 1.9, label: 'PERFECT', sound: 'perfect', shake: 0.5 },
  good: { mult: 1.15, label: 'GOOD', sound: 'good', shake: 0.22 },
  miss: { mult: 0.25, label: 'MISS', sound: 'miss', shake: 0.1 },
};

export class Set {
  /**
   * @param station  the station being worked
   * @param stamina  0..100 — a fit Kevin gets a wider target, which is the only
   *                 place stamina pays out and the reason to touch the treadmill
   */
  constructor(station, stamina = 0) {
    this.station = station;
    this.rep = 0;
    this.results = [];
    this.combo = 0;
    this.bestCombo = 0;
    this.done = false;

    // Heavier stations sweep slower but have a tighter target: the bench is
    // forgiving to time and unforgiving to place, the treadmill the reverse.
    this.baseSpeed = station.sweep ?? 1.05;
    this.baseHalf = (station.window ?? 0.15) + (stamina / 100) * 0.055;

    this.t = 0;
    this.dir = 1;
    this.pos = 0;
    this.target = 0.5;
    this.armed = false;
    this.nextRep();
  }

  nextRep() {
    if (this.rep >= REPS_PER_SET) { this.done = true; return; }
    this.rep += 1;
    // Later reps sweep faster and land the target further from centre, so the
    // fifth rep is a different problem from the first.
    this.speed = this.baseSpeed * (1 + (this.rep - 1) * 0.17);
    this.half = Math.max(0.055, this.baseHalf * (1 - (this.rep - 1) * 0.09));
    const spread = 0.30 - this.half;
    this.target = 0.5 + (Math.random() * 2 - 1) * spread;
    this.pos = this.dir > 0 ? 0 : 1;
    this.armed = true;
  }

  /** Advance the sweep. Returns true while the marker is still moving. */
  tick(dt) {
    if (this.done || !this.armed) return false;
    this.pos += this.dir * this.speed * dt;
    if (this.pos >= 1) { this.pos = 1; this.dir = -1; }
    else if (this.pos <= 0) { this.pos = 0; this.dir = 1; }
    this.t += dt;
    return true;
  }

  /**
   * A rep can also be failed by not pressing. Without this the optimal play is
   * to wait for a sweep that happens to line up, which is not a game.
   */
  get expired() {
    return this.armed && this.t > 2.6;
  }

  /** Press. Returns the graded rep. */
  hit() {
    if (!this.armed) return null;
    const d = Math.abs(this.pos - this.target);
    const grade = d <= this.half * PERFECT ? 'perfect' : d <= this.half ? 'good' : 'miss';
    return this.record(grade, d);
  }

  /** Ran out of time — counts as a miss, and breaks the combo like one. */
  timeout() {
    return this.record('miss', 1);
  }

  record(grade, distance) {
    this.armed = false;
    this.t = 0;
    if (grade === 'miss') {
      this.combo = 0;
    } else {
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    }
    const r = { grade, distance, rep: this.rep, combo: this.combo, ...GRADES[grade] };
    this.results.push(r);
    return r;
  }

  /**
   * The set's payout. Reps multiply the station's base gain; a clean set of
   * five pays a bonus on top, because the interesting decision is whether to
   * push for the streak or bank a scrappy set.
   */
  score() {
    const sum = this.results.reduce((n, r) => n + r.mult, 0) / REPS_PER_SET;
    const perfects = this.results.filter((r) => r.grade === 'perfect').length;
    const clean = !this.results.some((r) => r.grade === 'miss');
    const bonus = clean ? (perfects === REPS_PER_SET ? 0.6 : 0.25) : 0;
    return {
      mult: sum + bonus,
      perfects,
      misses: this.results.filter((r) => r.grade === 'miss').length,
      clean,
      flawless: perfects === REPS_PER_SET,
      bestCombo: this.bestCombo,
    };
  }
}

// --- rank -------------------------------------------------------------------
// Somewhere to be going. The thresholds are deliberately close together early
// so the first two arrive inside one session, and far apart later so the top
// one means something.

export const RANKS = [
  [0, 'New Starter'],
  [8, 'Trainee'],
  [20, 'Regular'],
  [34, 'Fry Cook'],
  [50, 'Gym Bro'],
  [66, 'Employee of the Month'],
  [80, 'Absolute Unit'],
  [92, 'CEO of Chaos'],
];

export function rankOf(muscle) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (muscle >= RANKS[k][0]) i = k;
  const next = RANKS[i + 1] ?? null;
  return {
    index: i,
    name: RANKS[i][1],
    next: next ? next[1] : null,
    toNext: next ? next[0] - muscle : 0,
    progress: next ? (muscle - RANKS[i][0]) / (next[0] - RANKS[i][0]) : 1,
  };
}
