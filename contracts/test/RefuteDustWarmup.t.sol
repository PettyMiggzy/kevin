// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract RefuteDustWarmup is Test {
    MockERC20 kevin; MockERC20 gme; MockERC721 crew; KevinStaking s;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");
    address carol = makeAddr("carol");
    uint256 constant MIN = 5_000_000e18;
    uint256 constant WARMUP = 5 days;
    uint256 constant DURATION = 30 days;
    uint256 constant POT = 30_000e18;

    function _deploy() internal {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("KEVIN","KEVIN",18);
        gme = new MockERC20("GME","GME",18);
        crew = new MockERC721();
        s = new KevinStaking(IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), DURATION, owner);
        vm.startPrank(owner);
        s.setMinStake(MIN); s.setWarmup(WARMUP);
        s.setTerm(1, 30 days, 2_500); s.setTerm(2, 90 days, 6_000); s.setTerm(3, 180 days, 10_000);
        vm.stopPrank();
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            kevin.mint(us[i], 50_000_000e18);
            vm.prank(us[i]); kevin.approve(address(s), type(uint256).max);
        }
    }
    function _fund() internal { gme.mint(address(s), POT); vm.prank(owner); s.notifyRewardAmount(POT); }

    /// Carol is an honest, already-warm, actively-earning staker. Does it make ANY
    /// difference to her whether Alice spent the warm-up holding 1 wei or 10m?
    function _run(bool dust) internal returns (uint256 carolEarned, uint256 aliceEarned) {
        _deploy();
        // Carol stakes and warms up first, so she is genuinely earning when the period opens.
        vm.prank(carol); s.stakeFor(MIN * 2, 3);
        // Alice arms her clock at the same moment: 1 wei, or the full honest position.
        vm.prank(alice); dust ? s.stake(1) : s.stakeFor(MIN * 2, 3);

        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(carol);
        _fund();                                   // emissions begin
        if (dust) { vm.prank(alice); s.stakeFor(MIN * 2 - 1, 3); }
        s.activate(alice);

        assertEq(s.balanceOf(alice), MIN * 2, "same position either way");
        vm.warp(block.timestamp + DURATION);
        carolEarned = s.earned(carol);
        aliceEarned = s.earned(alice);
    }

    function test_honestStakersAreIndifferentToTheDustTrick() public {
        (uint256 cDust, uint256 aDust) = _run(true);
        (uint256 cHonest, uint256 aHonest) = _run(false);
        console2.log("carol, alice dusted the warm-up :", cDust);
        console2.log("carol, alice held full size     :", cHonest);
        console2.log("alice dusted :", aDust);
        console2.log("alice honest :", aHonest);
        assertEq(cDust, cHonest, "an honest earner receives EXACTLY the same either way");
        assertEq(aDust, aHonest, "and the 'attacker' gains EXACTLY nothing over staking honestly early");
    }

    /// The PoC's "bob earned 0" is the un-activated keeper issue, not the warm-up.
    function test_bobEarnsFineOnceTheKeeperTouchesHim() public {
        _deploy();
        vm.prank(alice); s.stake(1);
        vm.warp(block.timestamp + WARMUP + 1);
        _fund();
        vm.prank(alice); s.stakeFor(MIN * 2 - 1, 3);
        s.activate(alice);
        vm.prank(bob); s.stakeFor(MIN * 2, 3);

        vm.warp(block.timestamp + WARMUP + 1);   // bob's own warm-up ends
        s.activate(bob);                          // the keeper does its job
        vm.warp(block.timestamp + 10 days);
        console2.log("alice:", s.earned(alice));
        console2.log("bob  :", s.earned(bob));
        assertGt(s.earned(bob), 0, "bob earns from the moment he is warm");
    }

    /// The proposed fix does not remove the behaviour; it only re-prices it.
    function test_proposedFixIsStillBypassedByHoldingExactlyTheMinimum() public {
        _deploy();
        // Under the proposed fix the clock arms on crossing minStake. A whale
        // holds EXACTLY the minimum through the warm-up, then sizes up 10x at
        // the emission start -- clock never re-arms, same head start.
        vm.prank(alice); s.stakeFor(MIN, 3);
        vm.warp(block.timestamp + WARMUP + 1);
        _fund();
        vm.prank(alice); s.stakeFor(45_000_000e18, 3);   // 10x, at the bell
        s.activate(alice);
        assertTrue(s.qualifies(alice));
        assertEq(s.balanceOf(alice), 50_000_000e18);
        console2.log("size held through warm-up  :", MIN);
        console2.log("size earning at the bell   :", s.balanceOf(alice));
    }

    /// Selling down under the minimum DOES already re-arm the warm-up.
    function test_sellingUnderTheMinimumRestartsTheClock() public {
        _deploy();
        vm.prank(alice); s.stake(MIN * 2);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice);
        assertTrue(s.qualifies(alice));
        vm.prank(alice); s.withdraw(MIN + 1);     // now under the minimum
        (uint64 earnFrom,,) = s.lockOf(alice);
        assertEq(earnFrom, uint64(block.timestamp + WARMUP), "clock re-armed on the way down");
        vm.prank(alice); s.stake(MIN * 2);         // buy straight back
        assertFalse(s.qualifies(alice), "must serve the warm-up again");
    }

    /// Nobody pre-armed: the warm-up window's emissions are recycled, not burned.
    function test_warmupWindowEmissionsAreRecycledWhenNobodyQualifies() public {
        _deploy();
        vm.prank(bob); s.stakeFor(MIN * 2, 3);
        _fund();
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(bob);
        assertGt(s.unallocatedRewards(), 0, "warm-up seconds are remembered, not stranded");
        console2.log("unallocated after warm-up:", s.unallocatedRewards());
    }
}
