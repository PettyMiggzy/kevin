// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KevinStaking} from "../../src/KevinStaking.sol";
import {HookERC20, ITokenHook} from "./Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Stakes, then tries to re-enter the staking contract from inside the
 *      token transfer that pays it out. Records whether the re-entrant call
 *      got through so the test can assert on it instead of just on a revert.
 */
contract Reenterer is ITokenHook {
    enum Mode {
        None,
        GetReward,
        Withdraw,
        Stake,
        EmergencyWithdraw,
        Exit
    }

    KevinStaking public immutable staking;
    HookERC20 public immutable token;

    Mode public mode;
    bool public didAttempt;
    bool public reentrySucceeded;

    constructor(KevinStaking staking_, HookERC20 token_) {
        staking = staking_;
        token = token_;
    }

    function setMode(Mode m) external {
        mode = m;
        didAttempt = false;
        reentrySucceeded = false;
    }

    function approveAll() external {
        token.approve(address(staking), type(uint256).max);
    }

    function stake(uint256 amount) external {
        staking.stake(amount);
    }

    function withdraw(uint256 amount) external {
        staking.withdraw(amount);
    }

    function claim() external {
        staking.getReward();
    }

    function emergency() external {
        staking.emergencyWithdraw();
    }

    /// @dev Fired by HookERC20 while the staking contract is mid-transfer.
    function onTokenMoved() external override {
        if (mode == Mode.None || didAttempt) return;
        didAttempt = true;

        if (mode == Mode.GetReward) {
            try staking.getReward() {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        } else if (mode == Mode.Withdraw) {
            try staking.withdraw(1) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        } else if (mode == Mode.Stake) {
            try staking.stake(1) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        } else if (mode == Mode.EmergencyWithdraw) {
            try staking.emergencyWithdraw() {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        } else if (mode == Mode.Exit) {
            try staking.exit() {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }
}
