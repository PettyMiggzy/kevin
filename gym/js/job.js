// The shift. Kevin's other job, and where $KEVIN actually comes from.
//
// The gym spends; this earns. Deliberately a different game from the reps —
// the bench is one bar and one moment of timing, and doing that again with a
// burger on it would just be the bench with a burger on it. A shift is memory
// and speed under a clock instead: read the order, fill it, next.
//
// WHAT $KEVIN IS: a score in this browser. It is not the token, it is not
// supply, and nothing here mints, moves or promises anything on a chain. If
// that ever changes it has to change on a server with the wallet holding the
// balance — a number this file can write is a number a player can write.

/** Four items, because five is a memory test and three is not a choice. */
export const ITEMS = [
  { id: 'burger', label: 'BURGER', icon: '🍔', key: '1' },
  { id: 'fries', label: 'FRIES', icon: '🍟', key: '2' },
  { id: 'shake', label: 'SHAKE', icon: '🥤', key: '3' },
  { id: 'nuggets', label: 'NUGGETS', icon: '🍗', key: '4' },
];

export const SHIFT_LENGTH = 6;          // customers per shift
const BASE_PATIENCE = 9500;             // ms the first customer will wait
const MIN_PATIENCE = 5200;              // and the least the last one will
const MISTAKE_COST = 1400;              // ms of patience a wrong tap burns
const PAY_PER_ITEM = 4;                 // $KEVIN, before tip
const SPEED_TIP = 14;                   // most a fast, clean order can add

/** Names for the people at the window. Regulars, so the place feels used. */
const CUSTOMERS = [
  'Big Mike', 'Sandra', 'The Regular', 'Dave from work', 'Nan', 'Trav',
  'Two-Phones Tony', 'Kayla', 'The Night Guy', 'Mr. Peters',
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

/**
 * One customer's order: two to four items, and how long they will wait.
 *
 * Patience tightens across the shift rather than the order getting longer —
 * a six-item order is a reading test, a shorter clock is a skill one.
 */
function rollOrder(index) {
  const n = 2 + Math.floor(Math.random() * 3);
  const want = [];
  for (let i = 0; i < n; i++) want.push(pick(ITEMS).id);
  const t = index / Math.max(1, SHIFT_LENGTH - 1);
  return {
    name: pick(CUSTOMERS),
    want,
    filled: [],
    patience: BASE_PATIENCE + (MIN_PATIENCE - BASE_PATIENCE) * t,
  };
}

export class Shift {
  constructor(now = performance.now()) {
    this.orders = Array.from({ length: SHIFT_LENGTH }, (_, i) => rollOrder(i));
    this.index = 0;
    this.started = now;
    this.orderStarted = now;
    this.served = 0;
    this.walked = 0;            // customers whose patience ran out
    this.mistakes = 0;
    this.coin = 0;
    this.penalty = 0;           // patience burned on this order, in ms
    this.done = false;
  }

  get order() { return this.orders[this.index] ?? null; }

  /** 1 at the moment they arrive, 0 when they give up and walk. */
  patienceLeft(now) {
    const o = this.order;
    if (!o) return 0;
    const spent = now - this.orderStarted + this.penalty;
    return Math.max(0, 1 - spent / o.patience);
  }

  /** What still needs putting in the bag, as item ids. */
  remaining() {
    const o = this.order;
    if (!o) return [];
    const left = o.want.slice();
    for (const f of o.filled) {
      const i = left.indexOf(f);
      if (i !== -1) left.splice(i, 1);
    }
    return left;
  }

  /**
   * Put an item in the bag.
   *
   * Anything the order does not still need is a mistake: it costs patience
   * rather than ending the order, so a slip is a setback and not a fail state.
   */
  press(id, now = performance.now()) {
    const o = this.order;
    if (!o || this.done) return { ok: false, served: false };

    if (!this.remaining().includes(id)) {
      this.mistakes += 1;
      this.penalty += MISTAKE_COST;
      // Burning past the clock is the same as them walking out.
      if (this.patienceLeft(now) <= 0) return { ok: false, served: false, ...this.walk(now) };
      return { ok: false, served: false };
    }

    o.filled.push(id);
    if (this.remaining().length) return { ok: true, served: false };
    return { ok: true, ...this.serve(now) };
  }

  serve(now) {
    const o = this.order;
    const left = this.patienceLeft(now);
    const tip = Math.round(SPEED_TIP * left * (this.mistakes ? 0.5 : 1));
    const pay = o.want.length * PAY_PER_ITEM + tip;
    this.coin += pay;
    this.served += 1;
    const res = { served: true, pay, tip, fast: left > 0.55, name: o.name };
    this.next(now);
    return res;
  }

  walk(now) {
    this.walked += 1;
    const res = { walked: true, name: this.order?.name };
    this.next(now);
    return res;
  }

  next(now) {
    this.index += 1;
    this.orderStarted = now;
    this.penalty = 0;
    if (this.index >= this.orders.length) this.done = true;
  }

  /** Call every frame. Returns an event when somebody gives up. */
  tick(now = performance.now()) {
    if (this.done || !this.order) return null;
    if (this.patienceLeft(now) <= 0) return this.walk(now);
    return null;
  }

  /**
   * The shift's result. A clean shift pays a real bonus, because turning up
   * and getting every order right is the behaviour worth rewarding.
   */
  result() {
    // Clocking off halfway pays for what you actually served and nothing more.
    // Without this, walking away after one easy order counted as a clean shift
    // and paid the bonus for it.
    const complete = this.index >= this.orders.length;
    const clean = complete && this.walked === 0 && this.mistakes === 0;
    const allServed = complete && this.walked === 0;
    const bonus = clean ? 60 : allServed ? 25 : 0;
    return {
      served: this.served,
      walked: this.walked,
      mistakes: this.mistakes,
      coin: this.coin + bonus,
      bonus,
      clean,
      allServed,
      complete,
      title: !complete ? 'CLOCKED OFF'
        : clean ? 'PERFECT SHIFT'
        : allServed ? 'SHIFT DONE'
        : this.served ? 'ROUGH SHIFT' : 'DISASTER',
    };
  }
}
