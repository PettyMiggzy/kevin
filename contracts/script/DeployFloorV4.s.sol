// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KevinFloorV4} from "../src/KevinFloorV4.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/**
 * @notice Puts KevinFloorV4 on chain and sets the rails. It does NOT fund it and
 *         it does NOT set the floor — both are deliberate separate steps you
 *         take after reading the deployed parameters back.
 *
 *  forge script script/DeployFloorV4.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY     deployer key
 *   KEVIN_TOKEN     $KEVIN ERC-20
 *   POOL_MANAGER    v4 PoolManager. VERIFIED on chain 4663 by reading it off
 *                   the launchpad's own router: 0x8366a39CC670B4001A1121B8F6A443A643e40951
 *   QUOTE           the other side of the pool. Defaults to WETH, because this
 *                   launchpad pairs against WETH and NOT native ETH — a v4 ETH
 *                   pool would use address(0) and this is not one.
 *   POOL_FEE        VERIFIED 3000 on the live pools from this factory.
 *   TICK_SPACING    VERIFIED 60.
 *   POOL_HOOKS      VERIFIED 0xFEf8e78090697C808116c56A9E81fC83d4f76000. NOT
 *                   address(0) — these pools have a hook, and a PoolKey with a
 *                   zero hook hashes to a pool that does not exist.
 *
 * All five were read off the live WETH/CULT pool created by the same factory
 * (0xE4AcdB51b6554246Da8488d1e68E8FAd1b93f383). RUN script/Preflight.s.sol
 * FIRST — it proves the pool is really there before anything is deployed at it.
 *   FLOOR_OWNER     can sweep and re-tune. Defaults to the owner's wallet:
 *                   0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf
 *                   It is one key, deliberately. See LOCK.md for what that
 *                   does and does not put at risk.
 *   FLOOR_OPERATOR  the hot key that pokes it. Assume it leaks.
 *
 *   Rails, optional:
 *   MAX_TOKENS_PER_TRADE  default 250_000e18
 *   MAX_QUOTE_PER_TRADE   default 0.05 ether
 *   DAILY_TOKEN_CAP       default 2_000_000e18
 *   DAILY_QUOTE_CAP       default 0.5 ether
 *   COOLDOWN              default 300
 *
 * THE FEE, SPACING AND HOOKS HAVE TO MATCH THE POOL EXACTLY. A v4 pool is
 * identified by the hash of all five fields, so one wrong number is not an
 * error — it is a different, probably uninitialised, pool.
 */
contract DeployFloorV4 is Script {
    struct Rails {
        uint256 maxTokens;
        uint256 maxQuote;
        uint256 dayTokens;
        uint256 dayQuote;
        uint256 cooldown;
    }

    function _rails() internal view returns (Rails memory r) {
        r.maxTokens = vm.envOr("MAX_TOKENS_PER_TRADE", uint256(250_000 ether));
        r.maxQuote = vm.envOr("MAX_QUOTE_PER_TRADE", uint256(0.05 ether));
        r.dayTokens = vm.envOr("DAILY_TOKEN_CAP", uint256(2_000_000 ether));
        r.dayQuote = vm.envOr("DAILY_QUOTE_CAP", uint256(0.5 ether));
        r.cooldown = vm.envOr("COOLDOWN", uint256(300));
    }

    function run() external returns (KevinFloorV4 floor) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("KEVIN_TOKEN");
        // WETH on Robinhood Chain 4663, read off the launchpad factory's weth().
        address quote = vm.envOr("QUOTE", address(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73));
        address owner = vm.envOr("FLOOR_OWNER", address(0xCDD5ff5d521D3694c2a2F31eDF7cd3C0E9a6fabf));

        // v4 sorts the two currencies by address; native ETH is address(0) and
        // therefore always currency0.
        (address c0, address c1) = quote < token ? (quote, token) : (token, quote);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: uint24(vm.envOr("POOL_FEE", uint256(3000))),
            tickSpacing: int24(vm.envOr("TICK_SPACING", int256(60))),
            hooks: IHooks(vm.envOr("POOL_HOOKS", address(0xFEf8e78090697C808116c56A9E81fC83d4f76000)))
        });

        Rails memory r = _rails();

        vm.startBroadcast(pk);
        floor = new KevinFloorV4(
            owner,
            IPoolManager(vm.envOr("POOL_MANAGER", address(0x8366a39CC670B4001A1121B8F6A443A643e40951))),
            key,
            token
        );
        if (owner == vm.addr(pk)) {
            floor.setOperator(vm.envAddress("FLOOR_OPERATOR"));
            floor.setRails(r.maxTokens, r.maxQuote, r.dayTokens, r.dayQuote, r.cooldown);
        }
        vm.stopBroadcast();

        console2.log("KevinFloorV4 ", address(floor));
        console2.log("token        ", token);
        console2.log("quote        ", quote);
        console2.log("currency0    ", c0);
        console2.log("currency1    ", c1);
        console2.log("tokenIsZero  ", floor.tokenIsZero());
        console2.log("upIsUp       ", floor.upIsUp());
        console2.log("owner        ", owner);
        console2.log("");
        console2.log("READ upIsUp ABOVE. WETH is 0x0Bd7... which is a very low");
        console2.log("address, so $KEVIN is almost certainly currency1 and");
        console2.log("upIsUp must be FALSE. Preflight.s.sol prints the same");
        console2.log("value off the live pool -- they must agree. If not, stop.");
        console2.log("");
        console2.log("The quote is an ERC20, so top the bid up with");
        console2.log("fundWarChestToken(). The payable fundWarChest() reverts.");
        console2.log("");
        if (owner != vm.addr(pk)) {
            console2.log("From the owner: setOperator(...) and setRails(...)");
        }
        console2.log("Then, from the owner, once the pool is live and trading:");
        console2.log("  setFloorFromSpot(1500)   puts the floor 15% under spot");
        console2.log("It does nothing at all until a floor is set.");
        console2.log("");
        console2.log("Defaults hold the floor 3 days under water, then yield");
        console2.log("1.5%/day down to -30% of the mark, so a price that never");
        console2.log("comes back does not stall it forever. setPatience() to");
        console2.log("change that; setPatience(x, 0, y) to never yield at all.");
        console2.log("");
        console2.log("Then send it tokens. Send a fraction of one day's");
        console2.log("allocation first and watch one fill land before the rest.");
    }
}
