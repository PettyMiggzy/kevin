// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KevinAirdrop} from "../src/KevinAirdrop.sol";

/**
 * @notice Puts KevinAirdrop on chain. It holds nothing until a round is opened,
 *         and opening a round is a separate, deliberate step.
 *
 *  forge script script/DeployAirdrop.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY  deployer
 *   OWNER        who may open rounds and sweep expired ones. Defaults to the
 *                treasury wallet.
 */
contract DeployAirdrop is Script {
    function run() external returns (KevinAirdrop drop) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envOr("OWNER", address(0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf));

        vm.startBroadcast(pk);
        drop = new KevinAirdrop(owner);
        vm.stopBroadcast();

        console2.log("KevinAirdrop ", address(drop));
        console2.log("owner        ", owner);
        console2.log("MIN_WINDOW   ", drop.MIN_WINDOW() / 1 days, "days");
        console2.log("");
        console2.log("To open a round, in this order and not another:");
        console2.log("  1. node tools/airdrop-snapshot.mjs --total <wei> --days 14");
        console2.log("  2. node tools/airdrop-snapshot.mjs --verify airdrop/round-*.json");
        console2.log("  3. PUBLISH that file where holders can fetch it");
        console2.log("  4. approve() this contract for the payout token");
        console2.log("  5. openRound(token, root, amount, deadline, uri)");
        console2.log("");
        console2.log("Step 3 before step 5. Once the round is open the root is");
        console2.log("fixed forever, so the list has to be the published one.");
    }
}
