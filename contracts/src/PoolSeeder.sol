// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CurrencyLibrary, Currency} from "v4-core/src/types/Currency.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {CurrencySettler} from "v4-core/test/utils/CurrencySettler.sol";

/// @title PoolSeeder — add or remove liquidity on a v4 pool, owner-only
/// @notice Uniswap's own v4-core ships PoolModifyLiquidityTest for exactly this, but it is
/// unauthenticated by design (it is a TEST helper) — a position it holds is keyed to the
/// router's own address, not to whoever funded it, so anyone can call it to walk off with
/// liquidity someone else paid for. This is the same mechanism with one change: every call
/// is `onlyOwner`. Nothing else about the settlement logic differs from the reference
/// contract — it is proven code, just no longer callable by a stranger.
///
/// One deployment, reusable for every pool the owner ever wants to seed.
contract PoolSeeder is Ownable2Step, IUnlockCallback {
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

    IPoolManager public immutable manager;

    constructor(IPoolManager manager_, address owner_) Ownable(owner_) {
        manager = manager_;
    }

    struct CallbackData {
        address sender;
        PoolKey key;
        IPoolManager.ModifyLiquidityParams params;
        bytes hookData;
    }

    /// @notice Add (liquidityDelta > 0) or remove (< 0) liquidity on `key`, in the caller's
    /// name. Pulls owed tokens from the owner via transferFrom — approve this contract first.
    /// Anything owed back (removing liquidity, or a partial fill) is sent to the owner.
    function modifyLiquidity(PoolKey memory key, IPoolManager.ModifyLiquidityParams memory params, bytes memory hookData)
        external
        onlyOwner
        returns (BalanceDelta delta)
    {
        delta = abi.decode(manager.unlock(abi.encode(CallbackData(msg.sender, key, params, hookData))), (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        CallbackData memory data = abi.decode(rawData, (CallbackData));

        (BalanceDelta delta,) = manager.modifyLiquidity(data.key, data.params, data.hookData);
        int256 delta0 = delta.amount0();
        int256 delta1 = delta.amount1();

        if (delta0 < 0) data.key.currency0.settle(manager, data.sender, uint256(-delta0), false);
        if (delta1 < 0) data.key.currency1.settle(manager, data.sender, uint256(-delta1), false);
        if (delta0 > 0) data.key.currency0.take(manager, data.sender, uint256(delta0), false);
        if (delta1 > 0) data.key.currency1.take(manager, data.sender, uint256(delta1), false);

        return abi.encode(delta);
    }

    /// @notice Ownership pays the settlement — see PadRouter's note on the same tradeoff.
    /// Renouncing would just mean nobody can ever seed or unwind a position here again.
    function renounceOwnership() public pure override {
        revert("disabled");
    }
}
