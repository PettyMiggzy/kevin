// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

/**
 * The commitment layer, at the numbers it is actually meant to run at:
 * hold at least five million $KEVIN, wait five days before anything accrues,
 * pick a term you are willing to be locked for, and forfeit the rewards — never
 * the principal — if you leave early or sell down under the minimum.
 *
 * The whole layer is off unless it is configured, which is why the 70 tests
 * written before it existed still pass untouched. These are the ones that turn
 * it on.
 */
contract KevinCommitmentTest is Test {
    MockERC20 internal kevin;
    MockERC20 internal gme;
    MockERC721 internal crew;
    KevinStaking internal s;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant MIN = 5_000_000e18;
    uint256 internal constant WARMUP = 5 days;
    uint256 internal constant DURATION = 30 days;
    uint256 internal constant POT = 30_000e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("KEVIN", "KEVIN", 18);
        gme = new MockERC20("GameStop", "GME", 18);
        crew = new MockERC721();
        s = new KevinStaking(
            IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), DURATION, owner
        );

        vm.startPrank(owner);
        s.setMinStake(MIN);
        s.setWarmup(WARMUP);
        s.setTerm(1, 30 days, 2_500); // +25%
        s.setTerm(2, 90 days, 6_000); // +60%
        s.setTerm(3, 180 days, 10_000); // +100%, the ceiling
        vm.stopPrank();

        for (uint256 i; i < 2; ++i) {
            address u = i == 0 ? alice : bob;
            kevin.mint(u, 50_000_000e18);
            vm.prank(u);
            kevin.approve(address(s), type(uint256).max);
        }
    }

    function _fund() internal {
        gme.mint(address(s), POT);
        vm.prank(owner);
        s.notifyRewardAmount(POT);
    }

    // --- the minimum ---------------------------------------------------------

    function test_underTheMinimumEarnsNothing() public {
        vm.prank(alice);
        s.stake(MIN - 1);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 10 days);
        assertEq(s.earned(alice), 0, "too small to count");
        assertFalse(s.qualifies(alice));
    }

    function test_atTheMinimumEarns() public {
        vm.prank(alice);
        s.stake(MIN);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 10 days);
        assertGt(s.earned(alice), 0, "exactly the minimum is enough");
    }

    // --- the warm-up ---------------------------------------------------------

    function test_nothingAccruesDuringTheWarmup() public {
        vm.prank(alice);
        s.stake(MIN);
        _fund();
        vm.warp(block.timestamp + WARMUP - 1);
        assertEq(s.earned(alice), 0, "still warming up");
        assertFalse(s.qualifies(alice));
    }

    function test_theWarmupEndsAndAnybodyMayRingTheBell() public {
        vm.prank(alice);
        s.stake(MIN);
        _fund();
        vm.warp(block.timestamp + WARMUP + 1);
        assertTrue(s.qualifies(alice), "warmed up");

        // A total stranger brings them in. Nobody has to be the owner for this.
        vm.prank(makeAddr("passer-by"));
        s.activate(alice);
        assertGt(s.effectiveBalanceOf(alice), 0);

        vm.warp(block.timestamp + 5 days);
        assertGt(s.earned(alice), 0);
    }

    /// @dev Topping up an already-earning stake must not restart the clock.
    function test_addingMoreDoesNotResetTheWarmup() public {
        vm.prank(alice);
        s.stake(MIN);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        (uint64 earnFrom,,) = s.lockOf(alice);

        vm.prank(alice);
        s.stake(MIN);
        (uint64 after_,,) = s.lockOf(alice);
        assertEq(after_, earnFrom, "the clock did not restart");
        assertTrue(s.qualifies(alice));
    }

    // --- the term ------------------------------------------------------------

    function test_alongerTermEarnsMore() public {
        vm.prank(alice);
        s.stakeFor(MIN, 3); // +100%
        vm.prank(bob);
        s.stakeFor(MIN, 0); // no commitment
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        s.activate(bob);
        _fund();
        vm.warp(block.timestamp + 10 days);

        assertApproxEqRel(s.earned(alice), s.earned(bob) * 2, 1e15, "double the weight, double the share");
    }

    function test_theTermCanOnlyEverBeStrengthened() public {
        vm.startPrank(alice);
        s.stakeFor(MIN, 3); // 180 days, +100%
        (, uint64 until, uint16 boost) = s.lockOf(alice);
        s.stakeFor(MIN, 1); // a shorter, weaker term
        (, uint64 until2, uint16 boost2) = s.lockOf(alice);
        vm.stopPrank();
        assertEq(until2, until, "the end date did not come closer");
        assertEq(boost2, boost, "and the boost did not go down");
    }

    function test_theOwnerCannotDevalueAPromiseAlreadyMade() public {
        vm.prank(alice);
        s.stakeFor(MIN, 3);
        (, uint64 until, uint16 boost) = s.lockOf(alice);

        vm.prank(owner);
        s.setTerm(3, 1 days, 0); // retune it to worthless

        (, uint64 until2, uint16 boost2) = s.lockOf(alice);
        assertEq(boost2, boost, "alice keeps what she was promised");
        assertEq(until2, until);
    }

    function test_theTermBoostHasACeilingTheOwnerCannotRaise() public {
        // Read the constant FIRST. An external call inside the expectRevert
        // argument is the call expectRevert catches, and it does not revert,
        // so the test passes for the wrong reason or fails for a confusing one.
        uint16 overCap = uint16(s.MAX_TERM_BOOST_BPS() + 1);
        vm.expectRevert(KevinStaking.TermBoostAboveCap.selector);
        vm.prank(owner);
        s.setTerm(4, 365 days, overCap);
    }

    // --- forfeiture ----------------------------------------------------------

    function test_leavingEarlyCostsTheRewardsAndNotOneTokenOfPrincipal() public {
        vm.prank(alice);
        s.stakeFor(MIN, 1); // locked 30 days
        vm.prank(bob);
        s.stakeFor(MIN, 1);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        s.activate(bob);
        _fund();
        vm.warp(block.timestamp + 10 days);

        uint256 owed = s.earned(alice);
        assertGt(owed, 0);
        uint256 before = kevin.balanceOf(alice);

        vm.prank(alice);
        s.exit();

        assertEq(kevin.balanceOf(alice), before + MIN, "every token of principal came back");
        assertEq(gme.balanceOf(alice), 0, "and none of the reward did");
        assertEq(s.earned(alice), 0);
    }

    /// @dev And what she gave up is not stranded — it goes back to the pool and
    ///      is emitted again to the person who stayed.
    function test_whatIsForfeitedGoesToWhoeverStayed() public {
        vm.prank(alice);
        s.stakeFor(MIN, 1);
        vm.prank(bob);
        s.stakeFor(MIN, 1);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        s.activate(bob);
        _fund();
        vm.warp(block.timestamp + 10 days);

        uint256 freeBefore = s.freeRewardBalance();
        vm.prank(alice);
        s.exit();
        assertGt(s.freeRewardBalance(), freeBefore, "back in the pot, not stuck");

        vm.warp(block.timestamp + 40 days);
        vm.prank(bob);
        s.exit();
        assertGt(gme.balanceOf(bob), 0, "and bob, who stayed, is paid");
    }

    function test_sellingDownUnderTheMinimumForfeitsToo() public {
        vm.prank(alice);
        s.stake(MIN * 2); // no term at all
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 10 days);
        assertGt(s.earned(alice), 0);

        // Sell down to just under the minimum.
        vm.prank(alice);
        s.withdraw(MIN + 1);

        assertEq(s.earned(alice), 0, "dropping under the line costs the rewards");
        assertFalse(s.qualifies(alice));
        assertEq(kevin.balanceOf(alice) >= MIN + 1, true, "the principal still came out");
    }

    function test_sellingDownButStayingAboveTheMinimumCostsNothing() public {
        vm.prank(alice);
        s.stake(MIN * 3);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 10 days);
        uint256 owed = s.earned(alice);

        vm.prank(alice);
        s.withdraw(MIN); // still 2x the minimum left

        assertApproxEqAbs(s.earned(alice), owed, 1e12, "still above the line, still earning");
    }

    function test_leavingCompletelyAfterTheTermKeepsEverything() public {
        vm.prank(alice);
        s.stakeFor(MIN, 1); // 30 days
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 31 days);

        assertFalse(s.isLocked(alice), "the term is over");
        uint256 owed = s.earned(alice);
        assertGt(owed, 0);

        vm.prank(alice);
        s.exit();
        assertEq(gme.balanceOf(alice), owed, "paid in full for keeping the promise");
    }

    function test_theViewSaysWhatLeavingWouldCost() public {
        vm.prank(alice);
        s.stakeFor(MIN, 1);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 10 days);

        assertEq(s.forfeitIfLeavingNow(alice), s.earned(alice), "told before you do it");
        vm.warp(block.timestamp + 30 days);
        assertEq(s.forfeitIfLeavingNow(alice), 0, "and nothing once the term is up");
    }

    /// @dev The one thing no configuration may ever do.
    function test_noSettingLetsAnybodyKeepSomebodyElsesPrincipal() public {
        vm.prank(alice);
        s.stakeFor(MIN, 3); // the longest lock
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 1 days);

        vm.startPrank(owner);
        s.setMinStake(type(uint128).max); // put everyone under the line
        s.setDepositsPaused(true);
        vm.stopPrank();

        uint256 before = kevin.balanceOf(alice);
        vm.prank(alice);
        s.emergencyWithdraw();
        assertEq(kevin.balanceOf(alice), before + MIN, "principal is not the owner's to hold");
    }

    // --- off unless it is turned on -----------------------------------------

    function test_withNothingConfiguredItBehavesExactlyAsBefore() public {
        KevinStaking plain = new KevinStaking(
            IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), DURATION, owner
        );
        vm.prank(alice);
        kevin.approve(address(plain), type(uint256).max);
        vm.prank(alice);
        plain.stake(1e18);

        assertTrue(plain.qualifies(alice), "no minimum, no warm-up, earning immediately");
        assertFalse(plain.isLocked(alice));
        assertEq(plain.termCount(), 0);

        gme.mint(address(plain), POT);
        vm.prank(owner);
        plain.notifyRewardAmount(POT);
        vm.warp(block.timestamp + 10 days);

        uint256 owed = plain.earned(alice);
        assertGt(owed, 0);
        vm.prank(alice);
        plain.exit();
        assertEq(gme.balanceOf(alice), owed, "nothing forfeited, because nothing was promised");
    }
}
