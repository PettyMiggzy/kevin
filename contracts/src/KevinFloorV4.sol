// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/**
 * @title  KevinFloorV4
 * @notice Sells $KEVIN into strength and buys it back into weakness, against a
 *         floor the pool itself refuses to cross.
 *
 * @dev  ---------------------------------------------------------------------
 *       THE ONE IDEA THIS IS BUILT ON
 *       ---------------------------------------------------------------------
 *       Uniswap v4's swap takes a `sqrtPriceLimitX96`, and the pool stops
 *       filling when the price reaches it. Not "reverts" — STOPS, having filled
 *       what fit and consumed only that much of the input.
 *
 *       So "sell into buy pressure but never wreck the chart" is not a
 *       heuristic here and does not depend on the keeper guessing a size. Offer
 *       the pool more than you think it can take, with the limit set at the
 *       floor, and it sells exactly as much as fits above the floor and hands
 *       the rest back. Buyers push the price up, room opens, the next poke
 *       sells into it. Nobody has to measure volume. The price cannot be pushed
 *       below the floor by this contract, because the pool will not do it.
 *
 *       That is a stronger guarantee than any amount of off-chain care, and it
 *       is the reason this is worth being a contract.
 *
 *       ---------------------------------------------------------------------
 *       IT IS TWO-SIDED, AND THAT IS DELIBERATE
 *       ---------------------------------------------------------------------
 *       A contract that only ever sells is a distribution bot. Calling one a
 *       floor keeper is the kind of gap between a name and a net flow that gets
 *       found — every fill is an event on a public chain, and the address is
 *       one click from the chart.
 *
 *       This one also bids: `buybackBps` of every sale's proceeds is held back
 *       and spent buying $KEVIN when the price falls under the floor's own buy
 *       band. Set it to zero and you have a pure distribution bot, which is
 *       your call to make; leave it non-zero and the thing is what it says on
 *       the tin, the sells fund the bids, and the whole of it is auditable by
 *       anybody who cares to read the events.
 *
 *       ---------------------------------------------------------------------
 *       THE FLOOR RATCHETS
 *       ---------------------------------------------------------------------
 *       `floorSqrtPriceX96` only ever moves in the direction that means $KEVIN
 *       is worth more, by at most `ratchetBps` per call, and never past
 *       `floorGapBps` under spot. So the level being defended rises with the
 *       chart instead of anchoring to launch day, and one manipulated block
 *       cannot drag it anywhere.
 *
 *       ---------------------------------------------------------------------
 *       ...AND IT YIELDS, OR IT WOULD NEVER SELL AGAIN
 *       ---------------------------------------------------------------------
 *       A floor that only goes up is a floor that stops working the first time
 *       the price makes a high and does not come back. The chart sets a top,
 *       the floor ratchets under it, the market drifts down and sits there —
 *       and the contract waits forever for a price that is not coming, while
 *       the tokens it is supposed to be distributing pile up.
 *
 *       So the floor is a HIGH-WATER MARK, not a promise. While the price is
 *       under it, it waits `patience`, and then eases toward the market at
 *       `decayBpsPerDay` a day, never further than `maxDecayBps` below the
 *       high-water mark.
 *
 *       WAITING IS TIME SOMEBODY WATCHED, not time that passed. The clock is
 *       an accumulator advanced by `observe()`, which anyone may call and a
 *       pause does not block, and no single observation may move it by more
 *       than `MAX_OBSERVATION`. Time nobody looked at is worth nothing to
 *       either side, so an outage cannot quietly spend the allowance, and a
 *       price pushed to the floor for one block cannot wipe it. Coming back
 *       unwinds the clock at the rate it was earned rather than resetting it,
 *       because an instant reset is a thing an attacker can buy.
 *
 *       That does not weaken the "never wreck my chart" guarantee, because
 *       `sellStopBps` is a separate limit on every individual sale. What it
 *       bounds is the RATE: in a market with no buyers at all, the most this
 *       contract can walk the price down is `decayBpsPerDay` per day, because
 *       that is all the room a day of waiting opens — and it stops entirely
 *       once `maxDecayBps` is spent. A slow drip with a hard bottom, instead
 *       of an indefinite stall.
 *
 *       ---------------------------------------------------------------------
 *       WHICH WAY IS UP
 *       ---------------------------------------------------------------------
 *       v4 prices a pool as currency1 per currency0, and native ETH is
 *       address(0), which sorts below every token — so in an ETH-paired pool
 *       $KEVIN is currency1 and a RISING $KEVIN is a FALLING sqrtPrice. In a
 *       WETH-paired pool it depends on how the two addresses sort. Getting that
 *       backwards would make the contract sell into every dip, so the direction
 *       is decided once in the constructor and everything else asks
 *       `_isBetter`.
 */
