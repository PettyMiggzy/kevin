// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KevinLock} from "../src/KevinLock.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * The whole treasury bag sits in this contract, so these tests are less about
 * features than about the two claims the contract makes to the market:
 *
 *   1. nothing leaves faster than the published rate, except
 *   2. through a countdown that everybody sees start.
 *
 * If either of those can be broken, the contract is worse than not having one,
 * because people will have priced the token as though it were true.
 */
contract KevinLockTest is Test {
    MockERC20 internal kevin;
    KevinLock internal lock;

    address internal floor = address(0xF100);
    address internal treasury = address(0x7EA5);
    address internal stranger = address(0xBAD);

    uint256 internal constant RATE = 2_000_000 ether; // a day
    uint256 internal constant NOTICE = 14 days;
    uint256 internal constant BAG = 200_000_000 ether;

    uint256 internal deployedAt;

    function setUp() public {
        kevin = new MockERC20("Kevin", "KEVIN", 18);
        lock = new KevinLock(IERC20(address(kevin)), floor, treasury, RATE, NOTICE);
        deployedAt = block.timestamp;
        kevin.mint(address(lock), BAG);
    }

    // --- claim 1: nothing leaves faster than the published rate --------------

    function test_itStartsEmptyRatherThanWithADaysCredit() public view {
        assertEq(lock.releasable(), 0, "day zero is not a day");
    }

    function test_aDayIsADay() public {
        vm.warp(block.timestamp + 1 days);
        assertEq(lock.releasable(), RATE, "one day, one day's worth");
        lock.release();
        assertEq(kevin.balanceOf(floor), RATE, "and it went to the floor keeper");
        assertEq(lock.releasable(), 0, "with nothing left over");
    }

    function test_theOnlyPlaceTheFastPathCanSendIsTheFloorKeeper() public {
        vm.warp(block.timestamp + 1 days);
        lock.release();
        assertEq(kevin.balanceOf(floor), RATE);
        assertEq(kevin.balanceOf(treasury), 0, "not to the treasury, ever, on this path");
        assertEq(kevin.balanceOf(address(lock)), BAG - RATE);
    }

    /// @dev The headline. Somebody who wants the whole bag out today cannot get
    ///      it out today, and calling more often does not help.
    function test_theBagCannotLeaveInADay() public {
        vm.warp(block.timestamp + 1 days);
        for (uint256 i = 0; i < 50; i++) {
            try lock.release() {} catch {}
        }
        assertEq(kevin.balanceOf(floor), RATE, "one day is one day, however hard you call it");
    }

    function test_unusedAllowanceBanksButOnlyAsFarAsBANK() public {
        vm.warp(block.timestamp + 30 days);
        assertEq(lock.releasable(), RATE * 3, "a month of not calling is worth three days");
        lock.release();
        assertEq(kevin.balanceOf(floor), RATE * 3);
    }

    /// @dev A release capped by an empty-ish box must not throw away the
    ///      allowance it could not use — otherwise topping the box up on the
    ///      wrong day silently costs the treasury a day.
    function test_anAllowanceTheBalanceCouldNotCoverIsNotForfeited() public {
        KevinLock small = new KevinLock(IERC20(address(kevin)), floor, treasury, RATE, NOTICE);
        kevin.mint(address(small), RATE / 4); // only a quarter of a day in the box
        vm.warp(block.timestamp + 1 days);

        assertEq(small.releasable(), RATE / 4, "capped by what is actually in there");
        small.release();

        kevin.mint(address(small), RATE); // the rest of the day's arrival lands
        assertEq(small.releasable(), (RATE * 3) / 4, "the other three quarters are still owed");
    }

    function test_theDripCanBeSlowedAndNeverRaised() public {
        vm.prank(treasury);
        lock.slowDown(RATE / 2);
        assertEq(lock.ratePerDay(), RATE / 2);

        vm.prank(treasury);
        vm.expectRevert(KevinLock.OnlySlower.selector);
        lock.slowDown(RATE);

        vm.prank(treasury);
        vm.expectRevert(KevinLock.OnlySlower.selector);
        lock.slowDown(RATE * 100);
    }

    function test_slowingToZeroClosesTheFastPathEntirely() public {
        vm.prank(treasury);
        lock.slowDown(0);
        vm.warp(block.timestamp + 365 days);
        assertEq(lock.releasable(), 0);
        vm.expectRevert(KevinLock.NothingToRelease.selector);
        lock.release();
    }

    function test_anybodyMayDriveTheDrip() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(stranger);
        lock.release();
        assertEq(kevin.balanceOf(floor), RATE, "permissionless, because there is nothing to gain");
    }

    // --- claim 2: the only other way out is a countdown everyone sees --------

    function test_theSlowExitTakesTheFullNoticeEveryTime() public {
        vm.prank(treasury);
        lock.requestExit(BAG);

        vm.warp(block.timestamp + NOTICE - 1);
        // Read exitAt into a local FIRST: an external call inside the
        // expectRevert argument spends the prank before executeExit ever sees
        // it, and the test then fails on NotBeneficiary for no reason at all.
        uint256 at = lock.exitAt();
        vm.expectRevert(abi.encodeWithSelector(KevinLock.TooSoon.selector, at));
        vm.prank(treasury);
        lock.executeExit();

        vm.warp(block.timestamp + 1);
        vm.prank(treasury);
        lock.executeExit();
        assertEq(kevin.balanceOf(treasury), BAG);
    }

    function test_askingTwiceRestartsTheClockRatherThanShorteningIt() public {
        vm.prank(treasury);
        lock.requestExit(BAG);
        vm.warp(block.timestamp + NOTICE - 1 days);

        vm.prank(treasury);
        lock.requestExit(BAG); // impatient
        assertEq(lock.exitCountdown(), NOTICE, "the full notice, again, from now");

        vm.warp(block.timestamp + NOTICE - 1);
        uint256 at = lock.exitAt();
        vm.expectRevert(abi.encodeWithSelector(KevinLock.TooSoon.selector, at));
        vm.prank(treasury);
        lock.executeExit();
    }

    function test_theRequestIsPublicTheMomentItIsMade() public {
        vm.expectEmit(true, true, true, true);
        emit KevinLock.ExitRequested(BAG, block.timestamp + NOTICE);
        vm.prank(treasury);
        lock.requestExit(BAG);
    }

    function test_anExitCanBeCalledOff() public {
        vm.prank(treasury);
        lock.requestExit(BAG);
        vm.prank(treasury);
        lock.cancelExit();
        assertEq(lock.exitAt(), 0);

        vm.warp(block.timestamp + 365 days);
        vm.prank(treasury);
        vm.expectRevert(KevinLock.NoExitPending.selector);
        lock.executeExit();
    }

    function test_thereIsNoExitWithoutARequest() public {
        vm.warp(block.timestamp + 365 days);
        vm.prank(treasury);
        vm.expectRevert(KevinLock.NoExitPending.selector);
        lock.executeExit();
    }

    function test_anExitCannotBeReusedForASecondHelping() public {
        kevin.mint(address(lock), BAG); // plenty left over afterwards
        vm.prank(treasury);
        lock.requestExit(BAG);
        vm.warp(block.timestamp + NOTICE);
        vm.startPrank(treasury);
        lock.executeExit();
        vm.expectRevert(KevinLock.NoExitPending.selector);
        lock.executeExit();
        vm.stopPrank();
        assertEq(kevin.balanceOf(treasury), BAG, "one request, one withdrawal");
    }

    // --- there is no third way -----------------------------------------------

    function test_nobodyElseCanTouchAnyOfIt() public {
        vm.startPrank(stranger);
        vm.expectRevert(KevinLock.NotBeneficiary.selector);
        lock.requestExit(1);
        vm.expectRevert(KevinLock.NotBeneficiary.selector);
        lock.cancelExit();
        vm.expectRevert(KevinLock.NotBeneficiary.selector);
        lock.executeExit();
        vm.expectRevert(KevinLock.NotBeneficiary.selector);
        lock.slowDown(1);
        vm.stopPrank();
    }

    /// @dev There is no owner, no sweep, no rescue and no upgrade. This test
    ///      exists so that adding one is a deliberate act with a failing test
    ///      attached, rather than a convenience somebody slips in later.
    function test_thereIsNoOwnerAndNoSweep() public view {
        // If any of these ever exist, this stops compiling or stops passing.
        assertEq(lock.beneficiary(), treasury, "the only privileged address");
        assertEq(lock.floor(), floor, "immutable");
        assertEq(lock.exitDelay(), NOTICE, "immutable");
    }

    function test_theConstructorRefusesAToothlessLock() public {
        vm.expectRevert(KevinLock.BadParam.selector);
        new KevinLock(IERC20(address(kevin)), floor, treasury, RATE, 23 hours); // no real notice
        vm.expectRevert(KevinLock.BadParam.selector);
        new KevinLock(IERC20(address(kevin)), floor, treasury, 0, NOTICE); // unusable
        vm.expectRevert(KevinLock.BadParam.selector);
        new KevinLock(IERC20(address(kevin)), address(0), treasury, RATE, NOTICE);
        vm.expectRevert(KevinLock.BadParam.selector);
        new KevinLock(IERC20(address(kevin)), floor, address(0), RATE, NOTICE);
    }

    // --- the claim, as an invariant -----------------------------------------

    /// @dev Whatever anybody does, in whatever order, over any span of time:
    ///      the fast path never lets out more than the rate times the elapsed
    ///      time, and the slow path never lets out anything at all without a
    ///      full notice period having run.
    function testFuzz_neitherPathCanBeHurried(uint256[8] memory jumps, uint256 exitOn) public {
        exitOn = bound(exitOn, 0, 15);
        uint256 requestedAt;

        for (uint256 i = 0; i < jumps.length; i++) {
            vm.warp(block.timestamp + bound(jumps[i], 1 hours, 20 days));

            try lock.release() {} catch {}
            // Somebody keeps trying the door.
            vm.prank(treasury);
            try lock.executeExit() returns (uint256 got) {
                if (got > 0) {
                    assertGe(
                        block.timestamp - requestedAt, NOTICE, "no exit without the full notice"
                    );
                }
            } catch {}

            if (i == exitOn) {
                vm.prank(treasury);
                lock.requestExit(BAG);
                requestedAt = block.timestamp;
            }
            if (i == exitOn / 2) {
                vm.prank(treasury);
                try lock.slowDown(RATE / 2) {} catch {}
            }

            assertLe(
                lock.totalReleased() * 1 days,
                RATE * (block.timestamp - deployedAt),
                "the drip never ran ahead of the clock"
            );
        }
    }
}
