// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KevinAirdrop} from "../src/KevinAirdrop.sol";
import {KevinLock} from "../src/KevinLock.sol";
import {MockERC20} from "./mocks/Mocks.sol";

/**
 * Independent audit tests. These do not reuse the suite's helpers on purpose:
 * the point is to state each contract's central promise as an arithmetic
 * property and try to break it from outside, rather than re-run the author's
 * own reasoning.
 */
contract AuditInvariants is Test {
    MockERC20 tok;
    address owner = address(0xA11CE);
    address treasury = address(0xBEEF);
    address floorKeeper = address(0xF100);

    function setUp() public {
        tok = new MockERC20("Kevin", "KEVIN", 18);
    }

    // ---------------------------------------------------------------- airdrop
    //
    // THE PROMISE: a round can never pay out of another round's money. Stated
    // as solvency: the contract's balance always covers every round's
    // outstanding remainder, for any interleaving of funding and claiming.

    function testFuzz_airdropIsAlwaysSolventAcrossRounds(
        uint96 fundA,
        uint96 fundB,
        uint96 leafA,
        uint96 leafB
    ) public {
        fundA = uint96(bound(fundA, 1e18, 1e24));
        fundB = uint96(bound(fundB, 1e18, 1e24));
        // Leaves deliberately allowed to exceed what the round holds — an
        // oversubscribed root is the exact case that must not reach a neighbour.
        leafA = uint96(bound(leafA, 1, 5e24));
        leafB = uint96(bound(leafB, 1, 5e24));

        KevinAirdrop drop = new KevinAirdrop(owner);
        tok.mint(owner, uint256(fundA) + fundB);

        vm.startPrank(owner);
        tok.approve(address(drop), type(uint256).max);

        // Single-leaf trees: the root IS the leaf, so no proof is needed.
        bytes32 rootA = _leaf(0, address(0xAAAA), leafA);
        bytes32 rootB = _leaf(0, address(0xBBBB), leafB);
        uint64 dl = uint64(block.timestamp + 30 days);
        uint256 a = drop.openRound(IERC20(address(tok)), rootA, fundA, dl, "a");
        uint256 b = drop.openRound(IERC20(address(tok)), rootB, fundB, dl, "b");
        vm.stopPrank();

        bytes32[] memory none = new bytes32[](0);

        // Claim the oversubscribed round FIRST, which is where a missing bound
        // would quietly drain the other one.
        try drop.claim(a, 0, address(0xAAAA), leafA, none) {} catch {}
        try drop.claim(b, 0, address(0xBBBB), leafB, none) {} catch {}

        (uint256 leftA,) = drop.remaining(a);
        (uint256 leftB,) = drop.remaining(b);
        assertGe(
            tok.balanceOf(address(drop)),
            leftA + leftB,
            "a round paid out of another round's money"
        );
    }

    /// A one-wei round whose root pays the owner the whole contract balance.
    /// This is the attack the overdraw bound exists to stop; assert it directly.
    function test_airdropOwnerCannotDrainViaATinyRound() public {
        KevinAirdrop drop = new KevinAirdrop(owner);
        tok.mint(owner, 1_000_000e18 + 1);

        vm.startPrank(owner);
        tok.approve(address(drop), type(uint256).max);
        uint64 dl = uint64(block.timestamp + 30 days);
        // A real, honest round holding the money.
        drop.openRound(IERC20(address(tok)), _leaf(0, address(0xD00D), 1_000_000e18), 1_000_000e18, dl, "real");
        // A one-wei round whose single leaf claims the lot.
        uint256 evil = drop.openRound(IERC20(address(tok)), _leaf(0, owner, 1_000_000e18), 1, dl, "evil");
        vm.stopPrank();

        bytes32[] memory none = new bytes32[](0);
        vm.expectRevert(KevinAirdrop.Overdrawn.selector);
        drop.claim(evil, 0, owner, 1_000_000e18, none);

        assertEq(tok.balanceOf(address(drop)), 1_000_000e18 + 1, "balance moved");
    }

    /// A swept round must never be able to reopen and claim against a balance
    /// that belongs to a live round.
    function test_airdropSweptRoundCannotBeRevived() public {
        KevinAirdrop drop = new KevinAirdrop(owner);
        tok.mint(owner, 200e18);

        vm.startPrank(owner);
        tok.approve(address(drop), type(uint256).max);
        uint64 dl = uint64(block.timestamp + 8 days);
        uint256 r = drop.openRound(IERC20(address(tok)), _leaf(0, address(0xD00D), 100e18), 100e18, dl, "r");
        drop.openRound(IERC20(address(tok)), _leaf(0, address(0xE00E), 100e18), 100e18, uint64(block.timestamp + 300 days), "live");

        vm.warp(block.timestamp + 9 days);
        drop.sweepExpired(r, treasury);

        // Cannot be extended back into life.
        vm.expectRevert(KevinAirdrop.RoundClosed.selector);
        drop.extendDeadline(r, uint64(block.timestamp + 30 days));
        vm.stopPrank();

        // And the leaf is dead even though it was never claimed.
        bytes32[] memory none = new bytes32[](0);
        vm.expectRevert(KevinAirdrop.RoundClosed.selector);
        drop.claim(r, 0, address(0xD00D), 100e18, none);

        assertEq(tok.balanceOf(address(drop)), 100e18, "the live round lost money");
    }

    // ------------------------------------------------------------------- lock
    //
    // THE PROMISE: the treasury cannot get tokens out faster than ratePerDay,
    // plus at most BANK days of unused allowance. Anything else makes the
    // published number a suggestion.

    function testFuzz_lockNeverBeatsItsPublishedRate(uint64 rate, uint16 pokes, uint32 gap) public {
        uint256 ratePerDay = bound(rate, 1e18, 1e24);
        uint256 n = bound(pokes, 1, 60);
        uint256 step = bound(gap, 1, 5 days);

        KevinLock lock = new KevinLock(
            IERC20(address(tok)), floorKeeper, treasury, ratePerDay, 14 days, 3 days
        );
        tok.mint(address(lock), 1e30); // never balance-capped

        uint256 t0 = block.timestamp;
        for (uint256 i = 0; i < n; i++) {
            vm.warp(block.timestamp + step);
            try lock.release() {} catch {}
        }
        uint256 elapsed = block.timestamp - t0;

        // Allowance available over the run: the elapsed time, plus the bank the
        // contract started empty-but-ticking with. +1 day of slack absorbs the
        // deliberate round-up in release().
        uint256 ceiling = (ratePerDay * (elapsed + lock.BANK() + 1 days)) / 1 days;
        assertLe(lock.totalReleased(), ceiling, "the lock outran its published rate");
        assertLe(lock.lastRelease(), block.timestamp, "allowance clock ran into the future");
    }

    /// The notice period must not be convertible into a standing silent exit.
    function test_lockRipeExitExpiresAndMustBeRefiled() public {
        KevinLock lock = new KevinLock(
            IERC20(address(tok)), floorKeeper, treasury, 1e21, 14 days, 3 days
        );
        tok.mint(address(lock), 1e24);

        vm.prank(treasury);
        lock.requestExit(1e24);

        // Let it ripen and then go stale.
        vm.warp(block.timestamp + 14 days + 3 days + 1);
        vm.prank(treasury);
        vm.expectRevert();
        lock.executeExit();
        assertEq(tok.balanceOf(treasury), 0, "a stale request still paid out");
    }

    /// Re-requesting must always restart the full countdown, never shorten it.
    function test_lockReRequestCannotShortenTheNotice() public {
        KevinLock lock = new KevinLock(
            IERC20(address(tok)), floorKeeper, treasury, 1e21, 14 days, 3 days
        );
        tok.mint(address(lock), 1e24);

        vm.startPrank(treasury);
        lock.requestExit(1e24);
        vm.warp(block.timestamp + 13 days);
        lock.requestExit(1e24); // asking again must not inherit the 13 days
        vm.warp(block.timestamp + 13 days);
        vm.expectRevert();
        lock.executeExit();
        vm.stopPrank();
    }

    /// release() may only ever reach the floor keeper, whoever calls it.
    function testFuzz_lockReleaseOnlyEverReachesTheFloor(address caller) public {
        vm.assume(caller != address(0));
        KevinLock lock = new KevinLock(
            IERC20(address(tok)), floorKeeper, treasury, 1e21, 14 days, 3 days
        );
        tok.mint(address(lock), 1e24);
        vm.warp(block.timestamp + 1 days);

        uint256 before = tok.balanceOf(floorKeeper);
        vm.prank(caller);
        uint256 amt = lock.release();
        assertEq(tok.balanceOf(floorKeeper) - before, amt, "tokens went somewhere else");
    }

    function _leaf(uint256 i, address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(i, a, amt))));
    }
}
