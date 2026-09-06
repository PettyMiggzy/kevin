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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Somebody else trades, so the keeper has a chart to react to.
///         ETH_IN buys (the price rises); KEVIN_IN sells (it falls), which is
///         how you set up the case the yielding exists for: a price that goes
///         under the floor and stays there.
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
        uint256 kevinIn = vm.envOr("KEVIN_IN", uint256(0));
        vm.startBroadcast(pk);
        if (kevinIn > 0) {
            IERC20(vm.envAddress("KEVIN")).approve(address(swapper), type(uint256).max);
            swapper.swap(
                key,
                IPoolManager.SwapParams({
                    zeroForOne: false,
                    amountSpecified: -int256(kevinIn),
                    sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
            console2.log("sold %s wei of KEVIN", kevinIn);
        } else {
            uint256 ethIn = vm.envOr("ETH_IN", uint256(30 ether));
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
            console2.log("bought with %s wei of ETH", ethIn);
        }
        vm.stopBroadcast();
    }
}