contract KevinFloorV4 is Ownable2Step, ReentrancyGuard, Pausable, IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 private constant BPS = 10_000;

    // --- what the owner may never do, whatever happens to the key ----------
    //
    // A stolen owner key does not need `sweep()`. Two transactions moving zero
    // tokens — `sellStopBps = 9999` and `cooldown = 0` — would turn "no sale
    // may move the chart more than 2.5%" into no guarantee at all, quietly,
    // with nothing on chain that looks like a theft until the candle prints.
    //
    // These are the published ceilings. They are constants, so they are part of
    // the deployed bytecode and anybody can check that no setting can ever
    // exceed them. This, and not a multisig, is the real answer to one key.
    uint256 public constant MAX_SELL_STOP_BPS = 500; // no sale may move price >5%
    uint256 public constant MAX_FLOOR_GAP_BPS = 3_000;
    uint256 public constant MAX_RATCHET_BPS = 2_000;
    uint256 public constant MAX_BUY_BAND_BPS = 3_000;
    uint256 public constant MIN_COOLDOWN = 60;
    /// @notice The most time one observation may add to or take off the
    ///         underwater clock. Bounds what a gap in watching is worth to
    ///         either side. The keeper ticks every few minutes, so normal
    ///         operation is never clipped by this.
    uint256 public constant MAX_OBSERVATION = 1 hours;
    /// @notice Ceiling on how far the floor may ever be allowed to yield.
    ///         setPatience() was the one policy dial with no bytecode ceiling,
    ///         and it is the dial that sets the floor's own hard bottom.
    uint256 public constant MAX_FLOOR_DECAY_BPS = 3_000;
    uint256 private constant DAY = 1 days;
    /// @dev v4's own bounds on a price limit, from TickMath.
    uint160 private constant MIN_SQRT = 4_295_128_739;
    uint160 private constant MAX_SQRT =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    IPoolManager public immutable manager;
    Currency public immutable currency0;
    Currency public immutable currency1;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    IHooks public immutable hooks;

    /// @dev $KEVIN is currency0 of the pair. Decided once, at deploy.
    bool public immutable tokenIsZero;
    /// @dev A higher sqrtPrice means a higher $KEVIN price. True iff $KEVIN is
    ///      currency0 — v4 prices currency1 PER currency0, so $KEVIN as
    ///      currency1 makes the pool price the inverse of $KEVIN's.
    ///      (This comment said "currency1" and was simply wrong. The code is
    ///      right, and it is the one field the docs tell every reader to check.)
    bool public immutable upIsUp;

    address public operator;
    /// @notice Once set, the only address $KEVIN may be swept to. See sweep().
    address public lockbox;

    // --- the floor ----------------------------------------------------------

    /// @notice The price the pool is told not to cross when this contract sells.
    uint160 public floorSqrtPriceX96;
    /// @notice How far under spot the floor is allowed to sit when ratcheting.
    uint256 public floorGapBps;
    /// @notice How far the floor may move in one call.
    uint256 public ratchetBps;
    /// @notice How far under the floor spot must fall before this contract bids.
    uint256 public buyBandBps;
    /// @notice The most one sale may move the price, in bps off spot.
    ///
    /// THE FLOOR AND THE SELL STOP ARE NOT THE SAME LEVEL, and conflating them
    /// was the first version's real mistake. The floor is the level you DEFEND —
    /// it wants to be a long way under spot to be worth anything. The sell stop
    /// is how far one sale may walk the price DOWN — it wants to be small. With
    /// one number doing both jobs at 15%, every poke sold the price 15% lower,
    /// which is precisely the chart-wrecking this exists to prevent. Driving it
    /// against a live pool is what made that obvious.
    uint256 public sellStopBps;
    /// @notice The share of each sale's proceeds reserved for buying back.
    uint256 public buybackBps;
    /// @notice Proceeds set aside by `buybackBps` and not yet spent.
    uint256 public warChest;

    // --- patience -----------------------------------------------------------
    // The floor above is the high-water mark. What is actually defended is
    // `effectiveFloorSqrtPriceX96()`, which is that mark eased toward a market
    // that has walked away from it.

    /// @notice How long the price must be seen under the floor before it starts
    ///         to yield. ZERO MEANS NO WAIT AT ALL — the floor begins yielding
    ///         immediately. It is `decayBpsPerDay = 0` that disables yielding;
    ///         this comment said the opposite, which is a dangerous way round
    ///         to be wrong about the dial that holds the floor up.
    uint256 public patience;
    /// @notice How far the floor eases per day of waiting, in price bps.
    uint256 public decayBpsPerDay;
    /// @notice The most the floor may ever sit below its high-water mark.
    ///         The hard bottom: past this it stops chasing and just waits.
    uint256 public maxDecayBps;
    /// @notice Seconds the price has been SEEN under the floor, accumulated.
    ///
    /// THIS USED TO BE A SINGLE TIMESTAMP AND IT WAS WRONG IN BOTH DIRECTIONS.
    /// `floorHeldSince` was only ever written by a privileged call, and the
    /// decay was `now - floorHeldSince` with no knowledge of what the price
    /// had actually done in between. So a month in which the chart was
    /// perfectly healthy but nobody called still counted as a month of
    /// waiting, and the first dip afterwards released the entire allowance at
    /// once — the published "decayBpsPerDay a day" bound was not a bound at
    /// all. `pause()`, the advertised emergency stop, guaranteed that state,
    /// because it blocks the only two functions that could have reset it.
    ///
    /// And it was equally broken the other way: because ANY single call
    /// finding spot at the floor reset the whole thing to zero, one swap
    /// round-trip timed against the keeper's tick pinned it at zero forever
    /// and the floor could never yield, which kills the sell side permanently.
    ///
    /// So the clock now counts only time somebody actually WATCHED, in either
    /// direction, and no observation may credit or debit more than
    /// MAX_OBSERVATION at once. Time nobody looked at is worth nothing to
    /// either side: an outage costs at most an hour, and a manipulated tick
    /// buys at most an hour.
    uint256 public underwaterSeconds;
    /// @notice When the accumulator was last advanced.
    uint256 public lastObservedAt;

    // --- the rails ----------------------------------------------------------

    uint256 public maxTokensPerTrade;
    uint256 public maxQuotePerTrade;
    uint256 public dailyTokenCap;
    uint256 public dailyQuoteCap;
    uint256 public cooldown;

    uint256 public lastTradeAt;
    /// @notice When the floor last moved up. The ratchet's own rate limit.
    uint256 public lastRatchetAt;
    /// @notice A floor level sighted once and waiting to be confirmed by a
    ///         second reading before it can become permanent. Zero if none.
    uint160 public pendingFloor;
    /// @notice When that sighting was taken.
    uint256 public pendingFloorAt;
    /// @notice How long the floor must wait between upward moves, so that
    ///         `ratchetBps` is a rate rather than a per-call constant.
    uint256 public ratchetCooldown;
    /// @notice A LEAKY BUCKET, not a calendar window.
    ///
    /// This was a tumbling window: a counter reset to zero the moment a day had
    /// passed since the last reset. The published claim is "capped per day",
    /// and a tumbling window does not deliver that — spend the whole cap in the
    /// last minute before the boundary, spend it again in the first minute
    /// after, and twice the daily cap has gone out inside two minutes without
    /// either check failing.
    ///
    /// The bucket instead drains continuously at exactly `cap` per day, so the
    /// limit holds over EVERY window rather than over the particular ones the
    /// contract happened to draw. There is no boundary to sit on.
    uint256 public tokensInBucket;
    uint256 public quoteInBucket;
    uint256 public bucketDrainedAt;

    struct Job {
        bool selling;
        uint256 amountIn;
        uint160 limit;
    }

    event OperatorSet(address indexed operator);
    event FloorMoved(uint160 from, uint160 to, uint160 spot);
    event FloorProposed(uint160 from, uint160 to, uint160 spot);
    event PolicySet(
        uint256 floorGapBps,
        uint256 ratchetBps,
        uint256 buyBandBps,
        uint256 buybackBps,
        uint256 sellStopBps
    );
    event RailsSet(
        uint256 maxTokensPerTrade,
        uint256 maxQuotePerTrade,
        uint256 dailyTokenCap,
        uint256 dailyQuoteCap,
        uint256 cooldown
    );
    event Sold(uint256 tokensIn, uint256 quoteOut, uint256 reserved, uint160 spotAfter);
    event Bought(uint256 quoteIn, uint256 tokensOut, uint160 spotAfter);
    event PatienceSet(uint256 patience, uint256 decayBpsPerDay, uint256 maxDecayBps);
    event RatchetCooldownSet(uint256 seconds_);
    event LockboxSet(address indexed lockbox);
    event Swept(address indexed asset, address indexed to, uint256 amount);

    error NotOperator();
    /// @dev What a poke actually got per unit spent, and the least the caller
    ///      was willing to accept. Both are Q96 fixed point.
    error Slipped(uint256 rate, uint256 minRate);
    error NotManager();
    error NothingToDo();
    error TooSoon();
    error OverDailyCap();
    error NoFloorYet();
    error BadParam();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(address owner_, IPoolManager manager_, PoolKey memory key, address token_)
        Ownable(owner_)
    {
        if (address(manager_) == address(0) || token_ == address(0)) revert BadParam();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 != token_ && c1 != token_) revert BadParam();

        manager = manager_;
        currency0 = key.currency0;
        currency1 = key.currency1;
        poolFee = key.fee;
        tickSpacing = key.tickSpacing;
        hooks = key.hooks;

        tokenIsZero = c0 == token_;
        // v4 prices a pool as currency1 PER currency0. So if $KEVIN is
        // currency0 the pool price is quote-per-KEVIN and up is up; if $KEVIN
        // is currency1 the pool price is KEVIN-per-quote — the inverse — and a
        // rising sqrtPrice means $KEVIN is getting CHEAPER.
        //
        // This was written the other way round first. test_knowsWhichWayIsUp
        // and every ratchet test caught it immediately, which is why they are
        // the first tests in the file: an inverted orientation here would make
        // the contract sell into every dip and call it strength.
        upIsUp = tokenIsZero;

        floorGapBps = 1_500; // the floor sits 15% under spot
        ratchetBps = 500; // and moves at most 5% at a time
        buyBandBps = 800; // bid once spot is 8% under the floor
        buybackBps = 3_000; // 30% of every sale is kept to bid with
        sellStopBps = 250; // no sale may walk the price more than 2.5%
        patience = 3 days; // hold at full height for three days under water
        decayBpsPerDay = 150; // then give up 1.5% a day looking for the market
        maxDecayBps = 3_000; // and never more than 30% under the high-water mark
        cooldown = 5 minutes;
        ratchetCooldown = 5 minutes;
        bucketDrainedAt = block.timestamp;
    }

    // --- what it is looking at ----------------------------------------------

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(currency0, currency1, poolFee, tickSpacing, hooks);
    }

    function poolId() public view returns (PoolId) {
        return poolKey().toId();
    }

    /// @notice The pool's current sqrt price, in the pool's own orientation.
    function spotSqrtPriceX96() public view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = manager.getSlot0(poolId());
    }

    /// @notice How far the floor has eased below its high-water mark, in price
    ///         bps, purely as a function of how long the price has been under
    ///         it. Nothing accrues it and nothing has to be called to advance
    ///         it — which is also why nobody can advance it faster by calling
    ///         more often.
    function floorDecayBps() public view returns (uint256) {
        if (floorSqrtPriceX96 == 0 || decayBpsPerDay == 0) return 0;
        // Observed time only. Time since the last observation is deliberately
        // NOT counted: it has not been watched, so nobody can say what the
        // price did, and guessing in the permissive direction is what made the
        // old version's rate bound meaningless.
        uint256 held = underwaterSeconds;
        if (held <= patience) return 0;
        uint256 d = ((held - patience) * decayBpsPerDay) / DAY;
        return d > maxDecayBps ? maxDecayBps : d;
    }

    /// @notice The level actually defended right now: the high-water floor,
    ///         eased by whatever the waiting has cost it. This is the number
    ///         every swap carries as its price limit.
    function effectiveFloorSqrtPriceX96() public view returns (uint160) {
        uint160 f = floorSqrtPriceX96;
        if (f == 0) return 0;
        uint256 d = floorDecayBps();
        return d == 0 ? f : _worseBy(f, d); // _scale keeps it inside v4's bounds
    }

    /// @notice Record what the price is doing right now.
    ///
    /// @dev PERMISSIONLESS AND NOT PAUSABLE, both deliberately. It moves no
    ///      money and grants nothing, so there is nothing to gain by calling
    ///      it; and the old version could only be advanced by `poke` and
    ///      `ratchet`, which meant an outage, a pause, or simply a `poke` that
    ///      reverted (routine now that no lock drips inventory in — the
    ///      revert rolls the write back) all left the clock unattended while
    ///      the decay kept counting. Anyone can now keep it honest.
    function observe() public {
        _observe();
    }

    /// @dev Advance the underwater clock by the time since the last look,
    ///      capped at MAX_OBSERVATION, in whichever direction the price is.
    ///      Symmetric on purpose: a momentary spike to the floor now buys back
    ///      only the time it actually covers instead of wiping the clock, so
    ///      pinning it at zero costs an attacker the whole period rather than
    ///      one well-timed block.
    function _observe() internal {
        if (floorSqrtPriceX96 == 0) return;
        uint256 last = lastObservedAt;
        lastObservedAt = block.timestamp;
        if (last == 0 || block.timestamp <= last) return;
        uint256 elapsed = block.timestamp - last;
        if (elapsed > MAX_OBSERVATION) elapsed = MAX_OBSERVATION;

        uint256 held = underwaterSeconds;
        if (_isBetter(floorSqrtPriceX96, spotSqrtPriceX96())) {
            // The floor is a better price than spot, i.e. spot is under it.
            uint256 cap = _underwaterCap();
            held += elapsed;
            underwaterSeconds = held > cap ? cap : held;
        } else {
            underwaterSeconds = elapsed >= held ? 0 : held - elapsed;
        }
    }

    /// @dev The most the accumulator can usefully hold: past this the decay is
    ///      already pinned at maxDecayBps, so letting it grow further would
    ///      only mean the price has to be back for longer before the floor
    ///      recovers, which is not a promise this contract makes.
    function _underwaterCap() internal view returns (uint256) {
        if (decayBpsPerDay == 0) return patience;
        return patience + (maxDecayBps * DAY) / decayBpsPerDay;
    }

    /// @notice Is `a` a better price for $KEVIN than `b`?
    function _isBetter(uint160 a, uint160 b) internal view returns (bool) {
        return upIsUp ? a > b : a < b;
    }

    /// @dev `x`, moved so that $KEVIN is worth `bps` LESS.
    ///
    /// EVERY BPS IN THIS CONTRACT IS A PRICE MOVE, NOT A SQRT-PRICE MOVE, and
    /// the two are not the same thing: a 2.5% move in sqrt space is a 5.06%
    /// move in price. The first version applied the bps straight to the sqrt
    /// price, so every number in the docs — and every number you would set
    /// after reading them — meant about twice what it said. On the one dial
    /// that matters, "no sale may move the chart more than 2.5%", that is not
    /// a rounding difference. So the conversion happens here, once, and
    /// `sellStopBps = 250` means the $KEVIN price moved 2.5%.
    function _worseBy(uint160 x, uint256 bps) internal view returns (uint160) {
        return upIsUp ? _scale(x, BPS - bps, BPS) : _scale(x, BPS, BPS - bps);
    }

    /// @notice What a poke would do right now. `floorAt` is the EFFECTIVE
    ///         floor — the high-water mark eased by any waiting — because that
    ///         is the level the swaps will actually carry.
    function reading() public view returns (bool sell, bool buy, uint160 spot, uint160 floorAt) {
        spot = spotSqrtPriceX96();
        floorAt = effectiveFloorSqrtPriceX96();
        if (floorAt == 0) return (false, false, spot, floorAt);
        // Sell whenever there is any room above the floor at all: the pool
        // itself decides how much, which is the point.
        sell = _isBetter(spot, floorAt);
        buy = _isBetter(_worseBy(floorAt, buyBandBps), spot) && warChest > 0;
    }

    // --- the trigger --------------------------------------------------------

    /**
     * @notice Sell into whatever room is above the floor, or bid under it.
     *
     * @param  size how much to offer. Clamped to the per-trade cap. Offering
     *              more than the pool can take is not a mistake here — the
     *              price limit decides the fill, so `type(uint256).max` means
     *              "as much as fits above the floor, up to the cap".
     *
     * @param  minRateX96 the WORST average execution price the caller will
     *              accept, as output-per-input in Q96. Zero disables the
     *              check, which is only ever right for a rescue by hand.
     *
     * @dev THE PRICE LIMIT IS NOT SLIPPAGE PROTECTION, AND THIS IS WHY.
     *
     *      `sqrtPriceLimitX96` bounds where the price ENDS UP. It says nothing
     *      about the average the fill went out at, and — worse — the sell
     *      limit is derived from `spotSqrtPriceX96()` READ DURING THE SWAP.
     *      Move spot before the call lands and the stop moves with it, so the
     *      contract obligingly recomputes a limit around the manipulated
     *      price and sells into it. The floor still holds; everything between
     *      spot and the floor does not.
     *
     *      That is an ordinary sandwich, and this pool has an audience for it:
     *      five distinct searchers ran closed loops across these pools in the
     *      last 400k blocks (`docs/ARBITRAGE.md`). The exposure was measured
     *      at about 1.9% of whatever the keeper traded.
     *
     *      The fix has to come from OUTSIDE the transaction, because every
     *      number inside it is downstream of a spot price the attacker just
     *      set. So the caller passes the rate it expects, computed from a
     *      price it read in an earlier block, and a fill worse than that
     *      reverts. `minRateX96` is a RATE and not an amount on purpose: the
     *      pool decides the fill size here, so the caller cannot know the
     *      amount in advance, but it can always know what a fair price is.
     */
    function poke(uint256 size, uint256 minRateX96)
        external
        nonReentrant
        whenNotPaused
        onlyOperator
    {
        if (floorSqrtPriceX96 == 0) revert NoFloorYet();
        // Before deciding anything: if the price is back at the floor, the
        // waiting is over and the floor is at full height again.
        _observe();
        (bool sell, bool buy,,) = reading();
        if (sell) {
            _sell(size, minRateX96);
        } else if (buy) {
            _buy(size, minRateX96);
        } else {
            revert NothingToDo();
        }
    }

    /// @dev Revert unless the fill's average price is at least `minRateX96`.
    ///      Called after the swap, so the revert unwinds it.
    function _requireRate(uint256 spent, uint256 got, uint256 minRateX96) internal pure {
        if (minRateX96 == 0) return;
        uint256 rate = Math.mulDiv(got, 1 << 96, spent);
        if (rate < minRateX96) revert Slipped(rate, minRateX96);
    }

    /**
     * @notice Move the floor up toward spot.
     *
     * @dev THIS WAS PERMISSIONLESS AND IT WAS A CRITICAL BUG. The reasoning was
     *      that the floor only moves in the direction that makes this contract
     *      sell less, "which costs an attacker money and saves us none". That is
     *      false, because freezing the distribution IS the attacker's goal.
     *
     *      `ratchetBps` caps the move per CALL, and the ceiling is recomputed
     *      from the freshly-written floor every time. So an attacker contract
     *      pumped the price, called this thirty times in ONE transaction — each
     *      call compounding 1.05 on the last — dumped, and left in the same
     *      block. `nonReentrant` does not help: it releases between top-level
     *      calls. The measured cost against a pool deeper than ours was 0.0153
     *      ETH, and the floor never comes down, so the sell side was dead
     *      permanently: 20% of supply with nowhere to go but a `sweep()`.
     *      `test_ratchetCannotBeWalkedUpInOneBlock` is that attack, kept.
     *
     *      Two changes, both needed. `onlyOperator`, because nobody else ever
     *      had a reason to call this and the argument for letting them was the
     *      false one above. And a cooldown, so `ratchetBps` bounds the move per
     *      unit of TIME rather than per call — which is what bounds a leaked
     *      operator key, the one caller that is left.
     */
    function ratchet() external nonReentrant whenNotPaused onlyOperator {
        uint160 spot = spotSqrtPriceX96();
        uint160 was = floorSqrtPriceX96;
        if (was == 0) revert NoFloorYet();
        // Returns rather than reverts: the keeper calls this every tick and a
        // revert would be indistinguishable from a real failure in its log.
        if (block.timestamp < lastRatchetAt + ratchetCooldown) return;
        // The keeper calls this every tick, so it is the reliable place to
        // keep the underwater clock current as well.
        _observe();

        uint160 target = _worseBy(spot, floorGapBps);
        if (!_isBetter(target, was)) {
            // Spot has fallen back below what was already proposed. Drop the
            // proposal rather than letting a stale high reading ripen.
            if (pendingFloor != 0) {
                pendingFloor = 0;
                pendingFloorAt = 0;
            }
            return; // the floor never comes down
        }

        // TWO READS, ratchetCooldown APART, AND THE FLOOR TAKES THE WORSE ONE.
        //
        // The mark this sets is PERMANENT — it never comes down — and it used
        // to be derived from one instantaneous `slot0` read. Anyone willing to
        // spend a swap could push spot up in the block the keeper's tick
        // landed and leave the floor parked above the honest market, which
        // freezes selling and then turns every later poke into a forced
        // above-market bid. A price that has to hold across two separate
        // observations, with the lower of the two winning, cannot be faked by
        // one block: the attacker has to hold the price up for the whole
        // cooldown against everyone arbitraging them.
        if (pendingFloor == 0 || _isBetter(pendingFloor, target)) {
            // First sighting, or the proposal was optimistic — record the
            // conservative one and make it wait.
            pendingFloor = target;
            pendingFloorAt = block.timestamp;
            emit FloorProposed(was, target, spot);
            return;
        }
        if (block.timestamp < pendingFloorAt + ratchetCooldown) return;

        uint160 sustained = pendingFloor; // already the worse of the two reads
        pendingFloor = 0;
        pendingFloorAt = 0;

        uint160 ceiling = _betterBy(was, ratchetBps);
        uint160 next = _isBetter(sustained, ceiling) ? ceiling : sustained;
        if (!_isBetter(next, was)) return;
        floorSqrtPriceX96 = next;
        // A higher floor means more of the market is under it, so the clock
        // starts again from nothing rather than carrying the old level's debt.
        underwaterSeconds = 0;
        lastObservedAt = block.timestamp;
        lastRatchetAt = block.timestamp;
        emit FloorMoved(was, next, spot);
    }

    /// @dev `x`, moved so that $KEVIN is worth `bps` MORE.
    function _betterBy(uint160 x, uint256 bps) internal view returns (uint160) {
        return upIsUp ? _scale(x, BPS + bps, BPS) : _scale(x, BPS, BPS + bps);
    }

    /// @dev x * sqrt(num/den). A price ratio of num/den is a sqrt-price ratio
    ///      of its square root, which is the whole reason this helper exists.
    ///      Full-width throughout: x is up to 2^160 and the Q96 multiplier up
    ///      to 2^103, so the intermediate product does not fit in a word.
    function _scale(uint160 x, uint256 num, uint256 den) internal pure returns (uint160) {
        uint256 mQ96 = Math.sqrt(Math.mulDiv(num, 1 << 192, den));
        uint256 v = Math.mulDiv(uint256(x), mQ96, 1 << 96);
        // Clamped rather than cast, because a bare uint160() here would wrap a
        // price near the top of the range around to a tiny one — which is to
        // say, silently turn a limit that means "do not go below this" into one
        // that means "sell into anything". Real pool prices are nowhere near
        // these bounds; that is exactly why it would never be noticed.
        if (v <= MIN_SQRT) return MIN_SQRT + 1;
        if (v >= MAX_SQRT) return MAX_SQRT - 1;
        return uint160(v);
    }

    // --- the two things it does ---------------------------------------------

    function _sell(uint256 size, uint256 minRateX96) internal {
        _tick();
        uint256 have = IERC20(_token()).balanceOf(address(this));
        uint256 amountIn = size < have ? size : have;
        if (amountIn > maxTokensPerTrade) amountIn = maxTokensPerTrade;
        if (amountIn == 0) revert NothingToDo();
        // Clamp to the day's remaining room rather than refusing. This compared
        // the OFFERED size against the cap, and the offer is always the whole
        // per-trade maximum — so it started reverting OverDailyCap once the
        // window was within one trade of the cap, whatever the actual fill
        // would have been, and handed the keeper a revert instead of a sale.
        uint256 room = dailyTokenCap > tokensInBucket ? dailyTokenCap - tokensInBucket : 0;
        if (amountIn > room) amountIn = room;
        if (amountIn == 0) revert OverDailyCap();

        // THE WHOLE MECHANISM. The pool fills what fits above the limit and
        // stops, so overshooting `amountIn` is free — the unfilled remainder
        // never leaves this contract.
        //
        // The limit is the TIGHTER of two levels: the floor, which must never be
        // crossed, and a stop `sellStopBps` under the current price, which caps
        // how far this one sale may walk the chart. Without the second, a floor
        // sitting 15% down means every sale sells 15% down.
        uint160 defended = effectiveFloorSqrtPriceX96();
        uint160 stop = _worseBy(spotSqrtPriceX96(), sellStopBps);
        uint160 limit = _isBetter(stop, defended) ? stop : defended;
        (uint256 spent, uint256 got) = _swap(true, amountIn, limit);
        if (spent == 0) revert NothingToDo();
        _requireRate(spent, got, minRateX96);

        uint256 reserved = (got * buybackBps) / BPS;
        warChest += reserved;
        tokensInBucket += spent;
        lastTradeAt = block.timestamp;
        emit Sold(spent, got, reserved, spotSqrtPriceX96());
    }

    function _buy(uint256 size, uint256 minRateX96) internal {
        _tick();
        uint256 amountIn = size < warChest ? size : warChest;
        if (amountIn > maxQuotePerTrade) amountIn = maxQuotePerTrade;
        if (amountIn == 0) revert NothingToDo();
        uint256 room = dailyQuoteCap > quoteInBucket ? dailyQuoteCap - quoteInBucket : 0;
        if (amountIn > room) amountIn = room;
        if (amountIn == 0) revert OverDailyCap();

        // Buying pushes the price toward the floor from below. Stop at the
        // floor: past it the contract would be bidding above its own level.
        (uint256 spent, uint256 got) = _swap(false, amountIn, effectiveFloorSqrtPriceX96());
        if (spent == 0) revert NothingToDo();
        _requireRate(spent, got, minRateX96);

        warChest -= spent;
        quoteInBucket += spent;
        lastTradeAt = block.timestamp;
        emit Bought(spent, got, spotSqrtPriceX96());
    }

    function _tick() internal {
        if (lastTradeAt != 0 && block.timestamp < lastTradeAt + cooldown) revert TooSoon();
        // Drain by exactly cap-per-day of elapsed time. Rounds DOWN, so the
        // rounding costs the contract its own allowance rather than handing it
        // extra room.
        uint256 dt = block.timestamp - bucketDrainedAt;
        if (dt != 0) {
            bucketDrainedAt = block.timestamp;
            uint256 tOut = (dailyTokenCap * dt) / DAY;
            tokensInBucket = tOut >= tokensInBucket ? 0 : tokensInBucket - tOut;
            uint256 qOut = (dailyQuoteCap * dt) / DAY;
            quoteInBucket = qOut >= quoteInBucket ? 0 : quoteInBucket - qOut;
        }
    }

    function _token() internal view returns (address) {
        return Currency.unwrap(tokenIsZero ? currency0 : currency1);
    }

    function _quote() internal view returns (Currency) {
        return tokenIsZero ? currency1 : currency0;
    }

    // --- the swap -----------------------------------------------------------

    /// @dev Exact-input swap with a hard price limit. Returns what was actually
    ///      consumed and received, which for a limited swap is a partial fill.
    function _swap(bool sellingToken, uint256 amountIn, uint160 limit)
        internal
        returns (uint256 spent, uint256 got)
    {
        bool zeroForOne = sellingToken ? tokenIsZero : !tokenIsZero;
        // v4 rejects a limit on the wrong side of spot, which is exactly the
        // "there is no room" case. Treat it as nothing to do rather than a
        // revert the keeper has to special-case.
        uint160 spot = spotSqrtPriceX96();
        if (zeroForOne ? limit >= spot : limit <= spot) return (0, 0);
        if (limit <= MIN_SQRT || limit >= MAX_SQRT) revert BadParam();

        bytes memory out = manager.unlock(
            abi.encode(Job({selling: sellingToken, amountIn: amountIn, limit: limit}))
        );
        (spent, got) = abi.decode(out, (uint256, uint256));
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotManager();
        Job memory job = abi.decode(raw, (Job));

        bool zeroForOne = job.selling ? tokenIsZero : !tokenIsZero;
        BalanceDelta delta = manager.swap(
            poolKey(),
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(job.amountIn), // negative is exact-input
                sqrtPriceLimitX96: job.limit
            }),
            ""
        );

        int128 d0 = BalanceDeltaLibrary.amount0(delta);
        int128 d1 = BalanceDeltaLibrary.amount1(delta);
        (int128 dIn, int128 dOut) = zeroForOne ? (d0, d1) : (d1, d0);
        (Currency cIn, Currency cOut) = zeroForOne ? (currency0, currency1) : (currency1, currency0);

        // Negative is owed to the pool, positive is owed to us.
        uint256 spent = dIn < 0 ? uint256(uint128(-dIn)) : 0;
        uint256 got = dOut > 0 ? uint256(uint128(dOut)) : 0;

        if (spent > 0) _settle(cIn, spent);
        if (got > 0) manager.take(cOut, address(this), got);

        return abi.encode(spent, got);
    }

    /// @dev Pay the pool. Native currency goes with the call; a token is synced,
    ///      transferred, and then settled against.
    function _settle(Currency c, uint256 amount) internal {
        if (c.isAddressZero()) {
            manager.settle{value: amount}();
        } else {
            manager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(manager), amount);
            manager.settle();
        }
    }

    // --- the owner's end ----------------------------------------------------

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @notice Put the floor somewhere. For the first one, and only ever
    ///         deliberately after that — the ratchet is the normal way it moves.
    function setFloor(uint160 sqrtPriceX96) external onlyOwner {
        if (sqrtPriceX96 <= MIN_SQRT || sqrtPriceX96 >= MAX_SQRT) revert BadParam();
        emit FloorMoved(floorSqrtPriceX96, sqrtPriceX96, spotSqrtPriceX96());
        floorSqrtPriceX96 = sqrtPriceX96;
        underwaterSeconds = 0;
        lastObservedAt = block.timestamp;
        pendingFloor = 0;
        pendingFloorAt = 0;
    }

    /// @notice Put the floor a set distance under the current price, in one call.
    function setFloorFromSpot(uint256 gapBps) external onlyOwner {
        if (gapBps >= BPS) revert BadParam();
        uint160 spot = spotSqrtPriceX96();
        uint160 next = _worseBy(spot, gapBps);
        emit FloorMoved(floorSqrtPriceX96, next, spot);
        floorSqrtPriceX96 = next;
        underwaterSeconds = 0;
        lastObservedAt = block.timestamp;
        pendingFloor = 0;
        pendingFloorAt = 0;
    }

    function setPolicy(
        uint256 floorGapBps_,
        uint256 ratchetBps_,
        uint256 buyBandBps_,
        uint256 buybackBps_,
        uint256 sellStopBps_
    ) external onlyOwner {
        if (floorGapBps_ == 0 || floorGapBps_ > MAX_FLOOR_GAP_BPS) revert BadParam();
        if (ratchetBps_ > MAX_RATCHET_BPS) revert BadParam();
        if (buyBandBps_ > MAX_BUY_BAND_BPS) revert BadParam();
        if (buybackBps_ > BPS) revert BadParam();
        // A stop of zero would mean no sale can move the price at all, which is
        // no sale. The ceiling is the one that matters: it is the whole of
        // "never wreck my chart", and it must not be raisable by whoever holds
        // the key at the time.
        if (sellStopBps_ == 0 || sellStopBps_ > MAX_SELL_STOP_BPS) revert BadParam();
        floorGapBps = floorGapBps_;
        ratchetBps = ratchetBps_;
        buyBandBps = buyBandBps_;
        buybackBps = buybackBps_;
        sellStopBps = sellStopBps_;
        emit PolicySet(floorGapBps_, ratchetBps_, buyBandBps_, buybackBps_, sellStopBps_);
    }

    /// @notice How long the floor holds out, and how far it will bend.
    /// @param  patience_        seconds under water before it starts to yield
    /// @param  decayBpsPerDay_  price bps a day thereafter. Zero: never yields,
    ///                          which means it may never sell again — that is
    ///                          a real choice, just make it deliberately.
    /// @param  maxDecayBps_     the hard bottom, in price bps under the mark
    function setPatience(uint256 patience_, uint256 decayBpsPerDay_, uint256 maxDecayBps_)
        external
        onlyOwner
    {
        // The ceilings block above argues that a stolen owner key cannot turn
        // the policy into no policy, because the limits are constants in the
        // bytecode. That enumeration had a hole exactly where the floor's own
        // hard bottom lives: this was the one dial with no ceiling at all.
        if (maxDecayBps_ > MAX_FLOOR_DECAY_BPS) revert BadParam();
        // A day of decay that could exceed the whole allowance is not a rate,
        // it is a switch, and it would make the bottom unreachable by degrees.
        if (decayBpsPerDay_ > maxDecayBps_) revert BadParam();
        patience = patience_;
        decayBpsPerDay = decayBpsPerDay_;
        maxDecayBps = maxDecayBps_;
        emit PatienceSet(patience_, decayBpsPerDay_, maxDecayBps_);
    }

    function setRails(
        uint256 maxTokensPerTrade_,
        uint256 maxQuotePerTrade_,
        uint256 dailyTokenCap_,
        uint256 dailyQuoteCap_,
        uint256 cooldown_
    ) external onlyOwner {
        if (maxTokensPerTrade_ > dailyTokenCap_ || maxQuotePerTrade_ > dailyQuoteCap_) {
            revert BadParam();
        }
        // A cooldown of zero turns every per-trade cap into a per-block cap.
        if (cooldown_ < MIN_COOLDOWN) revert BadParam();
        maxTokensPerTrade = maxTokensPerTrade_;
        maxQuotePerTrade = maxQuotePerTrade_;
        dailyTokenCap = dailyTokenCap_;
        dailyQuoteCap = dailyQuoteCap_;
        cooldown = cooldown_;
        emit RailsSet(
            maxTokensPerTrade_, maxQuotePerTrade_, dailyTokenCap_, dailyQuoteCap_, cooldown_
        );
    }

    /// @notice How long the floor must wait between upward moves. Floored, so
    ///         the ratchet can never again become a per-call step.
    function setRatchetCooldown(uint256 seconds_) external onlyOwner {
        if (seconds_ < MIN_COOLDOWN) revert BadParam();
        ratchetCooldown = seconds_;
        emit RatchetCooldownSet(seconds_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Take assets out.
     *
     * @dev Once `lockbox` is set, $KEVIN can only be swept BACK TO THE LOCKBOX.
     *      Everything else stays sweepable to anywhere.
     *
     *      That restriction is the whole point of KevinLock existing. These
     *      pools are tiny — a walk from spot to a 15% floor moves about 0.009
     *      ETH of tokens — so inventory released by the lock ACCUMULATES here
     *      rather than selling. Without this, every token the lock protects
     *      transits through a contract the same single key can empty instantly
     *      with no notice, and a 20% lock funnelling into an unrestricted sweep
     *      is a worse commitment than no lock at all, because the claim has
     *      been published.
     */
    function sweep(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadParam();
        if (asset == _token() && lockbox != address(0) && to != lockbox) revert BadParam();

        // The war chest is denominated in the QUOTE, which is only the native
        // currency in an ETH pool. Against a WETH, KEK or GME pair this
        // decremented the chest when sweeping stray ETH it had nothing to do
        // with, and did NOT decrement it when sweeping the quote token itself —
        // leaving `warChest` claiming money that had gone, after which every
        // bid reverted trying to settle tokens the contract no longer held.
        if (asset == Currency.unwrap(_quote())) {
            // ONLY DEBIT WHAT ACTUALLY CAME OUT OF THE CHEST.
            //
            // This debited the full amount, so sweeping the UNRESERVED share
            // of sale proceeds — the profit the buyback was never entitled to
            // — silently zeroed the bid side while its own backing was still
            // sitting in the contract. Taking a profit is not the same act as
            // cancelling the buyback, and the accounting should not conflate
            // them. What is free is balance minus the chest; only past that
            // does a sweep start eating the chest itself.
            uint256 bal = asset == address(0)
                ? address(this).balance
                : IERC20(asset).balanceOf(address(this));
            uint256 free = bal > warChest ? bal - warChest : 0;
            uint256 fromChest = amount > free ? amount - free : 0;
            warChest = fromChest > warChest ? 0 : warChest - fromChest;
        }

        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert BadParam();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Swept(asset, to, amount);
    }

    /// @notice Name the lockbox this contract's $KEVIN may be returned to.
    ///         One shot: it can be set once and never changed or unset, so
    ///         `lockbox()` is a promise anybody can check in one call rather
    ///         than a setting the owner can walk back the moment it binds.
    function setLockbox(address lockbox_) external onlyOwner {
        if (lockbox != address(0) || lockbox_ == address(0)) revert BadParam();
        // ONE SHOT, PERMANENT, AND IT SURVIVES OWNER ROTATION, so a mistyped
        // address here pins every future $KEVIN sweep at somewhere nothing can
        // receive it, forever. Requiring code at the target will not catch a
        // wrong contract, but it does catch the case this is actually exposed
        // to — a typo, or an EOA pasted where a lockbox belongs — and there is
        // no second attempt to fall back on.
        if (lockbox_.code.length == 0) revert BadParam();
        lockbox = lockbox_;
        emit LockboxSet(lockbox_);
    }

    /// @notice Add to the bidding money without selling anything first, in an
    ///         ETH-quoted pool. Permissionless: anyone may back the bid.
    function fundWarChest() external payable {
        if (!_quote().isAddressZero()) revert BadParam();
        warChest += msg.value;
    }

    /// @notice The same, for a pool quoted in a token — WETH, KEK, GME. The
    ///         payable version above reverts on those, which quietly left the
    ///         bid side with no way to be topped up on two of the three pools
    ///         this is actually going to be pointed at.
    function fundWarChestToken(uint256 amount) external {
        Currency q = _quote();
        if (q.isAddressZero()) revert BadParam();
        IERC20 t = IERC20(Currency.unwrap(q));
        // CREDIT WHAT ARRIVED, NOT WHAT WAS ASKED FOR. This credited `amount`,
        // so a quote token that takes a cut on transfer left `warChest`
        // claiming money the contract never received — and the chest is spent
        // by settling real tokens to the pool, so the overstated tail made
        // every bid revert with the contract looking solvent. That is the same
        // failure the sweep() accounting note describes, reached from the
        // other side, and openRound() in KevinAirdrop already measures the
        // delta for exactly this reason.
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        warChest += t.balanceOf(address(this)) - before;
    }

    receive() external payable {}
}
