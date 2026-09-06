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
 *       high-water mark. The moment the price is back at the floor, the wait
 *       resets and the floor is at full height again — waiting only counts
 *       while the market is actually gone.
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

    /// @notice How long the price may sit under the floor before it starts to
    ///         yield. Zero disables the yielding entirely.
    uint256 public patience;
    /// @notice How far the floor eases per day of waiting, in price bps.
    uint256 public decayBpsPerDay;
    /// @notice The most the floor may ever sit below its high-water mark.
    ///         The hard bottom: past this it stops chasing and just waits.
    uint256 public maxDecayBps;
    /// @notice The last time the price was at or above the floor. Waiting is
    ///         measured from here, so an outage or a quiet market with a
    ///         healthy price costs nothing.
    uint256 public floorHeldSince;

    // --- the rails ----------------------------------------------------------

    uint256 public maxTokensPerTrade;
    uint256 public maxQuotePerTrade;
    uint256 public dailyTokenCap;
    uint256 public dailyQuoteCap;
    uint256 public cooldown;

    uint256 public lastTradeAt;
    /// @notice When the floor last moved up. The ratchet's own rate limit.
    uint256 public lastRatchetAt;
    /// @notice How long the floor must wait between upward moves, so that
    ///         `ratchetBps` is a rate rather than a per-call constant.
    uint256 public ratchetCooldown;
    uint256 public windowStart;
    uint256 public tokensSoldInWindow;
    uint256 public quoteSpentInWindow;

    struct Job {
        bool selling;
        uint256 amountIn;
        uint160 limit;
    }

    event OperatorSet(address indexed operator);
    event FloorMoved(uint160 from, uint160 to, uint160 spot);
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
        windowStart = block.timestamp;
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
        uint256 held = block.timestamp - floorHeldSince;
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

    /// @dev The price being back at the floor is the end of waiting. Called on
    ///      every path that changes state, so a keeper outage cannot quietly
    ///      run the clock down while the chart was fine the whole time.
    function _touchFloor() internal {
        if (floorSqrtPriceX96 == 0) return;
        if (!_isBetter(floorSqrtPriceX96, spotSqrtPriceX96())) floorHeldSince = block.timestamp;
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
     * @param  size how much to offer. Clamped to the per-trade cap. Offering
     *              more than the pool can take is not a mistake here — the
     *              price limit decides the fill, so `type(uint256).max` means
     *              "as much as fits above the floor, up to the cap".
     */
    function poke(uint256 size) external nonReentrant whenNotPaused onlyOperator {
        if (floorSqrtPriceX96 == 0) revert NoFloorYet();
        // Before deciding anything: if the price is back at the floor, the
        // waiting is over and the floor is at full height again.
        _touchFloor();
        (bool sell, bool buy,,) = reading();
        if (sell) {
            _sell(size);
        } else if (buy) {
            _buy(size);
        } else {
            revert NothingToDo();
        }
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
        // Permissionless and cheap, so the keeper calls it every tick — which
        // makes it the reliable place to notice that the price came back and
        // stop the floor from yielding any further.
        _touchFloor();
        uint160 target = _worseBy(spot, floorGapBps);
        if (!_isBetter(target, was)) return; // the floor never comes down
        uint160 ceiling = _betterBy(was, ratchetBps);
        uint160 next = _isBetter(target, ceiling) ? ceiling : target;
        floorSqrtPriceX96 = next;
        floorHeldSince = block.timestamp;
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

    function _sell(uint256 size) internal {
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
        uint256 room = dailyTokenCap > tokensSoldInWindow ? dailyTokenCap - tokensSoldInWindow : 0;
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

        uint256 reserved = (got * buybackBps) / BPS;
        warChest += reserved;
        tokensSoldInWindow += spent;
        lastTradeAt = block.timestamp;
        emit Sold(spent, got, reserved, spotSqrtPriceX96());
    }

    function _buy(uint256 size) internal {
        _tick();
        uint256 amountIn = size < warChest ? size : warChest;
        if (amountIn > maxQuotePerTrade) amountIn = maxQuotePerTrade;
        if (amountIn == 0) revert NothingToDo();
        uint256 room = dailyQuoteCap > quoteSpentInWindow ? dailyQuoteCap - quoteSpentInWindow : 0;
        if (amountIn > room) amountIn = room;
        if (amountIn == 0) revert OverDailyCap();

        // Buying pushes the price toward the floor from below. Stop at the
        // floor: past it the contract would be bidding above its own level.
        (uint256 spent, uint256 got) = _swap(false, amountIn, effectiveFloorSqrtPriceX96());
        if (spent == 0) revert NothingToDo();

        warChest -= spent;
        quoteSpentInWindow += spent;
        lastTradeAt = block.timestamp;
        emit Bought(spent, got, spotSqrtPriceX96());
    }

    function _tick() internal {
        if (lastTradeAt != 0 && block.timestamp < lastTradeAt + cooldown) revert TooSoon();
        if (block.timestamp >= windowStart + DAY) {
            windowStart = block.timestamp;
            tokensSoldInWindow = 0;
            quoteSpentInWindow = 0;
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
        floorHeldSince = block.timestamp;
    }

    /// @notice Put the floor a set distance under the current price, in one call.
    function setFloorFromSpot(uint256 gapBps) external onlyOwner {
        if (gapBps >= BPS) revert BadParam();
        uint160 spot = spotSqrtPriceX96();
        uint160 next = _worseBy(spot, gapBps);
        emit FloorMoved(floorSqrtPriceX96, next, spot);
        floorSqrtPriceX96 = next;
        floorHeldSince = block.timestamp;
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
        if (maxDecayBps_ >= BPS) revert BadParam();
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
            warChest = amount > warChest ? 0 : warChest - amount;
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
        IERC20(Currency.unwrap(q)).safeTransferFrom(msg.sender, address(this), amount);
        warChest += amount;
    }

    receive() external payable {}
}
