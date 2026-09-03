// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @dev DSToken / DAI-shaped ERC-20: `transferFrom` skips the allowance check
///      when `from == msg.sender`. Extremely common in the wild.
contract SelfTransferERC20 {
    string public name = "SelfKevin";
    string public symbol = "sKEVIN";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 v);
    event Approval(address indexed o, address indexed s, uint256 v);

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
        totalSupply += a;
        emit Transfer(address(0), to, a);
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        emit Approval(msg.sender, s, a);
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        emit Transfer(msg.sender, to, a);
        return true;
    }

    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        if (from != msg.sender) {
            allowance[from][msg.sender] -= a;
        }
        balanceOf[from] -= a;
        balanceOf[to] += a;
        emit Transfer(from, to, a);
        return true;
    }
}

contract AdversarialTest is Test {
    KevinStaking internal s;
    MockERC20 internal kevin;
    MockERC721 internal crew;

    address internal owner = address(0xB0B5);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant D = 10_000; // seconds
    uint256 internal constant RATE = 1e18; // wei/sec
    uint256 internal constant FUND = D * RATE; // 10_000e18

    function setUp() public {
        kevin = new MockERC20("KEVIN", "KEVIN", 18);
        crew = new MockERC721();
        s = new KevinStaking(
            IERC20(address(kevin)), IERC20(address(kevin)), IERC721(address(crew)), D, owner
        );

        kevin.mint(alice, 1_000_000e18);
        kevin.mint(bob, 1_000_000e18);
        vm.prank(alice);
        kevin.approve(address(s), type(uint256).max);
        vm.prank(bob);
        kevin.approve(address(s), type(uint256).max);

        // tier 1 == +100%
        vm.prank(owner);
        s.setTierBoost(1, 10_000, "double");

        vm.warp(1_000_000);
    }

    function _fundAndStart(uint256 amount) internal {
        kevin.mint(address(s), amount);
        vm.prank(owner);
        s.notifyRewardAmount(amount);
    }

    function _giveBoostedNft(address who, uint256 id) internal {
        crew.mint(who, id);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner);
        s.setTokenTiers(ids, 1);
        vm.startPrank(who);
        crew.setApprovalForAll(address(s), true);
        s.stakeNfts(ids);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // 1. Hand-derived two-staker maths, different boosts, staggered exit
    // -----------------------------------------------------------------
    function test_HandDerived_TwoStakers_DifferentBoosts() public {
        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;
        assertEq(s.rewardRate(), RATE, "rate");

        vm.prank(alice);
        s.stake(100e18); // eff 100e18, unboosted

        vm.warp(t0 + 1000);
        _giveBoostedNft(bob, 7);
        vm.prank(bob);
        s.stake(100e18); // eff 200e18

        // Segment 1: 1000s @ supply 100e18 -> rpt = 1000*1e18*1e18/100e18 = 10e18
        assertEq(s.rewardPerToken(), 10e18, "rpt after seg1");
        assertEq(s.earned(alice), 1000e18, "alice seg1");
        assertEq(s.earned(bob), 0, "bob seg1");

        vm.warp(t0 + 3000);
        // Segment 2: 2000s @ supply 300e18 -> delta = 2000e18*1e18/300e18
        uint256 d2 = (2000 * RATE * 1e18) / 300e18; // 6666666666666666666
        assertEq(d2, 6_666_666_666_666_666_666);
        assertEq(s.rewardPerToken(), 10e18 + d2);
        assertEq(s.earned(alice), 1000e18 + (100e18 * d2) / 1e18);
        assertEq(s.earned(bob), (200e18 * d2) / 1e18);

        uint256 aliceExpected = 1000e18 + (100e18 * d2) / 1e18; // 1666666666666666666600
        assertEq(aliceExpected, 1_666_666_666_666_666_666_600);

        uint256 aBefore = kevin.balanceOf(alice);
        vm.prank(alice);
        s.exit();
        assertEq(kevin.balanceOf(alice) - aBefore, 100e18 + aliceExpected, "alice payout");

        // Segment 3: 7000s @ supply 200e18
        vm.warp(t0 + D + 5000); // well past periodFinish
        uint256 d3 = (7000 * RATE * 1e18) / 200e18; // 35e18
        assertEq(d3, 35e18);
        uint256 bobExpected = (200e18 * d2) / 1e18 + (200e18 * d3) / 1e18;
        assertEq(bobExpected, 8_333_333_333_333_333_333_200);
        assertEq(s.earned(bob), bobExpected, "bob total");

        uint256 bBefore = kevin.balanceOf(bob);
        vm.prank(bob);
        s.exit();
        assertEq(kevin.balanceOf(bob) - bBefore, 100e18 + bobExpected, "bob payout");

        // Never over-pays the funded amount.
        assertLe(aliceExpected + bobExpected, FUND, "overpay");
        assertEq(FUND - (aliceExpected + bobExpected), 200, "dust is 200 wei");

        // Contract is empty of principal, holds only dust.
        assertEq(s.totalStaked(), 0);
        assertEq(kevin.balanceOf(address(s)), 200);
    }

    // -----------------------------------------------------------------
    // 2. Boost change mid-stake must NOT be retroactive
    // -----------------------------------------------------------------
    function test_BoostCut_IsNotRetroactive() public {
        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;

        _giveBoostedNft(alice, 1);
        vm.prank(alice);
        s.stake(100e18); // eff 200e18
        vm.prank(bob);
        s.stake(100e18); // eff 100e18
        assertEq(s.totalEffectiveSupply(), 300e18);

        vm.warp(t0 + 1000);
        uint256 rpt1 = (1000 * RATE * 1e18) / 300e18; // 3333333333333333333
        assertEq(s.rewardPerToken(), rpt1);
        uint256 aliceSeg1 = (200e18 * rpt1) / 1e18;

        // Owner zeroes the tier; a stranger forces the sync.
        vm.prank(owner);
        s.setTierBoost(1, 0, "zeroed");
        vm.prank(address(0xDEAD));
        s.syncBoost(alice);

        // Settled at the OLD boost, then re-based.
        assertEq(s.rewards(alice), aliceSeg1, "alice banked at old boost");
        assertEq(s.effectiveBalanceOf(alice), 100e18);
        assertEq(s.totalEffectiveSupply(), 200e18);

        vm.warp(t0 + 2000);
        uint256 rpt2 = rpt1 + (1000 * RATE * 1e18) / 200e18; // + 5e18
        assertEq(s.rewardPerToken(), rpt2);
        assertEq(s.earned(alice), aliceSeg1 + 500e18, "alice not retro-cut");
        assertEq(s.earned(bob), (100e18 * rpt2) / 1e18, "bob");
        assertEq(s.earned(alice), 1_166_666_666_666_666_666_600);
        assertEq(s.earned(bob), 833_333_333_333_333_333_300);
        assertLe(s.earned(alice) + s.earned(bob), 2000e18);
    }

    function test_BoostRaise_IsNotRetroactive() public {
        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;

        _giveBoostedNft(alice, 1);
        vm.prank(owner);
        s.setTierBoost(1, 0, "starts at zero");

        vm.prank(alice);
        s.stake(100e18);
        vm.prank(bob);
        s.stake(100e18);
        assertEq(s.totalEffectiveSupply(), 200e18);

        vm.warp(t0 + 1000);
        vm.prank(owner);
        s.setTierBoost(1, 20_000, "max");
        s.syncBoost(alice);

        // First 1000s were split 50/50 at the OLD boost.
        assertEq(s.rewards(alice), 500e18, "no retro raise");
        assertEq(s.effectiveBalanceOf(alice), 300e18);

        vm.warp(t0 + 2000);
        // supply 400e18: alice 3/4, bob 1/4
        assertEq(s.earned(alice), 500e18 + 750e18);
        assertEq(s.earned(bob), 500e18 + 250e18);
    }

    // -----------------------------------------------------------------
    // 3. topUpCurrentPeriod: reward smaller than the remaining seconds
    // -----------------------------------------------------------------
    function test_TopUp_SmallerThanRemaining_IsNotSilentlyBurned() public {
        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        s.stake(100e18);

        vm.warp(t0 + 1000);
        uint256 remaining = s.periodFinish() - block.timestamp; // 9000
        assertEq(remaining, 9000);

        uint256 rateBefore = s.rewardRate();
        uint256 committedBefore = s.rewardsCommitted();

        // 8999 wei over 9000 seconds -> integer rate bump of ZERO.
        kevin.mint(address(s), 8999);
        vm.prank(owner);
        vm.expectRevert(KevinStaking.RewardTooSmall.selector);
        s.topUpCurrentPeriod(8999);

        assertEq(s.rewardRate(), rateBefore, "rate untouched");
        assertEq(s.rewardsCommitted(), committedBefore, "nothing committed");
    }

    // -----------------------------------------------------------------
    // 4. rescueERC721 must not be an ERC-20 drain (selector collision)
    // -----------------------------------------------------------------
    function test_RescueERC721_CannotDrainStakedPrincipal() public {
        SelfTransferERC20 tok = new SelfTransferERC20();
        MockERC721 c2 = new MockERC721();
        KevinStaking s2 = new KevinStaking(
            IERC20(address(tok)), IERC20(address(tok)), IERC721(address(c2)), D, owner
        );

        tok.mint(alice, 1000e18);
        vm.startPrank(alice);
        tok.approve(address(s2), type(uint256).max);
        s2.stake(1000e18);
        vm.stopPrank();

        assertEq(tok.balanceOf(address(s2)), 1000e18);
        assertEq(s2.totalStaked(), 1000e18);

        // recoverERC20 correctly refuses.
        vm.prank(owner);
        vm.expectRevert();
        s2.recoverERC20(IERC20(address(tok)), 1000e18);

        // transferFrom(address,address,uint256) is the SAME selector on
        // ERC-721 and ERC-20. rescueERC721 must refuse the staking/reward
        // token, or the owner walks off with every staker's principal.
        vm.prank(owner);
        vm.expectRevert(KevinStaking.NotRescuable.selector);
        s2.rescueERC721(IERC721(address(tok)), 1000e18, owner);

        // Same guard on the reward token, and a real ERC-721 still rescues.
        vm.prank(owner);
        vm.expectRevert(KevinStaking.NotRescuable.selector);
        s2.rescueERC721(IERC721(address(tok)), 1, owner);
        c2.mint(address(s2), 99);
        vm.prank(owner);
        s2.rescueERC721(IERC721(address(c2)), 99, owner);
        assertEq(c2.ownerOf(99), owner, "genuine rescue still works");

        assertEq(tok.balanceOf(address(s2)), 1000e18, "principal still here");
        assertEq(tok.balanceOf(owner), 0, "owner got nothing");

        // And the staker can still leave whole.
        vm.prank(alice);
        s2.withdraw(1000e18);
        assertEq(tok.balanceOf(alice), 1000e18);
    }

    // -----------------------------------------------------------------
    // 5. Solvency: last person out can always leave; total paid <= funded
    // -----------------------------------------------------------------
    function testFuzz_Solvency_LastOutAlwaysExits(
        uint96 aStake,
        uint96 bStake,
        uint32 joinGap,
        uint32 exitGap,
        uint16 boostA,
        bool emergencyB
    ) public {
        aStake = uint96(bound(aStake, 1, 1e24));
        bStake = uint96(bound(bStake, 1, 1e24));
        joinGap = uint32(bound(joinGap, 0, D));
        exitGap = uint32(bound(exitGap, 0, 2 * D));
        boostA = uint16(bound(boostA, 0, 20_000));

        vm.prank(owner);
        s.setTierBoost(1, boostA, "fuzzed");

        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;

        _giveBoostedNft(alice, 42);
        vm.prank(alice);
        s.stake(aStake);

        vm.warp(t0 + joinGap);
        vm.prank(bob);
        s.stake(bStake);

        vm.warp(t0 + joinGap + exitGap);
        vm.prank(alice);
        s.exit();

        vm.warp(t0 + joinGap + exitGap + 1);
        if (emergencyB) {
            vm.prank(bob);
            s.emergencyWithdraw();
        } else {
            vm.prank(bob);
            s.exit();
        }

        // Everyone got their principal back, in full.
        assertEq(s.totalStaked(), 0, "totalStaked drained");
        assertGe(kevin.balanceOf(alice), 1_000_000e18, "alice principal whole");
        assertGe(kevin.balanceOf(bob), 1_000_000e18, "bob principal whole");

        // Nobody was paid more than was funded.
        uint256 paid =
            (kevin.balanceOf(alice) - 1_000_000e18) + (kevin.balanceOf(bob) - 1_000_000e18);
        assertLe(paid, FUND, "overpay");

        // Contract still solvent for whatever it claims to owe.
        assertGe(kevin.balanceOf(address(s)), s.rewardsCommitted() + s.totalStaked(), "insolvent");
    }

    // -----------------------------------------------------------------
    // 6. Owner cannot sweep principal or owed rewards, ever
    // -----------------------------------------------------------------
    function test_OwnerCannotSweepPrincipalOrOwed() public {
        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        s.stake(500e18);

        vm.warp(t0 + D / 2);

        // Free balance is zero: everything here is principal or committed.
        assertEq(s.freeRewardBalance(), 0);
        vm.prank(owner);
        vm.expectRevert();
        s.recoverERC20(IERC20(address(kevin)), 1);

        // Alice can still take everything she is owed at the end.
        vm.warp(t0 + D + 1);
        uint256 owed = s.earned(alice);
        vm.prank(alice);
        s.exit();
        assertEq(kevin.balanceOf(alice), 1_000_000e18 + owed);
    }

    // -----------------------------------------------------------------
    // 7. Small-stake precision: a 1-wei staker cannot mint value
    // -----------------------------------------------------------------
    function test_DustStaker_CannotOutEarnEmissions() public {
        _fundAndStart(FUND);
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        s.stake(1);
        vm.prank(bob);
        s.stake(1e24);

        vm.warp(t0 + D + 1);
        uint256 total = s.earned(alice) + s.earned(bob);
        assertLe(total, FUND, "overpay");
    }

    // -----------------------------------------------------------------
    // 8. Two periods with an empty-pool gap: no double-spend of the
    //    unallocated reward-seconds, and the contract stays solvent.
    // -----------------------------------------------------------------
    function test_TwoPeriods_EmptyGap_NoDoubleSpend() public {
        _fundAndStart(FUND); // balance FUND, committed FUND
        uint256 t0 = block.timestamp;

        // Nobody stakes for the first half of period 1.
        vm.warp(t0 + D / 2);
        vm.prank(alice);
        s.stake(100e18);
        assertEq(s.unallocatedRewards(), (D / 2) * RATE, "half emitted to nobody");

        vm.warp(t0 + D + 1);
        uint256 aliceOwed = s.earned(alice);
        assertEq(aliceOwed, (D / 2) * RATE, "alice gets the other half");

        // Period 2 recycles exactly the orphaned half; no new money added.
        vm.prank(owner);
        s.notifyRewardAmount((D / 2) * RATE);
        assertEq(s.unallocatedRewards(), 0);
        // Committed = alice's unclaimed half + the re-notified half = FUND.
        assertEq(s.rewardsCommitted(), FUND, "no double-spend");
        assertEq(kevin.balanceOf(address(s)), FUND + 100e18, "balance covers it");
        assertEq(s.freeRewardBalance(), 0, "nothing left to sweep");

        vm.warp(block.timestamp + D + 1);
        vm.prank(alice);
        s.exit();
        // Alice alone for period 2, plus her period-1 half. Never more than FUND.
        uint256 paid = kevin.balanceOf(alice) - 1_000_000e18;
        assertEq(paid, FUND, "exactly the funded amount, no more");
        assertGe(kevin.balanceOf(address(s)), s.rewardsCommitted() + s.totalStaked());
    }
}
