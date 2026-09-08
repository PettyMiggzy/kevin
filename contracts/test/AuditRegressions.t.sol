// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KevinFloorV4Test} from "./KevinFloorV4.t.sol";
import {KevinFloorV4} from "../src/KevinFloorV4.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/**
 * One test per confirmed audit finding, each written to FAIL on the old code.
 * The suite already had tests around this machinery — one of them asserted the
 * bug outright — so these are deliberately the loss cases the old ones stopped
 * short of.
 */
contract AuditRegressions is KevinFloorV4Test {
    /// CRITICAL. The clock used to reset in full whenever any single call
    /// happened to see spot at the floor. Anyone could buy that reset for one
    /// swap round-trip, timed against the keeper's tick, and hold the floor at
    /// full height forever — the contract then never sells, and the supply it
    /// exists to distribute has nowhere to go but a sweep.
    function test_theClockCannotBePinnedAtZeroByTimingTheKeepersTick() public {
        _marketWalksAway();

        // Twenty rounds of: let time pass under water, then have an attacker
        // shove the price up to the floor exactly when the keeper looks.
        for (uint256 i = 0; i < 20; i++) {
            _watch(1 days);
            _buyPressure(60 ether); // the manipulation
            floor.observe(); // the keeper's tick lands right here
            _sellPressure(400_000 ether); // and it is unwound in the same breath
        }

        assertGt(
            floor.floorDecayBps(),
            0,
            "a well-timed spike must not buy back more than the time it covers"
        );
    }

    /// HIGH. An outage, and THEN a dip. Nothing resets on the way in, so the
    /// old clock had already banked the whole allowance and the first poke
    /// could walk the chart the full maxDecayBps in one sitting.
    function test_aMonthOfSilenceIsNotAMonthOfWaiting() public {
        _marketWalksAway();
        vm.warp(block.timestamp + 30 days); // nobody watching at all
        assertEq(floor.floorDecayBps(), 0, "unobserved time is worth nothing");
    }

    /// HIGH. pause() is the advertised emergency stop and it blocks the only
    /// two functions that used to be able to reset the clock, so pausing
    /// GUARANTEED the floor decayed while the contract was switched off.
    function test_theEmergencyStopDoesNotSpendTheFloorsAllowance() public {
        _marketWalksAway();
        vm.prank(owner);
        floor.pause();
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        floor.unpause();
        assertEq(floor.floorDecayBps(), 0, "a pause is not a wait");
    }

    /// HIGH. A poke that reverts rolls back its own observation. With no lock
    /// dripping inventory in, an empty contract is the ordinary state, so a
    /// keeper that only pokes would never advance the clock at all — and
    /// observe() is the permissionless answer to that.
    function test_observeIsReachableEvenWhenEveryPokeReverts() public {
        _marketWalksAway();
        uint256 held = kevin.balanceOf(address(floor)); // before the prank: a
        vm.prank(owner);                                   // call would consume it
        floor.sweep(address(kevin), owner, held);

        vm.prank(operator);
        vm.expectRevert();
        floor.poke(type(uint256).max); // nothing to sell, so nothing commits

        _watch(10 days); // but anyone can still keep the clock honest
        assertGt(floor.floorDecayBps(), 0, "the clock ran because somebody watched it");
    }

    /// MEDIUM. The daily cap was a tumbling window: spend it all just before
    /// the boundary and again just after, and twice the cap leaves in minutes
    /// with neither check failing. A leaky bucket has no boundary to sit on.
    function test_twiceTheDailyCapCannotLeaveAcrossAWindowBoundary() public {
        _arm(1_500);
        kevin.mint(address(floor), 50_000_000 ether);
        vm.prank(owner);
        floor.setRails(1 ether, 50 ether, 2 ether, 200 ether, 60);

        // Sit just before where a tumbling window would roll over.
        vm.warp(block.timestamp + 1 days);

        uint256 mid = kevin.balanceOf(address(floor));
        for (uint256 i = 0; i < 4; i++) { // spend the allowance
            _tock();
            vm.prank(operator);
            try floor.poke(type(uint256).max) {} catch {}
        }
        uint256 firstBatch = mid - kevin.balanceOf(address(floor));
        assertGt(firstBatch, 1.9 ether, "the allowance really was spent");

        // Two minutes later the old code would have reset the counter and let
        // the whole cap go again. Two minutes of drain is 2/720ths of it.
        uint256 beforeSecond = kevin.balanceOf(address(floor));
        for (uint256 i = 0; i < 4; i++) {
            _tock();
            vm.prank(operator);
            try floor.poke(type(uint256).max) {} catch {}
        }
        uint256 secondBatch = beforeSecond - kevin.balanceOf(address(floor));
        assertLt(secondBatch, 0.05 ether, "no second full allowance astride the boundary");
    }

    /// MEDIUM. setPatience was the one policy dial with no bytecode ceiling —
    /// and it is the dial that sets the floor's own hard bottom.
    function test_theOwnerCannotRaiseTheFloorsHardBottom() public {
        uint256 max = floor.MAX_FLOOR_DECAY_BPS();
        vm.prank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setPatience(3 days, 150, max + 1);
    }

    /// MEDIUM. setLockbox is one shot, permanent, and survives owner rotation,
    /// so a pasted EOA would pin every future $KEVIN sweep at a dead end.
    function test_theLockboxMustBeAContract() public {
        vm.prank(owner);
        vm.expectRevert(KevinFloorV4.BadParam.selector);
        floor.setLockbox(address(0xDEAD));
    }
}
