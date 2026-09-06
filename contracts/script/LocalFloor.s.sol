// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KevinFloorV4} from "../src/KevinFloorV4.sol";
import {KevinLock} from "../src/KevinLock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {MockERC20} from "../test/mocks/Mocks.sol";

/**
 * @notice A whole world on a local anvil, so the keeper can be driven against a
 *         real pool before it is ever pointed at a real one.
 *
 *   anvil &
 *   forge script script/LocalFloor.s.sol --rpc-url http://127.0.0.1:8545 \
 *     --broadcast --private-key <anvil key 0>
 *
 * Prints the addresses the keeper needs. The deployer is the owner AND the
 * operator here, which is wrong for production and exactly right for a rehearsal.
 */
contract LocalFloor is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);
        PoolManager manager = new PoolManager(me);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(manager);
        PoolSwapTest swapper = new PoolSwapTest(manager);
        MockERC20 kevin = new MockERC20("Kevin", "KEVIN", 18);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(kevin)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        kevin.mint(me, 50_000_000 ether);
        kevin.approve(address(lp), type(uint256).max);
        kevin.approve(address(swapper), type(uint256).max);
        lp.modifyLiquidity{value: 400 ether}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -6000, tickUpper: 6000, liquidityDelta: 80 ether, salt: 0
            }),
            ""
        );

        KevinFloorV4 floor = new KevinFloorV4(me, manager, key, address(kevin));
        floor.setOperator(me);
        floor.setRails(200_000 ether, 0.05 ether, 2_000_000 ether, 0.5 ether, 60);
        // A rehearsal wants the yielding visible in minutes, not days. In
        // production this is 3 days / 1.5% a day / 30% and you leave it alone.
        floor.setPatience(vm.envOr("PATIENCE", uint256(120)), 150, 3_000);
        floor.setFloorFromSpot(1500);
        kevin.mint(address(floor), 3_000_000 ether);

        // The lockbox, holding the bag, dripping into the floor keeper.
        KevinLock lock = new KevinLock(
            IERC20(address(kevin)), address(floor), me, 2_000_000 ether,
            vm.envOr("EXIT_DELAY", uint256(1 days)), vm.envOr("EXIT_WINDOW", uint256(1 hours))
        );
        kevin.mint(address(lock), 40_000_000 ether);
        floor.setLockbox(address(lock));
        vm.stopBroadcast();

        console2.log("");
        console2.log("FLOOR_ADDRESS=%s", address(floor));
        console2.log("KEVIN=%s", address(kevin));
        console2.log("POOL_MANAGER=%s", address(manager));
        console2.log("SWAPPER=%s", address(swapper));
        console2.log("LOCK_ADDRESS=%s", address(lock));
        console2.log("upIsUp=%s (false is correct for an ETH pool)", floor.upIsUp());
        console2.log("patience=%ss decay=%s bps/day cap=%s bps",
            floor.patience(), floor.decayBpsPerDay(), floor.maxDecayBps());
    }
}
