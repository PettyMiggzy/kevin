// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title  KevinLock
 * @notice Holds the treasury's bag and can only let it out at a published rate,
 *         through the floor keeper, which cannot sell below the floor.
 *
 * @dev  ---------------------------------------------------------------------
 *       WHAT THIS IS ACTUALLY FOR
 *       ---------------------------------------------------------------------
 *       A large holder with a vesting schedule is the single most bearish fact
 *       about a young token, and it is bearish BEFORE they sell anything. Every
 *       buyer can see the wallet, everyone knows roughly when the unlocks land,
 *       and the rational thing for all of them is to sell into that wallet's
 *       shadow first. You do not have to dump to be dumped on; you only have to
 *       be ABLE to.
 *
 *       KevinFloorV4 solves the wrong half of that. It makes the treasury's own
 *       selling orderly — no wicks, never below a floor, capped per trade and
 *       per day — and that is worth having. But its owner can `sweep()` the
 *       whole balance in one transaction, which means nothing it holds is a
 *       commitment. It is a promise with a withdraw button.
 *
 *       This contract is the commitment. Tokens in here have exactly two ways
 *       out:
 *
 *         1. FAST: `release()`, permissionless, at most `ratePerDay` a day,
 *            and only ever to the floor keeper — which then sells them under
 *            all of its own limits. Anyone may call it. Nobody can redirect it.
 *
 *         2. SLOW: `requestExit()`, which starts a public countdown of
 *            `exitDelay` and emits an event the moment it is called. After the
 *            countdown the beneficiary can take the tokens. Before it, nobody
 *            can.
 *
 *       There is no third way and no owner. `floor`, `beneficiary` and
 *       `exitDelay` are immutable, and `ratePerDay` can only ever be lowered.
 *       Every lever on this contract points the same direction: slower.
 *
 *       That turns "a 20% holder could dump at any moment" into "a 20% holder
 *       cannot sell faster than X a day, and cannot change that, and if they
 *       want out they have to say so publicly N days in advance". It is worth
 *       more to the chart than any amount of buy-side money you could put up,
 *       and it costs you nothing you were actually going to do.
 *
 *       ---------------------------------------------------------------------
 *       WHAT IT DOES NOT DO
 *       ---------------------------------------------------------------------
 *       It only speaks for what is inside it. Tokens the treasury holds
 *       elsewhere are not covered by anything here, and a lock holding a tenth
 *       of the bag is a press release rather than a commitment. **Put the bag
 *       in, publish the address, and let people check it themselves.**
 *
 *       It also cannot make anyone buy. Nothing can. What it removes is the
 *       reason not to.
 */
