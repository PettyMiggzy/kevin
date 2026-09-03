// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721, HookERC20} from "./mocks/Mocks.sol";
import {Reenterer} from "./mocks/Reentrant.sol";

contract KevinStakingTest is Test {
    MockERC20 internal kevin;
    MockERC721 internal crew;
    KevinStaking internal staking;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant DURATION = 30 days;
    uint256 internal constant STAKE = 1_000e18;
    uint256 internal constant REWARD = 30_000e18;

    function setUp() public virtual {
        vm.warp(1_700_000_000);

        kevin = new MockERC20("KEVIN", "KEVIN", 18);
        crew = new MockERC721();
        staking = new KevinStaking(
            IERC20(address(kevin)), IERC20(address(kevin)), IERC721(address(crew)), DURATION, owner
        );

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; ++i) {
            kevin.mint(users[i], 1_000_000e18);
            vm.prank(users[i]);
            kevin.approve(address(staking), type(uint256).max);
            vm.prank(users[i]);
            crew.setApprovalForAll(address(staking), true);
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _fund(uint256 amount) internal {
        kevin.mint(address(staking), amount);
        vm.prank(owner);
        staking.notifyRewardAmount(amount);
    }

    function _stake(address who, uint256 amount) internal {
        vm.prank(who);
        staking.stake(amount);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        out[0] = a;
        out[1] = b;
    }

    function _mintCrew(address to, uint256 id) internal {
        crew.mint(to, id);
    }

    function _setTier(uint256 tokenId, uint16 tier) internal {
        vm.prank(owner);
        staking.setTokenTiers(_ids(tokenId), tier);
    }

    function _setTierBoost(uint16 tier, uint16 bps) internal {
        vm.prank(owner);
        staking.setTierBoost(tier, bps, "test tier");
    }

    // ==================================================================
    // 1. staking and unstaking
    // ==================================================================

    function test_StakeMovesTokensAndBooksBalances() public {
        uint256 before = kevin.balanceOf(alice);
        _stake(alice, STAKE);

        assertEq(kevin.balanceOf(alice), before - STAKE, "alice not debited");
        assertEq(kevin.balanceOf(address(staking)), STAKE, "contract not credited");
        assertEq(staking.balanceOf(alice), STAKE, "balanceOf");
        assertEq(staking.totalStaked(), STAKE, "totalStaked");
        // No NFT, so effective == nominal.
        assertEq(staking.effectiveBalanceOf(alice), STAKE, "effective");
        assertEq(staking.totalEffectiveSupply(), STAKE, "totalEffective");
    }

    function test_WithdrawReturnsPrincipal() public {
        _stake(alice, STAKE);

        vm.prank(alice);
        staking.withdraw(STAKE / 4);

        assertEq(staking.balanceOf(alice), STAKE - STAKE / 4);
        assertEq(staking.totalStaked(), STAKE - STAKE / 4);
        assertEq(staking.effectiveBalanceOf(alice), STAKE - STAKE / 4);
        assertEq(kevin.balanceOf(address(staking)), STAKE - STAKE / 4);
    }

    function test_WithdrawEverythingLeavesNoDust() public {
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.withdraw(STAKE);

        assertEq(staking.balanceOf(alice), 0);
        assertEq(staking.totalStaked(), 0);
        assertEq(staking.totalEffectiveSupply(), 0);
        assertEq(kevin.balanceOf(address(staking)), 0);
    }

    function test_WithdrawMoreThanStakedReverts() public {
        _stake(alice, STAKE);
        vm.prank(alice);
        vm.expectRevert(KevinStaking.InsufficientBalance.selector);
        staking.withdraw(STAKE + 1);
    }

    function test_ExitTakesPrincipalAndRewards() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(DURATION);

        uint256 before = kevin.balanceOf(alice);
        vm.prank(alice);
        staking.exit();

        uint256 gained = kevin.balanceOf(alice) - before;
        assertGt(gained, STAKE, "should be principal plus rewards");
        assertEq(staking.balanceOf(alice), 0);
        assertEq(staking.earned(alice), 0);
    }

    // ==================================================================
    // 2. staking zero
    // ==================================================================

    function test_StakeZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(KevinStaking.ZeroAmount.selector);
        staking.stake(0);
    }

    function test_WithdrawZeroReverts() public {
        _stake(alice, STAKE);
        vm.prank(alice);
        vm.expectRevert(KevinStaking.ZeroAmount.selector);
        staking.withdraw(0);
    }

    function test_StakeNoNftsReverts() public {
        uint256[] memory empty = new uint256[](0);
        vm.prank(alice);
        vm.expectRevert(KevinStaking.EmptyArray.selector);
        staking.stakeNfts(empty);
    }

    function test_EmergencyWithdrawWithNothingStakedReverts() public {
        vm.prank(alice);
        vm.expectRevert(KevinStaking.NothingStaked.selector);
        staking.emergencyWithdraw();
    }

    /// @dev Zero stake must not corrupt the accumulator either: a claim with
    ///      nothing staked is a silent no-op, not a revert and not a payout.
    function test_GetRewardWithNothingStakedIsANoOp() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(1 days);

        uint256 before = kevin.balanceOf(bob);
        vm.prank(bob);
        staking.getReward();
        assertEq(kevin.balanceOf(bob), before, "bob paid for nothing");
    }

    // ==================================================================
    // 3. reward accrual over time
    // ==================================================================

    function test_RewardAccruesLinearly() public {
        _stake(alice, STAKE);
        _fund(REWARD);

        uint256 rate = staking.rewardRate();
        assertEq(rate, REWARD / DURATION, "rate");

        assertEq(staking.earned(alice), 0, "nothing at t0");

        skip(1 days);
        assertApproxEqAbs(staking.earned(alice), rate * 1 days, 1e6, "day 1");

        skip(9 days);
        assertApproxEqAbs(staking.earned(alice), rate * 10 days, 1e6, "day 10");

        skip(20 days);
        assertApproxEqAbs(staking.earned(alice), rate * DURATION, 1e6, "day 30");
    }

    function test_GetRewardPaysAndZeroes() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(10 days);

        uint256 owed = staking.earned(alice);
        assertGt(owed, 0);

        uint256 before = kevin.balanceOf(alice);
        vm.prank(alice);
        staking.getReward();

        assertEq(kevin.balanceOf(alice) - before, owed, "paid exactly what was earned");
        assertEq(staking.earned(alice), 0, "reset");
    }

    function test_StakingMoreDoesNotWipeAccruedRewards() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(10 days);

        uint256 owedBefore = staking.earned(alice);
        _stake(alice, STAKE);

        assertApproxEqAbs(staking.earned(alice), owedBefore, 1e6, "banked across a re-stake");
    }

    // ==================================================================
    // 4. two stakers splitting emissions
    // ==================================================================

    function test_TwoStakersSplitEqually() public {
        _stake(alice, STAKE);
        _stake(bob, STAKE);
        _fund(REWARD);
        skip(DURATION);

        uint256 rate = staking.rewardRate();
        uint256 half = (rate * DURATION) / 2;

        assertApproxEqAbs(staking.earned(alice), half, 1e6, "alice half");
        assertApproxEqAbs(staking.earned(bob), half, 1e6, "bob half");
        assertApproxEqAbs(
            staking.earned(alice) + staking.earned(bob), rate * DURATION, 1e6, "sum is the pot"
        );
    }

    function test_TwoStakersSplitByWeight() public {
        _stake(alice, STAKE); // 1x
        _stake(bob, STAKE * 3); // 3x
        _fund(REWARD);
        skip(DURATION);

        uint256 total = staking.rewardRate() * DURATION;
        assertApproxEqAbs(staking.earned(alice), total / 4, 1e6, "alice quarter");
        assertApproxEqAbs(staking.earned(bob), (total * 3) / 4, 1e6, "bob three quarters");
    }

    function test_LateStakerOnlyEarnsFromWhenTheyArrived() public {
        _stake(alice, STAKE);
        _fund(REWARD);

        skip(DURATION / 2);
        _stake(bob, STAKE);
        skip(DURATION / 2);

        uint256 rate = staking.rewardRate();
        // Alice: all of the first half, half of the second.
        uint256 aliceExpected = rate * (DURATION / 2) + (rate * (DURATION / 2)) / 2;
        uint256 bobExpected = (rate * (DURATION / 2)) / 2;

        assertApproxEqAbs(staking.earned(alice), aliceExpected, 1e6, "alice");
        assertApproxEqAbs(staking.earned(bob), bobExpected, 1e6, "bob");
    }

    function test_PaidOutSumNeverExceedsWhatWasFunded() public {
        _stake(alice, STAKE);
        _stake(bob, STAKE * 7);
        _stake(carol, STAKE * 13);
        _fund(REWARD);
        skip(DURATION + 10 days);

        uint256 sum = staking.earned(alice) + staking.earned(bob) + staking.earned(carol);
        assertLe(sum, REWARD, "over-distributed");
        assertApproxEqRel(sum, REWARD, 1e12, "under-distributed by more than dust");
    }

    // ==================================================================
    // 5. NFT boost
    // ==================================================================

    function test_NftBoostRaisesEffectiveBalance() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 5_000); // +50%
        _setTier(1, 1);

        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));

        assertEq(staking.appliedBoostBps(alice), 5_000);
        assertEq(staking.effectiveBalanceOf(alice), (STAKE * 15_000) / 10_000);
        assertEq(staking.totalEffectiveSupply(), (STAKE * 15_000) / 10_000);
        assertEq(crew.ownerOf(1), address(staking), "NFT held by the pool");
        assertEq(staking.nftDepositor(1), alice);
    }

    function test_UntieredNftGivesNoBoost() public {
        _mintCrew(alice, 7);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(7));

        assertEq(staking.appliedBoostBps(alice), 0, "untiered must be inert");
        assertEq(staking.effectiveBalanceOf(alice), STAKE);
    }

    function test_BoostIsCapped() public {
        // Three NFTs each worth the whole cap. Sum is 3x the cap; applied is 1x.
        _setTierBoost(9, uint16(staking.MAX_BOOST_BPS()));
        for (uint256 i = 1; i <= 3; ++i) {
            _mintCrew(alice, i);
            _setTier(i, 9);
        }

        _stake(alice, STAKE);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        vm.prank(alice);
        staking.stakeNfts(ids);

        assertEq(staking.appliedBoostBps(alice), staking.MAX_BOOST_BPS(), "capped");
        assertEq(
            staking.effectiveBalanceOf(alice),
            (STAKE * (10_000 + staking.MAX_BOOST_BPS())) / 10_000,
            "3x and no more"
        );
    }

    function test_SingleTierAboveCapIsRejected() public {
        uint16 overCap = uint16(staking.MAX_BOOST_BPS() + 1);
        vm.prank(owner);
        vm.expectRevert(KevinStaking.BoostAboveCap.selector);
        staking.setTierBoost(1, overCap, "too much");
    }

    function test_TierZeroIsReserved() public {
        vm.prank(owner);
        vm.expectRevert(KevinStaking.ReservedTier.selector);
        staking.setTierBoost(0, 100, "nope");
    }

    function test_UnstakingNftDropsTheBoost() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 10_000);
        _setTier(1, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        assertEq(staking.effectiveBalanceOf(alice), STAKE * 2);

        vm.prank(alice);
        staking.withdrawNfts(_ids(1));

        assertEq(staking.appliedBoostBps(alice), 0);
        assertEq(staking.effectiveBalanceOf(alice), STAKE);
        assertEq(staking.totalEffectiveSupply(), STAKE);
        assertEq(crew.ownerOf(1), alice, "NFT returned");
        assertEq(staking.nftDepositor(1), address(0));
    }

    function test_OnlyDepositorCanWithdrawAnNft() public {
        _mintCrew(alice, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KevinStaking.NotDepositor.selector, uint256(1)));
        staking.withdrawNfts(_ids(1));
    }

    /// @dev Swap-and-pop removal has to keep `_nftIndex` honest for the token
    ///      that gets moved into the hole. Withdraw from the middle, then prove
    ///      every remaining token is still withdrawable.
    function test_NftRemovalFromTheMiddleKeepsTheIndexHonest() public {
        uint256[] memory ids = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            ids[i] = 100 + i;
            _mintCrew(alice, ids[i]);
        }
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(ids);
        assertEq(staking.stakedNftCount(alice), 5);

        vm.prank(alice);
        staking.withdrawNfts(_ids(101, 103));
        assertEq(staking.stakedNftCount(alice), 3);

        uint256[] memory rest = new uint256[](3);
        rest[0] = 104;
        rest[1] = 100;
        rest[2] = 102;
        vm.prank(alice);
        staking.withdrawNfts(rest);

        assertEq(staking.stakedNftCount(alice), 0);
        for (uint256 i; i < 5; ++i) {
            assertEq(crew.ownerOf(100 + i), alice, "every NFT came back");
        }
    }

    function test_CannotStakeMoreThanTheNftCap() public {
        uint256 cap = staking.MAX_STAKED_NFTS();
        uint256[] memory ids = new uint256[](cap + 1);
        for (uint256 i; i <= cap; ++i) {
            ids[i] = 500 + i;
            _mintCrew(alice, ids[i]);
        }

        vm.prank(alice);
        vm.expectRevert(KevinStaking.TooManyNfts.selector);
        staking.stakeNfts(ids);

        // Exactly the cap is fine.
        uint256[] memory atCap = new uint256[](cap);
        for (uint256 i; i < cap; ++i) {
            atCap[i] = 500 + i;
        }
        vm.prank(alice);
        staking.stakeNfts(atCap);
        assertEq(staking.stakedNftCount(alice), cap);

        // One more is not.
        vm.prank(alice);
        vm.expectRevert(KevinStaking.TooManyNfts.selector);
        staking.stakeNfts(_ids(500 + cap));
    }

    // ==================================================================
    // 6. boost changing mid-stake
    // ==================================================================

    /**
     * Two stakers, equal principal, thirty days. Alice holds a tier-1 NFT that
     * is worth nothing for the first half and +100% for the second. The split
     * must be 50/50 over the first half and 2/3-1/3 over the second, and the
     * change must not reach back and re-price the first half.
     */
    function test_OwnerRetuningATierChangesTheSplitFromThatMomentOn() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 0); // explicitly worth nothing at first
        _setTier(1, 1);

        _stake(alice, STAKE);
        _stake(bob, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        _fund(REWARD);

        uint256 rate = staking.rewardRate();
        uint256 half = DURATION / 2;

        skip(half);
        uint256 aliceAtMidpoint = staking.earned(alice);
        uint256 bobAtMidpoint = staking.earned(bob);
        assertApproxEqAbs(aliceAtMidpoint, (rate * half) / 2, 1e6, "first half 50/50 - alice");
        assertApproxEqAbs(bobAtMidpoint, (rate * half) / 2, 1e6, "first half 50/50 - bob");

        // The owner doubles what tier 1 is worth, mid-stake.
        _setTierBoost(1, 10_000);

        // Nothing has moved yet: a retune is not retroactive and does not even
        // apply going forward until the account is synced.
        assertEq(staking.appliedBoostBps(alice), 0, "not applied before sync");
        assertEq(staking.pendingBoostBps(alice), 10_000, "but pending");

        // Anyone may push the sync. Bob does it, out of spite.
        vm.prank(bob);
        staking.syncBoost(alice);

        assertEq(staking.appliedBoostBps(alice), 10_000, "applied");
        assertEq(staking.effectiveBalanceOf(alice), STAKE * 2);
        assertEq(staking.totalEffectiveSupply(), STAKE * 3);

        // Rewards banked before the change are untouched.
        assertApproxEqAbs(staking.earned(alice), aliceAtMidpoint, 1e6, "no retroactive top-up");

        skip(half);

        uint256 secondHalf = rate * half;
        assertApproxEqAbs(
            staking.earned(alice),
            aliceAtMidpoint + (secondHalf * 2) / 3,
            1e12,
            "alice: half then two thirds"
        );
        assertApproxEqAbs(
            staking.earned(bob), bobAtMidpoint + secondHalf / 3, 1e12, "bob: half then one third"
        );
    }

    /// @dev Same shape, but the change is the holder staking an NFT part way
    ///      through rather than the owner retuning a tier.
    function test_StakingAnNftMidStakeChangesTheSplitFromThatMomentOn() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 10_000);
        _setTier(1, 1);

        _stake(alice, STAKE);
        _stake(bob, STAKE);
        _fund(REWARD);

        uint256 rate = staking.rewardRate();
        uint256 half = DURATION / 2;

        skip(half);
        uint256 aliceAtMidpoint = staking.earned(alice);

        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        assertEq(staking.effectiveBalanceOf(alice), STAKE * 2);
        assertApproxEqAbs(staking.earned(alice), aliceAtMidpoint, 1e6, "banked, not re-priced");

        skip(half);
        assertApproxEqAbs(
            staking.earned(alice), aliceAtMidpoint + (rate * half * 2) / 3, 1e12, "alice"
        );
    }

    /// @dev The owner cutting a tier to zero mid-stake must also only bite
    ///      forwards, and must not strand effective supply.
    function test_TierCutToZeroOnlyBitesForwards() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 10_000);
        _setTier(1, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        _stake(bob, STAKE);
        _fund(REWARD);

        skip(DURATION / 2);
        uint256 banked = staking.earned(alice);

        _setTierBoost(1, 0);
        staking.syncBoost(alice);

        assertEq(staking.appliedBoostBps(alice), 0);
        assertEq(staking.effectiveBalanceOf(alice), STAKE);
        assertEq(staking.totalEffectiveSupply(), STAKE * 2, "supply follows exactly");
        assertApproxEqAbs(staking.earned(alice), banked, 1e6, "already-earned survives the cut");
    }

    function test_RetieringATokenChangesTheBoost() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 2_500);
        _setTierBoost(2, 7_500);
        _setTier(1, 1);

        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        assertEq(staking.appliedBoostBps(alice), 2_500);

        _setTier(1, 2);
        staking.syncBoost(alice);
        assertEq(staking.appliedBoostBps(alice), 7_500);
    }

    function test_SyncBoostIsPermissionless() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 1_000);
        _setTier(1, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));

        _setTierBoost(1, 5_000);

        vm.prank(carol); // a total stranger
        staking.syncBoost(alice);
        assertEq(staking.appliedBoostBps(alice), 5_000);
    }

    // ==================================================================
    // 7. reward-period expiry
    // ==================================================================

    function test_RewardsStopAtPeriodFinish() public {
        _stake(alice, STAKE);
        _fund(REWARD);

        skip(DURATION);
        uint256 atFinish = staking.earned(alice);

        skip(365 days);
        assertEq(staking.earned(alice), atFinish, "kept paying after the period ended");
        assertEq(staking.lastTimeRewardApplicable(), staking.periodFinish());
    }

    function test_CannotStartANewPeriodWhileOneIsRunning() public {
        _stake(alice, STAKE);
        _fund(REWARD);

        kevin.mint(address(staking), REWARD);
        vm.prank(owner);
        vm.expectRevert(KevinStaking.PeriodStillRunning.selector);
        staking.notifyRewardAmount(REWARD);
    }

    function test_TopUpAddsRewardsWithoutMovingTheEndDate() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        uint256 finish = staking.periodFinish();
        uint256 rateBefore = staking.rewardRate();

        skip(DURATION / 2);
        kevin.mint(address(staking), REWARD);
        vm.prank(owner);
        staking.topUpCurrentPeriod(REWARD);

        assertEq(staking.periodFinish(), finish, "period was silently extended");
        assertGt(staking.rewardRate(), rateBefore, "rate should rise instead");
    }

    function test_TopUpAfterThePeriodEndsReverts() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(DURATION + 1);

        kevin.mint(address(staking), REWARD);
        vm.prank(owner);
        vm.expectRevert(KevinStaking.PeriodNotFinished.selector);
        staking.topUpCurrentPeriod(REWARD);
    }

    function test_ASecondPeriodStartsCleanlyAfterTheFirst() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(DURATION);
        uint256 first = staking.earned(alice);

        _fund(REWARD);
        skip(DURATION);

        assertApproxEqRel(staking.earned(alice), first * 2, 1e12, "two full periods");
    }

    function test_DurationCannotChangeMidPeriod() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        vm.prank(owner);
        vm.expectRevert(KevinStaking.PeriodStillRunning.selector);
        staking.setRewardsDuration(7 days);

        skip(DURATION);
        vm.prank(owner);
        staking.setRewardsDuration(7 days);
        assertEq(staking.rewardsDuration(), 7 days);
    }

    function test_DurationBoundsAreEnforced() public {
        vm.startPrank(owner);
        vm.expectRevert(KevinStaking.BadDuration.selector);
        staking.setRewardsDuration(1 minutes);
        vm.expectRevert(KevinStaking.BadDuration.selector);
        staking.setRewardsDuration(400 days);
        vm.stopPrank();
    }

    // ==================================================================
    // 8. funding checks
    // ==================================================================

    function test_NotifyRevertsIfTheContractDoesNotHoldTheTokens() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(KevinStaking.RewardNotFunded.selector, REWARD, uint256(0))
        );
        staking.notifyRewardAmount(REWARD);
    }

    /// @dev The important one: staked principal is not spendable as rewards,
    ///      even though it is sitting in the same balance because the staking
    ///      token and the reward token are the same token.
    function test_StakedPrincipalCannotBeUsedToFundRewards() public {
        _stake(alice, 100_000e18);
        assertEq(kevin.balanceOf(address(staking)), 100_000e18);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(KevinStaking.RewardNotFunded.selector, REWARD, uint256(0))
        );
        staking.notifyRewardAmount(REWARD);
    }

    /// @dev And rewards already owed to a staker cannot be recycled into a new
    ///      period behind their back.
    function test_UnclaimedRewardsCannotBeUsedToFundTheNextPeriod() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(DURATION);

        uint256 owed = staking.earned(alice);
        assertGt(owed, 0);
        assertEq(staking.freeRewardBalance(), 0, "nothing free, it is all owed");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(KevinStaking.RewardNotFunded.selector, uint256(1), uint256(0))
        );
        staking.notifyRewardAmount(1);

        // Alice can still be paid in full.
        vm.prank(alice);
        staking.getReward();
        assertEq(kevin.balanceOf(alice) - (1_000_000e18 - STAKE), owed);
    }

    function test_RewardTooSmallForTheDurationReverts() public {
        kevin.mint(address(staking), 10);
        vm.prank(owner);
        vm.expectRevert(KevinStaking.RewardTooSmall.selector);
        staking.notifyRewardAmount(10); // 10 wei over 30 days rounds to rate 0
    }

    /// @dev Emissions into an empty pool are owed to nobody, so they must come
    ///      back round for the next period rather than being stranded here.
    function test_EmissionsIntoAnEmptyPoolAreReusable() public {
        _fund(REWARD);
        skip(DURATION);
        assertEq(staking.totalStaked(), 0);

        // `unallocatedRewards` is only materialised when the accumulator is
        // next rolled forward, which the first stake does.
        _stake(alice, STAKE);
        assertApproxEqRel(staking.unallocatedRewards(), REWARD, 1e12, "tracked");

        uint256 reclaimable = staking.rewardRate() * DURATION;
        vm.prank(owner);
        staking.notifyRewardAmount(reclaimable);

        skip(DURATION);
        assertGt(staking.earned(alice), 0, "second period paid out of the reclaimed pot");
        assertLe(kevin.balanceOf(address(staking)), REWARD + STAKE, "no fresh money invented");
    }

    // ==================================================================
    // 9. emergency withdraw
    // ==================================================================

    function test_EmergencyWithdrawReturnsPrincipalAndForfeitsRewards() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(15 days);

        uint256 forfeited = staking.earned(alice);
        assertGt(forfeited, 0);

        uint256 before = kevin.balanceOf(alice);
        vm.prank(alice);
        staking.emergencyWithdraw();

        assertEq(kevin.balanceOf(alice) - before, STAKE, "principal only, exactly");
        assertEq(staking.balanceOf(alice), 0);
        assertEq(staking.effectiveBalanceOf(alice), 0);
        assertEq(staking.totalEffectiveSupply(), 0);
        assertEq(staking.earned(alice), 0, "rewards gone");
    }

    /// @dev A bailed-out position must not keep reporting a boost it no longer
    ///      has any stake to apply, and must re-derive it if the holder returns.
    function test_EmergencyWithdrawClearsTheReportedBoostAndItComesBack() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 5_000);
        _setTier(1, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        assertEq(staking.appliedBoostBps(alice), 5_000);

        vm.prank(alice);
        staking.emergencyWithdraw();
        assertEq(staking.appliedBoostBps(alice), 0, "stale boost left on an empty position");

        // The NFT never moved, so staking again picks the boost straight back up.
        _stake(alice, STAKE);
        assertEq(staking.appliedBoostBps(alice), 5_000, "boost did not come back");
        assertEq(staking.effectiveBalanceOf(alice), (STAKE * 15_000) / 10_000);
    }

    function test_EmergencyWithdrawWorksWhileDepositsArePaused() public {
        _stake(alice, STAKE);
        _fund(REWARD);
        skip(5 days);

        vm.prank(owner);
        staking.setDepositsPaused(true);

        vm.prank(alice);
        staking.emergencyWithdraw();
        assertEq(staking.balanceOf(alice), 0);
    }

    function test_ForfeitedRewardsGoBackIntoThePot() public {
        _stake(alice, STAKE);
        _stake(bob, STAKE);
        _fund(REWARD);
        skip(15 days);

        uint256 forfeited = staking.earned(alice);
        uint256 committedBefore = staking.rewardsCommitted();

        vm.prank(alice);
        staking.emergencyWithdraw();

        assertEq(staking.rewardsCommitted(), committedBefore - forfeited, "released");
        assertGe(staking.freeRewardBalance(), forfeited, "and now spendable again");
    }

    /// @dev Emergency withdraw deliberately leaves NFTs alone so that a broken
    ///      ERC-721 can never stand between a holder and their $KEVIN.
    function test_EmergencyWithdrawLeavesNftsForWithdrawNfts() public {
        _mintCrew(alice, 1);
        _setTierBoost(1, 5_000);
        _setTier(1, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        _fund(REWARD);
        skip(5 days);

        vm.prank(alice);
        staking.emergencyWithdraw();

        assertEq(crew.ownerOf(1), address(staking), "NFT still held");
        assertEq(staking.effectiveBalanceOf(alice), 0, "but weightless");

        vm.prank(alice);
        staking.withdrawNfts(_ids(1));
        assertEq(crew.ownerOf(1), alice);
    }

    /// @dev One account bailing must not distort what everyone else is owed.
    function test_EmergencyWithdrawDoesNotCorruptOtherStakers() public {
        _stake(alice, STAKE);
        _stake(bob, STAKE);
        _fund(REWARD);
        uint256 rate = staking.rewardRate();

        skip(DURATION / 2);
        uint256 bobAtMidpoint = staking.earned(bob);

        vm.prank(alice);
        staking.emergencyWithdraw();

        skip(DURATION / 2);
        assertApproxEqAbs(
            staking.earned(bob),
            bobAtMidpoint + rate * (DURATION / 2),
            1e12,
            "bob gets the whole second half"
        );
    }

    // ==================================================================
    // 10. pause only stops deposits
    // ==================================================================

    function test_PauseStopsDepositsOnly() public {
        _mintCrew(alice, 1);
        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));
        _fund(REWARD);
        skip(5 days);

        vm.prank(owner);
        staking.setDepositsPaused(true);

        vm.prank(alice);
        vm.expectRevert(KevinStaking.DepositsArePaused.selector);
        staking.stake(1);

        vm.prank(alice);
        vm.expectRevert(KevinStaking.DepositsArePaused.selector);
        staking.stakeNfts(_ids(1));

        // Everything on the way out still works.
        vm.startPrank(alice);
        staking.getReward();
        staking.withdrawNfts(_ids(1));
        staking.withdraw(STAKE / 2);
        staking.exit();
        vm.stopPrank();

        assertEq(staking.balanceOf(alice), 0);
        assertEq(crew.ownerOf(1), alice);
    }

    // ==================================================================
    // 11. reentrancy
    // ==================================================================

    function _deployHookRig() internal returns (HookERC20 hookToken, Reenterer bad) {
        hookToken = new HookERC20();
        KevinStaking s = new KevinStaking(
            IERC20(address(hookToken)),
            IERC20(address(hookToken)),
            IERC721(address(crew)),
            DURATION,
            owner
        );
        staking = s;
        bad = new Reenterer(s, hookToken);

        hookToken.mint(address(bad), 10_000e18);
        bad.approveAll();
        hookToken.setHook(address(bad), true);
    }

    function test_ReentrancyOnGetRewardIsBlocked() public {
        (HookERC20 hookToken, Reenterer bad) = _deployHookRig();

        bad.setMode(Reenterer.Mode.None);
        bad.stake(STAKE);

        hookToken.setHook(address(0), false);
        hookToken.mint(address(staking), REWARD);
        vm.prank(owner);
        staking.notifyRewardAmount(REWARD);
        hookToken.setHook(address(bad), true);

        skip(10 days);
        uint256 owed = staking.earned(address(bad));
        assertGt(owed, 0);

        bad.setMode(Reenterer.Mode.GetReward);
        bad.claim();

        assertTrue(bad.didAttempt(), "the attack never fired - test is not proving anything");
        assertFalse(bad.reentrySucceeded(), "re-entered getReward");
        assertEq(hookToken.balanceOf(address(bad)), 10_000e18 - STAKE + owed, "paid exactly once");
    }

    function test_ReentrancyOnWithdrawIsBlocked() public {
        (HookERC20 hookToken, Reenterer bad) = _deployHookRig();

        bad.setMode(Reenterer.Mode.None);
        bad.stake(STAKE);

        bad.setMode(Reenterer.Mode.Withdraw);
        bad.withdraw(STAKE);

        assertTrue(bad.didAttempt(), "the attack never fired");
        assertFalse(bad.reentrySucceeded(), "re-entered withdraw");
        assertEq(staking.balanceOf(address(bad)), 0);
        assertEq(hookToken.balanceOf(address(staking)), 0, "drained nothing extra");
    }

    function test_ReentrancyOnEmergencyWithdrawIsBlocked() public {
        (HookERC20 hookToken, Reenterer bad) = _deployHookRig();

        bad.setMode(Reenterer.Mode.None);
        bad.stake(STAKE);

        hookToken.setHook(address(0), false);
        hookToken.mint(address(staking), REWARD);
        vm.prank(owner);
        staking.notifyRewardAmount(REWARD);
        hookToken.setHook(address(bad), true);
        skip(5 days);

        bad.setMode(Reenterer.Mode.EmergencyWithdraw);
        bad.emergency();

        assertTrue(bad.didAttempt(), "the attack never fired");
        assertFalse(bad.reentrySucceeded(), "re-entered emergencyWithdraw");
        assertEq(staking.balanceOf(address(bad)), 0);
        assertEq(hookToken.balanceOf(address(bad)), 10_000e18, "principal back, nothing more");
    }

    function test_ReentrancyIntoStakeIsBlocked() public {
        (, Reenterer bad) = _deployHookRig();

        bad.setMode(Reenterer.Mode.None);
        bad.stake(STAKE);

        bad.setMode(Reenterer.Mode.Stake);
        bad.withdraw(STAKE);

        assertTrue(bad.didAttempt(), "the attack never fired");
        assertFalse(bad.reentrySucceeded(), "re-entered stake");
    }

    // ==================================================================
    // 12. owner powers and their limits
    // ==================================================================

    function test_OnlyOwnerCanTouchTheTables() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        staking.setTierBoost(1, 100, "x");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        staking.setTokenTiers(_ids(1), 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        staking.notifyRewardAmount(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        staking.setDepositsPaused(true);
        vm.stopPrank();
    }

    function test_OwnershipTransferIsTwoStep() public {
        vm.prank(owner);
        staking.transferOwnership(alice);
        assertEq(staking.owner(), owner, "not yet");
        assertEq(staking.pendingOwner(), alice);

        vm.prank(alice);
        staking.acceptOwnership();
        assertEq(staking.owner(), alice);
    }

    function test_OwnerCannotRecoverStakedPrincipal() public {
        _stake(alice, STAKE);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                KevinStaking.AmountExceedsRecoverable.selector, uint256(1), uint256(0)
            )
        );
        staking.recoverERC20(IERC20(address(kevin)), 1);
    }

    function test_OwnerCannotRecoverCommittedRewards() public {
        _stake(alice, STAKE);
        _fund(REWARD);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                KevinStaking.AmountExceedsRecoverable.selector, uint256(1), uint256(0)
            )
        );
        staking.recoverERC20(IERC20(address(kevin)), 1);
    }

    function test_OwnerCanRecoverStrayTokens() public {
        MockERC20 stray = new MockERC20("STRAY", "STRAY", 18);
        stray.mint(address(staking), 5e18);

        vm.prank(owner);
        staking.recoverERC20(IERC20(address(stray)), 5e18);
        assertEq(stray.balanceOf(owner), 5e18);
    }

    function test_OwnerCanReturnAnNftSentInByMistakeButNotAStakedOne() public {
        _mintCrew(alice, 1);
        _mintCrew(bob, 2);

        _stake(alice, STAKE);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));

        // Bob fumbles one straight in.
        vm.prank(bob);
        crew.safeTransferFrom(bob, address(staking), 2);
        assertEq(crew.ownerOf(2), address(staking));

        vm.prank(owner);
        staking.rescueERC721(IERC721(address(crew)), 2, bob);
        assertEq(crew.ownerOf(2), bob, "returned");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KevinStaking.NotDepositor.selector, uint256(1)));
        staking.rescueERC721(IERC721(address(crew)), 1, owner);
    }

    function test_ConstructorRejectsZeroAddressesAndBadDurations() public {
        vm.expectRevert(KevinStaking.ZeroAddress.selector);
        new KevinStaking(
            IERC20(address(0)), IERC20(address(kevin)), IERC721(address(crew)), DURATION, owner
        );

        vm.expectRevert(KevinStaking.BadDuration.selector);
        new KevinStaking(
            IERC20(address(kevin)), IERC20(address(kevin)), IERC721(address(crew)), 1, owner
        );
    }

    // ==================================================================
    // 13. fuzz
    // ==================================================================

    function testFuzz_SplitIsProportionalToEffectiveBalance(
        uint96 aliceStake,
        uint96 bobStake,
        uint16 aliceBoost
    ) public {
        aliceStake = uint96(bound(aliceStake, 1e12, 100_000e18));
        bobStake = uint96(bound(bobStake, 1e12, 100_000e18));
        aliceBoost = uint16(bound(aliceBoost, 0, staking.MAX_BOOST_BPS()));

        _mintCrew(alice, 1);
        if (aliceBoost > 0) _setTierBoost(1, aliceBoost);
        _setTier(1, 1);

        _stake(alice, aliceStake);
        _stake(bob, bobStake);
        vm.prank(alice);
        staking.stakeNfts(_ids(1));

        _fund(REWARD);
        skip(DURATION);

        uint256 aliceEff = staking.effectiveBalanceOf(alice);
        uint256 bobEff = staking.effectiveBalanceOf(bob);
        uint256 pot = staking.rewardRate() * DURATION;

        assertApproxEqRel(
            staking.earned(alice), (pot * aliceEff) / (aliceEff + bobEff), 1e12, "alice share"
        );
        assertApproxEqRel(
            staking.earned(bob), (pot * bobEff) / (aliceEff + bobEff), 1e12, "bob share"
        );
        assertLe(staking.earned(alice) + staking.earned(bob), REWARD, "over-distributed");
    }

    function testFuzz_PrincipalIsAlwaysFullyRecoverable(uint96 amount, bool pause, bool emergency)
        public
    {
        amount = uint96(bound(amount, 1, 1_000_000e18));

        _stake(alice, amount);
        _fund(REWARD);
        skip(7 days);

        if (pause) {
            vm.prank(owner);
            staking.setDepositsPaused(true);
        }

        uint256 before = kevin.balanceOf(alice);
        vm.prank(alice);
        if (emergency) {
            staking.emergencyWithdraw();
        } else {
            staking.withdraw(amount);
        }

        assertGe(kevin.balanceOf(alice) - before, amount, "did not get the principal back");
        assertEq(staking.balanceOf(alice), 0);
    }
}
