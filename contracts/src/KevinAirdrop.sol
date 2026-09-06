// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  KevinAirdrop
 * @notice Pays a token out to $KEVIN holders against a published Merkle root.
 *         Built for the GME the pools earn going back to people who held.
 *
 * @dev  ---------------------------------------------------------------------
 *       WHY A MERKLE ROOT AND NOT A LOOP
 *       ---------------------------------------------------------------------
 *       "Airdrop to everyone who held" is a loop over an unbounded list, which
 *       does not fit in a block and gets more expensive the more successful the
 *       token is. A root is one storage word regardless of whether there are
 *       fifty holders or fifty thousand, holders pay their own claim gas, and
 *       the full list is published so anybody can rebuild the root and check
 *       their own row — which is a stronger guarantee than trusting a
 *       spreadsheet nobody outside the team ever sees.
 *
 *       ---------------------------------------------------------------------
 *       WHAT THE OWNER CANNOT DO, WHICH IS THE POINT
 *       ---------------------------------------------------------------------
 *       A round is funded at the moment it is created and its root is
 *       immutable from that moment. There is no setRoot, no cancel, and no
 *       early withdrawal. So "we will drop this to holders" stops being a
 *       promise the moment the round exists: the tokens are already in here,
 *       the list is already fixed, and the owner cannot rewrite who gets what
 *       after watching who claims.
 *
 *       The one way out is `sweepExpired`, and only after the round's deadline
 *       has passed, so unclaimed tokens are recoverable without being
 *       confiscatable. `extendDeadline` moves that date LATER only.
 *
 *       ---------------------------------------------------------------------
 *       WHAT IS DECIDED OFF CHAIN, AND WHY THAT IS FINE
 *       ---------------------------------------------------------------------
 *       Who qualifies and for how much is computed by tools/airdrop-snapshot.mjs
 *       from the token's own Transfer log: a time-weighted average balance over
 *       a block window, so somebody who bought an hour before the snapshot
 *       scores near zero and somebody who held the whole window scores full.
 *       That is deliberately not on chain — a plain ERC-20 clone has no hook to
 *       record holding time with, and any on-chain version would be a second
 *       token nobody wants to hold.
 *
 *       It is verifiable rather than trusted: the snapshot is deterministic
 *       from public log data, the whole list is published, and anyone can
 *       re-run it and check the root matches what this contract stores.
 */
