// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  KevinStaking
 * @notice Stake $KEVIN, earn $KEVIN. Stake KEVIN'S CREW NFTs on top and your
 *         stake counts for more. That is the whole product.
 *
 * @dev Reward maths is the Synthetix StakingRewards accumulator
 *      (`rewardPerTokenStored` / `userRewardPerTokenPaid`). Nothing in this
 *      contract ever iterates over stakers. The only loops are over one
 *      caller's own staked NFTs, and that list is hard-capped by
 *      MAX_STAKED_NFTS so the loop can never approach the block gas limit.
 *
 *      ---------------------------------------------------------------------
 *      BOOST DESIGN: tokenId -> tier -> boost bps.  Why this and not
 *      (traitCategory, traitValue) -> boost bps.
 *      ---------------------------------------------------------------------
 *      KEVIN'S CREW is trait-layered: 8 layers, 8,128,512 reachable
 *      combinations, and the trait tables are append-only so the space only
 *      grows. Traits live in the off-chain manifest (`assets/crew/crew.json`);
 *      the ERC-721 does not expose them on-chain. So EITHER shape needs the
 *      owner to publish per-token data on-chain — there is no version of this
 *      where the contract reads traits for free.
 *
 *      Given that, the two shapes cost:
 *
 *        (a) trait pairs:  8 storage words per token (one per layer) to record
 *            which traits it has, plus a (category,value) -> bps table. Reading
 *            one NFT's boost is 8 cold SLOADs for the traits plus up to 8 more
 *            for the table. Five staked NFTs is ~80 cold SLOADs, ~168k gas,
 *            paid every time the boost is recomputed.
 *
 *        (b) tiers:        1 storage word per token. Reading one NFT's boost is
 *            2 cold SLOADs. Five staked NFTs is ~10, ~21k gas.
 *
 *      (b) is ~8x cheaper to publish and ~8x cheaper to read, and it does not
 *      get worse when a 9th trait layer is added next month. The trait->boost
 *      decision still happens — it happens off-chain, in the published script
 *      that reads crew.json and derives a tier per token, and the result is
 *      committed on-chain by `setTokenTiers`. What stays owner-settable after
 *      deploy, which is the actual requirement, is `setTierBoost`: the bps a
 *      tier is worth can be retuned at any time, and a brand new trait just
 *      gets a new tier id. No trait name appears anywhere in this contract.
 *
 *      Cost of choosing (b), stated plainly: the tier assignment is a claim by
 *      the owner, not a fact the chain can check. A holder verifies it by
 *      re-running the published script against crew.json and comparing. See
 *      README.md, "What the owner can still do to you".
 *
 *      ---------------------------------------------------------------------
 *      WHEN A BOOST CHANGE TAKES EFFECT
 *      ---------------------------------------------------------------------
 *      The accumulator is only sound while
 *      `totalEffectiveSupply == sum of every effectiveBalanceOf`. Applying a
 *      retuned tier to everyone at once would mean walking every staker, which
 *      is exactly what this pattern exists to avoid. So a boost change is not
 *      retroactive: it lands on an account the next time that account is
 *      synced — any stake/withdraw/claim, or a permissionless `syncBoost(who)`
 *      that anyone may call for anyone. Both sides of the invariant move in the
 *      same transaction, so the accounting is exact at every block; what a
 *      change does NOT do is rewrite rewards already earned.
 *
 *      ---------------------------------------------------------------------
 *      ASSUMPTIONS
 *      ---------------------------------------------------------------------
 *      Both tokens are plain ERC-20s: no fee-on-transfer, no rebasing, no
 *      callback hooks (no ERC-777). $KEVIN is a plain ERC-20. Deploying this
 *      against a fee-on-transfer token WILL mis-account, because the free
 *      reward balance is derived from `balanceOf(this)` minus what is owed.
 *      `stakingToken` and `rewardToken` may be the same token; that case is
 *      handled explicitly everywhere balances are reasoned about.
 */
