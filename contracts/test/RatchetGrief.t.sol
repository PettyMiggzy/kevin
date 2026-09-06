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

/**
 * THE ATTACK THAT KILLED THE SELL SIDE FOR 0.0153 ETH.
 *
 * `ratchet()` was permissionless, and `ratchetBps` capped the move per CALL
 * with the ceiling recomputed from the freshly-written floor each time. So one
 * transaction could pump the price, call ratchet thirty times — compounding
 * 1.05 on itself — and dump back out in the same block. The floor never comes
 * down, so the contract could never sell again: 20% of supply with nowhere to
 * go but a sweep(). Measured against a pool DEEPER than the real ones.
 *
 * This file is kept as a regression test. `test_theAttackNoLongerWorks` runs
 * the identical attacker contract and asserts it is refused.
 */
contract Attacker {
    KevinFloorV4 public floor;
    PoolSwapTest public swapper;
    PoolKey public key;
    MockERC20 public kevin;

    constructor(KevinFloorV4 f, PoolSwapTest s, PoolKey memory k, MockERC20 t) {
        floor = f; swapper = s; key = k; kevin = t;
        t.approve(address(s), type(uint256).max);
    }

    receive() external payable {}

    function run(uint256 ethIn, uint256 loops) external payable {
        // 1. pump: buy KEVIN with ETH (zeroForOne)
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
        // 2. walk the floor
        for (uint256 i = 0; i < loops; i++) {
            floor.ratchet();
        }
        // 3. dump it all back
        uint256 bal = kevin.balanceOf(address(this));
        swapper.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(bal),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }
}

contract RatchetGrief is Test {
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

    function _spot() internal view returns (uint160 s) {
        (s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
    }
    receive() external payable {}

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
        kevin.mint(address(this), 1_000_000_000 ether);
        kevin.approve(address(lp), type(uint256).max);
        kevin.approve(address(swapper), type(uint256).max);
        vm.deal(address(this), 100_000 ether);
        // ~14 ETH-equivalent of depth, full-ish range: closer to the real thing.
        lp.modifyLiquidity{value: 50 ether}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -60000, tickUpper: 60000, liquidityDelta: 7 ether, salt: 0
            }),
            ""
        );
        floor = new KevinFloorV4(owner, manager, key, address(kevin));
        vm.startPrank(owner);
        floor.setOperator(operator);
        floor.setRails(500_000 ether, 0.05 ether, 2_000_000 ether, 0.5 ether, 5 minutes);
        vm.stopPrank();
        kevin.mint(address(floor), 5_000_000 ether);
    }

    /// @dev The attack, unchanged, against the fixed contract. A stranger
    ///      cannot call ratchet() at all now, so the whole thing reverts on the
    ///      first of the thirty calls and the floor does not move.
    function test_theAttackNoLongerWorks() public {
        vm.prank(owner);
        floor.setFloorFromSpot(1_500);
        uint160 markBefore = floor.floorSqrtPriceX96();

        Attacker a = new Attacker(floor, swapper, key, kevin);
        vm.deal(address(a), 100 ether);

        vm.expectRevert(KevinFloorV4.NotOperator.selector);
        a.run(3 ether, 30);

        assertEq(floor.floorSqrtPriceX96(), markBefore, "the floor did not move");
        (bool sell,,,) = floor.reading();
        assertTrue(sell, "and the contract can still do its job");
    }

    /// @dev And the second half of the fix, which is what bounds the caller who
    ///      IS allowed: a leaked operator key. Thirty calls in one transaction
    ///      buy exactly one step, because ratchetBps is now a rate in time
    ///      rather than a constant per call.
    function test_ratchetCannotBeWalkedUpInOneBlock() public {
        vm.prank(owner);
        floor.setFloorFromSpot(1_500);
        vm.warp(block.timestamp + 1 hours);

        uint160 markBefore = floor.floorSqrtPriceX96();
        _pump(3 ether);
        uint160 spotPumped = _spot();

        for (uint256 i = 0; i < 30; i++) {
            vm.prank(operator);
            floor.ratchet();
        }
        uint160 markAfter = floor.floorSqrtPriceX96();

        // One step of ratchetBps (500 = 5% of PRICE), and not thirty of them.
        // Better means a SMALLER sqrtPrice here, so measure the price ratio.
        uint256 r = (uint256(markBefore) * 1e18) / uint256(markAfter);
        uint256 movedBps = (((r * r) / 1e18) - 1e18) * 10_000 / 1e18;
        assertApproxEqAbs(movedBps, 500, 2, "one 5% step for thirty calls");

        // Sanity: the price really was manipulated, so the cap is what stopped
        // it and not a lack of room.
        assertLt(spotPumped, markBefore, "the pump did move the market");
    }

    function _pump(uint256 ethIn) internal {
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
}
