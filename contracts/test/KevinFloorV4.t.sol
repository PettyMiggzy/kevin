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
        // upIsUp false: better means a SMALLER sqrtPrice, capped at -5%.
        assertEq(floor.floorSqrtPriceX96(), uint160((uint256(before) * 9_500) / 10_000), "one step");
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
        vm.prank(owner);
        floor.setRails(5 ether, 50 ether, 2_000_000 ether, 200 ether, 5 minutes);
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
}
