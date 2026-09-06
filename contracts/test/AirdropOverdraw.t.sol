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

    /// Round B's list sums to `total` but B is funded with less. B's claimants
    /// are paid in full out of round A's money, and A can no longer pay.
    function test_underfundedRoundEatsAnotherRoundsMoney() public {
        vm.startPrank(owner);
        uint256 a = drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 30 days), "A");
        // B funded 1000e18 short of what its own leaves add up to.
        uint256 short_ = 1000e18;
        uint256 b = drop.openRound(IERC20(address(gme)), root, total - short_, uint64(block.timestamp + 30 days), "B");
        vm.stopPrank();

        assertEq(gme.balanceOf(address(drop)), total * 2 - short_);
        assertEq(drop.rounds(b).total, total - short_, "B holds less than its list promises");

        // B pays out its whole list anyway.
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(b, i, accounts[i], amounts[i], _proof(i));
        }
        assertEq(drop.rounds(b).claimed, total, "B paid out MORE than B was funded with");
        assertEq(gme.balanceOf(address(drop)), total - short_, "and round A is 1000e18 light");

        // Round A can no longer pay its own list. Two claims go through and the
        // third runs out of money that round A was funded with and still owns.
        drop.claim(a, 0, accounts[0], amounts[0], _proof(0));
        drop.claim(a, 1, accounts[1], amounts[1], _proof(1));
        (uint256 leftA,) = drop.remaining(a);
        assertGt(leftA, gme.balanceOf(address(drop)), "A is owed more than the contract holds");
        vm.expectRevert(); // ERC20InsufficientBalance
        drop.claim(a, 2, accounts[2], amounts[2], _proof(2));
    }

    /// Once claimed > total, remaining() and sweepExpired() panic forever.
    function test_overdrawBricksSweepAndViews() public {
        vm.startPrank(owner);
        uint256 a = drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 30 days), "A");
        uint256 b = drop.openRound(IERC20(address(gme)), root, total - 1000e18, uint64(block.timestamp + 30 days), "B");
        vm.stopPrank();
        a; // silence
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(b, i, accounts[i], amounts[i], _proof(i));
        }
        vm.expectRevert(stdError.arithmeticError);
        drop.remaining(b);
        vm.warp(block.timestamp + 31 days);
        vm.prank(owner);
        vm.expectRevert(stdError.arithmeticError);
        drop.sweepExpired(b, owner);
    }

    /// The fee-on-transfer path the contract explicitly supports produces the
    /// same shortfall with no operator error at all.
    function test_feeTokenRoundOverdrawsByTheFee() public {
        FeeToken2 fee = new FeeToken2();
        fee.mint(owner, total * 10);
        vm.startPrank(owner);
        fee.approve(address(drop), type(uint256).max);
        uint256 a = drop.openRound(IERC20(address(fee)), root, total, uint64(block.timestamp + 30 days), "A");
        uint256 b = drop.openRound(IERC20(address(fee)), root, total, uint64(block.timestamp + 30 days), "B");
        vm.stopPrank();
        a;
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(b, i, accounts[i], amounts[i], _proof(i));
        }
        assertGt(drop.rounds(b).claimed, drop.rounds(b).total, "B paid more than it was funded");
        vm.expectRevert(stdError.arithmeticError);
        drop.remaining(b);
    }
}
