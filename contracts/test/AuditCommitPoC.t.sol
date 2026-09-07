// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract AuditCommitPoC is Test {
    MockERC20 kevin; MockERC20 gme; MockERC721 crew; KevinStaking s;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");
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
        s.setMinStake(MIN);
        s.setWarmup(WARMUP);
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

    // ---- PoC 1: forfeiture is defeated by claiming as you go -----------------
    function test_PoC_claimAsYouGoDefeatsForfeiture() public {
        // Alice takes the LONGEST term (+100%) and claims daily.
        vm.prank(alice); s.stakeFor(MIN, 3);
        // Bob takes the same term and honours it, never claiming.
        vm.prank(bob);   s.stakeFor(MIN, 3);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob);
        _fund();

        for (uint256 d; d < 29; ++d) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(alice); s.getReward();
        }
        vm.warp(block.timestamp + 12 hours);

        assertTrue(s.isLocked(alice), "still inside her 180-day term");
        uint256 banked = gme.balanceOf(alice);
        uint256 atRisk = s.earned(alice);
        console2.log("alice banked while locked :", banked);
        console2.log("alice forfeits on exit    :", atRisk);
        console2.log("bob  earned (never claimed):", s.earned(bob));

        vm.prank(alice); s.exit();
        console2.log("alice final GME           :", gme.balanceOf(alice));
        assertGt(banked, atRisk * 20, "she keeps >20x what breaking the promise costs");
        assertEq(kevin.balanceOf(alice), 50_000_000e18, "and all principal back");
    }

    // ---- PoC 2: 1-wei placeholder skips the whole warm-up --------------------
    function test_PoC_dustStakeSkipsWarmup() public {
        vm.prank(alice); s.stake(1); // 1 wei, worth nothing, starts the clock
        assertFalse(s.qualifies(alice));

        vm.warp(block.timestamp + WARMUP + 1);
        _fund();                       // emissions begin now
        vm.prank(alice); s.stakeFor(MIN * 2 - 1, 3); // full size, max term, same block
        s.activate(alice);

        assertTrue(s.qualifies(alice), "earning immediately, warm-up never served at size");
        assertEq(s.balanceOf(alice), MIN * 2, "full position");
        assertGt(s.effectiveBalanceOf(alice), 0);

        // Bob does it honestly: full size up front, then waits.
        vm.prank(bob); s.stakeFor(MIN * 2, 3);
        vm.warp(block.timestamp + 10 days);
        s.activate(bob);
        console2.log("alice earned over the period:", s.earned(alice));
        console2.log("bob   earned over the period:", s.earned(bob));
        assertGt(s.earned(alice), 0);
        assertEq(s.earned(bob), 0, "bob served the warm-up and earned nothing for it");
    }

    // ---- PoC 3: the term boost never expires ---------------------------------
    function test_PoC_termBoostOutlivesTheTerm() public {
        vm.prank(alice); s.stakeFor(MIN, 1); // 30 days, +25%
        vm.prank(bob);   s.stake(MIN);       // no commitment
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob);

        // Term runs out. Alice is free to leave with no penalty...
        vm.warp(block.timestamp + 31 days);
        assertFalse(s.isLocked(alice), "term over, no obligation left");

        // ...and she still carries the boost, forever.
        (,, uint16 boost) = s.lockOf(alice);
        assertEq(boost, 2_500, "boost still baked in with nothing promised");
        s.activate(alice);
        assertEq(s.effectiveBalanceOf(alice), MIN * 12_500 / 10_000);
        assertEq(s.effectiveBalanceOf(bob),   MIN);

        _fund();
        vm.warp(block.timestamp + 10 days);
        console2.log("alice (expired term) earned:", s.earned(alice));
        console2.log("bob   (no term)      earned:", s.earned(bob));
        assertGt(s.earned(alice), s.earned(bob), "paid for a promise that ended");

        // And it survives topping up with term 0.
        vm.prank(alice); s.stake(MIN);
        (,, uint16 boost2) = s.lockOf(alice);
        assertEq(boost2, 2_500, "still there on a fresh, uncommitted deposit");
    }

    // ---- PoC 4: forfeitIfLeavingNow under-reports the below-minimum case -----
    function test_PoC_viewUnderreportsBelowMinimumForfeit() public {
        vm.prank(alice); s.stake(MIN * 2); // no term at all
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        _fund();
        vm.warp(block.timestamp + 10 days);

        uint256 owed = s.earned(alice);
        assertGt(owed, 0);
        assertFalse(s.isLocked(alice));
        assertEq(s.forfeitIfLeavingNow(alice), 0, "view says leaving is free");

        vm.prank(alice); s.withdraw(MIN + 1); // one wei under the line
        assertEq(s.earned(alice), 0, "but it cost every reward token");
        assertEq(gme.balanceOf(alice), 0);
        console2.log("silently forfeited:", owed);
    }

    // ---- PoC 5: withdrawing MORE is cheaper than withdrawing less ------------
    function test_PoC_withdrawingEverythingIsFreeWithdrawingMostIsNot() public {
        vm.prank(alice); s.stake(MIN * 2);
        vm.prank(bob);   s.stake(MIN * 2);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob);
        _fund();
        vm.warp(block.timestamp + 10 days);

        uint256 owedA = s.earned(alice);
        vm.prank(alice); s.withdraw(MIN * 2 - 1); // leave 1 wei behind
        assertEq(s.earned(alice), 0, "1 wei left behind burns the lot");

        vm.prank(bob); s.exit();                  // take it all
        assertEq(gme.balanceOf(bob), owedA, "taking MORE out costs nothing");
        console2.log("alice lost by leaving 1 wei:", owedA);
    }

    // ---- PoC 6: what an unactivated staker loses, exactly --------------------
    function test_PoC_unactivatedLossIsPermanent() public {
        vm.prank(alice); s.stake(MIN);
        vm.prank(bob);   s.stake(MIN);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(bob);              // keeper catches bob only
        _fund();
        vm.warp(block.timestamp + DURATION + 1); // whole period elapses

        assertTrue(s.qualifies(alice), "she qualified the entire time");
        assertEq(s.earned(alice), 0, "and earned nothing");
        s.activate(alice);
        assertEq(s.earned(alice), 0, "activating later recovers none of it");
        console2.log("bob took the whole pot:", s.earned(bob));
        assertApproxEqRel(s.earned(bob), POT, 1e15);
    }
}
