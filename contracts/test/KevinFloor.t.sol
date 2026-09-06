// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KevinFloor} from "../src/KevinFloor.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {MockWETH, MockPair, MockRouter, TaxedERC20} from "./mocks/FloorMocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * The whole argument for putting this on chain rather than in a wallet is that
 * a leaked operator key cannot take the money. So most of what is tested here
 * is what the operator CANNOT do, not what it can.
 */
contract KevinFloorTest is Test {
    KevinFloor internal floor;
    MockERC20 internal kevin;
    MockWETH internal weth;
    MockPair internal pair;
    MockRouter internal router;

    address internal owner = address(0xA11CE);
    address internal operator = address(0x09E12A);
    address internal stranger = address(0xBAD);

    // A pool a pad might graduate into: 4 ETH against 40m tokens.
    uint256 internal constant POOL_WETH = 4 ether;
    uint256 internal constant POOL_TOKENS = 40_000_000 ether;

    function setUp() public {
        kevin = new MockERC20("Kevin", "KEVIN", 18);
        weth = new MockWETH();
        pair = new MockPair(address(kevin), address(weth));
        router = new MockRouter(pair);

        kevin.mint(address(pair), POOL_TOKENS);
        vm.deal(address(this), 1000 ether);
        weth.deposit{value: POOL_WETH}();
        weth.transfer(address(pair), POOL_WETH);
        pair.sync();

        floor = new KevinFloor(owner, address(kevin), address(weth), address(pair), address(router));

        vm.startPrank(owner);
        floor.setOperator(operator);
        floor.setRails({
            maxWethPerTrade_: 0.05 ether,
            maxTokensPerTrade_: 2_000_000 ether,
            dailyWethCap_: 0.2 ether,
            dailyTokenCap_: 8_000_000 ether,
            cooldown_: 5 minutes,
            maxSlippageBps_: 300
        });
        vm.stopPrank();

        // Fund it the way the treasury would: 0.35 ETH and some tokens.
        vm.deal(address(this), 1000 ether);
        weth.deposit{value: 0.35 ether}();
        weth.transfer(address(floor), 0.35 ether);
        kevin.mint(address(floor), 5_000_000 ether);
    }

    // --- helpers ------------------------------------------------------------

    /// @dev Somebody else dumps, which is what makes a dip.
    function _dump(uint256 tokens) internal {
        kevin.mint(address(this), tokens);
        kevin.approve(address(router), tokens);
        address[] memory path = new address[](2);
        path[0] = address(kevin);
        path[1] = address(weth);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokens, 0, path, address(this), block.timestamp
        );
    }

    /// @dev Somebody else buys, which is what makes a spike.
    function _pump(uint256 ethIn) internal {
        weth.deposit{value: ethIn}();
        weth.approve(address(router), ethIn);
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(kevin);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            ethIn, 0, path, address(this), block.timestamp
        );
    }

    /// @dev vm.prank applies to the next CALL, and `floor.spotPrice()` written
    ///      inline as an argument is that call — so the prank was spent on the
    ///      view and setReference ran as the test contract. Read it first.
    function _arm() internal {
        uint256 spot = floor.spotPrice();
        vm.prank(owner);
        floor.setReference(spot);
    }

    // --- what it reads ------------------------------------------------------

    function test_spotPrice_isReservesRatio() public view {
        assertEq(floor.spotPrice(), (POOL_WETH * 1e18) / POOL_TOKENS, "weth per token");
    }

    function test_quote_matchesTheV2Formula() public view {
        uint256 amountIn = 0.05 ether;
        uint256 inWithFee = amountIn * 997;
        uint256 want = (inWithFee * POOL_TOKENS) / (POOL_WETH * 1000 + inWithFee);
        assertEq(floor.quote(amountIn, true), want, "buy side");
    }

    function test_constructor_rejectsAPairThatIsNotThisPair() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        MockPair wrong = new MockPair(address(other), address(weth));
        vm.expectRevert(KevinFloor.BadParam.selector);
        new KevinFloor(owner, address(kevin), address(weth), address(wrong), address(router));
    }

    function test_constructor_rejectsZeroes() public {
        vm.expectRevert(KevinFloor.BadParam.selector);
        new KevinFloor(owner, address(0), address(weth), address(pair), address(router));
    }

    // --- the band -----------------------------------------------------------

    function test_reading_isSilentUntilTheReferenceIsSet() public view {
        (bool buy, bool sell,, uint256 ref) = floor.reading();
        assertEq(ref, 0, "no reference yet");
        assertFalse(buy);
        assertFalse(sell);
    }

    function test_reading_saysBuyOnlyOnceTheDipIsDeepEnough() public {
        _arm();
        _dump(2_000_000 ether); // ~5% down
        (bool buy,,,) = floor.reading();
        assertFalse(buy, "5% is not a dip at a 12% band");

        _dump(4_000_000 ether); // deeper
        (buy,,,) = floor.reading();
        assertTrue(buy, "now it is");
    }

    function test_reading_saysSellOnASpike() public {
        _arm();
        _pump(2 ether);
        (, bool sell,,) = floor.reading();
        assertTrue(sell, "50% up is over a 25% band");
    }

    // --- the ratchet --------------------------------------------------------

    function test_ratchet_neverComesDown() public {
        _arm();
        uint256 before = floor.refPrice();
        _dump(6_000_000 ether);
        floor.ratchet();
        assertEq(floor.refPrice(), before, "a dip does not lower the floor");
    }

    function test_ratchet_climbsByAtMostOneStep() public {
        _arm();
        uint256 before = floor.refPrice();
        _pump(3 ether); // a big move up
        floor.ratchet();
        assertEq(floor.refPrice(), (before * 10_500) / 10_000, "capped at refStepBps");
        assertLt(floor.refPrice(), floor.spotPrice(), "it has not caught up in one go");
    }

    function test_ratchet_landsExactlyOnSpotForASmallMove() public {
        _arm();
        _pump(0.05 ether);
        uint256 spot = floor.spotPrice();
        floor.ratchet();
        assertEq(floor.refPrice(), spot, "a small move is taken whole");
    }

    // --- buying -------------------------------------------------------------

    function test_poke_buysTheDip() public {
        _arm();
        _dump(6_000_000 ether);

        uint256 wethBefore = weth.balanceOf(address(floor));
        uint256 tokensBefore = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);

        assertEq(weth.balanceOf(address(floor)), wethBefore - 0.05 ether, "spent one trade cap");
        assertGt(kevin.balanceOf(address(floor)), tokensBefore, "got tokens");
        assertEq(floor.wethSpentInWindow(), 0.05 ether, "counted against the day");
    }

    function test_poke_buyRaisesThePrice() public {
        _arm();
        _dump(6_000_000 ether);
        uint256 spotBefore = floor.spotPrice();
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertGt(floor.spotPrice(), spotBefore, "a bid moves the price up");
    }

    function test_poke_revertsWhenThereIsNothingToDo() public {
        _arm();
        vm.prank(operator);
        vm.expectRevert(KevinFloor.NothingToDo.selector);
        floor.poke(type(uint256).max);
    }

    function test_poke_sizeIsClampedToTheTradeCap() public {
        _arm();
        _dump(6_000_000 ether);
        uint256 wethBefore = weth.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(10 ether); // far more than the cap, and more than it holds
        assertEq(wethBefore - weth.balanceOf(address(floor)), 0.05 ether, "clamped, not reverted");
    }

    // --- selling ------------------------------------------------------------

    function test_poke_sellsTheSpike() public {
        _arm();
        _pump(2 ether);
        uint256 wethBefore = weth.balanceOf(address(floor));
        uint256 tokensBefore = kevin.balanceOf(address(floor));
        vm.prank(operator);
        floor.poke(type(uint256).max);
        assertEq(
            tokensBefore - kevin.balanceOf(address(floor)),
            2_000_000 ether,
            "one trade cap of tokens"
        );
        assertGt(weth.balanceOf(address(floor)), wethBefore, "took ether for them");
    }

    function test_sell_isRefusedUnderTheHardFloor() public {
        _arm();
        _pump(2 ether);
        uint256 spot = floor.spotPrice();
        vm.prank(owner);
        // A floor set above the current price: it may never sell here.
        floor.setBand(1_200, 2_500, 500, spot + 1);
        (, bool sell,,) = floor.reading();
        assertFalse(sell, "the band is met but the floor is not");
        vm.prank(operator);
        vm.expectRevert(KevinFloor.NothingToDo.selector);
        floor.poke(type(uint256).max);
    }

    // --- the rails ----------------------------------------------------------

    function test_cooldown_stopsASecondTradeInTheSameBlock() public {
        _arm();
        _dump(6_000_000 ether);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        vm.prank(operator);
        vm.expectRevert(KevinFloor.TooSoon.selector);
        floor.poke(type(uint256).max);
    }

    function test_cooldown_lets_go_afterTheWait() public {
        _arm();
        _dump(6_000_000 ether);
        vm.prank(operator);
        floor.poke(type(uint256).max);
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(operator);
        floor.poke(type(uint256).max); // does not revert
        assertEq(floor.wethSpentInWindow(), 0.1 ether, "two trades counted");
    }

    function test_dailyCap_isTheRealLimitOnALeakedKey() public {
        _arm();
        _dump(8_000_000 ether);
        // Four trades of 0.05 is the 0.2 daily cap.
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + 5 minutes);
            vm.prank(operator);
            floor.poke(type(uint256).max);
        }
        assertEq(floor.wethSpentInWindow(), 0.2 ether, "at the cap");
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(operator);
        vm.expectRevert(KevinFloor.OverDailyCap.selector);
        floor.poke(type(uint256).max);
    }

    function test_dailyCap_rollsOverAfterADay() public {
        test_dailyCap_isTheRealLimitOnALeakedKey();
        vm.warp(block.timestamp + 1 days);
        vm.prank(operator);
        floor.poke(type(uint256).max); // does not revert
        assertEq(floor.wethSpentInWindow(), 0.05 ether, "a fresh window");
    }

    function test_sandwichedFillIsRefused() public {
        _arm();
        _dump(6_000_000 ether);
        router.setShortfall(500); // 5% worse than the reserves say, against a 3% tolerance
        vm.prank(operator);
        vm.expectRevert();
        floor.poke(type(uint256).max);
    }

    function test_aFillInsideTheToleranceIsAccepted() public {
        _arm();
        _dump(6_000_000 ether);
        router.setShortfall(100); // 1%
        vm.prank(operator);
        floor.poke(type(uint256).max); // does not revert
    }

    // --- what the operator cannot do ----------------------------------------

    function test_operator_cannotSweep() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, operator)
        );
        floor.sweep(address(weth), operator, 0.35 ether);
    }

    function test_operator_cannotWidenItsOwnRails() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, operator)
        );
        floor.setRails(100 ether, 100 ether, 100 ether, 100 ether, 0, 9_000);
    }

    function test_operator_cannotMoveTheReference() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, operator)
        );
        floor.setReference(1);
    }

    function test_stranger_cannotPoke() public {
        _arm();
        _dump(6_000_000 ether);
        vm.prank(stranger);
        vm.expectRevert(KevinFloor.NotOperator.selector);
        floor.poke(type(uint256).max);
    }

    /**
     * The headline claim, as a test: hand the key to an attacker, let them do
     * their worst for a day, and count what left.
     */
    function test_aLeakedKeyCannotTakeMoreThanADay() public {
        _arm();
        _dump(8_000_000 ether);
        uint256 wethBefore = weth.balanceOf(address(floor));

        for (uint256 i = 0; i < 40; i++) {
            vm.warp(block.timestamp + 5 minutes);
            vm.prank(operator);
            try floor.poke(type(uint256).max) {} catch {}
        }

        uint256 spent = wethBefore - weth.balanceOf(address(floor));
        assertLe(spent, floor.dailyWethCap(), "a day of abuse is capped at the daily cap");
        assertGt(kevin.balanceOf(address(floor)), 0, "and it bought tokens with it, not nothing");
    }

    // --- the owner's end ----------------------------------------------------

    function test_owner_sweeps() public {
        vm.prank(owner);
        floor.sweep(address(weth), owner, 0.35 ether);
        assertEq(weth.balanceOf(owner), 0.35 ether, "the treasury can always get its money back");
    }

    function test_pause_stopsTrading() public {
        _arm();
        _dump(6_000_000 ether);
        vm.prank(owner);
        floor.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        floor.poke(type(uint256).max);
    }

    function test_setRails_refusesToTurnOffTheSlippageCheck() public {
        vm.prank(owner);
        vm.expectRevert(KevinFloor.BadParam.selector);
        floor.setRails(0.05 ether, 1 ether, 0.2 ether, 2 ether, 5 minutes, 5_000);
    }

    function test_setRails_refusesATradeCapOverTheDailyCap() public {
        vm.prank(owner);
        vm.expectRevert(KevinFloor.BadParam.selector);
        floor.setRails(1 ether, 1 ether, 0.2 ether, 2 ether, 5 minutes, 300);
    }

    function test_setBand_refusesABandThatIsNotABand() public {
        vm.startPrank(owner);
        vm.expectRevert(KevinFloor.BadParam.selector);
        floor.setBand(0, 2_500, 500, 0);
        vm.expectRevert(KevinFloor.BadParam.selector);
        floor.setBand(10_000, 2_500, 500, 0);
        vm.stopPrank();
    }

    function test_etherSentToItBecomesAmmunition() public {
        uint256 before = weth.balanceOf(address(floor));
        (bool ok,) = address(floor).call{value: 0.1 ether}("");
        assertTrue(ok);
        assertEq(weth.balanceOf(address(floor)), before + 0.1 ether, "wrapped on arrival");
    }

    // --- a taxed token, which is what a pad token usually is -----------------

    function test_taxedToken_countsWhatArrivedNotWhatWasQuoted() public {
        TaxedERC20 taxed = new TaxedERC20(500, address(0xFEE)); // 5%
        MockPair p2 = new MockPair(address(taxed), address(weth));
        MockRouter r2 = new MockRouter(p2);
        taxed.mint(address(p2), POOL_TOKENS);
        weth.deposit{value: POOL_WETH}();
        weth.transfer(address(p2), POOL_WETH);
        p2.sync();

        KevinFloor f2 =
            new KevinFloor(owner, address(taxed), address(weth), address(p2), address(r2));
        vm.startPrank(owner);
        f2.setOperator(operator);
        f2.setRails(0.05 ether, 2_000_000 ether, 0.2 ether, 8_000_000 ether, 5 minutes, 1_500);
        vm.stopPrank();
        weth.deposit{value: 0.35 ether}();
        weth.transfer(address(f2), 0.35 ether);

        uint256 spot2 = f2.spotPrice();
        vm.prank(owner);
        f2.setReference(spot2);
        // Dump into it to make a dip.
        taxed.mint(address(this), 6_000_000 ether);
        taxed.approve(address(r2), 6_000_000 ether);
        address[] memory path = new address[](2);
        path[0] = address(taxed);
        path[1] = address(weth);
        r2.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            6_000_000 ether, 0, path, address(this), block.timestamp
        );

        vm.prank(operator);
        f2.poke(type(uint256).max);
        // It went through, and what it holds is the post-tax amount, which is
        // strictly less than the quote said. The point is that it did not
        // revert on a quote it was never going to receive.
        assertGt(taxed.balanceOf(address(f2)), 0, "holds the taxed amount");
        assertGt(taxed.balanceOf(address(0xFEE)), 0, "the tax was taken");
    }

    // --- fuzz ---------------------------------------------------------------

    /// @dev However big the dip and whatever size is asked for, one poke can
    ///      never spend more than one trade cap or leave the contract owing
    ///      anything.
    function testFuzz_oneCannotSpendMoreThanOneTradeCap(uint256 dump, uint256 size) public {
        dump = bound(dump, 1_000_000 ether, 30_000_000 ether);
        size = bound(size, 0, 100 ether);
        _arm();
        _dump(dump);
        uint256 before = weth.balanceOf(address(floor));
        vm.prank(operator);
        try floor.poke(size) {} catch {}
        uint256 spent = before - weth.balanceOf(address(floor));
        assertLe(spent, floor.maxWethPerTrade(), "never more than a trade cap");
    }
}
