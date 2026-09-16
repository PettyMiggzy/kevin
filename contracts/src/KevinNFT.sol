// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  KevinNFT
 * @notice The 1,000-piece Kevin collection. Minting BURNS $KEVIN (sent to the
 *         dead address burnwatch.mjs already tracks — no new burn-tracking
 *         code needed anywhere), priced per tier by tools/mint-model-burn.mjs.
 *         Holding one earns a share of the KEK and WETH LP fees this project
 *         already collects — NOT the GME pool, which stays a separate promise
 *         to token holders generally (see docs/NFT.md). Weight per tier is
 *         the exact 1/2/4/8/16 ladder already spec'd there for GME, reused
 *         here rather than inventing a second scheme.
 *
 * @dev  ---------------------------------------------------------------------
 *       WHAT THIS CONTRACT DOES NOT DECIDE
 *       ---------------------------------------------------------------------
 *       It does not generate art, assign rarity, or invent a trait system —
 *       assets/pfp/tiers.json already fixed, permanently, which of the 1,000
 *       token ids is which tier, and gen-pfp.mjs already rendered the art to
 *       match. This contract's only job with that data is to make each tier's
 *       specific token ids mintable and nothing else — see loadTier below.
 *
 *       ---------------------------------------------------------------------
 *       BURN, NOT PAY: WHY
 *       ---------------------------------------------------------------------
 *       A normal mint takes payment into treasury. This one destroys the
 *       payment instead — every mint is a permanent, on-chain-checkable cut
 *       to circulating supply, on top of whatever burnwatch.mjs is already
 *       tracking. tools/mint-model-burn.mjs sizes each tier as a % of
 *       CIRCULATING supply rather than a flat number, specifically so the
 *       ladder still means the same thing after the chart moves or more gets
 *       burned elsewhere — see that file's own header for why a flat number
 *       was rejected.
 *
 *       ---------------------------------------------------------------------
 *       THE FEE SHARE, IN ONE SENTENCE
 *       ---------------------------------------------------------------------
 *       Standard MasterChef-shaped accumulator, doubled for two reward
 *       tokens: `depositFees` credits whatever KEK/WETH actually arrived
 *       (delta-based, fee-on-transfer safe, same idiom KevinFloorV4's
 *       fundWarChestToken already uses) into accKekPerWeight/
 *       accWethPerWeight scaled by 1e18; each token's claimable amount is
 *       `weight * acc / 1e18 - debt`, and debt resets to the current value on
 *       every claim AND every mint (a token minted after a deposit is not
 *       owed a share of rewards it was never part of). Reward entitlement
 *       lives on the TOKEN, not the holder, so it transfers with the NFT on
 *       sale — deliberate, not an oversight: whoever holds a token owns
 *       whatever it has already accrued, the same as any real fee-share NFT.
 */
