// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {KevinStaking} from "../src/KevinStaking.sol";

/**
 * @notice Step 2 of the deploy. Publishes the tier table produced by
 *         `script/derive-tiers.mjs`.
 *
 *  node script/derive-tiers.mjs --out tiers.json
 *  STAKING=0x... forge script script/Configure.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY  key of the pool OWNER (not necessarily the deployer)
 *   STAKING      deployed KevinStaking address
 *   TIERS_JSON   path to the plan, optional, default ./tiers.json
 *
 * Until this has run, every NFT is tier 0 and every boost is zero. Staking
 * still works — it just pays everyone the flat rate. That is the intended
 * failure mode: the pool is never wrong before it is configured, only plain.
 */
contract Configure is Script {
    struct Plan {
        uint256[] tierIds;
        uint256[] tierBps;
        string[] tierLabels;
        uint256[][] tokenIdsByTier;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        KevinStaking staking = KevinStaking(vm.envAddress("STAKING"));
        string memory path = vm.envOr("TIERS_JSON", string("tiers.json"));

        Plan memory plan = readPlan(vm.readFile(path));

        vm.startBroadcast(pk);
        apply_(staking, plan);
        vm.stopBroadcast();
    }

    /// @dev Split out from `run` so a test can parse a real fixture and a test
    ///      can apply it to a real pool, rather than the deploy path being the
    ///      one piece of this repo nobody ever executes.
    function readPlan(string memory json) public pure returns (Plan memory plan) {
        plan.tierIds = vm.parseJsonUintArray(json, ".tierIds");
        plan.tierBps = vm.parseJsonUintArray(json, ".tierBps");
        plan.tierLabels = vm.parseJsonStringArray(json, ".tierLabels");

        uint256 n = plan.tierIds.length;
        require(plan.tierBps.length == n, "tierBps length");
        require(plan.tierLabels.length == n, "tierLabels length");

        plan.tokenIdsByTier = new uint256[][](n);
        for (uint256 i; i < n; ++i) {
            plan.tokenIdsByTier[i] =
                vm.parseJsonUintArray(json, string.concat(".tokenIdsByTier[", vm.toString(i), "]"));
        }
    }

    function apply_(KevinStaking staking, Plan memory plan) public {
        for (uint256 i; i < plan.tierIds.length; ++i) {
            uint16 tier = uint16(plan.tierIds[i]);
            uint16 bps = uint16(plan.tierBps[i]);

            staking.setTierBoost(tier, bps, plan.tierLabels[i]);
            if (plan.tokenIdsByTier[i].length != 0) {
                staking.setTokenTiers(plan.tokenIdsByTier[i], tier);
            }

            console2.log("tier", tier);
            console2.log("  bps    ", bps);
            console2.log("  label  ", plan.tierLabels[i]);
            console2.log("  tokens ", plan.tokenIdsByTier[i].length);
        }
    }
}
