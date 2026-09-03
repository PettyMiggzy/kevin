// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {KevinStaking} from "../src/KevinStaking.sol";
import {Configure} from "../script/Configure.s.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

/**
 * @dev Runs the real deploy-step-2 script against the real plan generated from
 *      the real manifest, so the configure path is not the one thing in here
 *      that has never been executed.
 *
 *      test/fixtures/tiers.json is the output of
 *      `node script/derive-tiers.mjs --out test/fixtures/tiers.json`.
 *      Regenerate it whenever the crew grows and this test will tell you if
 *      the plan stopped applying cleanly.
 */
contract ConfigureTest is Test {
    MockERC20 internal kevin;
    MockERC721 internal crew;
    KevinStaking internal staking;
    Configure internal configure;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("KEVIN", "KEVIN", 18);
        crew = new MockERC721();
        staking = new KevinStaking(
            IERC20(address(kevin)), IERC20(address(kevin)), IERC721(address(crew)), 30 days, owner
        );
        configure = new Configure();
    }

    function _plan() internal view returns (Configure.Plan memory) {
        return configure.readPlan(vm.readFile("test/fixtures/tiers.json"));
    }

    /// @dev Under `forge script --broadcast` the script's calls go out from the
    ///      owner's own key. A plain `vm.prank` cannot reproduce that, because
    ///      the inner calls would still come from the script contract. Handing
    ///      the script contract the ownership produces the identical call
    ///      sequence, and exercises the two-step handover on the way.
    function _handOwnershipToTheScript() internal {
        vm.prank(owner);
        staking.transferOwnership(address(configure));
        vm.prank(address(configure));
        staking.acceptOwnership();
        assertEq(staking.owner(), address(configure));
    }

    function test_PlanParsesAndCoversEveryMintedCrewMember() public view {
        Configure.Plan memory plan = _plan();

        assertGt(plan.tierIds.length, 0, "no tiers in the plan");
        assertEq(plan.tierBps.length, plan.tierIds.length);
        assertEq(plan.tierLabels.length, plan.tierIds.length);

        uint256 tokens;
        for (uint256 i; i < plan.tierIds.length; ++i) {
            assertGt(plan.tierIds[i], 0, "tier 0 is reserved and must never appear in a plan");
            assertLe(plan.tierBps[i], staking.MAX_BOOST_BPS(), "plan exceeds the on-chain cap");
            tokens += plan.tokenIdsByTier[i].length;
        }
        // The manifest has 20 minted. Every one of them must be in exactly one
        // tier, or somebody staked an NFT that silently earns nothing.
        assertEq(tokens, 20, "plan does not cover all 20 minted crew members");
    }

    function test_ApplyingThePlanPublishesTheWholeTable() public {
        Configure.Plan memory plan = _plan();
        _handOwnershipToTheScript();
        configure.apply_(staking, plan);

        for (uint256 i; i < plan.tierIds.length; ++i) {
            uint16 tier = uint16(plan.tierIds[i]);
            assertEq(staking.tierBoostBps(tier), uint16(plan.tierBps[i]), "bps not published");
            assertEq(staking.tierLabel(tier), plan.tierLabels[i], "label not published");
            for (uint256 j; j < plan.tokenIdsByTier[i].length; ++j) {
                assertEq(staking.tokenTier(plan.tokenIdsByTier[i][j]), tier, "token not tiered");
            }
        }
    }

    /// @dev End to end: apply the plan, stake the rarest crew member the
    ///      manifest currently contains, and check the boost that lands is the
    ///      one the plan promised.
    function test_TheBoostAStakerGetsIsTheOneThePlanPromised() public {
        Configure.Plan memory plan = _plan();
        _handOwnershipToTheScript();
        configure.apply_(staking, plan);

        // Highest tier in the plan, and its first token.
        uint256 best;
        for (uint256 i; i < plan.tierIds.length; ++i) {
            if (plan.tierIds[i] > plan.tierIds[best] && plan.tokenIdsByTier[i].length > 0) {
                best = i;
            }
        }
        uint256 tokenId = plan.tokenIdsByTier[best][0];
        uint256 expectedBps = plan.tierBps[best];

        crew.mint(alice, tokenId);
        kevin.mint(alice, 1_000e18);
        vm.startPrank(alice);
        kevin.approve(address(staking), type(uint256).max);
        crew.setApprovalForAll(address(staking), true);
        staking.stake(1_000e18);

        uint256[] memory ids = new uint256[](1);
        ids[0] = tokenId;
        staking.stakeNfts(ids);
        vm.stopPrank();

        assertEq(staking.appliedBoostBps(alice), expectedBps, "boost does not match the plan");
        assertEq(
            staking.effectiveBalanceOf(alice),
            (1_000e18 * (10_000 + expectedBps)) / 10_000,
            "effective balance does not match the plan"
        );
    }
}
