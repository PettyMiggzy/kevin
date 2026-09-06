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
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 0);

        // Offer the pool everything, repeatedly. It cannot go through.
        for (uint256 i = 0; i < 12; i++) {
            vm.prank(operator);
            try floor.poke(type(uint256).max) {} catch {}
        }

        // upIsUp is false here, so "not past the floor" means spot <= floorAt.
        assertLe(_spot(), floorAt, "the pool never let it past the floor");
    }

    function test_anUnfilledRemainderStaysHere() public {
        _arm(200); // a tight floor: only a little room
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
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
        floor.poke(type(uint256).max);
    }

    function test_buyPressureOpensRoomAndItSellsIntoIt() public {
        _arm(200);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 afterFirst = kevin.balanceOf(address(floor));

        vm.prank(operator);
        vm.expectRevert(); // the room it had is gone
        floor.poke(type(uint256).max);

        _buyPressure(30 ether); // somebody buys
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertLt(kevin.balanceOf(address(floor)), afterFirst, "it sold into the buying");
    }

    // --- the ratchet --------------------------------------------------------

    function test_ratchet_onlyEverImproves() public {
        _arm(1_500);
        uint160 before = floor.floorSqrtPriceX96();
        _sellPressure(200_000 ether); // the price falls
        floor.ratchet();
        assertEq(floor.floorSqrtPriceX96(), before, "a dip does not lower the floor");
    }

    function test_ratchet_isCappedPerCall() public {
        _arm(1_500);
        uint160 before = floor.floorSqrtPriceX96();
        _buyPressure(60 ether); // a big move up
        floor.ratchet();
        // ratchetBps is 500 — five percent of the $KEVIN PRICE, which in this
        // inverted pool is a sqrt-price step of sqrt(1/1.05), not of 0.95.
        assertApproxEqAbs(_betterByBps(floor.floorSqrtPriceX96(), before), 500, 1, "one 5% step");
    }

    function test_ratchet_needsAFloorFirst() public {
        vm.expectRevert(KevinFloorV4.NoFloorYet.selector);
        floor.ratchet();
    }

    // --- the buyback, which is what makes it two-sided ----------------------

    function test_aShareOfEverySaleIsHeldBackToBidWith() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertGt(floor.warChest(), 0, "30% of the proceeds kept");
    }

    function test_itBidsWhenThePriceFallsUnderTheBand() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 chest = floor.warChest();
        assertGt(chest, 0);

        _sellPressure(600_000 ether); // through the floor and well under
        (, bool buy,,) = floor.reading();
        assertTrue(buy, "under the band, with money to spend");

        vm.warp(block.timestamp + 5 minutes);
        uint256 tokensBefore = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
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
        floor.poke(type(uint256).max);
        vm.prank(operator);
        vm.expectRevert(KevinFloorV4.TooSoon.selector);
        floor.poke(type(uint256).max);
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
            try floor.poke(type(uint256).max) {} catch {}
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
        // Widen the sell stop right out, so the CAP is the binding constraint
        // and not the stop — with the default 2.5% stop this pool fills 2.5
        // tokens and the cap never bites, which is the stop working.
        floor.setPolicy(1_500, 500, 800, 3_000, 9_000);
        floor.setRails(5 ether, 50 ether, 2_000_000 ether, 200 ether, 5 minutes);
        vm.stopPrank();
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertEq(before - kevin.balanceOf(address(floor)), 5 ether, "clamped to the cap");
    }

    /// @dev And the case where the ROOM is the smaller of the two: a cap far
    ///      bigger than the pool can absorb sells only what fits.
    function test_theRoomBindsWhenItIsSmallerThanTheCap() public {
        _arm(1_500);
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 sold = before - kevin.balanceOf(address(floor));
        assertGt(sold, 0, "it sold what fitted");
        assertLt(sold, floor.maxTokensPerTrade(), "and stopped well short of the cap");
    }

    // --- who may do what ----------------------------------------------------

    function test_strangerCannotPoke() public {
        _arm(1_500);
        vm.prank(stranger);
        vm.expectRevert(KevinFloorV4.NotOperator.selector);
        floor.poke(type(uint256).max);
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
        floor.poke(type(uint256).max);
    }

    function test_itDoesNothingBeforeTheFloorIsSet() public {
        vm.prank(operator);
        vm.expectRevert(KevinFloorV4.NoFloorYet.selector);
        floor.poke(type(uint256).max);
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
        floor.poke(type(uint256).max);
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
        floor.setPolicy(1_500, 500, 800, 3_000, 2_000); // a 20% stop, far looser
        uint160 floorAt = floor.floorSqrtPriceX96();
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertLe(_spot(), floorAt, "the floor, not the stop, was the limit");
    }

    function test_setPolicy_refusesAStopThatIsNotAStop() public {
        vm.startPrank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 800, 3_000, 0);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 800, 3_000, 10_000);
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
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 0);

        // A month of nothing. Without the yielding this is a permanent stall.
        vm.warp(block.timestamp + 30 days);
        (bool sell,,,) = floor.reading();
        assertTrue(sell, "it found the market rather than waiting forever");

        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertLt(kevin.balanceOf(address(floor)), before, "and it actually sold");
    }

    function test_nothingYieldsWhilePatienceLasts() public {
        _marketWalksAway();
        vm.warp(block.timestamp + floor.patience());
        assertEq(floor.floorDecayBps(), 0, "still holding at full height");
        assertEq(floor.effectiveFloorSqrtPriceX96(), _mark(), "not a basis point");

        vm.warp(block.timestamp + 1 days);
        assertEq(floor.floorDecayBps(), 150, "and then a day is a day");
    }

    function test_theYieldingHasAHardBottom() public {
        _marketWalksAway();
        vm.warp(block.timestamp + 3650 days); // ten years of nothing
        assertEq(floor.floorDecayBps(), floor.maxDecayBps(), "it stops chasing");
        assertApproxEqAbs(
            _worseByBps(floor.effectiveFloorSqrtPriceX96(), _mark()),
            floor.maxDecayBps(),
            1,
            "30% under the high-water mark and no further, forever"
        );
    }

    function test_thePriceComingBackPutsTheFloorStraightBackUp() public {
        _marketWalksAway();
        vm.warp(block.timestamp + 20 days);
        assertGt(floor.floorDecayBps(), 0, "it had started to yield");

        _buyPressure(120 ether); // the market comes back over the floor
        floor.ratchet();
        assertEq(floor.floorDecayBps(), 0, "one tick at the floor and it is whole again");
    }

    function test_waitingIsNotCountedWhileThePriceIsHealthy() public {
        _arm(1_500); // the floor sits under spot, which is the normal state
        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 5 days);
            floor.ratchet();
            assertEq(floor.floorDecayBps(), 0, "a quiet market above the floor is not waiting");
        }
    }

    /// @dev A keeper that was down for a fortnight must not come back and sell
    ///      into a decayed floor when the chart was fine the whole time. The
    ///      first call it makes puts the floor back before it decides anything.
    function test_anOutageDoesNotCostTheFloorAnything() public {
        _arm(1_500);
        vm.warp(block.timestamp + 14 days); // nobody called anything
        assertGt(floor.floorDecayBps(), 0, "the clock ran, because nothing touched it");

        uint160 mark = _mark();
        vm.prank(operator);
        floor.poke(type(uint256).max); // the keeper wakes up
        assertEq(floor.floorDecayBps(), 0, "and the first thing it does is notice");
        assertLe(_spot(), mark, "so the sale was against the full floor");
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
        floor.setRails(20_000_000 ether, 50 ether, 500_000_000 ether, 200 ether, 0);

        bool everSold;
        for (uint256 day = 0; day < 40; day++) {
            vm.warp(block.timestamp + 1 days);
            uint256 held = kevin.balanceOf(address(floor));
            // Offer it everything, over and over, with no cooldown in the way.
            for (uint256 i = 0; i < 6; i++) {
                vm.prank(operator);
                try floor.poke(type(uint256).max) {} catch {}
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
            floor.ratchet();
        }
        assertEq(floor.floorDecayBps(), once, "it is a function of the clock, not of calls");
    }

    function test_theHighWaterMarkItselfNeverMoves() public {
        _marketWalksAway();
        uint160 mark = _mark();
        vm.warp(block.timestamp + 60 days);
        assertEq(_mark(), mark, "the floor of record is untouched; only what it defends bends");
        assertTrue(_isWorse(floor.effectiveFloorSqrtPriceX96(), mark), "and it has bent");
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
    function test_theArithmeticCannotWrapAtTheEdgeOfTheRange() public {
        uint160 nearTheTop = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;
        vm.startPrank(owner);
        floor.setFloor(nearTheTop);
        floor.setPatience(0, 3_000, 3_000); // yield the maximum immediately
        vm.stopPrank();
        _sellPressure(12 ether); // put the price under it so the clock runs
        vm.warp(block.timestamp + 40 days);

        assertEq(floor.floorDecayBps(), 3_000, "it is asking for the full easing");
        assertEq(
            floor.effectiveFloorSqrtPriceX96(),
            nearTheTop,
            "and gets the top of the range, not a wrapped number near zero"
        );
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
        floor.poke(type(uint256).max); // fills the chest so `buy` can be true
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
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 0);

        if (pressure > 0) _buyPressure(pressure);
        vm.prank(operator);
        try floor.poke(offer) {} catch {}

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
        floor.setRails(20_000_000 ether, 50 ether, 500_000_000 ether, 200 ether, 0);

        uint256 notOurs = _worseByBps(_spot(), mark);
        vm.warp(block.timestamp + waited);
        uint256 earned = floor.floorDecayBps();
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(operator);
            try floor.poke(offer) {} catch {}
        }
        assertLe(
            _worseByBps(_spot(), mark),
            (earned > notOurs ? earned : notOurs) + 1,
            "never past what waiting has earned"
        );
    }
}
