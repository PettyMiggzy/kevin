// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {KevinStaking} from "../src/KevinStaking.sol";

/**
 * @notice Step 1 of the deploy. Puts the pool on chain and nothing else.
 *
 *  forge script script/Deploy.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY        deployer key
 *   KEVIN_TOKEN        $KEVIN ERC-20
 *   CREW_NFT           KEVIN'S CREW ERC-721
 *   STAKING_OWNER      address that will own the pool (a multisig, ideally)
 *   REWARDS_DURATION   seconds, optional, default 30 days
 */
contract Deploy is Script {
    function run() external returns (KevinStaking staking) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("KEVIN_TOKEN");
        address crew = vm.envAddress("CREW_NFT");
        address owner = vm.envAddress("STAKING_OWNER");
        uint256 duration = vm.envOr("REWARDS_DURATION", uint256(30 days));

        vm.startBroadcast(pk);
        staking = new KevinStaking(IERC20(token), IERC20(token), IERC721(crew), duration, owner);
        vm.stopBroadcast();

        console2.log("KevinStaking   ", address(staking));
        console2.log("stakingToken   ", token);
        console2.log("rewardToken    ", token);
        console2.log("crew           ", crew);
        console2.log("owner          ", owner);
        console2.log("rewardsDuration", duration);
        console2.log("");
        console2.log("Next: node script/derive-tiers.mjs --out tiers.json");
        console2.log("Then: forge script script/Configure.s.sol --broadcast");
    }
}
