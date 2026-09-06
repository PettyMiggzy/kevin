// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KevinFloor} from "../src/KevinFloor.sol";

interface IUniswapV2Factory {
    function getPair(address a, address b) external view returns (address);
}

/**
 * @notice Puts KevinFloor on chain, points it at the WETH pair, and sets the
 *         rails. It does NOT fund it — funding is a separate transaction you
 *         make deliberately, after you have read the deployed parameters back.
 *
 *  forge script script/DeployFloor.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY       deployer key
 *   KEVIN_TOKEN       $KEVIN ERC-20
 *   WETH              wrapped ether on Robinhood Chain
 *   V2_FACTORY        Uniswap V2 factory (0x8bce...937f per Uniswap's docs —
 *                     CHECK IT on the explorer before you send anything)
 *   V2_ROUTER         Uniswap V2 Router02 (0x89e5...9eba, same warning)
 *   FLOOR_OWNER       who can sweep and re-tune. A multisig, ideally.
 *   FLOOR_OPERATOR    the hot key that pokes it. Assume this one leaks.
 *
 *   Rails, all optional, with defaults sized for a 0.35 ETH treasury:
 *   MAX_WETH_PER_TRADE   default 0.02 ether
 *   MAX_TOKENS_PER_TRADE default 0            (selling off until you set it)
 *   DAILY_WETH_CAP       default 0.08 ether
 *   DAILY_TOKEN_CAP      default 0
 *   COOLDOWN             default 600 seconds
 *   MAX_SLIPPAGE_BPS     default 300
 *
 * The token caps default to ZERO on purpose. Buying is the half that supports
 * the price; selling is the half that needs a decision from you about what you
 * are telling holders. It stays switched off until you switch it on.
 */
contract DeployFloor is Script {
    /// @dev Grouped because six separate locals plus the addresses is stack-too-deep.
    struct Rails {
        uint256 maxWeth;
        uint256 maxTokens;
        uint256 dayWeth;
        uint256 dayTokens;
        uint256 cooldown;
        uint256 slippage;
    }

    function _rails() internal view returns (Rails memory r) {
        r.maxWeth = vm.envOr("MAX_WETH_PER_TRADE", uint256(0.02 ether));
        r.maxTokens = vm.envOr("MAX_TOKENS_PER_TRADE", uint256(0));
        r.dayWeth = vm.envOr("DAILY_WETH_CAP", uint256(0.08 ether));
        r.dayTokens = vm.envOr("DAILY_TOKEN_CAP", uint256(0));
        r.cooldown = vm.envOr("COOLDOWN", uint256(600));
        r.slippage = vm.envOr("MAX_SLIPPAGE_BPS", uint256(300));
    }

    function run() external returns (KevinFloor floor) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("KEVIN_TOKEN");
        address weth = vm.envAddress("WETH");
        address owner = vm.envAddress("FLOOR_OWNER");

        address pair = IUniswapV2Factory(vm.envAddress("V2_FACTORY")).getPair(token, weth);
        require(pair != address(0), "no KEVIN/WETH pair yet - has it graduated?");

        Rails memory r = _rails();

        vm.startBroadcast(pk);
        floor = new KevinFloor(owner, token, weth, pair, vm.envAddress("V2_ROUTER"));
        // Unless the deployer IS the owner these have to be sent afterwards by
        // the owner. Both paths are printed below.
        if (owner == vm.addr(pk)) {
            floor.setOperator(vm.envAddress("FLOOR_OPERATOR"));
            floor.setRails(r.maxWeth, r.maxTokens, r.dayWeth, r.dayTokens, r.cooldown, r.slippage);
        }
        vm.stopBroadcast();

        console2.log("KevinFloor   ", address(floor));
        console2.log("token        ", token);
        console2.log("weth         ", weth);
        console2.log("pair         ", pair);
        console2.log("owner        ", owner);
        console2.log("operator     ", vm.envAddress("FLOOR_OPERATOR"));
        console2.log("");
        if (owner != vm.addr(pk)) {
            console2.log("Owner is not the deployer, so from the owner, send:");
            console2.log("  setOperator(operator)");
            console2.log(
                "  setRails(maxWeth, maxTokens, dailyWeth, dailyTokens, cooldown, slippage)"
            );
        }
        console2.log("Then, from the owner, and only when the pair is live:");
        console2.log("  setReference(spotPrice())   arms it. It does nothing until you do.");
        console2.log("Then fund it. Send ETH to the contract; it wraps on arrival.");
        console2.log("");
        console2.log("Fund it with a slice first and watch one buy land before you send the rest.");
    }
}
