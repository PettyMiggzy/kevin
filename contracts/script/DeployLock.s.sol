// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KevinLock} from "../src/KevinLock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Puts the lockbox on chain. It does NOT fund it — that is your
 *         decision to make once, deliberately, after reading the addresses
 *         back and sending a test amount first.
 *
 *  forge script script/DeployLock.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY     deployer key
 *   KEVIN_TOKEN     $KEVIN ERC-20
 *   FLOOR_ADDRESS   the deployed KevinFloorV4. THE ONLY PLACE THE FAST PATH
 *                   CAN EVER SEND, and it is immutable, so check it twice.
 *   BENEFICIARY     the treasury. The only address a slow exit can send to,
 *                   also immutable. Defaults to the owner's wallet:
 *                   0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf
 *   RATE_PER_DAY    tokens released to the floor keeper per day, 18 decimals.
 *                   Can be lowered later, never raised. Set it at or below the
 *                   floor keeper's own dailyTokenCap or the difference just
 *                   piles up in the floor unsold.
 *   EXIT_DELAY      seconds of public notice a withdrawal gives. Immutable.
 *                   Default 14 days. Longer is more credible and less
 *                   recoverable; that is the entire trade and it is yours.
 *
 * NOTHING ABOUT THIS CONTRACT CAN BE CHANGED AFTER DEPLOY except lowering the
 * rate. There is no owner, no sweep and no upgrade. Read the addresses it
 * prints before you send it anything, and send it a thousand tokens and drive
 * one release before you send it the bag.
 */
contract DeployLock is Script {
    function run() external returns (KevinLock lock) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("KEVIN_TOKEN");
        address floor = vm.envAddress("FLOOR_ADDRESS");
        address beneficiary = vm.envOr("BENEFICIARY", address(0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf));
        uint256 rate = vm.envUint("RATE_PER_DAY");
        uint256 delay = vm.envOr("EXIT_DELAY", uint256(14 days));

        vm.startBroadcast(pk);
        lock = new KevinLock(IERC20(token), floor, beneficiary, rate, delay);
        vm.stopBroadcast();

        console2.log("KevinLock    ", address(lock));
        console2.log("token        ", token);
        console2.log("floor        ", floor, "  <- the ONLY fast way out, immutable");
        console2.log("beneficiary  ", beneficiary, "  <- the ONLY slow way out, immutable");
        console2.log("rate/day     ", rate / 1e18);
        console2.log("exit notice  ", delay / 1 days, "days, immutable");
        console2.log("");
        console2.log("Check both addresses above against what you deployed.");
        console2.log("Neither can be changed and there is no rescue function.");
        console2.log("");
        console2.log("Then: send it 1000 tokens, wait, call release(), and watch");
        console2.log("them land in the floor keeper. Only then send the bag.");
        console2.log("");
        console2.log("Then PUBLISH THIS ADDRESS. A lock nobody knows about is");
        console2.log("worth nothing at all -- the point is that people can check.");
    }
}