contract KevinStaking is Ownable2Step, ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------

    /// @notice Basis-point denominator. 10_000 bps = 1x.
    uint256 public constant BPS = 10_000;

    /// @notice Fixed-point scale for the reward accumulator.
    uint256 private constant PRECISION = 1e18;

    /**
     * @notice Hard ceiling on the NFT boost: +200% bps, so the largest
     *         effective balance anyone can hold is 3x their real stake.
     *
     * @dev Why 20_000 and not something else:
     *
     *      1. It bounds the dilution. Emissions are a fixed number of tokens
     *         over a fixed period; a boost does not create rewards, it moves
     *         them from unboosted stakers to boosted ones. With a 3x ceiling,
     *         a full-boost holder needs at least a third of an unboosted
     *         whale's stake to out-earn them. The crew is worth chasing and it
     *         never replaces the stake. An uncapped boost would let anyone who
     *         accumulated enough NFTs take an arbitrary share of a fixed pot
     *         and make plain staking pointless.
     *
     *      2. It bounds the arithmetic. totalEffectiveSupply can never exceed
     *         3x totalStaked, so with a 1e9 supply there is no configuration of
     *         tiers that can push the accumulator anywhere near overflow.
     *
     *      3. It is a `constant`, not a setter, and that is the point. The
     *         owner can retune what a tier is worth; the owner cannot widen the
     *         ceiling. The worst an owner can do to an unboosted staker is
     *         known at deploy time and does not change.
     */
    uint256 public constant MAX_BOOST_BPS = 20_000;

    /**
     * @notice Hard ceiling on the COMMITMENT boost: +100% bps, so committing
     *         for the longest term is worth at most double, and the two boosts
     *         together can never make one token count as more than four.
     *
     * @dev Separate from MAX_BOOST_BPS and capped separately on purpose. They
     *      pay for different things — the crew is something you bought, the
     *      term is something you promised — and letting one eat the other's
     *      headroom would mean retuning the tier table could silently change
     *      what a commitment is worth. Like the NFT cap it is a `constant`, so
     *      the worst the owner can do to a plain staker is fixed at deploy.
     */
    uint256 public constant MAX_TERM_BOOST_BPS = 10_000;

    /**
     * @notice Most NFTs one address can have staked here at once.
     * @dev The boost recompute walks this list. 32 entries is ~70k gas worst
     *      case on a cold cache, which is affordable, and it is a hard bound so
     *      no account can ever grow a position it cannot afford to exit. It is
     *      not a fairness rule — nothing stops a whale using 32 addresses — it
     *      is a gas-safety rule, and the boost is capped anyway.
     */
    uint256 public constant MAX_STAKED_NFTS = 32;

    /// @notice Bounds on `rewardsDuration`. Lower bound also stops a
    ///         division-by-zero; upper bound stops a fat-fingered century.
    uint256 public constant MIN_REWARDS_DURATION = 1 hours;
    uint256 public constant MAX_REWARDS_DURATION = 365 days;

    // -------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------

    /// @notice The token people stake. $KEVIN.
    IERC20 public immutable stakingToken;

    /// @notice The token people earn. Usually also $KEVIN.
    IERC20 public immutable rewardToken;

    /// @notice KEVIN'S CREW. Boost comes from these.
    IERC721 public immutable crew;

    // -------------------------------------------------------------------
    // Emissions
    // -------------------------------------------------------------------

    /// @notice Length of an emission period, in seconds.
    uint256 public rewardsDuration;

    /// @notice Timestamp the current period stops paying.
    uint256 public periodFinish;

    /// @notice Reward tokens emitted per second across the whole pool.
    uint256 public rewardRate;

    /// @notice Last time the accumulator was rolled forward.
    uint256 public lastUpdateTime;

    /// @notice Accumulated reward per unit of effective balance, scaled 1e18.
    uint256 public rewardPerTokenStored;

    /// @notice Reward tokens that have been notified but not yet paid out.
    ///         Anything counted here is off-limits to the owner.
    uint256 public rewardsCommitted;

    /// @notice Reward-seconds that elapsed while nothing was staked. Provably
    ///         owed to nobody, so `notifyRewardAmount` hands them back to the
    ///         free balance instead of stranding them.
    uint256 public unallocatedRewards;

    mapping(address account => uint256) public userRewardPerTokenPaid;
    mapping(address account => uint256) public rewards;

    // -------------------------------------------------------------------
    // Principal
    // -------------------------------------------------------------------

    /// @notice Real staked tokens. This is the number that must always be
    ///         withdrawable, in every state this contract can be in.
    uint256 public totalStaked;

    /// @notice Boosted supply. Denominator of the accumulator.
    uint256 public totalEffectiveSupply;

    mapping(address account => uint256) public balanceOf;
    mapping(address account => uint256) public effectiveBalanceOf;

    // -------------------------------------------------------------------
    // Boost
    // -------------------------------------------------------------------

    /// @notice tokenId -> tier id. 0 means "not tiered yet", which is worth
    ///         nothing. New mints are safe by default: an untiered NFT gives no
    ///         boost, it does not give an accidental one.
    mapping(uint256 tokenId => uint16 tier) public tokenTier;

    /// @notice tier id -> boost in bps. Owner-settable, forever.
    mapping(uint16 tier => uint16 bps) public tierBoostBps;

    /// @notice Human label for a tier, e.g. "Gold hood, Crown, Laser". Purely
    ///         informational — nothing reads it — but it puts the owner's
    ///         intent on-chain next to the number.
    mapping(uint16 tier => string label) public tierLabel;

    /// @notice Bumped whenever the owner changes anything that could alter a
    ///         boost. Invalidates every cached boost at once, for free.
    uint64 public boostEpoch;

    struct BoostCache {
        uint64 epoch; // epoch this was computed under; 0 = force recompute
        uint192 rawBps; // uncapped sum of tier boosts; cap applied at use
    }

    mapping(address account => BoostCache) private _boostCache;

    // -------------------------------------------------------------------
    // Commitment
    // -------------------------------------------------------------------
    //
    // ENTIRELY OPTIONAL AND OFF BY DEFAULT. With `minStake` and `warmup` at
    // zero and no terms configured, every path below is a no-op and this
    // contract behaves exactly as it did before any of it existed — which is
    // why the whole existing test suite still applies unchanged.
    //
    // Turned on, it is: hold at least `minStake`, wait `warmup` before you
    // start earning at all, and pick a term you are willing to be locked for.
    // Longer terms earn a bigger share. Leave early, or let your stake fall
    // under `minStake`, and you keep every token of principal and forfeit the
    // rewards — which go straight back to the people who stayed.

    /**
     * @notice Reward tokens somebody forfeited and that have not been emitted
     *         again yet. RESERVED FROM `recoverERC20`, so they can only ever
     *         leave through a reward period — which is to say, to the stakers
     *         who stayed.
     *
     * @dev Without this the owner could sweep forfeitures straight out, and a
     *      treasury that PROFITS from people breaking their commitments has
     *      exactly the wrong incentive: raise `minStake`, push a hundred people
     *      under it, collect. The audit found it against a README that had
     *      already promised forfeitures "do not go to the treasury". Now they
     *      cannot.
     */
    uint256 public forfeitedPool;

    /// @notice Least you may hold and still earn. Zero disables it.
    uint256 public minStake;

    /// @notice How long a new stake sits before it earns anything. Zero
    ///         disables it.
    uint256 public warmup;

    /// @notice A term somebody may commit to.
    struct Term {
        uint32 duration; // seconds locked
        uint16 boostBps; // what that promise is worth, on top of 1x
    }

    /// @notice The terms on offer. Index 0 is always "no commitment": zero
    ///         duration, zero boost, and it cannot be removed.
    Term[] public terms;

    /// @notice What one account has committed to.
    struct Lock {
        uint64 earnFrom; // nothing accrues before this
        uint64 until; // leaving before this forfeits the rewards
        uint16 boostBps; // the term's boost, frozen at stake time
    }

    mapping(address account => Lock) public lockOf;

    /// @notice The boost bps currently baked into `effectiveBalanceOf`.
    mapping(address account => uint256) public appliedBoostBps;

    mapping(address account => uint256[] tokenIds) private _stakedNfts;
    mapping(uint256 tokenId => address depositor) public nftDepositor;
    mapping(uint256 tokenId => uint256 index) private _nftIndex;

    // -------------------------------------------------------------------
    // Pause
    // -------------------------------------------------------------------

    /**
     * @notice Blocks NEW deposits only.
     * @dev There is deliberately no pause on the way out. `withdraw`,
     *      `withdrawNfts`, `getReward`, `exit` and `emergencyWithdraw` never
     *      read this flag and never can — people must always be able to get
     *      their principal and their NFTs out, paused or not. If you are
     *      reviewing a change to this contract and it adds a pause check to any
     *      exit path, that change is wrong.
     */
    bool public depositsPaused;

    // -------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------

    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event RewardPaid(address indexed account, uint256 reward);
    event EmergencyWithdrawn(address indexed account, uint256 amount, uint256 rewardsForfeited);
    event NftsStaked(address indexed account, uint256[] tokenIds);
    event NftsWithdrawn(address indexed account, uint256[] tokenIds);
    event EffectiveBalanceSynced(
        address indexed account, uint256 boostBps, uint256 effectiveBalance
    );
    event Committed(address indexed account, uint64 until, uint16 boostBps, uint64 earnFrom);
    event Forfeited(address indexed account, uint256 rewards, bool early, bool belowMinimum);
    event TermSet(uint256 indexed index, uint32 duration, uint16 boostBps);
    event MinStakeSet(uint256 minStake);
    event WarmupSet(uint256 warmup);
    event RewardAdded(uint256 reward, uint256 rate, uint256 periodFinish);
    event RewardToppedUp(uint256 reward, uint256 rate, uint256 periodFinish);
    event RewardsDurationUpdated(uint256 duration);
    event TierBoostUpdated(uint16 indexed tier, uint16 bps, string label);
    event TokenTiersUpdated(uint16 indexed tier, uint256[] tokenIds);
    event DepositsPausedSet(bool paused);
    event Recovered(address indexed token, uint256 amount);
    event RescuedERC721(address indexed token, uint256 indexed tokenId, address to);

    // -------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error EmptyArray();
    error NothingStaked();
    error InsufficientBalance();
    error DepositsArePaused();
    error TooManyNfts();
    error NotDepositor(uint256 tokenId);
    error PeriodStillRunning();
    error PeriodNotFinished();
    error RewardNotFunded(uint256 requested, uint256 available);
    error RewardTooSmall();
    error BadDuration();
    error BoostAboveCap();
    error NoSuchTerm();
    error TermBoostAboveCap();
    error StillLocked();
    error BelowMinimum();
    error ReservedTier();
    error LengthMismatch();
    error AmountExceedsRecoverable(uint256 requested, uint256 available);
    error NotRescuable();

    // -------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------

    constructor(
        IERC20 stakingToken_,
        IERC20 rewardToken_,
        IERC721 crew_,
        uint256 rewardsDuration_,
        address owner_
    ) Ownable(owner_) {
        if (
            address(stakingToken_) == address(0) || address(rewardToken_) == address(0)
                || address(crew_) == address(0)
        ) {
            revert ZeroAddress();
        }
        if (rewardsDuration_ < MIN_REWARDS_DURATION || rewardsDuration_ > MAX_REWARDS_DURATION) {
            revert BadDuration();
        }

        stakingToken = stakingToken_;
        rewardToken = rewardToken_;
        crew = crew_;
        rewardsDuration = rewardsDuration_;

        // Epochs start at 1 so that a zeroed BoostCache (epoch 0) always reads
        // as stale rather than as "computed under epoch 0".
        boostEpoch = 1;
    }

    // -------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------

    /// @dev Rolls the accumulator forward, then settles `account`. Must run
    ///      BEFORE any change to a balance or a boost, so that whatever is
    ///      owed is banked at the old effective balance.
    modifier settle(address account) {
        _updateReward(account);
        _;
    }

    modifier whenDepositsAllowed() {
        if (depositsPaused) revert DepositsArePaused();
        _;
    }

    // -------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        uint256 supply = totalEffectiveSupply;
        if (supply == 0) return rewardPerTokenStored;
        uint256 elapsed = lastTimeRewardApplicable() - lastUpdateTime;
        return rewardPerTokenStored + (elapsed * rewardRate * PRECISION) / supply;
    }

    function earned(address account) public view returns (uint256) {
        uint256 delta = rewardPerToken() - userRewardPerTokenPaid[account];
        return rewards[account] + (effectiveBalanceOf[account] * delta) / PRECISION;
    }

    /// @notice Total reward tokens this period will pay if it runs to the end.
    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /**
     * @notice Would this account be earning, if it were synced right now?
     *
     * @dev PENDING, NOT APPLIED — the same distinction this contract already
     *      draws between `pendingBoostBps` and `appliedBoostBps`, and it is
     *      worth being exact about because the two can disagree.
     *
     *      What is actually being paid is `effectiveBalanceOf`, and that only
     *      moves when something syncs the account. So if the owner RAISES
     *      `minStake` above somebody's stake, this returns false immediately
     *      while they keep earning until their next sync — which anybody can
     *      force with `activate`.
     *
     *      That lag is the safe direction and it is deliberate: raising the bar
     *      does not silently stop a hundred people mid-period, it stops each of
     *      them the next time they are touched. The accumulator is not harmed
     *      either way — `totalEffectiveSupply` and every `effectiveBalanceOf`
     *      go stale together, so their sum still agrees at every block, which
     *      is the invariant that actually matters.
     *
     *      Three ways to be false: too small, still warming up, nothing staked.
     *      The warm-up is frozen into `lockOf.earnFrom` at stake time so a later
     *      `setWarmup` cannot move somebody who has already started; the minimum
     *      is read live, because selling down under it genuinely must stop the
     *      earning and that is the whole point of having one.
     */
    function qualifies(address account) public view returns (bool) {
        uint256 bal = balanceOf[account];
        if (bal == 0 || bal < minStake) return false;
        return block.timestamp >= lockOf[account].earnFrom;
    }

    /// @notice What this account's effective balance WOULD be if synced now.
    /// @dev The applied number is `effectiveBalanceOf`. These disagree between
    ///      the moment something changes off the account's own path — a warm-up
    ///      ending, a term expiring, the owner moving `minStake` — and the next
    ///      time anything touches it.
    function effectiveBalanceIfSynced(address account) public view returns (uint256) {
        if (!qualifies(account)) return 0;
        uint256 term = isLocked(account) ? lockOf[account].boostBps : 0;
        return (balanceOf[account] * (BPS + pendingBoostBps(account) + term)) / BPS;
    }

    /// @notice Does this account owe a sync? The keeper's entire job, in one
    ///         call, so it never has to reimplement the weighting off chain
    ///         and quietly disagree with the contract about who is owed what.
    function needsSync(address account) external view returns (bool) {
        return effectiveBalanceOf[account] != effectiveBalanceIfSynced(account);
    }

    /// @notice Is this account still inside the term it committed to?
    function isLocked(address account) public view returns (bool) {
        return block.timestamp < lockOf[account].until;
    }

    /// @notice What leaving right now would cost, in reward tokens.
    /// @dev Zero if the term is over, or if none was taken.
    function forfeitIfLeavingNow(address account) external view returns (uint256) {
        return isLocked(account) ? earned(account) : 0;
    }

    function termCount() external view returns (uint256) {
        return terms.length;
    }

    /// @notice The boost `account` WOULD have if synced right now, capped.
    ///         Differs from `appliedBoostBps` only after the owner retunes a
    ///         tier and before that account's next sync.
    function pendingBoostBps(address account) public view returns (uint256) {
        return _cap(_computeRawBoostBps(account));
    }

    function stakedNftsOf(address account) external view returns (uint256[] memory) {
        return _stakedNfts[account];
    }

    function stakedNftCount(address account) external view returns (uint256) {
        return _stakedNfts[account].length;
    }

    /// @notice Reward tokens sitting here that are not staked principal and are
    ///         not owed to anybody. This is the pot `notifyRewardAmount` may
    ///         draw on and the only reward-token balance the owner can recover.
    function freeRewardBalance() public view returns (uint256) {
        uint256 bal = rewardToken.balanceOf(address(this));
        uint256 reserved = rewardsCommitted;
        if (address(rewardToken) == address(stakingToken)) reserved += totalStaked;
        return bal > reserved ? bal - reserved : 0;
    }

    // -------------------------------------------------------------------
    // Staking — ERC-20
    // -------------------------------------------------------------------

    /// @notice Stake with no commitment. Identical to `stakeFor(amount, 0)`.
    function stake(uint256 amount) external nonReentrant whenDepositsAllowed settle(msg.sender) {
        _stake(amount, 0);
    }

    /**
     * @notice Stake, and promise to leave it for `termIndex`.
     *
     * @dev The promise can only ever be strengthened. Adding to a stake, or
     *      picking a new term, may push `until` further out and may raise the
     *      boost — it can never pull `until` closer or lower the boost, so
     *      there is no sequence of calls that shortens a commitment already
     *      made. Topping up a locked stake keeps the lock.
     *
     *      The warm-up is charged on the FIRST stake only. Someone already
     *      earning who adds more does not go back to the start; someone who
     *      left and came back does, because their `earnFrom` was cleared when
     *      their balance hit zero.
     */
    function stakeFor(uint256 amount, uint256 termIndex)
        external
        nonReentrant
        whenDepositsAllowed
        settle(msg.sender)
    {
        _stake(amount, termIndex);
    }

    function _stake(uint256 amount, uint256 termIndex) private {
        if (amount == 0) revert ZeroAmount();
        if (termIndex >= terms.length && termIndex != 0) revert NoSuchTerm();

        Lock storage l = lockOf[msg.sender];
        if (balanceOf[msg.sender] == 0) l.earnFrom = uint64(block.timestamp + warmup);

        if (termIndex != 0) {
            Term memory t = terms[termIndex];
            uint64 endsAt = uint64(block.timestamp + t.duration);
            if (endsAt > l.until) l.until = endsAt;
            if (t.boostBps > l.boostBps) l.boostBps = t.boostBps;
        }

        totalStaked += amount;
        balanceOf[msg.sender] += amount;
        _syncEffective(msg.sender);

        emit Staked(msg.sender, amount);
        emit Committed(msg.sender, l.until, l.boostBps, l.earnFrom);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Bring a warmed-up account into the pool. Permissionless.
     *
     * @dev The accumulator is global, so nothing fires by itself when one
     *      account's warm-up ends — somebody has to touch it. Anybody may,
     *      because the only account it can possibly help is the one named: an
     *      account inside its warm-up counts for nothing, so calling this late
     *      costs that staker and nobody else, and calling it early does
     *      nothing at all. The keeper does it so no one has to remember.
     */
    function activate(address account) external nonReentrant settle(account) {
        _syncEffective(account);
    }

    /// @notice `activate` for a list, so one transaction can catch everybody.
    function activateMany(address[] calldata accounts) external nonReentrant {
        uint256 n = accounts.length;
        for (uint256 i; i < n; ++i) {
            _updateReward(accounts[i]);
            _syncEffective(accounts[i]);
        }
    }

    /// @dev No pause check. On purpose. See `depositsPaused`.
    function withdraw(uint256 amount) public nonReentrant settle(msg.sender) {
        _withdraw(amount);
    }

    /// @dev No pause check. On purpose.
    function getReward() public nonReentrant settle(msg.sender) {
        _getReward();
    }

    /// @notice Take everything: full principal and everything earned.
    /// @dev No pause check. On purpose.
    function exit() external nonReentrant settle(msg.sender) {
        uint256 bal = balanceOf[msg.sender];
        if (bal != 0) _withdraw(bal);
        _getReward();
    }

    /**
     * @notice Get your $KEVIN back and give up every reward you have earned.
     * @dev The escape hatch. It still rolls the global accumulator forward,
     *      because that is pure arithmetic with no external call and skipping
     *      it would corrupt everyone else's accounting. What it does not do is
     *      touch your NFTs — those come out through `withdrawNfts`, which is
     *      likewise never blocked — so one badly-behaved ERC-721 can never
     *      stand between you and your principal.
     *
     *      Forfeited rewards are released from `rewardsCommitted`, so they
     *      return to the free balance and can be emitted again to everyone
     *      else rather than being stranded here.
     */
    function emergencyWithdraw() external nonReentrant {
        _updateReward(msg.sender);

        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingStaked();

        uint256 forfeited = rewards[msg.sender];
        rewards[msg.sender] = 0;
        _releaseCommitment(forfeited);
        forfeitedPool += forfeited;

        balanceOf[msg.sender] = 0;
        totalStaked -= amount;
        delete lockOf[msg.sender];

        uint256 eff = effectiveBalanceOf[msg.sender];
        effectiveBalanceOf[msg.sender] = 0;
        totalEffectiveSupply -= eff;

        // Zeroed rather than left stale: with no stake there is no boost to
        // report, and any later action re-derives it from the NFTs, which are
        // deliberately untouched here.
        appliedBoostBps[msg.sender] = 0;

        emit EmergencyWithdrawn(msg.sender, amount, forfeited);
        stakingToken.safeTransfer(msg.sender, amount);
    }

    // -------------------------------------------------------------------
    // Staking — NFTs
    // -------------------------------------------------------------------

    function stakeNfts(uint256[] calldata tokenIds)
        external
        nonReentrant
        whenDepositsAllowed
        settle(msg.sender)
    {
        uint256 n = tokenIds.length;
        if (n == 0) revert EmptyArray();

        uint256[] storage list = _stakedNfts[msg.sender];
        if (list.length + n > MAX_STAKED_NFTS) revert TooManyNfts();

        for (uint256 i; i < n; ++i) {
            uint256 id = tokenIds[i];
            nftDepositor[id] = msg.sender;
            _nftIndex[id] = list.length;
            list.push(id);
        }

        // A duplicate id inside `tokenIds` cannot get through: the second
        // transferFrom pulls from an address that no longer owns it and the
        // whole transaction reverts.
        _invalidateCache(msg.sender);
        _syncEffective(msg.sender);

        emit NftsStaked(msg.sender, tokenIds);
        for (uint256 i; i < n; ++i) {
            crew.transferFrom(msg.sender, address(this), tokenIds[i]);
        }
    }

    /// @dev No pause check. On purpose. Plain `transferFrom` on the way out,
    ///      not `safeTransferFrom`: a receiver hook is both a reentrancy
    ///      surface and a way for a contract wallet to brick its own exit.
    function withdrawNfts(uint256[] calldata tokenIds) public nonReentrant settle(msg.sender) {
        uint256 n = tokenIds.length;
        if (n == 0) revert EmptyArray();

        uint256[] storage list = _stakedNfts[msg.sender];

        for (uint256 i; i < n; ++i) {
            uint256 id = tokenIds[i];
            if (nftDepositor[id] != msg.sender) revert NotDepositor(id);

            uint256 idx = _nftIndex[id];
            uint256 last = list.length - 1;
            if (idx != last) {
                uint256 moved = list[last];
                list[idx] = moved;
                _nftIndex[moved] = idx;
            }
            list.pop();

            delete nftDepositor[id];
            delete _nftIndex[id];
        }

        _invalidateCache(msg.sender);
        _syncEffective(msg.sender);

        emit NftsWithdrawn(msg.sender, tokenIds);
        for (uint256 i; i < n; ++i) {
            crew.transferFrom(address(this), msg.sender, tokenIds[i]);
        }
    }

    /**
     * @notice Re-derive `account`'s boost from the current tier table.
     * @dev Permissionless by design. After the owner retunes a tier, the change
     *      only reaches an account when that account is next synced; letting
     *      anyone push that sync means a holder never has to trust the owner to
     *      do it, and never has to move their stake to collect a raise.
     */
    function syncBoost(address account) external nonReentrant settle(account) {
        _syncEffective(account);
    }

    // -------------------------------------------------------------------
    // Owner — emissions
    // -------------------------------------------------------------------

    /**
     * @notice Fund and start a new emission period.
     * @dev Reverts while a period is running. That is the "cannot be extended
     *      silently" rule: the classic Synthetix `notifyRewardAmount` folds
     *      leftover into a fresh full-length period, which quietly moves
     *      `periodFinish` out and re-prices everyone's expected yield. Here the
     *      owner has exactly two moves and both are legible on-chain:
     *      start a period once the last one has ended, or `topUpCurrentPeriod`,
     *      which adds tokens without moving the end date.
     *
     *      The contract must already hold the tokens. `freeRewardBalance()`
     *      excludes staked principal and everything owed to stakers, so a new
     *      period can never be funded out of rewards that are already someone
     *      else's.
     */
    function notifyRewardAmount(uint256 reward) external onlyOwner settle(address(0)) {
        if (reward == 0) revert ZeroAmount();
        if (block.timestamp < periodFinish) revert PeriodStillRunning();

        // Reward-seconds nobody was staked for are owed to nobody. Hand them
        // back before measuring what is free.
        uint256 stale = unallocatedRewards;
        if (stale != 0) {
            unallocatedRewards = 0;
            _releaseCommitment(stale);
        }

        // Emitting is how a forfeiture gets back to the people who stayed, so
        // this is the one path that releases the reservation. Anything left in
        // `forfeitedPool` stays out of the owner's reach until it is emitted.
        if (forfeitedPool != 0) {
            forfeitedPool = reward >= forfeitedPool ? 0 : forfeitedPool - reward;
        }

        uint256 available = freeRewardBalance();
        if (reward > available) revert RewardNotFunded(reward, available);

        uint256 rate = reward / rewardsDuration;
        if (rate == 0) revert RewardTooSmall();

        rewardsCommitted += reward;
        rewardRate = rate;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;

        emit RewardAdded(reward, rate, periodFinish);
    }

    /**
     * @notice Add rewards to the period already running. `periodFinish` does
     *         not move; the rate rises for whatever time is left.
     */
    function topUpCurrentPeriod(uint256 reward) external onlyOwner settle(address(0)) {
        if (reward == 0) revert ZeroAmount();
        if (block.timestamp >= periodFinish) revert PeriodNotFinished();

        // Emitting is how a forfeiture gets back to the people who stayed, so
        // this is the one path that releases the reservation. Anything left in
        // `forfeitedPool` stays out of the owner's reach until it is emitted.
        if (forfeitedPool != 0) {
            forfeitedPool = reward >= forfeitedPool ? 0 : forfeitedPool - reward;
        }

        uint256 available = freeRewardBalance();
        if (reward > available) revert RewardNotFunded(reward, available);

        uint256 remaining = periodFinish - block.timestamp;

        // The bump must be checked, not the total. `rewardRate` is already
        // non-zero here, so testing the sum is dead code: a top-up smaller
        // than the number of seconds left divides to zero, leaves the rate
        // exactly where it was, and yet still commits the tokens — which
        // strands them here forever, emitted to nobody and no longer free.
        uint256 bump = reward / remaining;
        if (bump == 0) revert RewardTooSmall();
        uint256 rate = rewardRate + bump;

        rewardsCommitted += reward;
        rewardRate = rate;
        lastUpdateTime = block.timestamp;

        emit RewardToppedUp(reward, rate, periodFinish);
    }

    /// @notice Change the length of FUTURE periods. Only between periods, so
    ///         it can never re-price one that is already running.
    function setRewardsDuration(uint256 duration) external onlyOwner {
        if (block.timestamp < periodFinish) revert PeriodStillRunning();
        if (duration < MIN_REWARDS_DURATION || duration > MAX_REWARDS_DURATION) {
            revert BadDuration();
        }
        rewardsDuration = duration;
        emit RewardsDurationUpdated(duration);
    }

    // -------------------------------------------------------------------
    // Owner — boost table
    // -------------------------------------------------------------------

    /**
     * @notice Set what a tier is worth, in bps, and label it.
     * @dev Tier 0 is reserved as "untiered" and is permanently worth zero, so a
     *      newly minted crew member is inert until it is deliberately tiered.
     *      A single tier may not exceed the cap; a stack of them is capped
     *      again at use, so no combination of tiers can beat MAX_BOOST_BPS.
     */
    function setTierBoost(uint16 tier, uint16 bps, string calldata label) external onlyOwner {
        if (tier == 0) revert ReservedTier();
        if (bps > MAX_BOOST_BPS) revert BoostAboveCap();

        tierBoostBps[tier] = bps;
        tierLabel[tier] = label;
        ++boostEpoch;

        emit TierBoostUpdated(tier, bps, label);
    }

    /// @notice Assign a tier to a batch of token ids. Pass tier 0 to un-tier.
    function setTokenTiers(uint256[] calldata tokenIds, uint16 tier) external onlyOwner {
        uint256 n = tokenIds.length;
        if (n == 0) revert EmptyArray();

        for (uint256 i; i < n; ++i) {
            tokenTier[tokenIds[i]] = tier;
        }
        ++boostEpoch;

        emit TokenTiersUpdated(tier, tokenIds);
    }

    // -------------------------------------------------------------------
    // Owner — misc
    // -------------------------------------------------------------------

    /**
     * @notice Add or retune a term. Index 0 is reserved for "no commitment"
     *         and is created at the first call; it can never be given a
     *         duration or a boost.
     *
     * @dev Retuning a term changes what FUTURE stakes get. Nobody's existing
     *      commitment moves: `lockOf` freezes the boost and the end date at
     *      stake time, so the owner cannot reach back and devalue a promise
     *      somebody already made, or extend a lock they are already inside.
     */
    function setTerm(uint256 index, uint32 duration, uint16 boostBps) external onlyOwner {
        if (boostBps > MAX_TERM_BOOST_BPS) revert TermBoostAboveCap();
        if (terms.length == 0) {
            terms.push(Term({duration: 0, boostBps: 0})); // index 0, forever
            emit TermSet(0, 0, 0);
        }
        if (index == 0) revert NoSuchTerm();
        if (index > terms.length) revert NoSuchTerm();
        if (index == terms.length) {
            terms.push(Term({duration: duration, boostBps: boostBps}));
        } else {
            terms[index] = Term({duration: duration, boostBps: boostBps});
        }
        emit TermSet(index, duration, boostBps);
    }

    /**
     * @notice Least somebody may hold and still earn. Zero turns it off.
     *
     * @dev Checked live rather than frozen, so selling down under it really
     *      does stop the earning — that is the whole point of having one. The
     *      cost of that: raising it can push existing stakers under, and they
     *      stop earning until they top up. Announce a change before making it.
     */
    function setMinStake(uint256 amount) external onlyOwner {
        minStake = amount;
        emit MinStakeSet(amount);
    }

    /**
     * @notice How long a new stake waits before it earns. Zero turns it off.
     * @dev Frozen into `earnFrom` at stake time, so a later change never
     *      moves somebody who has already started.
     */
    function setWarmup(uint256 seconds_) external onlyOwner {
        warmup = seconds_;
        emit WarmupSet(seconds_);
    }

    /// @notice Stop new deposits. Does not and cannot stop withdrawals.
    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    /**
     * @notice Sweep tokens that are not spoken for.
     * @dev Staked principal and committed rewards are subtracted before the
     *      limit is checked, so this cannot reach either, including when the
     *      staking token and the reward token are the same token. Crew NFTs are
     *      not reachable from here at all — there is no ERC-721 sweep, so the
     *      owner cannot take a staked NFT.
     */
    function recoverERC20(IERC20 token, uint256 amount) external onlyOwner {
        uint256 reserved;
        if (address(token) == address(stakingToken)) reserved += totalStaked;
        if (address(token) == address(rewardToken)) reserved += rewardsCommitted + forfeitedPool;

        uint256 bal = token.balanceOf(address(this));
        uint256 available = bal > reserved ? bal - reserved : 0;
        if (amount > available) revert AmountExceedsRecoverable(amount, available);

        emit Recovered(address(token), amount);
        token.safeTransfer(owner(), amount);
    }

    /**
     * @notice Send back an ERC-721 that was transferred in directly instead of
     *         being staked.
     * @dev This contract accepts `safeTransferFrom` (it is an ERC721Holder), so
     *      somebody will eventually push a crew member in by hand with no stake
     *      recorded against it. Without this it would sit here forever.
     *      A crew id that HAS a recorded depositor is refused, so a staked NFT
     *      is out of the owner's reach by construction, not by promise.
     */
    function rescueERC721(IERC721 token, uint256 tokenId, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        // `transferFrom(address,address,uint256)` is the SAME 4-byte selector
        // on ERC-721 and ERC-20. Without this guard the owner can point this
        // function at the staking token, pass an AMOUNT where a tokenId is
        // expected, and call
        // `stakingToken.transferFrom(address(this), to, amount)` — which
        // succeeds on every ERC-20 that skips the allowance check when
        // `from == msg.sender` (DSToken/DAI-shaped tokens and many others),
        // draining 100% of staked principal straight past the reserve
        // arithmetic in `recoverERC20`. ERC-20s leave through `recoverERC20`
        // or they do not leave.
        if (address(token) == address(stakingToken) || address(token) == address(rewardToken)) {
            revert NotRescuable();
        }
        if (address(token) == address(crew) && nftDepositor[tokenId] != address(0)) {
            revert NotDepositor(tokenId);
        }
        emit RescuedERC721(address(token), tokenId, to);
        token.transferFrom(address(this), to, tokenId);
    }

    // -------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------

    /**
     * @dev PRINCIPAL IS NEVER TOUCHED. Breaking a commitment costs the rewards
     *      and only the rewards — a contract holding other people's tokens
     *      that can keep any of them is a different and much worse kind of
     *      contract, and no configuration of this one can do it.
     *
     *      Two ways to break it, and they are the two the design asks for:
     *      leaving before the term is up, and selling down under the minimum.
     *      Both give the whole accrued reward back to the pool, where it is
     *      emitted again to whoever stayed.
     */
    function _withdraw(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (amount > bal) revert InsufficientBalance();

        uint256 left = bal - amount;
        bool early = isLocked(msg.sender);
        // Leaving entirely is not "falling under the minimum" — that is just
        // leaving, and it only costs anything if the term was still running.
        bool below = left != 0 && minStake != 0 && left < minStake;

        if (early || below) {
            uint256 forfeited = rewards[msg.sender];
            if (forfeited != 0) {
                rewards[msg.sender] = 0;
                _releaseCommitment(forfeited);
                forfeitedPool += forfeited;
            }
            // The promise is spent either way, so it does not survive to bind
            // whatever is left behind.
            delete lockOf[msg.sender];
            if (left != 0) lockOf[msg.sender].earnFrom = uint64(block.timestamp + warmup);
            emit Forfeited(msg.sender, forfeited, early, below);
        }

        unchecked {
            balanceOf[msg.sender] = left;
        }
        totalStaked -= amount;
        if (left == 0) delete lockOf[msg.sender];
        _syncEffective(msg.sender);

        emit Withdrawn(msg.sender, amount);
        stakingToken.safeTransfer(msg.sender, amount);
    }

    /**
     * @dev THE COMMITMENT IS ENFORCED HERE, NOT ONLY ON THE WAY OUT.
     *
     *      Forfeiture in `_withdraw` can only take what is still sitting in
     *      `rewards[msg.sender]` — and without this line a staker could empty
     *      that bucket with one `getReward()` and then break a 180-day promise
     *      on day eleven, forfeiting exactly nothing and keeping the full term
     *      boost. Four independent reviewers found it; the tell was that
     *      `StillLocked` was declared and never thrown.
     *
     *      So: while your term is running, your rewards are not yours to take.
     *      That IS the commitment — you are paid for the promise when the
     *      promise is kept.
     *
     *      `exit()` still works mid-term, because `_withdraw` runs first, takes
     *      the penalty and deletes the lock, so by the time this is reached
     *      there is nothing left to claim and nothing left to be locked by.
     */
    function _getReward() private {
        if (isLocked(msg.sender)) revert StillLocked();

        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;

        rewards[msg.sender] = 0;
        _releaseCommitment(reward);

        emit RewardPaid(msg.sender, reward);
        rewardToken.safeTransfer(msg.sender, reward);
    }

    /**
     * @dev Roll the accumulator to now, then bank what `account` is owed.
     *      Written out rather than calling `rewardPerToken()` so that the
     *      nobody-is-staked case can be measured instead of discarded.
     */
    function _updateReward(address account) private {
        uint256 applicable = lastTimeRewardApplicable();
        uint256 elapsed = applicable - lastUpdateTime;

        if (elapsed != 0) {
            uint256 supply = totalEffectiveSupply;
            if (supply == 0) {
                // Emitted into an empty pool. Owed to nobody, remembered so it
                // can be re-notified rather than stranded.
                unallocatedRewards += elapsed * rewardRate;
            } else {
                rewardPerTokenStored += (elapsed * rewardRate * PRECISION) / supply;
            }
            lastUpdateTime = applicable;
        }

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    /**
     * @dev Recompute `account`'s effective balance and move
     *      `totalEffectiveSupply` by the same delta in the same statement, so
     *      `totalEffectiveSupply == sum(effectiveBalanceOf)` holds at every
     *      block. Always call after `_updateReward(account)`.
     */
    function _syncEffective(address account) private {
        uint256 boost = _cap(_rawBoostBps(account));
        // A stake that is under the minimum, or still inside its warm-up, is
        // worth nothing in the accumulator. It is not slashed and it is not
        // stuck — it simply does not count while it does not qualify, so what
        // it would have earned goes to the people who do.
        // The term boost is paid WHILE THE PROMISE IS LIVE and not a second
        // longer. Without the isLocked check it survived its own end date
        // forever, and worse, still applied to every later top-up — so one
        // 30-day term bought a permanent +25% on an unlimited, uncommitted
        // stake. Expiring it also means a top-up after the term is over gets
        // the boost only if a new term is taken with it.
        uint256 term = isLocked(account) ? lockOf[account].boostBps : 0;
        uint256 newEff = qualifies(account) ? (balanceOf[account] * (BPS + boost + term)) / BPS : 0;
        uint256 oldEff = effectiveBalanceOf[account];

        if (appliedBoostBps[account] != boost) appliedBoostBps[account] = boost;

        if (newEff != oldEff) {
            effectiveBalanceOf[account] = newEff;
            totalEffectiveSupply = totalEffectiveSupply - oldEff + newEff;
        }

        emit EffectiveBalanceSynced(account, boost, newEff);
    }

    /// @dev Cached sum of tier boosts. The cache is thrown away wholesale by a
    ///      global epoch bump when the owner touches the tier table, and per
    ///      account when that account's NFT set changes, so the walk over the
    ///      account's NFTs happens only when something actually moved.
    function _rawBoostBps(address account) private returns (uint256) {
        BoostCache storage c = _boostCache[account];
        if (c.epoch == boostEpoch) return c.rawBps;

        uint256 sum = _computeRawBoostBps(account);
        // casting to 'uint192' is safe because the sum is at most
        // MAX_STAKED_NFTS (32) * type(uint16).max, i.e. ~2.1e6, and every
        // addend is a uint16 read out of `tierBoostBps`.
        // forge-lint: disable-next-line(unsafe-typecast)
        _boostCache[account] = BoostCache({epoch: boostEpoch, rawBps: uint192(sum)});
        return sum;
    }

    function _computeRawBoostBps(address account) private view returns (uint256 sum) {
        uint256[] storage ids = _stakedNfts[account];
        uint256 n = ids.length;
        for (uint256 i; i < n; ++i) {
            sum += tierBoostBps[tokenTier[ids[i]]];
        }
    }

    function _invalidateCache(address account) private {
        _boostCache[account].epoch = 0;
    }

    function _cap(uint256 bps) private pure returns (uint256) {
        return bps > MAX_BOOST_BPS ? MAX_BOOST_BPS : bps;
    }

    /**
     * @dev Give `amount` back to the free reward balance. Clamped rather than
     *      checked: `rewardsCommitted` is only a reservation used to stop the
     *      owner spending money that is owed, and an underflow revert here
     *      would sit on an exit path. Nothing is paid out from this function —
     *      the actual transfer still has to succeed on its own.
     */
    function _releaseCommitment(uint256 amount) private {
        uint256 committed = rewardsCommitted;
        rewardsCommitted = amount >= committed ? 0 : committed - amount;
    }
}
