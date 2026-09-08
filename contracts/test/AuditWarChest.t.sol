// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {KevinFloorV4} from "../src/KevinFloorV4.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @dev A quote token that keeps 1% of every transfer.
contract FeeToken is ERC20 {
    constructor() ERC20("Fee", "FEE") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xFEE), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/**
 * The war chest is spent by settling REAL tokens to the pool, so any gap
 * between what it claims and what the contract holds turns into a bid that
 * reverts while the contract still looks funded.
 */
contract AuditWarChest is Test {
    PoolManager manager;
    FeeToken quote;
    MockERC20 kevin;
    KevinFloorV4 floor;
    address owner = address(0xA11CE);

    function setUp() public {
        manager = new PoolManager(address(this));
        quote = new FeeToken();
        kevin = new MockERC20("Kevin", "KEVIN", 18);
        // Order the pair so the FEE token is the quote and $KEVIN is the token.
        (address a, address b) = address(quote) < address(kevin)
            ? (address(quote), address(kevin))
            : (address(kevin), address(quote));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(a), currency1: Currency.wrap(b),
            fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        floor = new KevinFloorV4(owner, manager, key, address(kevin));
    }

    /// The chest must never claim more than the contract actually received.
    function test_warChestCountsWhatArrivedNotWhatWasSent() public {
        quote.mint(address(this), 1_000 ether);
        quote.approve(address(floor), type(uint256).max);

        floor.fundWarChestToken(1_000 ether);

        assertEq(
            floor.warChest(),
            quote.balanceOf(address(floor)),
            "war chest claims money the contract does not hold"
        );
        assertLt(floor.warChest(), 1_000 ether, "the fee token did not take its cut");
    }

    function testFuzz_warChestNeverExceedsTheBalance(uint96 a, uint96 b) public {
        uint256 x = bound(a, 1e15, 1e24);
        uint256 y = bound(b, 1e15, 1e24);
        quote.mint(address(this), x + y);
        quote.approve(address(floor), type(uint256).max);
        floor.fundWarChestToken(x);
        floor.fundWarChestToken(y);
        assertLe(
            floor.warChest(),
            quote.balanceOf(address(floor)),
            "war chest outran the balance backing it"
        );
    }
}
