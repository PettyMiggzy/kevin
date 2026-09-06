// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @notice PROVE THE POOL EXISTS BEFORE YOU DEPLOY ANYTHING AT IT.
 *
 *  forge script script/Preflight.s.sol --rpc-url robinhood
 *
 * A v4 pool is the hash of all five PoolKey fields, so one wrong number is not
 * an error you will see — it is a different, uninitialised pool, and a floor
 * keeper pointed at one looks completely healthy while doing nothing at all.
 * This reads the pool back off the chain and refuses if it is not there.
 *
 * Same env vars as DeployFloorV4, so if this passes, that will point at the
 * pool this printed. Read the output rather than just the exit code: `upIsUp`
 * and the two currency slots are the things worth checking with your own eyes.
 */
contract Preflight is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function run() external view {
        address token = vm.envAddress("KEVIN_TOKEN");
        address quote = vm.envAddress("QUOTE");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));

        (address c0, address c1) = quote < token ? (quote, token) : (token, quote);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: uint24(vm.envUint("POOL_FEE")),
            tickSpacing: int24(vm.envInt("TICK_SPACING")),
            hooks: IHooks(vm.envAddress("POOL_HOOKS"))
        });
        PoolId id = key.toId();

        console2.log("poolId       %s", vm.toString(PoolId.unwrap(id)));
        console2.log("currency0    %s  %s", c0, _sym(c0));
        console2.log("currency1    %s  %s", c1, _sym(c1));
        console2.log("fee          %s", key.fee);
        console2.log("tickSpacing  %s", vm.toString(int256(key.tickSpacing)));
        console2.log("hooks        %s", address(key.hooks));
        console2.log("");

        (uint160 sqrtPriceX96, int24 tick,, uint24 lpFee) = manager.getSlot0(id);
        require(sqrtPriceX96 != 0, "POOL IS NOT INITIALISED. One of the five fields is wrong.");
        uint128 liquidity = manager.getLiquidity(id);

        bool tokenIsZero = c0 == token;
        console2.log("sqrtPriceX96 %s", sqrtPriceX96);
        console2.log("tick         %s", vm.toString(int256(tick)));
        console2.log("lpFee        %s", lpFee);
        console2.log("liquidity    %s", liquidity);
        console2.log("");
        console2.log("tokenIsZero  %s", tokenIsZero);
        console2.log("upIsUp       %s", tokenIsZero);
        console2.log("");
        if (tokenIsZero) {
            console2.log("$KEVIN is currency0, so a rising $KEVIN is a RISING sqrtPrice.");
        } else {
            console2.log("$KEVIN is currency1, so a rising $KEVIN is a FALLING sqrtPrice.");
        }
        if (quote == address(0)) {
            console2.log("Quote is NATIVE ETH: fund the bid with fundWarChest().");
        } else {
            console2.log("Quote is an ERC20: fund the bid with fundWarChestToken(),");
            console2.log("NOT the payable fundWarChest(), which reverts on this pool.");
        }
        require(liquidity > 0, "POOL HAS NO LIQUIDITY AT SPOT. Nothing to trade against yet.");
        console2.log("");
        console2.log("OK. This is a real, initialised, liquid pool.");
    }

    function _sym(address a) internal view returns (string memory) {
        if (a == address(0)) return "(native ETH)";
        try IERC20Metadata(a).symbol() returns (string memory s) {
            return s;
        } catch {
            return "(no symbol)";
        }
    }
}
