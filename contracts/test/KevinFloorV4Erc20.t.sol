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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * A pool quoted in a TOKEN, not in native ETH.
 *
 * Every other test in this repo runs against an ETH pool, and $KEVIN is
 * launching into WETH, KEK and GME pairs — so the case with the most coverage
 * was the one least likely to be deployed. Two of the three code paths that
 * differ here (settle-by-sync-and-transfer, and the war chest being an ERC20)
 * had no test at all, and one of them was broken.
 *
 * $KEVIN is currency0 here, so upIsUp is TRUE and every direction is the
 * mirror image of the ETH suite. That is deliberate: it is the other half of
 * the orientation logic, and nothing else exercised it.
 */
contract KevinFloorV4Erc20Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    PoolModifyLiquidityTest internal lp;
    PoolSwapTest internal swapper;
    MockERC20 internal kevin;
    MockERC20 internal quote;
    KevinFloorV4 internal floor;
    PoolKey internal key;

    address internal owner = address(0xA11CE);
    address internal operator = address(0x09E12A);

    function setUp() public {
        manager = new PoolManager(address(this));
        lp = new PoolModifyLiquidityTest(manager);
        swapper = new PoolSwapTest(manager);

        // Deploy until $KEVIN sorts BELOW the quote, so $KEVIN is currency0 and
        // upIsUp is true — the branch the ETH suite never reaches.
        kevin = new MockERC20("Kevin", "KEVIN", 18);
        quote = new MockERC20("Wrapped Ether", "WETH", 18);
        while (address(kevin) >= address(quote)) {
            quote = new MockERC20("Wrapped Ether", "WETH", 18);
        }

        key = PoolKey({
            currency0: Currency.wrap(address(kevin)),
            currency1: Currency.wrap(address(quote)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        kevin.mint(address(this), 1_000_000 ether);
        quote.mint(address(this), 1_000_000 ether);
        kevin.approve(address(lp), type(uint256).max);
        quote.approve(address(lp), type(uint256).max);
        kevin.approve(address(swapper), type(uint256).max);
        quote.approve(address(swapper), type(uint256).max);
        lp.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -6000, tickUpper: 6000, liquidityDelta: 100 ether, salt: 0
            }),
            ""
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

    function _arm(uint256 gapBps) internal {
        vm.prank(owner);
        floor.setFloorFromSpot(gapBps);
    }

    /// @dev Somebody sells $KEVIN: token in, so zeroForOne.
    function _sellPressure(uint256 tokensIn) internal {
        swapper.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(tokensIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // --- the mirror image of the orientation tests --------------------------

    function test_knowsWhichWayIsUpTheOtherWayRound() public view {
        assertTrue(floor.tokenIsZero(), "KEVIN is currency0 in this pair");
        assertTrue(floor.upIsUp(), "so a rising KEVIN is a RISING sqrtPrice");
    }

    function test_theFloorSitsBelowSpotInSqrtTermsToo() public {
        uint160 spot = _spot();
        _arm(1_500);
        assertLt(floor.floorSqrtPriceX96(), spot, "upIsUp: worse is a lower sqrt price");
    }

    // --- the swap path that settles a token rather than native --------------

    function test_itSellsAndSettlesAnErc20() public {
        _arm(1_500);
        uint256 before = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertLt(kevin.balanceOf(address(floor)), before, "it sold");
        assertGt(quote.balanceOf(address(floor)), 0, "and was paid in the quote token");
        assertGt(floor.warChest(), 0, "a share of which is held back to bid with");
    }

    function test_theFloorHoldsInATokenPoolToo() public {
        _arm(1_500);
        uint160 floorAt = floor.floorSqrtPriceX96();
        kevin.mint(address(floor), 5_000_000 ether);
        vm.prank(owner);
        floor.setRails(5_000_000 ether, 50 ether, 50_000_000 ether, 200 ether, 60);
        for (uint256 i = 0; i < 12; i++) {
            vm.warp(block.timestamp + 61);
            vm.prank(operator);
            try floor.poke(type(uint256).max) {} catch {}
        }
        assertGe(_spot(), floorAt, "upIsUp: never below the floor means never a smaller sqrt");
    }

    function test_itBidsWithTheQuoteToken() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 chest = floor.warChest();
        assertGt(chest, 0);

        _sellPressure(300_000 ether); // through the floor and well under
        (, bool buy,,) = floor.reading();
        assertTrue(buy, "under the band with money to spend");

        vm.warp(block.timestamp + 5 minutes);
        uint256 tokensBefore = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertLt(floor.warChest(), chest, "it spent quote tokens");
        assertGt(kevin.balanceOf(address(floor)), tokensBefore, "and got $KEVIN back");
    }

    // --- the war chest bug this suite exists to catch -----------------------

    /// @dev `sweep` only ever adjusted the war chest on the NATIVE branch. In a
    ///      token-quoted pool that is exactly backwards: sweeping stray ETH
    ///      debited a chest denominated in the quote token, and sweeping the
    ///      quote token itself removed the backing while leaving the number
    ///      untouched — after which every bid reverted trying to settle tokens
    ///      the contract no longer held.
    function test_sweepingTheQuoteDebitsTheWarChest() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 chest = floor.warChest();
        assertGt(chest, 0);

        vm.prank(owner);
        floor.sweep(address(quote), owner, chest);
        assertEq(floor.warChest(), 0, "the money went, so the number went with it");
    }

    function test_sweepingStrayEthLeavesTheWarChestAlone() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 chest = floor.warChest();

        vm.deal(address(floor), 1 ether); // somebody sent ETH to a WETH-paired contract
        vm.prank(owner);
        floor.sweep(address(0), owner, 1 ether);
        assertEq(floor.warChest(), chest, "native ETH is not the quote here");
    }

    /// @dev And the bid still works afterwards, which is the failure the
    ///      accounting bug actually caused.
    function test_theBidStillWorksAfterAPartialSweep() public {
        _arm(1_500);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        uint256 chest = floor.warChest();

        vm.prank(owner);
        floor.sweep(address(quote), owner, chest / 2);

        _sellPressure(300_000 ether);
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(operator);
        floor.poke(type(uint256).max); // reverted on a phantom balance before
        assertLt(floor.warChest(), chest / 2 + 1, "it bid with what was actually there");
    }

    // --- funding the bid on a pool where the payable version cannot ---------

    function test_theWarChestCanBeToppedUpWithTheQuoteToken() public {
        quote.mint(address(this), 10 ether);
        quote.approve(address(floor), 10 ether);
        floor.fundWarChestToken(10 ether);
        assertEq(floor.warChest(), 10 ether, "anyone may back the bid");
    }

    function test_thePayableVersionIsRefusedHere() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.fundWarChest{value: 1 ether}();
    }

    receive() external payable {}
}
