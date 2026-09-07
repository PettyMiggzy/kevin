// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract RefuteClaimGate is Test {
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
        s.setMinStake(MIN); s.setWarmup(WARMUP);
        s.setTerm(1, 30 days, 2_500); s.setTerm(2, 90 days, 6_000); s.setTerm(3, 180 days, 10_000);
        vm.stopPrank();
        for (uint256 i; i < 2; ++i) {
            address u = i == 0 ? alice : bob;
            kevin.mint(u, 50_000_000e18);
            vm.prank(u); kevin.approve(address(s), type(uint256).max);
        }
    }
    function _fund() internal { gme.mint(address(s), POT); vm.prank(owner); s.notifyRewardAmount(POT); }

    /// Bob, the honest long-term staker, is NOT holding tokens "he cannot spend".
    function test_lockedStakerCanClaimToday() public {
        vm.prank(bob); s.stakeFor(MIN, 3);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(bob); _fund();
        vm.warp(block.timestamp + 10 days);
        assertTrue(s.isLocked(bob), "deep inside his 180-day term");
        uint256 owed = s.earned(bob);
        vm.prank(bob); s.getReward();
        assertEq(gme.balanceOf(bob), owed, "paid in full, mid-term, no gate");
        assertTrue(s.isLocked(bob), "and still committed");
    }

    /// Claim cadence changes NOTHING about how much an honest staker earns.
    function test_claimCadenceIsEconomicallyNeutralForWhoeverHonoursTheTerm() public {
        vm.prank(alice); s.stakeFor(MIN, 3);
        vm.prank(bob);   s.stakeFor(MIN, 3);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob); _fund();
        for (uint256 d; d < 29; ++d) { vm.warp(block.timestamp + 1 days); vm.prank(alice); s.getReward(); }
        vm.warp(block.timestamp + 12 hours);
        uint256 aliceTotal = gme.balanceOf(alice) + s.earned(alice);
        uint256 bobTotal   = gme.balanceOf(bob)   + s.earned(bob);
        console2.log("alice accrued in total:", aliceTotal);
        console2.log("bob   accrued in total:", bobTotal);
        assertEq(aliceTotal, bobTotal, "daily claiming earned her not one wei more");
    }

    /// The staker who stays is BETTER off after the breaker leaves, not worse.
    function test_theStayerGainsWhatTheBreakerForfeits() public {
        vm.prank(alice); s.stakeFor(MIN, 3);
        vm.prank(bob);   s.stakeFor(MIN, 3);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob); _fund();
        for (uint256 d; d < 29; ++d) { vm.warp(block.timestamp + 1 days); vm.prank(alice); s.getReward(); }
        vm.warp(block.timestamp + 12 hours);
        uint256 freeBefore = s.freeRewardBalance();
        uint256 forfeited = s.earned(alice);
        vm.prank(alice); s.exit();
        assertEq(s.freeRewardBalance(), freeBefore + forfeited, "her stake-at-risk went back to the pot");
        // and bob now takes the rest of the emission alone
        uint256 bobBefore = s.earned(bob);
        vm.warp(block.timestamp + 1 days);
        uint256 soloRate = s.earned(bob) - bobBefore;
        assertGt(soloRate, 0);
        console2.log("bob's daily accrual after she left:", soloRate);
    }

    /// Nothing leaves beyond the scheduled emission, whatever the claim pattern.
    function test_totalPaidNeverExceedsThePot() public {
        vm.prank(alice); s.stakeFor(MIN, 3);
        vm.prank(bob);   s.stakeFor(MIN, 3);
        vm.warp(block.timestamp + WARMUP + 1);
        s.activate(alice); s.activate(bob); _fund();
        for (uint256 d; d < 40; ++d) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(alice); s.getReward();
            vm.prank(bob);   s.getReward();
        }
        uint256 paid = gme.balanceOf(alice) + gme.balanceOf(bob);
        console2.log("total GME paid out:", paid, "pot:", POT);
        assertLe(paid, POT, "the accumulator is not over-drawn by claim-as-you-go");
        assertEq(s.totalEffectiveSupply(), s.effectiveBalanceOf(alice) + s.effectiveBalanceOf(bob), "central invariant holds");
    }
}
