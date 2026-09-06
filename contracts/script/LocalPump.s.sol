// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

/// @notice Somebody else buys, so the keeper has a rising chart to ratchet under.
contract LocalPump is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        PoolSwapTest swapper = PoolSwapTest(payable(vm.envAddress("SWAPPER")));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(vm.envAddress("KEVIN")),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 ethIn = vm.envOr("ETH_IN", uint256(30 ether));
        vm.startBroadcast(pk);
        swapper.swap{value: ethIn}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopBroadcast();
        console2.log("bought with %s wei of ETH", ethIn);
    }
}
