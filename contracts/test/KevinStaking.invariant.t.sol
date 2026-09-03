// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

/**
 * @dev Drives the contract through random sequences of everything an account
 *      or the owner can do, so the invariants below are checked against states
 *      no hand-written test would think to build.
 */
contract Handler is Test {
    KevinStaking public immutable staking;
    MockERC20 public immutable kevin;
    MockERC721 public immutable crew;
    address public immutable owner;

    address[4] public actors;
    uint256 public totalFunded;
    uint256 public totalClaimed;

    constructor(KevinStaking s, MockERC20 k, MockERC721 c, address o) {
        staking = s;
        kevin = k;
        crew = c;
        owner = o;

        actors = [
            makeAddr("inv_alice"),
            makeAddr("inv_bob"),
            makeAddr("inv_carol"),
            makeAddr("inv_dave")
        ];

        for (uint256 i; i < actors.length; ++i) {
            kevin.mint(actors[i], 1_000_000e18);
            vm.startPrank(actors[i]);
            kevin.approve(address(staking), type(uint256).max);
            crew.setApprovalForAll(address(staking), true);
            vm.stopPrank();
            // Four crew members each, ids 10*i .. 10*i+3.
            for (uint256 j; j < 4; ++j) {
                crew.mint(actors[i], 10 * i + j);
            }
        }

        // Two tiers exist from the start; the handler retunes them freely.
        vm.startPrank(owner);
        staking.setTierBoost(1, 2_500, "bronze");
        staking.setTierBoost(2, 10_000, "gold");
        vm.stopPrank();
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // --------------------------------------------------------------

    function stake(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1, kevin.balanceOf(a) == 0 ? 1 : kevin.balanceOf(a));
        if (kevin.balanceOf(a) < amount) return;
        vm.prank(a);
        staking.stake(amount);
    }

    function withdraw(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        uint256 bal = staking.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(a);
        staking.withdraw(amount);
    }

    function getReward(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        uint256 owed = staking.earned(a);
        vm.prank(a);
        staking.getReward();
        totalClaimed += owed;
    }

    function emergencyWithdraw(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        if (staking.balanceOf(a) == 0) return;
        vm.prank(a);
        staking.emergencyWithdraw();
    }

    function stakeNft(uint256 actorSeed, uint256 which) external {
        address a = _actor(actorSeed);
        uint256 idx = actorSeed % actors.length;
        uint256 id = 10 * idx + (which % 4);
        if (crew.ownerOf(id) != a) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(a);
        staking.stakeNfts(ids);
    }

    function withdrawNft(uint256 actorSeed, uint256 which) external {
        address a = _actor(actorSeed);
        uint256 idx = actorSeed % actors.length;
        uint256 id = 10 * idx + (which % 4);
        if (staking.nftDepositor(id) != a) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(a);
        staking.withdrawNfts(ids);
    }

    function retuneTier(uint256 tierSeed, uint256 bps) external {
        uint16 tier = uint16(1 + (tierSeed % 2));
        uint16 value = uint16(bound(bps, 0, staking.MAX_BOOST_BPS()));
        vm.prank(owner);
        staking.setTierBoost(tier, value, "retuned");
    }

    function retierToken(uint256 actorSeed, uint256 which, uint256 tierSeed) external {
        uint256 idx = actorSeed % actors.length;
        uint256[] memory ids = new uint256[](1);
        ids[0] = 10 * idx + (which % 4);
        vm.prank(owner);
        staking.setTokenTiers(ids, uint16(tierSeed % 3));
    }

    function syncBoost(uint256 actorSeed) external {
        staking.syncBoost(_actor(actorSeed));
    }

    function fund(uint256 amount) external {
        if (block.timestamp < staking.periodFinish()) return;
        amount = bound(amount, 1e18, 100_000e18);
        kevin.mint(address(staking), amount);
        totalFunded += amount;
        vm.prank(owner);
        staking.notifyRewardAmount(amount);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 10 days));
    }
}

contract KevinStakingInvariantTest is StdInvariant, Test {
    MockERC20 internal kevin;
    MockERC721 internal crew;
    KevinStaking internal staking;
    Handler internal handler;

    address internal owner = makeAddr("inv_owner");

    function setUp() public {
        vm.warp(1_700_000_000);

        kevin = new MockERC20("KEVIN", "KEVIN", 18);
        crew = new MockERC721();
        staking = new KevinStaking(
            IERC20(address(kevin)), IERC20(address(kevin)), IERC721(address(crew)), 30 days, owner
        );

        handler = new Handler(staking, kevin, crew, owner);
        targetContract(address(handler));
    }

    /// @dev The one that makes the whole accumulator sound. If this ever drifts,
    ///      rewards are being minted or destroyed out of thin air.
    function invariant_EffectiveSupplyEqualsSumOfEffectiveBalances() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += staking.effectiveBalanceOf(handler.actors(i));
        }
        assertEq(staking.totalEffectiveSupply(), sum, "effective supply drifted");
    }

    function invariant_TotalStakedEqualsSumOfBalances() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += staking.balanceOf(handler.actors(i));
        }
        assertEq(staking.totalStaked(), sum, "totalStaked drifted");
    }

    /// @dev Solvency. Every staker's principal AND every reward still owed must
    ///      be sitting in this contract at all times.
    function invariant_ContractCoversPrincipalAndCommittedRewards() public view {
        assertGe(
            kevin.balanceOf(address(staking)),
            staking.totalStaked() + staking.rewardsCommitted(),
            "under-collateralised"
        );
    }

    function invariant_BoostNeverExceedsTheCap() public view {
        uint256 cap = staking.MAX_BOOST_BPS();
        for (uint256 i; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            assertLe(staking.appliedBoostBps(a), cap, "applied boost above cap");
            assertLe(staking.pendingBoostBps(a), cap, "pending boost above cap");
        }
    }

    function invariant_EffectiveBalanceIsExactlyBalanceTimesAppliedBoost() public view {
        for (uint256 i; i < handler.actorCount(); ++i) {
            address a = handler.actors(i);
            uint256 expected =
                (staking.balanceOf(a) * (staking.BPS() + staking.appliedBoostBps(a)))
                    / staking.BPS();
            assertEq(staking.effectiveBalanceOf(a), expected, "effective balance is not derived");
        }
    }

    function invariant_NoMoreIsPaidOutThanWasFundedIn() public view {
        assertLe(handler.totalClaimed(), handler.totalFunded(), "paid out more than funded");
    }

    function invariant_StakedNftsAreHeldByThePool() public view {
        for (uint256 i; i < handler.actorCount(); ++i) {
            for (uint256 j; j < 4; ++j) {
                uint256 id = 10 * i + j;
                if (staking.nftDepositor(id) != address(0)) {
                    assertEq(crew.ownerOf(id), address(staking), "recorded but not held");
                }
            }
        }
    }
}
