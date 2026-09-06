// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

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
    ///      currency1 — v4 prices currency1 per currency0.
    bool public immutable upIsUp;

    address public operator;

    // --- the floor ----------------------------------------------------------

    /// @notice The price the pool is told not to cross when this contract sells.
    uint160 public floorSqrtPriceX96;
    /// @notice How far under spot the floor is allowed to sit when ratcheting.
    uint256 public floorGapBps;
    /// @notice How far the floor may move in one call.
    uint256 public ratchetBps;
    /// @notice How far under the floor spot must fall before this contract bids.
    uint256 public buyBandBps;
    /// @notice The share of each sale's proceeds reserved for buying back.
    uint256 public buybackBps;
    /// @notice Proceeds set aside by `buybackBps` and not yet spent.
    uint256 public warChest;

    // --- the rails ----------------------------------------------------------

    uint256 public maxTokensPerTrade;
    uint256 public maxQuotePerTrade;
    uint256 public dailyTokenCap;
    uint256 public dailyQuoteCap;
    uint256 public cooldown;

    uint256 public lastTradeAt;
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
        uint256 floorGapBps, uint256 ratchetBps, uint256 buyBandBps, uint256 buybackBps
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
        cooldown = 5 minutes;
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

    /// @notice Is `a` a better price for $KEVIN than `b`?
    function _isBetter(uint160 a, uint160 b) internal view returns (bool) {
        return upIsUp ? a > b : a < b;
    }

    /// @dev `x` moved `bps` in the direction that is worse for $KEVIN.
    function _worseBy(uint160 x, uint256 bps) internal view returns (uint160) {
        uint256 v = upIsUp ? (uint256(x) * (BPS - bps)) / BPS : (uint256(x) * (BPS + bps)) / BPS;
        return uint160(v);
    }

    /// @notice What a poke would do right now.
    function reading() public view returns (bool sell, bool buy, uint160 spot, uint160 floorAt) {
        spot = spotSqrtPriceX96();
        floorAt = floorSqrtPriceX96;
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
        (bool sell, bool buy,,) = reading();
        if (sell) {
            _sell(size);
        } else if (buy) {
            _buy(size);
        } else {
            revert NothingToDo();
        }
    }

    /// @notice Move the floor up toward spot. Permissionless: it can only ever
    ///         move in the direction that makes this contract sell less and bid
    ///         less, which costs an attacker money and saves us none.
    function ratchet() external nonReentrant whenNotPaused {
        uint160 spot = spotSqrtPriceX96();
        uint160 was = floorSqrtPriceX96;
        if (was == 0) revert NoFloorYet();
        uint160 target = _worseBy(spot, floorGapBps);
        if (!_isBetter(target, was)) return; // the floor never comes down
        uint160 ceiling = _betterBy(was, ratchetBps);
        uint160 next = _isBetter(target, ceiling) ? ceiling : target;
        floorSqrtPriceX96 = next;
        emit FloorMoved(was, next, spot);
    }

    /// @dev `x` moved `bps` in the direction that is better for $KEVIN.
    function _betterBy(uint160 x, uint256 bps) internal view returns (uint160) {
        uint256 v = upIsUp ? (uint256(x) * (BPS + bps)) / BPS : (uint256(x) * (BPS - bps)) / BPS;
        return uint160(v);
    }

    // --- the two things it does ---------------------------------------------

    function _sell(uint256 size) internal {
        _tick();
        uint256 have = IERC20(_token()).balanceOf(address(this));
        uint256 amountIn = size < have ? size : have;
        if (amountIn > maxTokensPerTrade) amountIn = maxTokensPerTrade;
        if (amountIn == 0) revert NothingToDo();
        if (tokensSoldInWindow + amountIn > dailyTokenCap) revert OverDailyCap();

        // THE WHOLE MECHANISM. The limit is the floor; the pool fills what fits
        // above it and stops. Overshooting `amountIn` is free — the unfilled
        // remainder never leaves this contract.
        (uint256 spent, uint256 got) = _swap(true, amountIn, floorSqrtPriceX96);
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
        if (quoteSpentInWindow + amountIn > dailyQuoteCap) revert OverDailyCap();

        // Buying pushes the price toward the floor from below. Stop at the
        // floor: past it the contract would be bidding above its own level.
        (uint256 spent, uint256 got) = _swap(false, amountIn, floorSqrtPriceX96);
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
    }

    /// @notice Put the floor a set distance under the current price, in one call.
    function setFloorFromSpot(uint256 gapBps) external onlyOwner {
        if (gapBps >= BPS) revert BadParam();
        uint160 spot = spotSqrtPriceX96();
        uint160 next = _worseBy(spot, gapBps);
        emit FloorMoved(floorSqrtPriceX96, next, spot);
        floorSqrtPriceX96 = next;
    }

    function setPolicy(
        uint256 floorGapBps_,
        uint256 ratchetBps_,
        uint256 buyBandBps_,
        uint256 buybackBps_
    ) external onlyOwner {
        if (floorGapBps_ == 0 || floorGapBps_ >= BPS) revert BadParam();
        if (ratchetBps_ > BPS) revert BadParam();
        if (buybackBps_ > BPS) revert BadParam();
        floorGapBps = floorGapBps_;
        ratchetBps = ratchetBps_;
        buyBandBps = buyBandBps_;
        buybackBps = buybackBps_;
        emit PolicySet(floorGapBps_, ratchetBps_, buyBandBps_, buybackBps_);
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
        maxTokensPerTrade = maxTokensPerTrade_;
        maxQuotePerTrade = maxQuotePerTrade_;
        dailyTokenCap = dailyTokenCap_;
        dailyQuoteCap = dailyQuoteCap_;
        cooldown = cooldown_;
        emit RailsSet(
            maxTokensPerTrade_, maxQuotePerTrade_, dailyTokenCap_, dailyQuoteCap_, cooldown_
        );
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Take anything out. The owner can always empty this, and saying so
    ///         plainly beats a timelock nobody would wait out. Use a multisig.
    function sweep(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadParam();
        if (asset == address(0)) {
            if (amount > warChest) warChest = 0;
            else warChest -= amount;
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert BadParam();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Swept(asset, to, amount);
    }

    /// @notice Add to the bidding money without selling anything first.
    function fundWarChest() external payable {
        if (!_quote().isAddressZero()) revert BadParam();
        warChest += msg.value;
    }

    receive() external payable {}
}
