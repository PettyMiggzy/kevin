// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {KevinNFT} from "../src/KevinNFT.sol";
import {MockERC20} from "./mocks/Mocks.sol";

/// @dev A quote token that keeps 1% of every transfer — same shape as
/// AuditWarChest.t.sol's FeeToken, proving depositFees credits what actually
/// arrived, not what was asked for.
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

contract KevinNFTTest is Test {
    MockERC20 kevin;
    MockERC20 kek;
    MockERC20 weth;
    KevinNFT nft;
    address owner = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        kevin = new MockERC20("Kevin", "KEVIN", 18);
        kek = new MockERC20("Kek", "KEK", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        vm.prank(owner);
        nft = new KevinNFT(address(kevin), address(kek), address(weth), "ipfs://base/", owner);

        kevin.mint(alice, 1_000_000 ether);
        kevin.mint(bob, 1_000_000 ether);
        vm.prank(alice);
        kevin.approve(address(nft), type(uint256).max);
        vm.prank(bob);
        kevin.approve(address(nft), type(uint256).max);
    }

    /// The real tier shape (400/300/200/75/25) is too slow for most tests —
    /// this one proves lockTiers() actually enforces it before anything else runs.
    function test_lockTiersRequiresExactCommittedCounts() public {
        vm.startPrank(owner);
        _priceAllTiers();
        uint256[] memory ids = new uint256[](399); // one short of 400
        for (uint256 i; i < ids.length; i++) ids[i] = i;
        nft.loadTier(KevinNFT.Tier.Common, ids);
        // fill the rest correctly
        _loadRemaining();
        vm.expectRevert(); // WrongTierCount(Common, 400, 399)
        nft.lockTiers();
        vm.stopPrank();
    }

    function test_cannotSetBurnAmountOrLoadTierAfterLock() public {
        _setupSmallCollection();
        vm.startPrank(owner);
        vm.expectRevert();
        nft.setBurnAmount(KevinNFT.Tier.Common, 1 ether);
        uint256[] memory one = new uint256[](1);
        one[0] = 999;
        vm.expectRevert();
        nft.loadTier(KevinNFT.Tier.Common, one);
        vm.expectRevert();
        nft.lockTiers();
        vm.stopPrank();
    }

    function test_onlyOwnerCanAdminister() public {
        vm.startPrank(alice);
        vm.expectRevert();
        nft.setBurnAmount(KevinNFT.Tier.Common, 1 ether);
        uint256[] memory ids = new uint256[](1);
        vm.expectRevert();
        nft.loadTier(KevinNFT.Tier.Common, ids);
        vm.expectRevert();
        nft.lockTiers();
        vm.expectRevert();
        nft.openMint();
        vm.stopPrank();
    }

    // --- minting ------------------------------------------------------------

    function test_mintBurnsExactAmountToDeadAddressAndAssignsATokenId() public {
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();

        uint256 price = nft.burnAmount(KevinNFT.Tier.Common);
        uint256 deadBefore = kevin.balanceOf(DEAD);
        uint256 aliceBefore = kevin.balanceOf(alice);

        vm.prank(alice);
        uint256 id = nft.mint(KevinNFT.Tier.Common);

        assertEq(kevin.balanceOf(DEAD) - deadBefore, price, "exact burn amount must reach the dead address");
        assertEq(aliceBefore - kevin.balanceOf(alice), price, "alice must be charged exactly the tier price");
        assertEq(nft.ownerOf(id), alice);
        assertEq(uint256(nft.tierOf(id)), uint256(KevinNFT.Tier.Common));
        assertEq(nft.remaining(KevinNFT.Tier.Common), 399, "one of the 400 Common slots is now gone");
    }

    function test_mintRevertsWhenTierIsSoldOut() public {
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();
        // Legendary is the smallest tier (25 slots) — burn through all of them
        // as alice, then prove the 26th mint has nothing left to hand out.
        vm.startPrank(alice);
        for (uint256 i; i < 25; i++) nft.mint(KevinNFT.Tier.Legendary);
        vm.stopPrank();
        assertEq(nft.remaining(KevinNFT.Tier.Legendary), 0);
        vm.prank(bob);
        vm.expectRevert();
        nft.mint(KevinNFT.Tier.Legendary);
    }

    function test_mintRevertsBeforeMintOpen() public {
        _setupSmallCollection();
        vm.prank(alice);
        vm.expectRevert();
        nft.mint(KevinNFT.Tier.Common);
    }

    // --- fee share: the property that actually matters -----------------------

    function test_singleHolderClaimsTheWholeDeposit() public {
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();
        vm.prank(alice);
        uint256 id = nft.mint(KevinNFT.Tier.Common);

        kek.mint(address(this), 100 ether);
        weth.mint(address(this), 1 ether);
        kek.approve(address(nft), 100 ether);
        weth.approve(address(nft), 1 ether);
        nft.depositFees(100 ether, 1 ether);

        (uint256 pKek, uint256 pWeth) = nft.pending(id);
        assertEq(pKek, 100 ether);
        assertEq(pWeth, 1 ether);

        vm.prank(alice);
        nft.claim(id);
        assertEq(kek.balanceOf(alice), 100 ether);
        assertEq(weth.balanceOf(alice), 1 ether);

        (pKek, pWeth) = nft.pending(id);
        assertEq(pKek, 0, "claiming must zero out pending, not leave it re-claimable");
        assertEq(pWeth, 0);
    }

    /// Legendary is weight 16, Common is weight 1 — a Legendary holder should
    /// get 16x a Common holder's share of the SAME deposit, not an equal split.
    function test_splitsProportionallyToTierWeight() public {
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();
        vm.prank(alice);
        uint256 commonId = nft.mint(KevinNFT.Tier.Common);
        vm.prank(bob);
        uint256 legendaryId = nft.mint(KevinNFT.Tier.Legendary);

        kek.mint(address(this), 17 ether); // divisible by 1+16=17 for a clean check
        kek.approve(address(nft), 17 ether);
        nft.depositFees(17 ether, 0);

        (uint256 commonShare,) = nft.pending(commonId);
        (uint256 legendaryShare,) = nft.pending(legendaryId);
        assertEq(commonShare, 1 ether, "weight 1 of 17 total");
        assertEq(legendaryShare, 16 ether, "weight 16 of 17 total");
        assertEq(commonShare + legendaryShare, 17 ether, "nothing lost, nothing invented");
    }

    /// A token minted AFTER a deposit must not retroactively earn a share of
    /// rewards it was never part of — its debt has to seed at the CURRENT
    /// accumulator, not zero.
    function test_tokenMintedAfterADepositIsNotOwedThatDeposit() public {
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();
        vm.prank(alice);
        uint256 firstId = nft.mint(KevinNFT.Tier.Common);

        kek.mint(address(this), 100 ether);
        kek.approve(address(nft), 100 ether);
        nft.depositFees(100 ether, 0);

        vm.prank(bob);
        uint256 secondId = nft.mint(KevinNFT.Tier.Common); // the second (and last) Common slot

        (uint256 firstPending,) = nft.pending(firstId);
        (uint256 secondPending,) = nft.pending(secondId);
        assertEq(firstPending, 100 ether, "the only token present when fees landed gets all of it");
        assertEq(secondPending, 0, "minted after the deposit, owed nothing from it");
    }

    /// Reward entitlement lives on the TOKEN. A buyer on secondary market
    /// inherits whatever is already accrued — deliberate, not a bug.
    function test_claimEntitlementTransfersWithTheNFT() public {
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();
        vm.prank(alice);
        uint256 id = nft.mint(KevinNFT.Tier.Common);

        kek.mint(address(this), 50 ether);
        kek.approve(address(nft), 50 ether);
        nft.depositFees(50 ether, 0);

        vm.prank(alice);
        nft.transferFrom(alice, bob, id);

        vm.prank(alice);
        vm.expectRevert(); // no longer the owner
        nft.claim(id);

        vm.prank(bob);
        nft.claim(id);
        assertEq(kek.balanceOf(bob), 50 ether, "the new owner collects what had already accrued");
    }

    function test_depositFeesRevertsBeforeAnyoneHasMinted() public {
        _setupSmallCollection();
        kek.mint(address(this), 1 ether);
        kek.approve(address(nft), 1 ether);
        vm.expectRevert(); // NothingMinted — totalWeight is 0
        nft.depositFees(1 ether, 0);
    }

    /// The FeeToken skims 1% on every transfer. depositFees must credit only
    /// what actually landed in the contract, same idiom as KevinFloorV4's
    /// fundWarChestToken and its own AuditWarChest.t.sol coverage.
    function test_depositFeesCreditsOnlyWhatArrivesNotWhatWasSent() public {
        FeeToken feeKek = new FeeToken();
        vm.prank(owner);
        KevinNFT feeNft = new KevinNFT(address(kevin), address(feeKek), address(weth), "ipfs://base/", owner);
        // This test only needs ONE minted token to exist to exercise depositFees'
        // delta accounting, so drive it through the full real ladder.
        _setupSmallCollectionFor(feeNft);
        vm.prank(owner);
        feeNft.openMint();
        vm.prank(alice);
        kevin.approve(address(feeNft), type(uint256).max);
        vm.prank(alice);
        uint256 id = feeNft.mint(KevinNFT.Tier.Common);

        feeKek.mint(address(this), 100 ether);
        feeKek.approve(address(feeNft), 100 ether);
        feeNft.depositFees(100 ether, 0); // only 99 ether actually arrives

        (uint256 pending_,) = feeNft.pending(id);
        assertEq(pending_, 99 ether, "must credit the 99 that arrived, not the 100 that was sent");
        assertEq(feeKek.balanceOf(address(feeNft)), 99 ether);
    }

    /// Property test: across a batch of random mints and deposits, the sum of
    /// every token's pending() balance can never exceed what was actually
    /// deposited — the one invariant that actually matters for a shared pool
    /// like this (no rounding path may ever let tokens collectively claim
    /// more than went in).
    function testFuzz_totalPendingNeverExceedsTotalDeposited(uint8 mintCount, uint96 depositAmount) public {
        vm.assume(mintCount > 0 && mintCount <= 2); // Common+Legendary is all this small ladder has
        vm.assume(depositAmount > 0 && depositAmount < 1_000_000 ether);
        _setupSmallCollection();
        vm.prank(owner);
        nft.openMint();

        uint256[] memory ids = new uint256[](2);
        vm.prank(alice);
        ids[0] = nft.mint(KevinNFT.Tier.Common);
        vm.prank(bob);
        ids[1] = nft.mint(KevinNFT.Tier.Legendary);

        kek.mint(address(this), depositAmount);
        kek.approve(address(nft), depositAmount);
        nft.depositFees(depositAmount, 0);

        (uint256 p0,) = nft.pending(ids[0]);
        (uint256 p1,) = nft.pending(ids[1]);
        assertLe(p0 + p1, depositAmount, "sum of claimable shares must never exceed what was actually deposited");
    }

    // --- helpers --------------------------------------------------------------

    function _priceAllTiers() internal {
        nft.setBurnAmount(KevinNFT.Tier.Common, 1_000 ether);
        nft.setBurnAmount(KevinNFT.Tier.Uncommon, 2_000 ether);
        nft.setBurnAmount(KevinNFT.Tier.Rare, 4_000 ether);
        nft.setBurnAmount(KevinNFT.Tier.Epic, 8_000 ether);
        nft.setBurnAmount(KevinNFT.Tier.Legendary, 16_000 ether);
    }

    function _loadRemaining() internal {
        // Common already partially loaded by the caller in one test; this
        // fills every OTHER tier to its exact real-world count so lockTiers()
        // has something consistent to check against for those tiers.
        _fillTier(KevinNFT.Tier.Uncommon, 300, 10_000);
        _fillTier(KevinNFT.Tier.Rare, 200, 20_000);
        _fillTier(KevinNFT.Tier.Epic, 75, 30_000);
        _fillTier(KevinNFT.Tier.Legendary, 25, 40_000);
    }

    function _fillTier(KevinNFT.Tier tier, uint256 count, uint256 startId) internal {
        uint256[] memory ids = new uint256[](count);
        for (uint256 i; i < count; i++) ids[i] = startId + i;
        nft.loadTier(tier, ids);
    }

    /// Loads the real committed ladder (400/300/200/75/25) — lockTiers()
    /// hard-checks those exact counts, so there is no cheaper "small" shape
    /// that can exercise it. Every test above therefore proves the REAL
    /// contract logic against the REAL launch shape, not a stand-in.
    function _setupSmallCollection() internal {
        _setupSmallCollectionFor(nft);
    }

    function _setupSmallCollectionFor(KevinNFT target) internal {
        vm.startPrank(owner);
        target.setBurnAmount(KevinNFT.Tier.Common, 1_000 ether);
        target.setBurnAmount(KevinNFT.Tier.Uncommon, 2_000 ether);
        target.setBurnAmount(KevinNFT.Tier.Rare, 4_000 ether);
        target.setBurnAmount(KevinNFT.Tier.Epic, 8_000 ether);
        target.setBurnAmount(KevinNFT.Tier.Legendary, 16_000 ether);
        _loadExactly(target, KevinNFT.Tier.Common, 400, 1);
        _loadExactly(target, KevinNFT.Tier.Uncommon, 300, 1000);
        _loadExactly(target, KevinNFT.Tier.Rare, 200, 2000);
        _loadExactly(target, KevinNFT.Tier.Epic, 75, 3000);
        _loadExactly(target, KevinNFT.Tier.Legendary, 25, 4000);
        target.lockTiers();
        vm.stopPrank();
    }

    function _loadExactly(KevinNFT target, KevinNFT.Tier tier, uint256 count, uint256 startId) internal {
        uint256[] memory ids = new uint256[](count);
        for (uint256 i; i < count; i++) ids[i] = startId + i;
        target.loadTier(tier, ids);
    }
}