contract KevinNFT is ERC721, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tier {
        Common,
        Uncommon,
        Rare,
        Epic,
        Legendary
    }

    /// @dev The GME weight ladder from docs/NFT.md, reused verbatim for this
    ///      separate KEK/WETH pool rather than inventing a second scheme.
    uint256 private constant W_COMMON = 1;
    uint256 private constant W_UNCOMMON = 2;
    uint256 private constant W_RARE = 4;
    uint256 private constant W_EPIC = 8;
    uint256 private constant W_LEGENDARY = 16;
    uint256 private constant ACC_PRECISION = 1e18;

    /// The only two destinations burnwatch.mjs already treats as unspendable
    /// — see its own BURN_ADDRESSES. Sending here needs no new tracking code
    /// anywhere in this repo; the existing keeper picks it up for free.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable KEVIN;
    IERC20 public immutable KEK;
    IERC20 public immutable WETH;

    string private _baseTokenURI;

    /// Per-tier burn price, in KEVIN. Owner-settable ONLY until locked — see
    /// lockTiers(). A price that can change after minting starts is not a
    /// price, it is a rug waiting for a reason.
    mapping(Tier => uint256) public burnAmount;

    /// Which specific token ids belong to each tier — loaded from
    /// assets/pfp/tiers.json's already-committed byId mapping, see loadTier.
    /// Popped from the back on mint; order within a tier carries no meaning,
    /// the art and rarity were already fixed per id before this ever loads.
    mapping(Tier => uint256[]) private _available;
    mapping(uint256 => Tier) public tierOf;

    /// ONE SHOT, like KevinFloorV4's setLockbox — once every tier is loaded
    /// and the ladder is final, lock it and minting can begin. No further
    /// admin call can ever change a price or swap which ids are in which
    /// tier again.
    bool public tiersLocked;
    bool public mintOpen;

    uint256 public totalWeight;
    uint256 public accKekPerWeight;
    uint256 public accWethPerWeight;
    mapping(uint256 => uint256) public kekDebt;
    mapping(uint256 => uint256) public wethDebt;

    event Minted(address indexed to, uint256 indexed tokenId, Tier tier, uint256 burned);
    event FeesDeposited(uint256 kekAmount, uint256 wethAmount, uint256 totalWeightAtDeposit);
    event Claimed(uint256 indexed tokenId, address indexed to, uint256 kekAmount, uint256 wethAmount);
    event TiersLocked(uint256 totalLoaded);
    event MintOpened();

    error TiersAlreadyLocked();
    error TierNotFullyPriced();
    error TierSoldOut(Tier tier);
    error WrongTierCount(Tier tier, uint256 expected, uint256 got);
    error MintNotOpen();
    error MintAlreadyOpen();
    error NotTokenOwnerOrApproved();
    error NothingMinted();
    error BadParam();

    /// Expected slot counts per tier, from assets/pfp/tiers.json's own
    /// counts block — checked at lock time so a partially-loaded or
    /// miscounted tier fails loudly before mint ever opens, not silently
    /// after someone has already burned KEVIN into it.
    uint256 private constant N_COMMON = 400;
    uint256 private constant N_UNCOMMON = 300;
    uint256 private constant N_RARE = 200;
    uint256 private constant N_EPIC = 75;
    uint256 private constant N_LEGENDARY = 25;

    constructor(address kevin_, address kek_, address weth_, string memory baseURI_, address owner_)
        ERC721("Kevin", "KEVIN-NFT")
        Ownable(owner_)
    {
        if (kevin_ == address(0) || kek_ == address(0) || weth_ == address(0)) revert BadParam();
        KEVIN = IERC20(kevin_);
        KEK = IERC20(kek_);
        WETH = IERC20(weth_);
        _baseTokenURI = baseURI_;
    }

    // --- setup, owner only, all of it dead after lockTiers() -------------

    function setBurnAmount(Tier tier, uint256 amount) external onlyOwner {
        if (tiersLocked) revert TiersAlreadyLocked();
        if (amount == 0) revert BadParam();
        burnAmount[tier] = amount;
    }

    /// Load a batch of token ids into a tier. Call this several times per
    /// tier (a script, not a human, should chunk assets/pfp/tiers.json into
    /// calls of a couple hundred ids each — 1,000 ids in one transaction
    /// risks the block gas limit). Safe to call multiple times per tier;
    /// order across calls does not matter.
    function loadTier(Tier tier, uint256[] calldata tokenIds) external onlyOwner {
        if (tiersLocked) revert TiersAlreadyLocked();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            _available[tier].push(id);
            tierOf[id] = tier;
        }
    }

    /// The one-shot: every tier must be priced and fully loaded to its exact
    /// committed count, or this reverts and minting cannot start. After this
    /// call, setBurnAmount and loadTier are dead forever.
    function lockTiers() external onlyOwner {
        if (tiersLocked) revert TiersAlreadyLocked();
        if (
            burnAmount[Tier.Common] == 0 || burnAmount[Tier.Uncommon] == 0 || burnAmount[Tier.Rare] == 0
                || burnAmount[Tier.Epic] == 0 || burnAmount[Tier.Legendary] == 0
        ) revert TierNotFullyPriced();

        _requireCount(Tier.Common, N_COMMON);
        _requireCount(Tier.Uncommon, N_UNCOMMON);
        _requireCount(Tier.Rare, N_RARE);
        _requireCount(Tier.Epic, N_EPIC);
        _requireCount(Tier.Legendary, N_LEGENDARY);

        tiersLocked = true;
        emit TiersLocked(N_COMMON + N_UNCOMMON + N_RARE + N_EPIC + N_LEGENDARY);
    }

    function _requireCount(Tier tier, uint256 expected) private view {
        uint256 got = _available[tier].length;
        if (got != expected) revert WrongTierCount(tier, expected, got);
    }

    function openMint() external onlyOwner {
        if (!tiersLocked) revert TiersAlreadyLocked();
        if (mintOpen) revert MintAlreadyOpen();
        mintOpen = true;
        emit MintOpened();
    }

    // --- minting -----------------------------------------------------------

    /// Burn this tier's price in KEVIN, receive one of that tier's remaining
    /// token ids. Which specific id is not choosable — art and rarity were
    /// already fixed per id before this contract ever saw them, so handing
    /// out the last element of the tier's array is exactly as fair as any
    /// other order would be.
    function mint(Tier tier) external nonReentrant returns (uint256 tokenId) {
        if (!mintOpen) revert MintNotOpen();
        uint256[] storage pool = _available[tier];
        if (pool.length == 0) revert TierSoldOut(tier);

        tokenId = pool[pool.length - 1];
        pool.pop();

        uint256 price = burnAmount[tier];
        // Delta-based, same reasoning as KevinFloorV4's fundWarChestToken:
        // credit exactly what left the sender's balance, not what was asked
        // for, so a fee-on-transfer KEVIN (there isn't one today, but this
        // costs nothing to guard) can never be double-counted.
        uint256 before = KEVIN.balanceOf(DEAD);
        KEVIN.safeTransferFrom(msg.sender, DEAD, price);
        uint256 actuallyBurned = KEVIN.balanceOf(DEAD) - before;

        uint256 w = _weightOf(tier);
        totalWeight += w;
        // A token minted after fees have already accrued is not owed a
        // share of rewards it was never part of — seed its debt at the
        // CURRENT accumulator value, exactly like a fresh claim would.
        kekDebt[tokenId] = (w * accKekPerWeight) / ACC_PRECISION;
        wethDebt[tokenId] = (w * accWethPerWeight) / ACC_PRECISION;

        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, tier, actuallyBurned);
    }

    function _weightOf(Tier tier) private pure returns (uint256) {
        if (tier == Tier.Common) return W_COMMON;
        if (tier == Tier.Uncommon) return W_UNCOMMON;
        if (tier == Tier.Rare) return W_RARE;
        if (tier == Tier.Epic) return W_EPIC;
        return W_LEGENDARY;
    }

    function remaining(Tier tier) external view returns (uint256) {
        return _available[tier].length;
    }

    // --- fee share -----------------------------------------------------------

    /// Permissionless, like KevinFloorV4's fundWarChestToken — anyone may
    /// top up the pool NFT holders draw from; nothing here trusts the
    /// caller with anything beyond what actually left their own wallet.
    function depositFees(uint256 kekAmount, uint256 wethAmount) external nonReentrant {
        if (totalWeight == 0) revert NothingMinted();
        if (kekAmount == 0 && wethAmount == 0) revert BadParam();

        if (kekAmount > 0) {
            uint256 before = KEK.balanceOf(address(this));
            KEK.safeTransferFrom(msg.sender, address(this), kekAmount);
            uint256 got = KEK.balanceOf(address(this)) - before;
            accKekPerWeight += (got * ACC_PRECISION) / totalWeight;
        }
        if (wethAmount > 0) {
            uint256 before = WETH.balanceOf(address(this));
            WETH.safeTransferFrom(msg.sender, address(this), wethAmount);
            uint256 got = WETH.balanceOf(address(this)) - before;
            accWethPerWeight += (got * ACC_PRECISION) / totalWeight;
        }
        emit FeesDeposited(kekAmount, wethAmount, totalWeight);
    }

    function pending(uint256 tokenId) public view returns (uint256 kek, uint256 weth) {
        uint256 w = _weightOf(tierOf[tokenId]);
        kek = (w * accKekPerWeight) / ACC_PRECISION - kekDebt[tokenId];
        weth = (w * accWethPerWeight) / ACC_PRECISION - wethDebt[tokenId];
    }

    /// Pays out both tokens together in one call — there is no reason to
    /// make a holder pay gas twice to collect what is, after all, one
    /// position. Reward entitlement lives on the token, so whoever owns it
    /// right now (not whoever minted it) is who gets paid, and is exactly
    /// who is allowed to call this.
    function claim(uint256 tokenId) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender && getApproved(tokenId) != msg.sender && !isApprovedForAll(ownerOf(tokenId), msg.sender)) {
            revert NotTokenOwnerOrApproved();
        }
        address to = ownerOf(tokenId);
        uint256 w = _weightOf(tierOf[tokenId]);
        (uint256 kek, uint256 weth) = pending(tokenId);

        kekDebt[tokenId] = (w * accKekPerWeight) / ACC_PRECISION;
        wethDebt[tokenId] = (w * accWethPerWeight) / ACC_PRECISION;

        if (kek > 0) KEK.safeTransfer(to, kek);
        if (weth > 0) WETH.safeTransfer(to, weth);
        emit Claimed(tokenId, to, kek, weth);
    }

    // --- metadata -----------------------------------------------------------

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// The only owner-controllable thing left after lockTiers() — where
    /// metadata is HOSTED, never what it says. Moving off a centralized host
    /// to something permanent (IPFS/Arweave) later is exactly the kind of
    /// change this should still allow; changing what token 42 actually is
    /// should not be, and lockTiers() already made that impossible.
    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }
}
