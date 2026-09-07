// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdError} from "forge-std/Test.sol";
import {KevinAirdrop} from "../src/KevinAirdrop.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FeeToken2 is MockERC20 {
    constructor() MockERC20("Fee", "FEE", 18) {}
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100;
        super.transferFrom(from, address(0xFEE), fee);
        return super.transferFrom(from, to, amount - fee);
    }
}

contract AirdropOverdrawTest is Test {
    KevinAirdrop internal drop;
    MockERC20 internal gme;
    address internal owner = address(0xA11CE);

    bytes32 internal root;
    uint256 internal total;
    address[] internal accounts;
    uint256[] internal amounts;

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/airdrop.json");
        root = vm.parseJsonBytes32(json, ".root");
        total = vm.parseJsonUint(json, ".total");
        accounts = vm.parseJsonAddressArray(json, ".accounts");
        amounts = vm.parseJsonUintArray(json, ".amounts");
        gme = new MockERC20("GameStop", "GME", 18);
        drop = new KevinAirdrop(owner);
        gme.mint(owner, total * 10);
        vm.prank(owner);
        gme.approve(address(drop), type(uint256).max);
    }

    function _proof(uint256 i) internal view returns (bytes32[] memory) {
        return vm.parseJsonBytes32Array(
            vm.readFile("test/fixtures/airdrop.json"), string.concat(".proofs[", vm.toString(i), "]")
        );
    }

    /**
     * A ROUND CANNOT SPEND ANOTHER ROUND'S MONEY.
     *
     * These three started life as an audit's proof that it could. Rounds of
     * the same token share one contract balance, and a Merkle root commits to
     * a list but not to a sum — so nothing stopped a round whose leaves added
     * up to more than it held from paying the difference out of its
     * neighbours, leaving an honest holder of a fully funded round with a
     * claim that reverted on a balance that was not there.
     *
     * They are kept, inverted: each one now asserts the round fails on its
     * own last claim and takes nothing from anybody.
     */
    function test_anUnderfundedRoundCannotEatAnothersMoney() public {
        vm.startPrank(owner);
        uint256 a = drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 30 days), "A");
        uint256 short_ = 1000e18;
        uint256 b = drop.openRound(IERC20(address(gme)), root, total - short_, uint64(block.timestamp + 30 days), "B");
        vm.stopPrank();

        // B pays out until its own funding runs out, and then stops.
        uint256 paid;
        for (uint256 i = 0; i < accounts.length; i++) {
            if (drop.rounds(b).claimed + amounts[i] > drop.rounds(b).total) {
                vm.expectRevert(KevinAirdrop.Overdrawn.selector);
                drop.claim(b, i, accounts[i], amounts[i], _proof(i));
            } else {
                drop.claim(b, i, accounts[i], amounts[i], _proof(i));
                paid += amounts[i];
            }
        }
        assertLe(drop.rounds(b).claimed, drop.rounds(b).total, "B never pays out more than it holds");
        assertEq(gme.balanceOf(address(drop)), total * 2 - short_ - paid, "and A is untouched");

        // A still pays its own list in full, which is the whole point.
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(a, i, accounts[i], amounts[i], _proof(i));
        }
        assertEq(drop.rounds(a).claimed, total, "A was paid in full");
    }

    /// @dev And the views stay readable, rather than panicking on an underflow
    ///      that could never be undone.
    function test_theViewsAndTheSweepStayUsable() public {
        vm.startPrank(owner);
        uint256 b = drop.openRound(IERC20(address(gme)), root, total - 1000e18, uint64(block.timestamp + 30 days), "B");
        vm.stopPrank();
        for (uint256 i = 0; i < accounts.length; i++) {
            try drop.claim(b, i, accounts[i], amounts[i], _proof(i)) {} catch {}
        }
        (uint256 left,) = drop.remaining(b);
        assertLe(left, drop.rounds(b).total, "remaining() is still a number");

        vm.warp(block.timestamp + 31 days);
        vm.prank(owner);
        drop.sweepExpired(b, owner);   // used to panic 0x11 forever
        assertEq(drop.rounds(b).claimed, drop.rounds(b).total);
    }

    /// @dev The fee-on-transfer path this contract explicitly supports creates
    ///      the shortfall with NO operator error at all: `total` records what
    ///      arrived, which is less than the list was built for. So this was
    ///      never only a mistyped-number bug.
    function test_aFeeTokenShortfallIsContainedToItsOwnRound() public {
        FeeToken2 fee = new FeeToken2();
        fee.mint(owner, total * 10);
        vm.startPrank(owner);
        fee.approve(address(drop), type(uint256).max);
        uint256 a = drop.openRound(IERC20(address(fee)), root, total, uint64(block.timestamp + 30 days), "A");
        uint256 b = drop.openRound(IERC20(address(fee)), root, total, uint64(block.timestamp + 30 days), "B");
        vm.stopPrank();
        assertLt(drop.rounds(b).total, total, "the token took its cut, so B is short by construction");

        for (uint256 i = 0; i < accounts.length; i++) {
            try drop.claim(b, i, accounts[i], amounts[i], _proof(i)) {} catch {}
        }
        assertLe(drop.rounds(b).claimed, drop.rounds(b).total, "B stayed inside its own funding");
        assertGe(fee.balanceOf(address(drop)), drop.rounds(a).total, "A's money is all still there");
    }

    /// @dev The owner could open a one-wei round with a root paying themselves
    ///      and take the whole contract balance immediately — which would have
    ///      made the contract's central promise, that a funded round is
    ///      irrevocable, simply untrue.
    function test_aTinyRoundCannotDrainTheContract() public {
        vm.startPrank(owner);
        uint256 real = drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 30 days), "real");
        uint256 sneaky = drop.openRound(IERC20(address(gme)), root, 1, uint64(block.timestamp + 7 days + 1), "1 wei");
        vm.stopPrank();

        vm.expectRevert(KevinAirdrop.Overdrawn.selector);
        drop.claim(sneaky, 0, accounts[0], amounts[0], _proof(0));

        assertEq(gme.balanceOf(address(drop)), total + 1, "nothing left");
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(real, i, accounts[i], amounts[i], _proof(i));
        }
        assertEq(drop.rounds(real).claimed, total, "the real round is still whole");
    }

    /// @dev A swept round must never reopen. Its bitmap still holds whatever it
    ///      held, so extending the deadline would make every unclaimed leaf
    ///      live again against a round holding nothing — and it reads exactly
    ///      like the benign "give people longer" the function is for.
    function test_aSweptRoundCannotBeReopened() public {
        vm.startPrank(owner);
        uint256 a = drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 30 days), "A");
        drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 400 days), "B");
        vm.stopPrank();

        vm.warp(block.timestamp + 31 days);
        vm.startPrank(owner);
        drop.sweepExpired(a, owner);
        vm.expectRevert(KevinAirdrop.RoundClosed.selector);
        drop.extendDeadline(a, uint64(block.timestamp + 60 days));
        vm.stopPrank();

        vm.expectRevert(KevinAirdrop.RoundClosed.selector);
        drop.claim(a, 0, accounts[0], amounts[0], _proof(0));
    }
}