contract KevinLock {
    using SafeERC20 for IERC20;

    uint256 private constant DAY = 1 days;

    /// @notice How much unused allowance may bank up. Without a cap, a box left
    ///         empty for a month would quietly earn the right to release a
    ///         month's worth the instant it was funded, which is the opposite
    ///         of the point.
    uint256 public constant BANK = 3 days;

    IERC20 public immutable token;
    /// @notice The only address `release()` can ever send to.
    address public immutable floor;
    /// @notice The only address a slow exit can ever send to.
    address public immutable beneficiary;
    /// @notice How much public notice a slow exit gives. Immutable, because a
    ///         notice period the beneficiary can shorten is not a notice period.
    uint256 public immutable exitDelay;

    /// @notice The published drip. May only ever be lowered.
    uint256 public ratePerDay;
    /// @notice When the allowance bucket was last drawn down.
    uint256 public lastRelease;
    /// @notice Cumulative, for anyone reading the contract rather than the logs.
    uint256 public totalReleased;

    /// @notice When a pending slow exit becomes executable. Zero if none.
    uint256 public exitAt;
    /// @notice How much that pending exit is for.
    uint256 public exitAmount;

    event Released(uint256 amount, uint256 total);
    event SlowedDown(uint256 from, uint256 to);
    event ExitRequested(uint256 amount, uint256 executableAt);
    event ExitCancelled(uint256 amount);
    event ExitExecuted(uint256 amount);

    error NotBeneficiary();
    error NothingToRelease();
    error OnlySlower();
    error NoExitPending();
    error TooSoon(uint256 executableAt);
    error BadParam();

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        _;
    }

    constructor(
        IERC20 token_,
        address floor_,
        address beneficiary_,
        uint256 ratePerDay_,
        uint256 exitDelay_
    ) {
        if (address(token_) == address(0) || floor_ == address(0) || beneficiary_ == address(0)) {
            revert BadParam();
        }
        // A same-day exit is not a notice period, and a rate of zero at deploy
        // would just be a contract nobody can use.
        if (exitDelay_ < 1 days || ratePerDay_ == 0) revert BadParam();

        token = token_;
        floor = floor_;
        beneficiary = beneficiary_;
        exitDelay = exitDelay_;
        ratePerDay = ratePerDay_;
        // Starts empty: the first day's allowance has to actually pass.
        lastRelease = block.timestamp;
    }

    // --- the fast way out ---------------------------------------------------

    /// @notice How much may go to the floor keeper right now.
    function releasable() public view returns (uint256) {
        if (ratePerDay == 0) return 0;
        uint256 elapsed = block.timestamp - lastRelease;
        if (elapsed > BANK) elapsed = BANK;
        uint256 allowed = (ratePerDay * elapsed) / DAY;
        uint256 bal = token.balanceOf(address(this));
        return allowed < bal ? allowed : bal;
    }

    /**
     * @notice Push the day's allowance to the floor keeper.
     * @dev    Permissionless on purpose. The only thing calling this can do is
     *         move tokens toward the one contract that is rate-limited and
     *         floor-limited, so there is nothing to gain by calling it and
     *         nothing to lose by letting anyone. It also means the keeper can
     *         drive the whole thing without holding a privileged key.
     */
    function release() external returns (uint256 amount) {
        amount = releasable();
        if (amount == 0) revert NothingToRelease();

        // Advance the bucket by exactly the time this drew down, rather than to
        // "now" — a release that was capped by the balance must not forfeit the
        // allowance it did not use. Pull the clock forward to the bank limit
        // first, so time spent beyond it is not credited either.
        //
        // Written as an addition rather than `block.timestamp - BANK` because
        // that subtraction underflows on any chain whose timestamps have not
        // yet passed three days. No real chain, but it is the kind of thing
        // that is true until it is not.
        uint256 elapsed = block.timestamp - lastRelease;
        if (elapsed > BANK) lastRelease += elapsed - BANK;
        // ROUNDED UP, so the rounding costs the treasury rather than the
        // market. Rounding down let the drip run a fraction of a second ahead
        // of the clock on every call, which a fuzz run compounded into a real
        // overshoot. Every ambiguity in this contract should resolve the same
        // way, because the whole value of it is that people believe the bound.
        //
        // This can never push lastRelease past now: `amount` is at most
        // floor(rate * e / DAY) for e = min(elapsed, BANK), so the time it
        // costs is at most e, and e seconds is exactly what is left.
        lastRelease += Math.ceilDiv(amount * DAY, ratePerDay);

        totalReleased += amount;
        token.safeTransfer(floor, amount);
        emit Released(amount, totalReleased);
    }

    // --- the levers, all of which point the same way ------------------------

    /// @notice Lower the drip. There is deliberately no way to raise it: a rate
    ///         the beneficiary can raise is not a rate, it is a preference.
    ///         Zero is allowed and means the fast path is closed entirely.
    function slowDown(uint256 newRate) external onlyBeneficiary {
        if (newRate >= ratePerDay) revert OnlySlower();
        emit SlowedDown(ratePerDay, newRate);
        ratePerDay = newRate;
    }

    // --- the slow way out ---------------------------------------------------

    /// @notice Start the public countdown on taking tokens back out.
    /// @dev    Emits immediately, and re-requesting always restarts the full
    ///         delay, so there is no way to shorten it by asking twice.
    function requestExit(uint256 amount) external onlyBeneficiary {
        if (amount == 0) revert BadParam();
        exitAmount = amount;
        exitAt = block.timestamp + exitDelay;
        emit ExitRequested(amount, exitAt);
    }

    function cancelExit() external onlyBeneficiary {
        if (exitAt == 0) revert NoExitPending();
        emit ExitCancelled(exitAmount);
        exitAt = 0;
        exitAmount = 0;
    }

    function executeExit() external onlyBeneficiary returns (uint256 amount) {
        if (exitAt == 0) revert NoExitPending();
        if (block.timestamp < exitAt) revert TooSoon(exitAt);

        uint256 bal = token.balanceOf(address(this));
        amount = exitAmount < bal ? exitAmount : bal;
        exitAt = 0;
        exitAmount = 0;
        if (amount > 0) token.safeTransfer(beneficiary, amount);
        emit ExitExecuted(amount);
    }

    /// @notice Seconds until a pending exit may be executed. Zero if none is
    ///         pending or it is already executable. For anyone watching.
    function exitCountdown() external view returns (uint256) {
        if (exitAt == 0 || block.timestamp >= exitAt) return 0;
        return exitAt - block.timestamp;
    }

    /// @notice What is actually locked in here right now.
    function locked() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
