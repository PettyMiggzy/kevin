// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KevinAirdrop} from "../src/KevinAirdrop.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev A token that keeps 1% on every transfer. Not what GME is, but the
///      contract must not be able to promise more than it holds if it ever is.
contract FeeToken is MockERC20 {
    constructor() MockERC20("Fee", "FEE", 18) {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100;
        super.transferFrom(from, address(0xFEE), fee);
        return super.transferFrom(from, to, amount - fee);
    }
}

/**
 * The Merkle root in these tests is NOT computed in Solidity — it is read from
 * contracts/test/fixtures/airdrop.json, which tools/test/airdrop.test.mjs
 * generates with the same code that will build the real one.
 *
 * That is the point. The off-chain tree and the on-chain verifier are two
 * independent implementations of the same rule, and if they disagree by one
 * hashing decision — sorted pairs, double-hashed leaves, the exact abi.encode
 * — then every claim reverts and the airdrop is dead on arrival with the
 * tokens already sent. Checking each half against its own idea of a leaf would
 * catch none of that.
 */
contract KevinAirdropTest is Test {
    KevinAirdrop internal drop;
    MockERC20 internal gme;

    address internal owner = address(0xA11CE);
    address internal stranger = address(0xBAD);

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
            vm.readFile("test/fixtures/airdrop.json"),
            string.concat(".proofs[", vm.toString(i), "]")
        );
    }

    function _open() internal returns (uint256 id) {
        vm.prank(owner);
        return drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 30 days), "ipfs://list");
    }

    // --- the two halves agree ------------------------------------------------

    function test_everyLeafInTheOffChainTreeClaimsOnChain() public {
        uint256 id = _open();
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(id, i, accounts[i], amounts[i], _proof(i));
            assertEq(gme.balanceOf(accounts[i]), amounts[i], "paid exactly the leaf");
        }
        assertEq(gme.balanceOf(address(drop)), 0, "and the round is emptied to the wei");
    }

    function test_aClaimPaysTheAccountNotTheCaller() public {
        uint256 id = _open();
        vm.prank(stranger); // anybody may submit somebody else's claim
        drop.claim(id, 0, accounts[0], amounts[0], _proof(0));
        assertEq(gme.balanceOf(accounts[0]), amounts[0]);
        assertEq(gme.balanceOf(stranger), 0, "the caller gets nothing for their trouble");
    }

    /// @dev claimMany calls claim(), which is nonReentrant. If claimMany were
    ///      ALSO nonReentrant the guard would still be held on the second
    ///      iteration and every batch of more than one would revert — a classic
    ///      way to ship a batch function that has never been called with two
    ///      items. It is deliberately not marked, and this is the proof.
    function test_aBatchOfClaimsActuallyWorks() public {
        uint256 id = _open();
        uint256 n = accounts.length;
        uint256[] memory ids = new uint256[](n);
        uint256[] memory idx = new uint256[](n);
        address[] memory who = new address[](n);
        uint256[] memory amt = new uint256[](n);
        bytes32[][] memory proofs = new bytes32[][](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = id; idx[i] = i; who[i] = accounts[i]; amt[i] = amounts[i]; proofs[i] = _proof(i);
        }
        drop.claimMany(ids, idx, who, amt, proofs);
        for (uint256 i = 0; i < n; i++) assertEq(gme.balanceOf(accounts[i]), amounts[i]);
        assertEq(gme.balanceOf(address(drop)), 0, "the whole round, in one transaction");
    }

    function test_aBatchWithMismatchedArraysIsRefused() public {
        uint256 id = _open();
        uint256[] memory one = new uint256[](1);
        one[0] = id;
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.claimMany(one, new uint256[](2), new address[](1), new uint256[](1), new bytes32[][](1));
    }

    // --- the things a bad proof must not do ---------------------------------

    function test_theSameLeafCannotBeClaimedTwice() public {
        uint256 id = _open();
        drop.claim(id, 0, accounts[0], amounts[0], _proof(0));
        vm.expectRevert(KevinAirdrop.AlreadyClaimed.selector);
        drop.claim(id, 0, accounts[0], amounts[0], _proof(0));
    }

    function test_aBiggerAmountThanTheLeafFails() public {
        uint256 id = _open();
        vm.expectRevert(KevinAirdrop.BadProof.selector);
        drop.claim(id, 0, accounts[0], amounts[0] + 1, _proof(0));
    }

    function test_someoneElsesProofDoesNotPayYou() public {
        uint256 id = _open();
        vm.expectRevert(KevinAirdrop.BadProof.selector);
        drop.claim(id, 0, stranger, amounts[0], _proof(0));
    }

    function test_theWrongIndexFails() public {
        uint256 id = _open();
        vm.expectRevert(KevinAirdrop.BadProof.selector);
        drop.claim(id, 1, accounts[0], amounts[0], _proof(0));
    }

    function test_anEmptyProofFails() public {
        uint256 id = _open();
        vm.expectRevert(KevinAirdrop.BadProof.selector);
        drop.claim(id, 0, accounts[0], amounts[0], new bytes32[](0));
    }

    // --- rounds are separate pots -------------------------------------------

    /// @dev Rounds share a contract but must not share a balance. If sweeping
    ///      an expired round could reach into a live one, the owner could end
    ///      the second drop early by letting the first one lapse.
    function test_sweepingOneRoundCannotTakeAnothersMoney() public {
        uint256 a = _open();
        vm.prank(owner);
        uint256 b = drop.openRound(
            IERC20(address(gme)), root, total, uint64(block.timestamp + 300 days), "ipfs://second"
        );
        assertEq(gme.balanceOf(address(drop)), total * 2);

        vm.warp(block.timestamp + 31 days); // a is over, b is not
        vm.prank(owner);
        drop.sweepExpired(a, owner);
        assertEq(gme.balanceOf(address(drop)), total, "exactly round b is left");

        // And round b still pays out in full.
        for (uint256 i = 0; i < accounts.length; i++) {
            drop.claim(b, i, accounts[i], amounts[i], _proof(i));
        }
        assertEq(gme.balanceOf(address(drop)), 0);
    }

    function test_sweepTakesOnlyWhatWasNotClaimed() public {
        uint256 id = _open();
        drop.claim(id, 0, accounts[0], amounts[0], _proof(0));
        vm.warp(block.timestamp + 31 days);
        vm.prank(owner);
        drop.sweepExpired(id, owner);
        assertEq(gme.balanceOf(accounts[0]), amounts[0], "a claim already made is not clawed back");
    }

    function test_sweepCannotBeRunTwice() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 31 days);
        vm.startPrank(owner);
        drop.sweepExpired(id, owner);
        vm.expectRevert(KevinAirdrop.RoundClosed.selector);
        drop.sweepExpired(id, owner);
        vm.stopPrank();
    }

    // --- the window is a promise --------------------------------------------

    function test_nothingCanBeSweptWhileTheRoundIsOpen() public {
        uint256 id = _open();
        vm.prank(owner);
        vm.expectRevert(KevinAirdrop.RoundStillOpen.selector);
        drop.sweepExpired(id, owner);
    }

    function test_claimingStopsAtTheDeadline() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 30 days + 1);
        vm.expectRevert(KevinAirdrop.RoundClosed.selector);
        drop.claim(id, 0, accounts[0], amounts[0], _proof(0));
    }

    /// @dev A deadline that can be pulled forward is a claim window that can be
    ///      closed on somebody who is mid-transaction.
    function test_theDeadlineOnlyEverMovesLater() public {
        uint256 id = _open();
        uint64 was = drop.rounds(id).deadline;
        vm.startPrank(owner);
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.extendDeadline(id, was - 1);
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.extendDeadline(id, was);
        drop.extendDeadline(id, was + 1 days);
        vm.stopPrank();
        assertEq(drop.rounds(id).deadline, was + 1 days);
    }

    function test_aRoundCannotOpenWithAWindowNobodyCouldUse() public {
        vm.prank(owner);
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 1 days), "x");
    }

    /**
     * A DEADLINE TOO FAR AWAY IS A LOCKED ROUND.
     *
     * The floor was bounded and the ceiling was not. There is no way to pull a
     * deadline in — extendDeadline only pushes it out — and sweepExpired needs
     * the deadline to pass, so one mistyped number puts the unclaimed remainder
     * beyond reach forever. The number is typed by hand: the snapshot tool
     * prints the openRound call with <DEADLINE> as a placeholder, and pasting
     * a millisecond timestamp where a second one belongs is a normal mistake.
     */
    function test_aRoundCannotOpenWithADeadlineNobodyCouldReach() public {
        vm.startPrank(owner);
        // Date.now() in milliseconds, pasted where seconds belong.
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.openRound(IERC20(address(gme)), root, total, uint64(1789000000000), "ms");

        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.openRound(IERC20(address(gme)), root, total, uint64(block.timestamp + 366 days), "just over");

        // The edge itself is allowed, so the bound is a ceiling and not a cliff
        // one second below where the constant says it is.
        uint256 id = drop.openRound(
            IERC20(address(gme)), root, total, uint64(block.timestamp + drop.MAX_WINDOW()), "at the ceiling"
        );
        assertEq(drop.rounds(id).deadline, uint64(block.timestamp + drop.MAX_WINDOW()));
        vm.stopPrank();
    }

    /// @dev And the same hole on the other function: extendDeadline would
    ///      happily push a live round to type(uint64).max, which is the same
    ///      lock arrived at one step later.
    function test_theDeadlineCannotBeExtendedOutOfReach() public {
        uint256 id = _open();
        vm.startPrank(owner);
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.extendDeadline(id, type(uint64).max);
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.extendDeadline(id, uint64(block.timestamp + 366 days));
        drop.extendDeadline(id, uint64(block.timestamp + 90 days));
        vm.stopPrank();
        assertEq(drop.rounds(id).deadline, uint64(block.timestamp + 90 days));
    }

    // --- the round is funded before it is announced -------------------------

    function test_aRoundHoldsItsMoneyFromTheMomentItExists() public {
        uint256 id = _open();
        assertEq(gme.balanceOf(address(drop)), total, "not a promise to fund it later");
        assertEq(drop.rounds(id).total, total);
    }

    function test_aTokenThatTakesACutIsRecordedAtWhatArrived() public {
        FeeToken fee = new FeeToken();
        fee.mint(owner, total * 2);
        vm.startPrank(owner);
        fee.approve(address(drop), type(uint256).max);
        uint256 id = drop.openRound(IERC20(address(fee)), root, total, uint64(block.timestamp + 30 days), "x");
        vm.stopPrank();
        assertEq(drop.rounds(id).total, fee.balanceOf(address(drop)), "records what it holds, not what it asked for");
        assertLt(drop.rounds(id).total, total, "which is less, because the token took a cut");
    }

    // --- who may do what ----------------------------------------------------

    function test_onlyTheOwnerOpensSweepsOrExtends() public {
        uint256 id = _open();
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        drop.openRound(IERC20(address(gme)), root, 1, uint64(block.timestamp + 30 days), "x");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        drop.extendDeadline(id, uint64(block.timestamp + 90 days));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        drop.sweepExpired(id, stranger);
        vm.stopPrank();
    }

    /// @dev There is no setRoot and no cancel. This test exists so that adding
    ///      one is a deliberate act with a failing test attached: once a round
    ///      is open, the list cannot be rewritten after watching who claims.
    function test_aLiveRoundsListCannotBeChanged() public {
        uint256 id = _open();
        bytes32 was = drop.rounds(id).merkleRoot;
        vm.warp(block.timestamp + 10 days);
        drop.claim(id, 0, accounts[0], amounts[0], _proof(0));
        assertEq(drop.rounds(id).merkleRoot, was, "immutable, and there is no function that could");
    }

    function test_openRoundRefusesNonsense() public {
        uint64 ok_ = uint64(block.timestamp + 30 days);
        vm.startPrank(owner);
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.openRound(IERC20(address(0)), root, total, ok_, "x");
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.openRound(IERC20(address(gme)), bytes32(0), total, ok_, "x");
        vm.expectRevert(KevinAirdrop.BadParam.selector);
        drop.openRound(IERC20(address(gme)), root, 0, ok_, "x");
        vm.stopPrank();
    }

    function test_thereIsNoSuchRound() public {
        vm.expectRevert(KevinAirdrop.NoSuchRound.selector);
        drop.claim(7, 0, accounts[0], amounts[0], _proof(0));
        vm.expectRevert(KevinAirdrop.NoSuchRound.selector);
        drop.rounds(7);
    }
}