contract KevinAirdrop is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The shortest a round may be open. A drop announced with a
    ///         one-block claim window is not a drop, it is a headline.
    uint256 public constant MIN_WINDOW = 7 days;

    struct Round {
        IERC20 token;
        bytes32 merkleRoot;
        uint256 total; // what was actually received when the round was funded
        uint256 claimed;
        uint64 deadline;
        uint64 createdAt;
        string uri; // where the full list lives, so the root can be checked
    }

    Round[] private _rounds;

    /// @dev roundId => word index => bitmap of claimed leaf indices.
    mapping(uint256 => mapping(uint256 => uint256)) private _claimedBitmap;

    event RoundOpened(
        uint256 indexed roundId,
        address indexed token,
        bytes32 merkleRoot,
        uint256 total,
        uint64 deadline,
        string uri
    );
    event Claimed(uint256 indexed roundId, uint256 index, address indexed account, uint256 amount);
    event DeadlineExtended(uint256 indexed roundId, uint64 from, uint64 to);
    event SweptExpired(uint256 indexed roundId, address indexed to, uint256 amount);

    error BadParam();
    error NoSuchRound();
    error AlreadyClaimed();
    error BadProof();
    error RoundClosed();
    error RoundStillOpen();

    constructor(address owner_) Ownable(owner_) {}

    // --- opening a round ----------------------------------------------------

    /**
     * @notice Fund a round and fix its list in the same transaction.
     * @param  token     what is being paid out (GME, or anything else)
     * @param  merkleRoot root of leaves keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
     * @param  amount    how much to pull in from the caller
     * @param  deadline  after this, unclaimed tokens can be swept. At least MIN_WINDOW away.
     * @param  uri       where the full list is published. Put something here.
     *
     * @dev The amount RECEIVED is what is recorded, not the amount requested,
     *      so a token that takes a cut on transfer cannot leave the round
     *      claiming to hold more than it does and reverting on the last claim.
     */
    function openRound(
        IERC20 token,
        bytes32 merkleRoot,
        uint256 amount,
        uint64 deadline,
        string calldata uri
    ) external onlyOwner nonReentrant returns (uint256 roundId) {
        if (address(token) == address(0) || merkleRoot == bytes32(0) || amount == 0) revert BadParam();
        if (deadline < block.timestamp + MIN_WINDOW) revert BadParam();

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert BadParam();

        roundId = _rounds.length;
        _rounds.push(
            Round({
                token: token,
                merkleRoot: merkleRoot,
                total: received,
                claimed: 0,
                deadline: deadline,
                createdAt: uint64(block.timestamp),
                uri: uri
            })
        );
        emit RoundOpened(roundId, address(token), merkleRoot, received, deadline, uri);
    }

    // --- claiming -----------------------------------------------------------

    /**
     * @notice Claim one leaf. Permissionless: anybody may submit a claim for
     *         anybody, because the tokens always go to `account` and never to
     *         the caller. That lets the team pay gas for people who cannot.
     */
    function claim(
        uint256 roundId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) public nonReentrant {
        if (roundId >= _rounds.length) revert NoSuchRound();
        Round storage r = _rounds[roundId];
        if (block.timestamp > r.deadline) revert RoundClosed();
        if (isClaimed(roundId, index)) revert AlreadyClaimed();

        // Double-hashed leaf: a second preimage of an internal node cannot be
        // presented as a leaf, which is the standard footgun with 64-byte data.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verifyCalldata(proof, r.merkleRoot, leaf)) revert BadProof();

        _setClaimed(roundId, index);
        r.claimed += amount;
        r.token.safeTransfer(account, amount);
        emit Claimed(roundId, index, account, amount);
    }

    /// @notice Claim several leaves across rounds in one transaction.
    function claimMany(
        uint256[] calldata roundIds,
        uint256[] calldata indexes,
        address[] calldata accounts,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external {
        uint256 n = roundIds.length;
        if (indexes.length != n || accounts.length != n || amounts.length != n || proofs.length != n) {
            revert BadParam();
        }
        for (uint256 i = 0; i < n; i++) {
            claim(roundIds[i], indexes[i], accounts[i], amounts[i], proofs[i]);
        }
    }

    function isClaimed(uint256 roundId, uint256 index) public view returns (bool) {
        uint256 word = index / 256;
        uint256 bit = index % 256;
        return (_claimedBitmap[roundId][word] >> bit) & 1 == 1;
    }

    function _setClaimed(uint256 roundId, uint256 index) internal {
        _claimedBitmap[roundId][index / 256] |= (1 << (index % 256));
    }

    // --- the owner's end ----------------------------------------------------

    /// @notice Give people longer. Later only — a deadline that can be pulled
    ///         forward is a claim window that can be closed on somebody mid
    ///         transaction.
    function extendDeadline(uint256 roundId, uint64 newDeadline) external onlyOwner {
        if (roundId >= _rounds.length) revert NoSuchRound();
        Round storage r = _rounds[roundId];
        if (newDeadline <= r.deadline) revert BadParam();
        emit DeadlineExtended(roundId, r.deadline, newDeadline);
        r.deadline = newDeadline;
    }

    /// @notice Recover what nobody claimed, once the round is over. Bounded to
    ///         this round's own unclaimed remainder, so it can never reach into
    ///         another round's money — the rounds share a contract but not a
    ///         balance.
    function sweepExpired(uint256 roundId, address to) external onlyOwner nonReentrant {
        if (roundId >= _rounds.length) revert NoSuchRound();
        if (to == address(0)) revert BadParam();
        Round storage r = _rounds[roundId];
        if (block.timestamp <= r.deadline) revert RoundStillOpen();

        uint256 left = r.total - r.claimed;
        if (left == 0) revert BadParam();
        // Mark it fully claimed BEFORE transferring, so a second sweep of the
        // same round takes nothing even if the token calls back.
        r.claimed = r.total;
        r.token.safeTransfer(to, left);
        emit SweptExpired(roundId, to, left);
    }

    // --- views --------------------------------------------------------------

    function roundCount() external view returns (uint256) {
        return _rounds.length;
    }

    function rounds(uint256 roundId) external view returns (Round memory) {
        if (roundId >= _rounds.length) revert NoSuchRound();
        return _rounds[roundId];
    }

    /// @notice What is still owed on a round, and whether it can still be had.
    function remaining(uint256 roundId) external view returns (uint256 left, bool open) {
        if (roundId >= _rounds.length) revert NoSuchRound();
        Round storage r = _rounds[roundId];
        return (r.total - r.claimed, block.timestamp <= r.deadline);
    }
}
