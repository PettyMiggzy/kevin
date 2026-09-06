# KEVIN LOCK

> Turns "a 20% holder could dump at any moment" into "a 20% holder cannot sell
> faster than X a day, cannot change that, and has to say so publicly two weeks
> in advance if they want out."

---

## Why this is the most valuable thing here

A large holder with a vest is the single most bearish fact about a young token,
**and it is bearish before they sell anything.** Everyone can see the wallet.
Everyone can guess the unlock schedule. The rational move for every one of them
is to sell into that wallet's shadow first, so the chart bleeds on the
possibility alone. You do not have to dump to be dumped on. You only have to be
*able* to.

`KevinFloorV4` solves the wrong half of that. It makes your selling orderly —
no wicks, never below a floor, capped per trade and per day — and that is worth
having. But its owner can `sweep()` the whole balance in one transaction, so
nothing it holds is a commitment. It is a promise with a withdraw button, and
anybody who reads the contract can see that.

This is the commitment.

## The two ways out, and there is no third

| | how | limit |
|---|---|---|
| **Fast** | `release()` | at most `ratePerDay`, and **only ever to the floor keeper** |
| **Slow** | `requestExit()` → wait → `executeExit()` | full `exitDelay` of public notice, every time |

`release()` is permissionless — anyone may call it, including the keeper —
because the only thing it can do is move tokens toward the one contract that is
rate-limited and floor-limited. There is nothing to gain by calling it, so
there is no reason to gate it.

`requestExit()` **emits the moment it is called**. The countdown is public from
second one, and asking twice always restarts the full delay, so there is no way
to shorten it by being impatient.

**A ripe exit expires.** `exitWindow` (default 3 days) is how long a request
stays executable once it ripens, and without it the notice period would be a
one-time cost rather than a constraint: file on day zero for the whole bag, let
it ripen, never execute — and from day fourteen onward the beneficiary holds a
permanent, silent, one-transaction exit, and the countdown everybody watched
bought them nothing. A request now has to be used while it is fresh or filed
again in public. Immutable, for the same reason the delay is.

Read `exitState()` to see where things stand — it returns `pending`,
`executable`, the amount, the ripening time and the expiry. The view it replaced
returned zero for both "nothing is pending" and "ripe and executable this
second": the same number for the safest state and the most dangerous one, in the
view whose only job was telling them apart.

**There is no owner, no sweep, no rescue and no upgrade.** `floor`,
`beneficiary` and `exitDelay` are immutable. `ratePerDay` can only ever be
*lowered*. Every lever on the contract points the same direction: slower.

## One key holds it, and the notice period is why that is survivable

The beneficiary is `0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf` — one
wallet, not a multisig, deliberately, because it is the owner's money.

The thing worth understanding about that choice: **the fourteen-day notice
protects the bag even against that key being stolen.** Someone who takes the
wallet cannot take the tokens. They can call `requestExit()`, which emits a
public event and starts a countdown that cannot be shortened, and then they have
to wait two weeks in full view. The owner has two weeks to notice, to say so
publicly, and — since `cancelExit()` is also theirs — to cancel it if they can
recover the key or move first.

That is a genuinely better property than most multisigs have, and it comes for
free from the design. It is worth knowing so the single key is a considered
choice rather than an unexamined one.

What one key **does** still put fully at risk: everything in `KevinFloorV4`,
which the same wallet owns and can `sweep()` instantly. That is the argument for
keeping the floor keeper's working balance small — a few days' drip, not a
reserve — and letting the lockbox hold the rest.

## What it costs you

The honest version: **if the floor keeper turns out to have a bug, you wait out
the notice period to get your tokens back.** That is the price of the promise
being real, and it is why `exitDelay` is immutable — a notice period you can
shorten is not a notice period.

Fourteen days is the default. Longer is more credible and less recoverable.
That trade is yours and nobody else can make it for you.

## What it does not do

It only speaks for what is inside it. Tokens held anywhere else are not covered
by anything here, and **a lock holding a tenth of the bag is a press release,
not a commitment** — people will check, and finding the other 90% loose in a
hot wallet is worse than never having deployed this at all.

It also cannot make anyone buy. Nothing can. What it removes is the reason not
to.

## Deploying

```bash
export PRIVATE_KEY=...
export KEVIN_TOKEN=0x...
export FLOOR_ADDRESS=0x...     # the deployed KevinFloorV4. IMMUTABLE.
export BENEFICIARY=0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf   # IMMUTABLE
export RATE_PER_DAY=2000000000000000000000000   # 2m/day, 18 decimals
export EXIT_DELAY=1209600      # 14 days. IMMUTABLE.

forge script script/DeployLock.s.sol --rpc-url robinhood --broadcast
```

Set `RATE_PER_DAY` at or below the floor keeper's own `dailyTokenCap`, or the
difference just piles up in the floor unsold.

Then, in order:

1. Read the addresses it prints. **Neither can be changed and there is no
   rescue function.**
2. Send it a thousand tokens. Wait. Call `release()`. Watch them land in the
   floor keeper and get sold.
3. Only then send the bag.
4. From the **floor keeper's** owner: `setLockbox(<this address>)`.
   **Do not skip this, and it is one shot.** Until it is called, everything the
   lock releases lands in a contract the same single key can empty instantly
   with no notice — so the lock would be funnelling the bag straight past
   itself. These pools are small enough that a walk from spot to a 15% floor
   moves about 0.009 ETH of tokens, so inventory *accumulates* in the floor
   keeper rather than selling. A 20% lock draining into an unrestricted
   `sweep()` is not a weaker commitment than no lock; it is a worse one,
   because you will have published the claim.
5. **Publish the address.** A lock nobody knows about is worth exactly nothing
   — the entire point is that people can check it themselves.

## The keeper drives it

Set `LOCK_ADDRESS` and `keeper/floor.mjs` pushes the allowance into the floor
keeper as part of its normal loop. It refuses to start if the lockbox's `floor`
is not the contract it is driving, because a lockbox pointed at the wrong
address would be pushing the bag somewhere nothing can sell it.

It releases when about a quarter of a day has accrued, or immediately if the
floor keeper has run out of inventory. Not every tick: the allowance accrues
continuously, so a keeper that released whenever it *could* would send about
nineteen hundred dust transactions a day. It did exactly that on the first
rehearsal — three seconds after a clean two-million release it went back for
sixty-nine tokens.

## Tested

19 tests, and a 20,000-run fuzz that hammers both paths in random order across
random spans of time and asserts the only two things that matter: the drip
never runs ahead of the clock, and nothing leaves by the slow path without a
full notice period having actually elapsed.

The fuzz earned its keep — it found the time consumed by a release being
rounded *down*, which let the drip run a fraction of a second ahead on every
call and compound. It rounds up now. Every ambiguity in this contract resolves
against the treasury, because the whole value of it is that people believe the
bound.
