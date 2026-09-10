// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KevinFloorV4} from "../src/KevinFloorV4.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * THE PROMISE: "no single sale may move the $KEVIN price more than
 * sellStopBps". Everything else this contract does is a preference; this is
 * the one line that is load-bearing for the chart, so it gets measured in
 * PRICE terms against a real pool rather than trusted from the sqrt-space
 * arithmetic that produced it.
 */
contract AuditFloorBound is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolManager manager;
    PoolModifyLiquidityTest lp;
    PoolSwapTest swapper;
    MockERC20 kevin;
    KevinFloorV4 floor;
    PoolKey key;
    address owner = address(0xA11CE);
    address operator = address(0x09E12A);

    function setUp() public {
        manager = new PoolManager(address(this));
        lp = new PoolModifyLiquidityTest(manager);
        swapper = new PoolSwapTest(manager);
        kevin = new MockERC20("Kevin", "KEVIN", 18);
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(kevin)),
            fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        kevin.mint(address(this), 1_000_000 ether);
        kevin.approve(address(lp), type(uint256).max);
        kevin.approve(address(swapper), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
        lp.modifyLiquidity{value: 500 ether}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -6000, tickUpper: 6000, liquidityDelta: 100 ether, salt: 0
            }), ""
        );
        floor = new KevinFloorV4(owner, manager, key, address(kevin));
        vm.startPrank(owner);
        floor.setOperator(operator);
        floor.setRails(500_000 ether, 50 ether, 2_000_000 ether, 200 ether, 5 minutes);
        vm.stopPrank();
        kevin.mint(address(floor), 200_000 ether);
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
    }

    function _buyPressure(uint256 ethIn) internal {
        swapper.swap{value: ethIn}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), ""
        );
    }

    /// $KEVIN is currency1 here, so its price is the INVERSE of the pool price:
    /// kevinPrice ~ 1/sqrtP^2. Returns how many bps of $KEVIN price survived a
    /// move from `before` to `nowP` — 10000 means unchanged.
    function _survivedBps(uint160 before_, uint160 nowP) internal pure returns (uint256) {
        // (before/now)^2 in bps, full-width so the square cannot overflow.
        uint256 r = Math.mulDiv(uint256(before_), 1e18, uint256(nowP)); // 1e18-scaled ratio
        return Math.mulDiv(r, r, 1e18) * 10_000 / 1e18;
    }

    /// Offer the contract everything, at any stop setting, after any amount of
    /// buy pressure. The fill must never walk $KEVIN down more than the stop.
    function testFuzz_noSaleEverBeatsTheSellStop(uint256 stopBps, uint256 pump, uint256 offer) public {
        stopBps = bound(stopBps, 1, floor.MAX_SELL_STOP_BPS());
        pump = bound(pump, 0.01 ether, 200 ether);
        offer = bound(offer, 1 ether, type(uint128).max);

        vm.startPrank(owner);
        floor.setPolicy(1_500, 500, 800, 3_000, stopBps);
        floor.setFloorFromSpot(2_000); // floor well below, so the STOP is what binds
        vm.stopPrank();

        _buyPressure(pump); // open room above the floor

        uint160 before_ = _spot();
        vm.prank(operator);
        try floor.poke(offer, 0) {} catch { return; } // nothing to do is not a failure
        uint160 after_ = _spot();

        uint256 survived = _survivedBps(before_, after_);
        // +2 bps of tolerance for the deliberate rounding in _worseBy/_scale.
        assertGe(survived + 2, 10_000 - stopBps, "one sale walked the chart past the sell stop");
    }

    /// The published ceilings must not be raisable by the owner, ever.
    function test_ownerCannotRaiseThePublishedCeilings() public {
        // Read the ceilings FIRST: vm.expectRevert arms the next call, and an
        // argument like floor.MAX_SELL_STOP_BPS() is itself a call.
        uint256 maxStop = floor.MAX_SELL_STOP_BPS();
        uint256 minCool = floor.MIN_COOLDOWN();
        uint256 maxGap = floor.MAX_FLOOR_GAP_BPS();
        uint256 maxRatchet = floor.MAX_RATCHET_BPS();

        vm.startPrank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, 500, 800, 3_000, maxStop + 1);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setRails(1 ether, 1 ether, 1 ether, 1 ether, minCool - 1);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(maxGap + 1, 500, 800, 3_000, 250);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPolicy(1_500, maxRatchet + 1, 800, 3_000, 250);
        vm.stopPrank();
    }

    /// The floor must never come down as a result of ratcheting, at any price.
    function testFuzz_theHighWaterMarkNeverFalls(uint256 pump, uint8 rounds) public {
        pump = bound(pump, 0.01 ether, 5 ether);
        uint256 n = bound(rounds, 1, 20);
        vm.prank(owner);
        floor.setFloorFromSpot(1_500);

        for (uint256 i = 0; i < n; i++) {
            uint160 was = floor.floorSqrtPriceX96();
            try this.pumpExternal(pump) {} catch { break; }
            vm.warp(block.timestamp + 10 minutes);
            vm.prank(operator);
            floor.ratchet();
            uint160 now_ = floor.floorSqrtPriceX96();
            // $KEVIN is currency1: a LOWER sqrtPrice is a HIGHER $KEVIN price.
            assertLe(now_, was, "the high-water floor moved down");
        }
    }

    /// The liquidity router refunds unused ETH; without this, setUp reverts.
    receive() external payable {}

    /// External so the fuzzer can try/catch a pump that would exhaust the pool.
    function pumpExternal(uint256 ethIn) external { _buyPressure(ethIn); }
}
