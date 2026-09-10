// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KevinFloorV4} from "../src/KevinFloorV4.sol";
import {MockERC20} from "./mocks/Mocks.sol";

import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * Against a REAL v4 PoolManager and a real initialised pool, not a mock — the
 * only claim this contract makes that matters is one the pool enforces, so the
 * pool has to be the real one.
 *
 * The pool is ETH / $KEVIN. Native ETH is address(0), which sorts below every
 * token, so $KEVIN is currency1 and a RISING $KEVIN is a FALLING sqrtPrice.
 * That inversion is the easiest thing in here to get backwards, so most of
 * these tests would fail loudly if it were.
 */
contract KevinFloorV4Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    PoolModifyLiquidityTest internal lp;
    PoolSwapTest internal swapper;
    MockERC20 internal kevin;
    KevinFloorV4 internal floor;
    PoolKey internal key;

    address internal owner = address(0xA11CE);
    address internal operator = address(0x09E12A);
    address internal stranger = address(0xBAD);

    uint256 internal constant MAX_STOP = 500; // KevinFloorV4.MAX_SELL_STOP_BPS
    uint24 internal constant FEE = 3000;
    int24 internal constant SPACING = 60;

    function setUp() public {
        manager = new PoolManager(address(this));
        lp = new PoolModifyLiquidityTest(manager);
        swapper = new PoolSwapTest(manager);
        kevin = new MockERC20("Kevin", "KEVIN", 18);

        key = PoolKey({
            currency0: Currency.wrap(address(0)), // native ETH
            currency1: Currency.wrap(address(kevin)),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(address(0))
        });
        // 1:1 to start, which for this pool means 1 ETH = 1 KEVIN. The absolute
        // level does not matter; every assertion here is relative.
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        kevin.mint(address(this), 1_000_000 ether);
        kevin.approve(address(lp), type(uint256).max);
        kevin.approve(address(swapper), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
        lp.modifyLiquidity{value: 500 ether}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -6000, tickUpper: 6000, liquidityDelta: 100 ether, salt: 0
            }),
            ""
        );

        floor = new KevinFloorV4(owner, manager, key, address(kevin));
        vm.startPrank(owner);
        floor.setOperator(operator);
        floor.setRails({
            maxTokensPerTrade_: 500_000 ether,
            maxQuotePerTrade_: 50 ether,
            dailyTokenCap_: 2_000_000 ether,
            dailyQuoteCap_: 200 ether,
            cooldown_: 5 minutes
        });
        vm.stopPrank();

        // The treasury's daily allocation lands here.
        kevin.mint(address(floor), 200_000 ether);
    }

    // --- helpers ------------------------------------------------------------

    /// @dev getSlot0 comes from StateLibrary, which attaches to the INTERFACE.
    function _spot() internal view returns (uint160 s) {
        (s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
    }

    /// @dev Somebody buys $KEVIN. ETH in (currency0), so zeroForOne.
    function _buyPressure(uint256 ethIn) internal {
        swapper.swap{value: ethIn}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// @dev Somebody sells $KEVIN.
    function _sellPressure(uint256 tokensIn) internal {
        swapper.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(tokensIn),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// @dev How much BETTER a $KEVIN price `to` is than `from`, in bps. This
    ///      pool is inverted — upIsUp is false — so a better price is a SMALLER
    ///      sqrt price, and the price ratio is the square of the sqrt ratio.
    ///      Every assertion below is in these terms on purpose: the contract's
    ///      parameters are price bps, and a test that measured sqrt bps would
    ///      pass while the numbers meant twice what they said.
    function _betterByBps(uint160 to, uint160 from) internal pure returns (uint256) {
        uint256 r = (uint256(from) * 1e18) / uint256(to);
        uint256 ratio = (r * r) / 1e18;
        return ratio <= 1e18 ? 0 : ((ratio - 1e18) * 10_000) / 1e18;
    }

    /// @dev And the other way: how much WORSE, in bps of the starting price.
    function _worseByBps(uint160 to, uint160 from) internal pure returns (uint256) {
        uint256 r = (uint256(to) * 1e18) / uint256(from);
        uint256 ratio = (r * r) / 1e18;
        return ratio <= 1e18 ? 0 : ((ratio - 1e18) * 10_000) / ratio;
    }

    function _mark() internal view returns (uint160) {
        return floor.floorSqrtPriceX96();
    }

    /// @dev ratchet() is onlyOperator now — it was permissionless, and that was
    ///      a critical bug: see test_ratchetCannotBeWalkedUpInOneBlock.
    function _ratchet() internal {
        vm.prank(operator);
        floor.ratchet();
    }

    /// @dev The cooldown has a floor of MIN_COOLDOWN now, so tests that used to
    ///      set it to zero step time forward instead.
    function _tock() internal {
        vm.warp(block.timestamp + 61);
    }

    /// @dev Let `secs` pass WITH SOMEBODY WATCHING, which is what the keeper
    ///      does. The underwater clock now only counts observed time, so a
    ///      bare vm.warp is an outage, not a wait — that distinction is the
    ///      whole point of the fix and these tests have to make it explicitly.
    function _watch(uint256 secs) internal {
        uint256 step = floor.MAX_OBSERVATION();
        uint256 gone;
        while (gone < secs) {
            uint256 d = secs - gone < step ? secs - gone : step;
            vm.warp(block.timestamp + d);
            floor.observe();
            gone += d;
        }
    }

    function _arm(uint256 gapBps) internal {
        vm.prank(owner);
        floor.setFloorFromSpot(gapBps);
    }

    /// @dev v4's test routers refund unspent native currency by calling back,
    ///      so a test that pays ETH into a pool has to be able to take it back.
    receive() external payable {}

    // --- orientation, which everything else depends on ----------------------

    function test_knowsWhichWayIsUp() public view {
        assertFalse(floor.tokenIsZero(), "KEVIN is currency1 in an ETH pool");
        assertFalse(floor.upIsUp(), "so a rising KEVIN is a falling sqrtPrice");
    }

    function test_buyPressureMovesTheSqrtPriceDown() public {
        uint160 before = _spot();
        _buyPressure(20 ether);
        assertLt(_spot(), before, "buying KEVIN lowers currency1-per-currency0");
    }

    // --- the claim: it cannot push the price through the floor --------------

    function test_theFloorHolds_evenIfYouOfferItEverything() public {
        _arm(1_500); // floor 15% under spot
        uint160 floorAt = floor.floorSqrtPriceX96();

        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 60);

        // Offer the pool everything, repeatedly. It cannot go through.
        for (uint256 i = 0; i < 12; i++) {
            _tock();
            vm.prank(operator);
            try floor.poke(type(uint256).max, 0) {} catch {}
        }

        // upIsUp is false here, so "not past the floor" means spot <= floorAt.
        assertLe(_spot(), floorAt, "the pool never let it past the floor");
    }

    function test_anUnfilledRemainderStaysHere() public {
        _arm(200); // a tight floor: only a little room
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        uint256 sold = before - kevin.balanceOf(address(floor));
        assertGt(sold, 0, "it sold something");
        assertLt(sold, before, "and kept the rest rather than dumping it");
    }

    function test_noRoomIsNothingToDo() public {
        _arm(1_500);
        // Push the price down to the floor by selling into it.
        _sellPressure(400_000 ether);
        (bool sell,,,) = floor.reading();
        assertFalse(sell, "no room above the floor");
        vm.prank(operator);
        vm.expectRevert(KevinFloorV4.NothingToDo.selector);
        floor.poke(type(uint256).max, 0);
    }

    function test_buyPressureOpensRoomAndItSellsIntoIt() public {
        _arm(200);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        uint256 afterFirst = kevin.balanceOf(address(floor));

        vm.prank(operator);
        vm.expectRevert(); // the room it had is gone
        floor.poke(type(uint256).max, 0);

        _buyPressure(30 ether); // somebody buys
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertLt(kevin.balanceOf(address(floor)), afterFirst, "it sold into the buying");
    }

    // --- the ratchet --------------------------------------------------------

    function test_ratchet_onlyEverImproves() public {
        _arm(1_500);
        uint160 before = floor.floorSqrtPriceX96();
        _sellPressure(200_000 ether); // the price falls
        _ratchet();
        assertEq(floor.floorSqrtPriceX96(), before, "a dip does not lower the floor");
    }

    function test_ratchet_isCappedPerCall() public {
        _arm(1_500);
        vm.warp(block.timestamp + 1 hours); // past the ratchet's own cooldown
        uint160 before = floor.floorSqrtPriceX96();
        _buyPressure(60 ether); // a big move up

        // TWO READINGS NOW, ratchetCooldown APART. The first only proposes:
        // the mark this sets is permanent, and deriving it from one
        // instantaneous slot0 read let anyone park it above the honest market
        // for the price of a swap in the keeper's block.
        _ratchet();
        assertEq(floor.floorSqrtPriceX96(), before, "one reading proposes, it does not move");
        assertTrue(floor.pendingFloor() != 0, "and it is on the clock");

        vm.warp(block.timestamp + 1 hours);
        _ratchet();
        // ratchetBps is 500 — five percent of the $KEVIN PRICE, which in this
        // inverted pool is a sqrt-price step of sqrt(1/1.05), not of 0.95.
        assertApproxEqAbs(_betterByBps(floor.floorSqrtPriceX96(), before), 500, 1, "one 5% step");
    }

    /// @dev A price that only existed for one block must not become permanent.
    function test_ratchetIgnoresALevelThatDoesNotSurviveTheSecondReading() public {
        _arm(1_500);
        vm.warp(block.timestamp + 1 hours);
        uint160 before = floor.floorSqrtPriceX96();

        _buyPressure(60 ether); // the manipulation
        _ratchet(); // proposes off the fake print
        _sellPressure(400_000 ether); // and it is gone again
        vm.warp(block.timestamp + 1 hours);
        _ratchet();

        assertEq(floor.floorSqrtPriceX96(), before, "a one-block print set no permanent mark");
    }

    function test_ratchet_needsAFloorFirst() public {
        vm.expectRevert(KevinFloorV4.NoFloorYet.selector);
        vm.prank(operator);
        floor.ratchet();
    }

    // --- the buyback, which is what makes it two-sided ----------------------

    function test_aShareOfEverySaleIsHeldBackToBidWith() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertGt(floor.warChest(), 0, "30% of the proceeds kept");
    }

    function test_itBidsWhenThePriceFallsUnderTheBand() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        uint256 chest = floor.warChest();
        assertGt(chest, 0);

        _sellPressure(600_000 ether); // through the floor and well under
        (, bool buy,,) = floor.reading();
        assertTrue(buy, "under the band, with money to spend");

        vm.warp(block.timestamp + 5 minutes);
        uint256 tokensBefore = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertLt(floor.warChest(), chest, "it spent some of the chest");
        assertGt(kevin.balanceOf(address(floor)), tokensBefore, "and got tokens back");
    }

    function test_itCannotBidWithMoneyItDoesNotHave() public {
        _arm(1_500);
        _sellPressure(600_000 ether);
        (, bool buy,,) = floor.reading();
        assertFalse(buy, "under the band but the chest is empty");
    }

    // --- the rails ----------------------------------------------------------

    function test_cooldownHolds() public {
        _arm(1_500);
        // A cap small enough that the first trade leaves room above the floor,
        // otherwise the second poke stops at NothingToDo before it ever reaches
        // the cooldown — which is correct, and not what this test is about.
        vm.prank(owner);
        floor.setRails(1 ether, 50 ether, 2_000_000 ether, 200 ether, 5 minutes);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        vm.prank(operator);
        vm.expectRevert(KevinFloorV4.TooSoon.selector);
        floor.poke(type(uint256).max, 0);
    }

    function test_dailyCapBoundsALeakedKey() public {
        _arm(1_500);
        vm.startPrank(owner);
        floor.setRails(50_000 ether, 50 ether, 100_000 ether, 200 ether, 5 minutes);
        vm.stopPrank();
        kevin.mint(address(floor), 5_000_000 ether);

        uint256 before = kevin.balanceOf(address(floor));
        for (uint256 i = 0; i < 20; i++) {
            vm.warp(block.timestamp + 5 minutes);
            vm.prank(operator);
            try floor.poke(type(uint256).max, 0) {} catch {}
        }
        uint256 sold = before - kevin.balanceOf(address(floor));
        assertLe(sold, floor.dailyTokenCap(), "a day of abuse is one day's allowance");
    }

    /// @dev Two things can bind a sale: the cap, and the room above the floor.
    ///      This is the case where the CAP is the smaller of the two — at a 15%
    ///      floor against this pool the room is only ~15 tokens, so a 1,000
    ///      token cap would never be the thing that bit.
    function test_perTradeCapClamps() public {
        _arm(1_500);
        vm.startPrank(owner);
        // Widen the sell stop to its ceiling, so the CAP is the binding
        // constraint and not the stop. It cannot go above 5% any more — that is
        // MAX_SELL_STOP_BPS, and it is a constant precisely so no key can raise
        // it — so the cap has to come down to meet it instead.
        floor.setPolicy(1_500, 500, 800, 3_000, MAX_STOP);
        floor.setRails(1 ether, 50 ether, 2_000_000 ether, 200 ether, 5 minutes);
        vm.stopPrank();
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertEq(before - kevin.balanceOf(address(floor)), 1 ether, "clamped to the cap");
    }

    /// @dev And the case where the ROOM is the smaller of the two: a cap far
    ///      bigger than the pool can absorb sells only what fits.
    function test_theRoomBindsWhenItIsSmallerThanTheCap() public {
        _arm(1_500);
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        uint256 sold = before - kevin.balanceOf(address(floor));
        assertGt(sold, 0, "it sold what fitted");
        assertLt(sold, floor.maxTokensPerTrade(), "and stopped well short of the cap");
    }

    // --- who may do what ----------------------------------------------------

    function test_strangerCannotPoke() public {
        _arm(1_500);
        vm.prank(stranger);
        vm.expectRevert(KevinFloorV4.NotOperator.selector);
        floor.poke(type(uint256).max, 0);
    }

    function test_operatorCannotMoveTheFloor() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, operator)
        );
        floor.setFloorFromSpot(9_000);
    }

    function test_operatorCannotSweep() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, operator)
        );
        floor.sweep(address(kevin), operator, 1);
    }

    function test_onlyTheManagerMayCallBack() public {
        vm.expectRevert(KevinFloorV4.NotManager.selector);
        floor.unlockCallback("");
    }

    function test_pauseStopsIt() public {
        _arm(1_500);
        vm.prank(owner);
        floor.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        floor.poke(type(uint256).max, 0);
    }

    function test_itDoesNothingBeforeTheFloorIsSet() public {
        vm.prank(operator);
        vm.expectRevert(KevinFloorV4.NoFloorYet.selector);
        floor.poke(type(uint256).max, 0);
    }

    function test_ownerSweeps() public {
        vm.prank(owner);
        floor.sweep(address(kevin), owner, 200_000 ether);
        assertEq(kevin.balanceOf(owner), 200_000 ether, "the treasury can always get it back");
    }

    // --- the sell stop, which is not the floor ------------------------------

    /// @dev One sale may walk the price by sellStopBps and no further, even when
    ///      the floor is miles away and the contract is holding millions.
    function test_oneSaleCannotWalkThePriceFurtherThanTheStop() public {
        _arm(1_500); // a floor 15% down: plenty of room
        vm.prank(owner);
        floor.setPolicy(1_500, 500, 800, 3_000, 250); // but a 2.5% stop
        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 5 minutes);

        uint160 before = _spot();
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        uint160 after_ = _spot();
        // In PRICE terms, which is what sellStopBps is denominated in and what
        // anybody looking at the chart would measure.
        uint256 movedBps = _worseByBps(after_, before);
        assertLe(movedBps, 251, "one sale moved the price no further than the stop");
        assertGt(movedBps, 0, "and it did sell something");
    }

    /// @dev And the floor still wins when it is the tighter of the two.
    function test_theFloorStillBindsWhenItIsTighterThanTheStop() public {
        _arm(100); // a floor 1% down
        vm.prank(owner);
        floor.setPolicy(1_500, 500, 800, 3_000, MAX_STOP); // the loosest stop allowed
        uint160 floorAt = floor.floorSqrtPriceX96();
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertLe(_spot(), floorAt, "the floor, not the stop, was the limit");
    }

    function test_setPolicy_refusesAStopThatIsNotAStop() public {
        vm.startPrank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 800, 3_000, 0);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 800, 3_000, MAX_STOP + 1);
        vm.stopPrank();
    }


    // --- patience: the answer to "what if that price never comes back" ------
    //
    // Every test in this section exists because a floor that only ratchets up
    // stops selling the first time the chart makes a high it does not revisit,
    // and then the tokens it is supposed to be distributing just pile up.

    /// @dev The market makes a high, drifts about 20% off it, and sits there.
    ///      Not a crash — a chart that simply does not come back. That is the
    ///      case the yielding exists for, and 12 tokens is what a 20% drift
    ///      costs against this pool's ~14 ETH of liquidity. Anything much
    ///      larger runs off the end of the tick range and stops being a market.
    function _marketWalksAway() internal {
        _arm(1_500);
        _sellPressure(12 ether);
        (bool sell,,,) = floor.reading();
        assertFalse(sell, "setup: the price is under the floor and it is stuck");
        assertLt(_worseByBps(_spot(), _mark()), 1_000, "setup: a drift, not a collapse");
    }

    function test_theFloorYieldsRatherThanWaitForAPriceThatNeverComes() public {
        _marketWalksAway();
        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 60);

        // A month under the floor, watched. Without the yielding this is a
        // permanent stall.
        _watch(30 days);
        (bool sell,,,) = floor.reading();
        assertTrue(sell, "it found the market rather than waiting forever");

        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertLt(kevin.balanceOf(address(floor)), before, "and it actually sold");
    }

    function test_nothingYieldsWhilePatienceLasts() public {
        _marketWalksAway();
        _watch(floor.patience());
        assertEq(floor.floorDecayBps(), 0, "still holding at full height");
        assertEq(floor.effectiveFloorSqrtPriceX96(), _mark(), "not a basis point");

        _watch(1 days);
        assertEq(floor.floorDecayBps(), 150, "and then a day is a day");
    }

    function test_theYieldingHasAHardBottom() public {
        _marketWalksAway();
        // patience + maxDecay/rate = 3 + 20 days is all it takes to spend the
        // whole allowance; the accumulator caps there, so watching for longer
        // cannot buy another basis point.
        _watch(30 days);
        assertEq(floor.floorDecayBps(), floor.maxDecayBps(), "it stops chasing");
        assertApproxEqAbs(
            _worseByBps(floor.effectiveFloorSqrtPriceX96(), _mark()),
            floor.maxDecayBps(),
            1,
            "30% under the high-water mark and no further, forever"
        );
    }

    /// @dev RECOVERY IS SYMMETRIC NOW, AND THAT IS THE FIX.
    ///
    /// This used to assert that one tick with spot at the floor wiped the
    /// whole clock — "one tick at the floor and it is whole again". That
    /// single-read reset was the attack: anyone could push spot to the floor
    /// in the block the keeper's tick landed, for the price of one swap
    /// round-trip, and hold the clock at zero forever. The floor then never
    /// yields, the contract never sells, and 20% of supply has nowhere to go.
    ///
    /// Coming back now buys back exactly the time it covers, so a momentary
    /// spike is worth a moment and a real recovery is worth a real recovery.
    function test_thePriceComingBackUnwindsTheClockAtTheRateItEarnedIt() public {
        _marketWalksAway();
        _watch(20 days);
        uint256 yielded = floor.floorDecayBps();
        assertGt(yielded, 0, "it had started to yield");

        _buyPressure(120 ether); // the market comes back over the floor
        _ratchet();
        assertGt(floor.floorDecayBps(), 0, "one tick cannot wipe twenty days");
        assertLe(floor.floorDecayBps(), yielded, "but it is unwinding, not growing");

        _watch(30 days); // and a real recovery does restore it
        assertEq(floor.floorDecayBps(), 0, "sustained recovery puts the floor back up");
    }

    function test_waitingIsNotCountedWhileThePriceIsHealthy() public {
        _arm(1_500); // the floor sits under spot, which is the normal state
        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 5 days);
            _ratchet();
            assertEq(floor.floorDecayBps(), 0, "a quiet market above the floor is not waiting");
        }
    }

    /// @dev A keeper that was down for a fortnight must not come back and sell
    ///      into a decayed floor.
    ///
    ///      THIS TEST USED TO ASSERT THE BUG. It said
    ///      `assertGt(floorDecayBps(), 0, "the clock ran, because nothing
    ///      touched it")` — writing down as expected behaviour that a
    ///      fortnight nobody watched had been charged to the floor — and then
    ///      only proved the benign branch where the price happens to still be
    ///      healthy when the keeper returns, so the next call resets it. The
    ///      loss case is an outage followed by a DIP, where nothing resets and
    ///      the whole allowance is already spent. Time nobody observed is now
    ///      worth nothing, so the clock reads zero either way.
    function test_anOutageDoesNotCostTheFloorAnything() public {
        _arm(1_500);
        vm.warp(block.timestamp + 14 days); // nobody called anything
        assertEq(floor.floorDecayBps(), 0, "unwatched time is not waiting");

        uint160 mark = _mark();
        vm.prank(operator);
        floor.poke(type(uint256).max, 0); // the keeper wakes up
        assertEq(floor.floorDecayBps(), 0, "and it is still zero afterwards");
        assertLe(_spot(), mark, "so the sale was against the full floor");
    }

    /// @dev The loss case the old test never reached: an outage, and THEN the
    ///      price dips. Nothing resets the clock on the way in, so under the
    ///      old code the first poke found the entire maxDecayBps already
    ///      spent and could walk the chart 30% in one sitting.
    function test_anOutageFollowedByADipDoesNotUnlockTheWholeAllowance() public {
        _arm(1_500);
        vm.warp(block.timestamp + 30 days); // nobody watching, chart fine
        _sellPressure(400_000 ether); // now it dips under the floor
        vm.prank(operator);
        try floor.poke(type(uint256).max, 0) {} catch {}
        assertLt(
            floor.floorDecayBps(),
            floor.maxDecayBps(),
            "a month nobody watched must not cash out as a month of waiting"
        );
    }

    /// @dev `pause()` is the advertised emergency stop. It blocks poke and
    ///      ratchet, which under the old clock were the only two things that
    ///      could reset the timer — so pausing GUARANTEED the floor decayed
    ///      while it was switched off. observe() is deliberately not pausable.
    function test_pauseDoesNotBurnTheClock() public {
        _arm(1_500);
        vm.prank(owner);
        floor.pause();
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        floor.unpause();
        assertEq(floor.floorDecayBps(), 0, "a pause must not spend the floor's allowance");
    }

    /// @dev THE RATE CLAIM, and the reason the yielding is safe to have.
    ///
    ///      In a market with no buyers at all, this contract can never put the
    ///      price more than `decayBpsPerDay` per day below the high-water mark,
    ///      because a day of waiting is all the room a day of waiting opens.
    ///      Forty days of offering it everything, every day, with no cooldown:
    ///      it is a 1.5%-a-day drip with a hard bottom, not a dump.
    function test_inADeadMarketItCannotWalkTheChartFasterThanTheDecay() public {
        _marketWalksAway();
        uint160 mark = _mark();
        // The market walked off on its own before the contract did anything;
        // that drop is not the contract's and the bound has to allow for it.
        uint256 notOurs = _worseByBps(_spot(), mark);
        kevin.mint(address(floor), 20_000_000 ether);
        vm.prank(owner);
        floor.setRails(20_000_000 ether, 50 ether, 500_000_000 ether, 200 ether, 60);

        bool everSold;
        for (uint256 day = 0; day < 40; day++) {
            _watch(1 days); // a day passing, with the keeper watching it
            uint256 held = kevin.balanceOf(address(floor));
            // Offer it everything, over and over, with no cooldown in the way.
            for (uint256 i = 0; i < 6; i++) {
                _tock();
                vm.prank(operator);
                try floor.poke(type(uint256).max, 0) {} catch {}
            }
            if (kevin.balanceOf(address(floor)) < held) everSold = true;
            uint256 earned = floor.floorDecayBps();
            assertLe(
                _worseByBps(_spot(), mark),
                (earned > notOurs ? earned : notOurs) + 1,
                "never further down than the waiting has earned"
            );
        }
        assertTrue(everSold, "and it did distribute, which was the whole point");
        // After forty days it is parked on the bottom, selling nothing further.
        assertEq(floor.floorDecayBps(), floor.maxDecayBps(), "on the hard bottom");
        assertLe(_worseByBps(_spot(), mark), floor.maxDecayBps() + 1, "which is where it stops");
    }

    function test_theYieldingCannotBeHurriedByCallingMoreOften() public {
        _marketWalksAway();
        vm.warp(block.timestamp + 10 days);
        uint256 once = floor.floorDecayBps();
        for (uint256 i = 0; i < 50; i++) {
            _ratchet();
        }
        assertEq(floor.floorDecayBps(), once, "it is a function of the clock, not of calls");
    }

    function test_theHighWaterMarkItselfNeverMoves() public {
        _marketWalksAway();
        uint160 mark = _mark();
        _watch(60 days);
        assertEq(_mark(), mark, "the floor of record is untouched; only what it defends bends");
        assertTrue(_isWorse(floor.effectiveFloorSqrtPriceX96(), mark), "and it has bent");
    }

    /// @dev A throwaway contract to stand in for a lockbox. setLockbox refuses
    ///      an address with no code, because it can never be corrected.
    function _box() internal returns (address) {
        return address(new MockERC20("Box", "BOX", 18));
    }

    function _isWorse(uint160 a, uint160 b) internal pure returns (bool) {
        return a > b; // upIsUp is false here
    }

    function test_zeroDecayMeansItHoldsOutForever() public {
        vm.prank(owner);
        floor.setPatience(3 days, 0, 3_000);
        _marketWalksAway();
        vm.warp(block.timestamp + 3650 days);
        assertEq(floor.floorDecayBps(), 0, "told never to yield, it never yields");
        (bool sell,,,) = floor.reading();
        assertFalse(sell, "which is a real choice, and this is what it costs");
    }

    function test_setPatience_refusesNonsense() public {
        vm.startPrank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPatience(3 days, 150, 10_000); // a bottom of "everything"
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPatience(3 days, 4_000, 3_000); // a day bigger than the whole allowance
        vm.stopPrank();
    }

    function test_operatorCannotChangeThePatience() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, operator)
        );
        floor.setPatience(0, 5_000, 9_000);
    }

    /// @dev The price arithmetic works in sqrt space and the result is cast
    ///      down to uint160. Near the top of v4's range that cast would wrap —
    ///      turning a limit meaning "never below this" into one meaning "sell
    ///      into anything". No real pool goes near these numbers, which is
    ///      precisely why nobody would ever catch it happening.
    /// @dev A bare uint160 cast in _scale would wrap a price near the top of
    ///      the range around to a tiny one — turning "never go below this" into
    ///      "sell into anything" — so the clamp is load bearing.
    ///
    ///      The old version of this test drove it by parking the floor at the
    ///      top of the range and letting the clock run. That only worked
    ///      because the clock counted wall time blindly: with a floor at
    ///      MAX_SQRT-1 the spot price can never be WORSE than the floor, so
    ///      the market is never under it and no decay can honestly accrue.
    ///      Now that the clock only counts observed underwater time, that
    ///      configuration is unreachable, so this checks the two things that
    ///      are: the clamp holds at the edge, and it holds under a real yield.
    function test_theArithmeticCannotWrapAtTheEdgeOfTheRange() public {
        uint160 nearTheTop = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;
        vm.prank(owner);
        floor.setFloor(nearTheTop);
        assertEq(
            floor.effectiveFloorSqrtPriceX96(),
            nearTheTop,
            "the top of the range, not a wrapped number near zero"
        );

        // And the same helper under a decay that IS reachable.
        _marketWalksAway();
        uint160 mark = _mark();
        _watch(30 days);
        assertEq(floor.floorDecayBps(), floor.maxDecayBps(), "the full easing");
        uint160 eff = floor.effectiveFloorSqrtPriceX96();
        assertTrue(_isWorse(eff, mark), "it eased in the right direction");
        assertLt(eff, 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342, "inside the range");
    }

    // --- the parameters mean what the documentation says they mean ----------

    function test_theFloorGapIsAPricePercentage() public {
        uint160 spot = _spot();
        _arm(1_500);
        assertApproxEqAbs(_worseByBps(_mark(), spot), 1_500, 1, "15% means 15% of the price");
    }

    function test_theBuyBandIsAPricePercentage() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0); // fills the chest so `buy` can be true
        uint160 mark = _mark();

        // Walk the price down a token at a time and watch where it starts
        // bidding. buyBandBps is 800, so it should hold its money until the
        // price is 8% of the PRICE under the floor and not before.
        bool crossed;
        for (uint256 i = 0; i < 30; i++) {
            _sellPressure(1 ether);
            (, bool buy,,) = floor.reading();
            uint256 under = _worseByBps(_spot(), mark);
            if (under > 850) {
                crossed = true;
                assertTrue(buy, "past the band, it bids");
                break;
            }
            if (under < 750) assertFalse(buy, "inside the band, it holds its money");
        }
        assertTrue(crossed, "setup: the band was actually crossed");
    }

    function test_setPolicy_refusesABuyBandThatWouldDivideByZero() public {
        vm.prank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 10_000, 3_000, 250);
    }


    // --- the lockbox, and what sweep may no longer do -----------------------

    function test_kevinCanOnlyBeSweptBackToTheLockboxOnceOneIsNamed() public {
        // Must be a contract now — setLockbox is one shot and permanent, so a
        // pasted EOA would pin every future $KEVIN sweep at a dead end.
        address lockbox = address(new MockERC20("Box", "BOX", 18));
        vm.prank(owner);
        floor.setLockbox(lockbox);

        vm.prank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.sweep(address(kevin), owner, 1 ether);

        vm.prank(owner);
        floor.sweep(address(kevin), lockbox, 1 ether);
        assertEq(kevin.balanceOf(lockbox), 1 ether, "back to the lockbox, or nowhere");
    }

    /// @dev One shot. A lockbox the owner can re-point the day after publishing
    ///      it is not a commitment, it is a setting.
    function test_theLockboxCanBeNamedOnceAndNeverAgain() public {
        // Deploy BOTH stand-ins first. _box() is a state-changing call, and
        // vm.expectRevert arms the very next one — and inside a prank it would
        // spend the prank as well.
        address first = _box();
        address second = _box();
        vm.startPrank(owner);
        floor.setLockbox(first);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setLockbox(second);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setLockbox(address(0));
        vm.stopPrank();
        assertTrue(floor.lockbox() != address(0), "named once");
    }

    function test_beforeALockboxIsNamedSweepIsUnrestricted() public {
        vm.prank(owner);
        floor.sweep(address(kevin), owner, 1 ether);
        assertEq(kevin.balanceOf(owner), 1 ether, "and anyone can see lockbox() is unset");
    }

    /// @dev Everything that is not $KEVIN stays sweepable wherever.
    function test_theLockboxDoesNotTrapAnythingElse() public {
        address box = _box(); // before the prank, or the deploy consumes it
        vm.prank(owner);
        floor.setLockbox(box);
        vm.deal(address(floor), 1 ether);
        vm.prank(owner);
        floor.sweep(address(0), owner, 1 ether);
        assertEq(owner.balance, 1 ether);
    }

    // --- the ceilings a stolen key cannot raise -----------------------------

    /// @dev A stolen owner key does not need sweep(). Two transactions moving
    ///      zero tokens would have turned "no sale may move the chart more than
    ///      2.5%" into no guarantee at all, and nothing on chain would look
    ///      like a theft until the candle printed.
    function test_theGuaranteesCannotBeTurnedOffByTheOwner() public {
        vm.startPrank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 800, 3_000, 9_999); // the chart-wrecking one
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(9_000, 500, 800, 3_000, 250); // a floor 90% down
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 9_000, 800, 3_000, 250); // a 90% ratchet step
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 9_000, 3_000, 250); // a 90% buy band
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setRails(1 ether, 1 ether, 2 ether, 2 ether, 0); // no cooldown
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setRatchetCooldown(0);
        vm.stopPrank();

        // and they are constants, so anyone can read the ceilings off the code
        assertEq(floor.MAX_SELL_STOP_BPS(), 500);
        assertEq(floor.MIN_COOLDOWN(), 60);
    }

    // --- the daily cap clamps rather than refusing ---------------------------

    /// @dev It compared the OFFERED size against the cap, and the offer is
    ///      always the whole per-trade maximum — so it began refusing at one
    ///      trade short of the cap however small the real fill would be.
    function test_theLastOfTheDailyCapIsStillUsable() public {
        _arm(1_500);
        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        // One token an offer, a day and a half's worth of cap. The first poke
        // uses a whole token; the second is offered a whole token again with
        // only half a token of room left in the day.
        floor.setRails(1 ether, 50 ether, 1.5 ether, 200 ether, 60);

        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertEq(floor.tokensInBucket(), 1 ether, "the first trade took its fill");

        _tock();
        vm.prank(operator);
        floor.poke(type(uint256).max, 0); // used to revert OverDailyCap here
        // The bucket drains continuously, so 61 seconds of a 1.5/day allowance
        // has already leaked back out by the time the second poke lands. It is
        // ~1.06e15 wei of slack, not a rounding artefact to paper over.
        assertApproxEqAbs(
            floor.tokensInBucket(), 1.5 ether, 0.002 ether, "and the half left over is usable"
        );
    }

    function test_theDailyCapStillBinds() public {
        _arm(1_500);
        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        floor.setRails(1 ether, 50 ether, 1.5 ether, 200 ether, 60);
        for (uint256 i = 0; i < 10; i++) {
            _tock();
            vm.prank(operator);
            try floor.poke(type(uint256).max, 0) {} catch {}
        }
        // A leaky bucket has no boundary to sit on: the cap holds over every
        // window, so the most that can ever be outstanding is the cap itself.
        assertLe(floor.tokensInBucket(), 1.5 ether, "a day is still a day");
        assertGt(floor.tokensInBucket(), 1.4 ether, "and it did keep selling up to it");
    }

    // --- fuzz ---------------------------------------------------------------

    /// @dev Whatever is offered and whatever the market has done first, the
    ///      price is never on the wrong side of the floor once it has traded.
    function testFuzz_theFloorIsNeverCrossed(uint256 offer, uint256 pressure) public {
        offer = bound(offer, 1 ether, 5_000_000 ether);
        pressure = bound(pressure, 0, 40 ether);
        _arm(1_500);
        uint160 floorAt = floor.floorSqrtPriceX96();
        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 60);

        if (pressure > 0) _buyPressure(pressure);
        vm.prank(operator);
        try floor.poke(offer, 0) {} catch {}

        // Buying by others can take the price past the floor in the GOOD
        // direction; this contract must never take it past in the bad one.
        if (pressure == 0) assertLe(_spot(), floorAt, "never through the floor");
    }

    /// @dev The same claim once the floor is allowed to yield: however long it
    ///      has been waiting, the price never ends up further down than the
    ///      waiting has earned. The floor bends; it does not break.
    function testFuzz_theEffectiveFloorIsNeverCrossed(uint256 waited, uint256 offer) public {
        waited = bound(waited, 0, 400 days);
        offer = bound(offer, 1 ether, 20_000_000 ether);
        _marketWalksAway();
        uint160 mark = _mark();
        kevin.mint(address(floor), 20_000_000 ether);
        vm.prank(owner);
        floor.setRails(20_000_000 ether, 50 ether, 500_000_000 ether, 200 ether, 60);

        uint256 notOurs = _worseByBps(_spot(), mark);
        vm.warp(block.timestamp + waited);
        uint256 earned = floor.floorDecayBps();
        for (uint256 i = 0; i < 4; i++) {
            _tock();
            vm.prank(operator);
            try floor.poke(offer, 0) {} catch {}
        }
        assertLe(
            _worseByBps(_spot(), mark),
            (earned > notOurs ? earned : notOurs) + 1,
            "never past what waiting has earned"
        );
    }

    // --- the sandwich, and the parameter that stops it ----------------------

    /// @dev What one $KEVIN is worth in ETH right now, as output-per-input in
    ///      Q96 — the same shape `poke`'s `minRateX96` takes. This pool is
    ///      ETH / $KEVIN, so sqrtPrice is $KEVIN per ETH and the rate a seller
    ///      of $KEVIN cares about is its reciprocal, squared.
    function _fairSellRateX96() internal view returns (uint256) {
        uint256 sqrtP = uint256(_spot());
        uint256 q = Math.mulDiv(1 << 96, 1 << 96, sqrtP); // (2^96 / sqrtP) * 2^96
        return Math.mulDiv(q, 1 << 96, sqrtP);
    }

    /// HIGH, from the audit: `poke` took no slippage bound, and could not have
    /// enforced one from inside the call even if it wanted to.
    ///
    /// The sell limit is `sellStopBps` under `spotSqrtPriceX96()` READ DURING
    /// THE SWAP. An attacker who moves spot in the same block moves the stop
    /// with it, so the contract recomputes a limit around the price the
    /// attacker just set and fills all the way down to it. The floor still
    /// holds. Everything between the honest price and the floor does not.
    ///
    /// Both halves are asserted, because only the pair is the finding: the
    /// same poke that the keeper's rate REFUSES is one the old signature would
    /// have executed without complaint.
    function test_aSandwichIsRefusedWhenTheKeeperNamesItsPrice() public {
        _arm(2_000); // floor 20% under, so there is a long way to fall
        _buyPressure(10 ether); // and the price has run up since

        // The keeper reads the price in an earlier block and decides what a
        // fair fill looks like. 6% of room: the 2.5% stop, the 0.3% fee, and
        // slack for a block of honest drift.
        uint256 minRate = (_fairSellRateX96() * 9_400) / 10_000;

        uint256 snap = vm.snapshotState();

        // The attacker gets in front and crushes the price, staying above the
        // floor so the sale still looks available.
        _sellPressure(8 ether);

        vm.prank(operator);
        vm.expectPartialRevert(KevinFloorV4.Slipped.selector);
        floor.poke(type(uint256).max, minRate);

        // Same block, same manipulated price, no rate named: it goes through.
        // That is the hole, and it is why the parameter is not optional.
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertGt(floor.warChest(), 0, "the unprotected poke filled");

        // And with no attacker in front of it, the keeper's own rate is not
        // in the way of an honest fill.
        vm.revertToState(snap);
        vm.prank(operator);
        floor.poke(type(uint256).max, minRate);
        assertGt(floor.warChest(), 0, "an honest fill clears the same bound");
    }

    /// The bid has the same exposure pointed the other way: its limit is the
    /// floor, so an attacker who lifts the price before the keeper's bid lands
    /// makes the contract pay up to the floor for fewer tokens.
    function test_theBidAlsoRefusesAPriceItDidNotAgreeTo() public {
        _arm(1_500);
        // Fill the war chest by selling into a rally first.
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertGt(floor.warChest(), 0, "war chest funded");
        _tock();

        // Now the price falls under the buy band and the keeper wants to bid.
        vm.warp(block.timestamp + 6 minutes);
        _sellPressure(25 ether);
        (, bool wantsToBuy,,) = floor.reading();
        assertTrue(wantsToBuy, "the contract wants to bid");

        // Tokens per ETH is the sqrt price squared, in this pool's orientation.
        uint256 sqrtP = uint256(_spot());
        uint256 fair = Math.mulDiv(sqrtP, sqrtP, 1 << 96);
        uint256 minRate = (fair * 9_400) / 10_000;

        uint256 snap = vm.snapshotState();

        // The attacker lifts the price into the keeper's bid.
        _buyPressure(5 ether);
        vm.prank(operator);
        vm.expectPartialRevert(KevinFloorV4.Slipped.selector);
        floor.poke(type(uint256).max, minRate);

        vm.revertToState(snap);
        uint256 chestBefore = floor.warChest();
        vm.prank(operator);
        floor.poke(type(uint256).max, minRate);
        assertLt(floor.warChest(), chestBefore, "an honest bid still goes out");
    }

    /// A rate of zero is the rescue path and has to keep working, because the
    /// owner may need to move the contract by hand with no keeper running.
    function test_aZeroRateStillMeansNoOpinion() public {
        _arm(1_000);
        _buyPressure(30 ether);
        vm.prank(operator);
        floor.poke(type(uint256).max, 0);
        assertGt(floor.warChest(), 0, "zero disables the check, as documented");
    }

    /// The bound is a RATE, not an amount, precisely because the pool decides
    /// the fill size here. The same fair price has to be acceptable whether
    /// the keeper offers one token or everything it holds — an amount-shaped
    /// bound would need the caller to predict a fill it cannot see.
    function test_theBoundDoesNotDependOnTheSizeOffered() public {
        _arm(1_000);
        _buyPressure(10 ether);
        uint256 minRate = (_fairSellRateX96() * 9_400) / 10_000;

        uint256 snap = vm.snapshotState();
        vm.prank(operator);
        floor.poke(1 ether, minRate);
        assertGt(floor.warChest(), 0, "a one-token offer clears the bound");

        vm.revertToState(snap);
        vm.prank(operator);
        floor.poke(type(uint256).max, minRate);
        assertGt(floor.warChest(), 0, "and so does everything it holds");
    }
}
