// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

interface IWETH is IERC20 {
    function deposit() external payable;
}

/**
 * @title  KevinFloor
 * @notice The treasury's hands. Buys $KEVIN when the price is under a
 *         ratcheting reference, sells it when the price is over one, and
 *         cannot do anything else with the money it is holding.
 *
 * @dev  ---------------------------------------------------------------------
 *       WHAT THIS IS, AND WHAT IT IS NOT
 *       ---------------------------------------------------------------------
 *       It is a rebalancer with hard limits, not a floor. The distinction is
 *       arithmetic, not modesty. On a constant-product pair, offsetting a sell
 *       of S costs you very nearly S. So a contract funded with 0.35 ETH
 *       absorbs 0.35 ETH of net selling — once — and is then empty. Against a
 *       pool with a few ETH in it that is enough to smooth the noise, keep a
 *       standing bid under the book, and accumulate cheaply. It is not enough
 *       to stop anybody who has decided to leave, and no amount of code makes
 *       it enough. The number that decides whether a floor holds is the size of
 *       the treasury, and this contract's job is to spend that number well
 *       rather than to pretend it is bigger.
 *
 *       ---------------------------------------------------------------------
 *       ONE PAIR. Deliberately.
 *       ---------------------------------------------------------------------
 *       $KEVIN opens against three pools: WETH, KEK and GME. This contract
 *       trades exactly one of them, and it should be the WETH one, for three
 *       reasons that are all mechanical:
 *
 *         1. The other two are priced in KEK and GME. Buying $KEVIN there needs
 *            KEK and GME inventory, not ETH — so ammunition would have to be
 *            swapped into two thin assets first, paying a spread and a fee each
 *            way, and would then sit in two things whose own price moves are
 *            larger than the move it was bought to defend.
 *         2. Splitting a small treasury three ways makes each piece too small
 *            to move anything. A third of not-enough is nothing.
 *         3. It is unnecessary. Buying in the deepest pool moves $KEVIN's price
 *            there, and arbitrage closes the gap in the other two within
 *            blocks, paid for by the arbitrageur. One pool's fees buy three
 *            pools' support.
 *
 *       ---------------------------------------------------------------------
 *       THE RAILS, AND WHY THEY ARE ON-CHAIN
 *       ---------------------------------------------------------------------
 *       The operator is a hot key on a server. Assume it leaks. Everything that
 *       stops a leaked key emptying this contract is enforced here rather than
 *       in the script that calls it:
 *
 *         - the operator names no path, no recipient and no router. It can only
 *           ever move WETH -> KEVIN or KEVIN -> WETH, into this contract.
 *         - every trade is capped in size, and capped again over a rolling day.
 *         - there is a cooldown between trades, so the daily cap cannot be
 *           spent in one block.
 *         - `minOut` is not taken on trust. The contract reads the pair's own
 *           reserves, computes what the swap should return, and reverts if the
 *           swap returns meaningfully less. An operator cannot pass
 *           `minOut = 0` and hand the balance to a sandwich.
 *         - it will not sell below `minSellPrice`, whatever the bands say.
 *
 *       A leaked operator key can therefore waste the daily cap on bad trades.
 *       It cannot take the money. Only the owner can take the money, and the
 *       owner should be a multisig.
 *
 *       ---------------------------------------------------------------------
 *       THE PRICE IT READS
 *       ---------------------------------------------------------------------
 *       Spot, from the pair's own reserves. There is no oracle for a token that
 *       started trading this morning, and pretending otherwise by TWAPing a
 *       one-block-old pool is worse than admitting it.
 *
 *       Reserves are manipulable inside a block, so the reference they feed is
 *       deliberately slow: `refPrice` is a high-water mark that only ever rises
 *       and rises by at most `refStepBps` per poke, and pokes are rate-limited.
 *       Dragging the reference far enough to make the contract mistake a pump
 *       for a dip therefore costs an attacker many blocks of holding a false
 *       price against arbitrage, and wins them at most one daily cap.
 */
contract KevinFloor is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant DAY = 1 days;
    /// @dev Uniswap V2's fee, as a numerator over 1000. 0.3%.
    uint256 private constant SWAP_FEE_NUM = 997;
    uint256 private constant SWAP_FEE_DEN = 1000;

    IERC20 public immutable token;
    IWETH public immutable weth;
    IUniswapV2Pair public immutable pair;
    IUniswapV2Router02 public immutable router;
    /// @dev True when `token` is token0 of the pair, decided once at deploy.
    bool private immutable tokenIsZero;

    /// @notice The hot key allowed to pull the trigger. Not allowed to aim.
    address public operator;

    // --- the band -----------------------------------------------------------

    /// @notice WETH per token, 18dp, as a ratio of reserves. Only ever compared
    ///         against itself, so the token's own decimals cancel.
    uint256 public refPrice;
    /// @notice Buy when spot is this far under `refPrice`.
    uint256 public buyBandBps;
    /// @notice Sell when spot is this far over `refPrice`.
    uint256 public sellBandBps;
    /// @notice How far `refPrice` may climb toward spot in one poke.
    uint256 public refStepBps;
    /// @notice Never sell under this, whatever the band says. 0 disables.
    uint256 public minSellPrice;

    // --- the rails ----------------------------------------------------------

    uint256 public maxWethPerTrade;
    uint256 public maxTokensPerTrade;
    uint256 public dailyWethCap;
    uint256 public dailyTokenCap;
    uint256 public cooldown;
    /// @notice How far under the reserves' own arithmetic a swap may land
    ///         before it is treated as a sandwich rather than a trade.
    uint256 public maxSlippageBps;

    uint256 public lastTradeAt;
    uint256 public windowStart;
    uint256 public wethSpentInWindow;
    uint256 public tokensSoldInWindow;

    event OperatorSet(address indexed operator);
    event BandSet(
        uint256 buyBandBps, uint256 sellBandBps, uint256 refStepBps, uint256 minSellPrice
    );
    event RailsSet(
        uint256 maxWethPerTrade,
        uint256 maxTokensPerTrade,
        uint256 dailyWethCap,
        uint256 dailyTokenCap,
        uint256 cooldown,
        uint256 maxSlippageBps
    );
    event ReferenceMoved(uint256 from, uint256 to, uint256 spot);
    event Bought(uint256 wethIn, uint256 tokensOut, uint256 spotBefore, uint256 spotAfter);
    event Sold(uint256 tokensIn, uint256 wethOut, uint256 spotBefore, uint256 spotAfter);
    event Swept(address indexed asset, address indexed to, uint256 amount);

    error NotOperator();
    error NothingToDo();
    error TooSoon();
    error OverTradeCap();
    error OverDailyCap();
    error EmptyPair();
    error Sandwiched(uint256 got, uint256 wanted);
    error BelowFloor(uint256 spot, uint256 floorPrice);
    error BadParam();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(address owner_, address token_, address weth_, address pair_, address router_)
        Ownable(owner_)
    {
        if (
            token_ == address(0) || weth_ == address(0) || pair_ == address(0)
                || router_ == address(0)
        ) {
            revert BadParam();
        }
        token = IERC20(token_);
        weth = IWETH(weth_);
        pair = IUniswapV2Pair(pair_);
        router = IUniswapV2Router02(router_);

        address t0 = IUniswapV2Pair(pair_).token0();
        address t1 = IUniswapV2Pair(pair_).token1();
        // The pair must be the one this contract says it is. Getting this wrong
        // silently is how a bot ends up trading somebody else's token.
        if (!((t0 == token_ && t1 == weth_) || (t0 == weth_ && t1 == token_))) revert BadParam();
        tokenIsZero = t0 == token_;

        // Conservative defaults. Every one of them is meant to be set by the
        // owner before the contract is funded; they are chosen so that a
        // contract funded and forgotten does as little as possible.
        buyBandBps = 1_200; // 12% under the reference is a dip
        sellBandBps = 2_500; // 25% over it is a spike
        refStepBps = 500; // the reference climbs at most 5% a poke
        maxSlippageBps = 300; // 3% off the reserves' own arithmetic
        cooldown = 5 minutes;
        windowStart = block.timestamp;
    }

    // --- what it is looking at ----------------------------------------------

    /// @notice WETH per token from the pair's reserves, 18dp.
    function spotPrice() public view returns (uint256) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (uint256 rToken, uint256 rWeth) =
            tokenIsZero ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        if (rToken == 0 || rWeth == 0) revert EmptyPair();
        return (rWeth * 1e18) / rToken;
    }

    /// @notice The reserves, token first, so a caller can size a trade.
    function reserves() public view returns (uint256 tokenReserve, uint256 wethReserve) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (tokenReserve, wethReserve) =
            tokenIsZero ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    /// @notice What the pair's own arithmetic says a swap of `amountIn` returns.
    /// @dev    The V2 formula, fee included. Used to check the router's answer
    ///         rather than to trust the caller's `minOut`.
    function quote(uint256 amountIn, bool wethIn) public view returns (uint256) {
        (uint256 rToken, uint256 rWeth) = reserves();
        if (rToken == 0 || rWeth == 0) revert EmptyPair();
        (uint256 rIn, uint256 rOut) = wethIn ? (rWeth, rToken) : (rToken, rWeth);
        uint256 inWithFee = amountIn * SWAP_FEE_NUM;
        return (inWithFee * rOut) / (rIn * SWAP_FEE_DEN + inWithFee);
    }

    /// @notice Whether a poke right now would do anything, and which way.
    /// @return buy  true if the band says buy
    /// @return sell true if the band says sell
    function reading() public view returns (bool buy, bool sell, uint256 spot, uint256 ref) {
        spot = spotPrice();
        ref = refPrice;
        if (ref == 0) return (false, false, spot, ref);
        buy = spot <= (ref * (BPS - buyBandBps)) / BPS;
        sell = spot >= (ref * (BPS + sellBandBps)) / BPS
            && (minSellPrice == 0 || spot >= minSellPrice);
    }

    // --- the trigger --------------------------------------------------------

    /**
     * @notice Do whatever the band says, within the rails, or revert.
     * @param  size how much to spend or sell. Clamped to the per-trade cap, so
     *              a caller passing type(uint256).max means "the most allowed".
     * @dev    Deliberately not permissionless. On a chain with a private
     *         sequencer the front-running risk is small, but a public trigger
     *         at a published threshold is still an invitation, and the contract
     *         gains nothing from being callable by strangers.
     */
    function poke(uint256 size) external nonReentrant whenNotPaused onlyOperator {
        (bool buy, bool sell,,) = reading();
        if (buy) {
            _buy(size);
        } else if (sell) {
            _sell(size);
        } else {
            _ratchet();
            revert NothingToDo();
        }
    }

    /// @notice Move the reference toward spot without trading. Anyone may call
    ///         this: it can only ever raise the reference by `refStepBps`, and
    ///         a higher reference makes the contract more willing to buy, which
    ///         is the direction that costs an attacker money rather than us.
    function ratchet() external nonReentrant whenNotPaused {
        _ratchet();
    }

    function _ratchet() internal {
        uint256 spot = spotPrice();
        uint256 was = refPrice;
        if (was == 0) {
            refPrice = spot;
            emit ReferenceMoved(0, spot, spot);
            return;
        }
        if (spot <= was) return; // it never comes down. That is the ratchet.
        uint256 ceiling = (was * (BPS + refStepBps)) / BPS;
        uint256 next = spot < ceiling ? spot : ceiling;
        refPrice = next;
        emit ReferenceMoved(was, next, spot);
    }

    // --- the two things it can do -------------------------------------------

    function _buy(uint256 size) internal {
        _tick();
        uint256 have = weth.balanceOf(address(this));
        uint256 amountIn = size < have ? size : have;
        if (amountIn > maxWethPerTrade) amountIn = maxWethPerTrade;
        if (amountIn == 0) revert NothingToDo();
        if (amountIn > maxWethPerTrade) revert OverTradeCap();
        if (wethSpentInWindow + amountIn > dailyWethCap) revert OverDailyCap();

        uint256 spotBefore = spotPrice();
        uint256 expected = quote(amountIn, true);
        uint256 floorOut = (expected * (BPS - maxSlippageBps)) / BPS;

        uint256 before = token.balanceOf(address(this));
        IERC20(address(weth)).forceApprove(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn, floorOut, path, address(this), block.timestamp
        );
        // Measured, not reported. The router's fee-on-transfer variant returns
        // nothing, and a taxed token delivers less than the pair sent.
        uint256 got = token.balanceOf(address(this)) - before;
        if (got < floorOut) revert Sandwiched(got, floorOut);

        wethSpentInWindow += amountIn;
        lastTradeAt = block.timestamp;
        emit Bought(amountIn, got, spotBefore, spotPrice());
        _ratchet();
    }

    function _sell(uint256 size) internal {
        _tick();
        uint256 spotBefore = spotPrice();
        if (minSellPrice != 0 && spotBefore < minSellPrice) {
            revert BelowFloor(spotBefore, minSellPrice);
        }

        uint256 have = token.balanceOf(address(this));
        uint256 amountIn = size < have ? size : have;
        if (amountIn > maxTokensPerTrade) amountIn = maxTokensPerTrade;
        if (amountIn == 0) revert NothingToDo();
        if (tokensSoldInWindow + amountIn > dailyTokenCap) revert OverDailyCap();

        uint256 expected = quote(amountIn, false);
        uint256 floorOut = (expected * (BPS - maxSlippageBps)) / BPS;

        uint256 before = weth.balanceOf(address(this));
        token.forceApprove(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = address(weth);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn, floorOut, path, address(this), block.timestamp
        );
        uint256 got = weth.balanceOf(address(this)) - before;
        if (got < floorOut) revert Sandwiched(got, floorOut);

        tokensSoldInWindow += amountIn;
        lastTradeAt = block.timestamp;
        emit Sold(amountIn, got, spotBefore, spotPrice());
    }

    /// @dev The cooldown and the rolling daily window, in one place.
    function _tick() internal {
        if (lastTradeAt != 0 && block.timestamp < lastTradeAt + cooldown) revert TooSoon();
        if (block.timestamp >= windowStart + DAY) {
            windowStart = block.timestamp;
            wethSpentInWindow = 0;
            tokensSoldInWindow = 0;
        }
    }

    // --- the owner's end ----------------------------------------------------

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setBand(
        uint256 buyBandBps_,
        uint256 sellBandBps_,
        uint256 refStepBps_,
        uint256 minSellPrice_
    ) external onlyOwner {
        // A buy band of 100% would mean buying at any price, which is not a
        // band. A ref step over 100% would let one poke drag the reference
        // anywhere, which defeats the slow ratchet.
        if (buyBandBps_ == 0 || buyBandBps_ >= BPS) revert BadParam();
        if (sellBandBps_ == 0) revert BadParam();
        if (refStepBps_ > BPS) revert BadParam();
        buyBandBps = buyBandBps_;
        sellBandBps = sellBandBps_;
        refStepBps = refStepBps_;
        minSellPrice = minSellPrice_;
        emit BandSet(buyBandBps_, sellBandBps_, refStepBps_, minSellPrice_);
    }

    function setRails(
        uint256 maxWethPerTrade_,
        uint256 maxTokensPerTrade_,
        uint256 dailyWethCap_,
        uint256 dailyTokenCap_,
        uint256 cooldown_,
        uint256 maxSlippageBps_
    ) external onlyOwner {
        // Slippage tolerance IS the anti-sandwich check. Letting it reach 100%
        // would turn it off, which is the one setting that must not be
        // reachable by mistake.
        if (maxSlippageBps_ >= BPS / 2) revert BadParam();
        if (maxWethPerTrade_ > dailyWethCap_ || maxTokensPerTrade_ > dailyTokenCap_) {
            revert BadParam();
        }
        maxWethPerTrade = maxWethPerTrade_;
        maxTokensPerTrade = maxTokensPerTrade_;
        dailyWethCap = dailyWethCap_;
        dailyTokenCap = dailyTokenCap_;
        cooldown = cooldown_;
        maxSlippageBps = maxSlippageBps_;
        emit RailsSet(
            maxWethPerTrade_,
            maxTokensPerTrade_,
            dailyWethCap_,
            dailyTokenCap_,
            cooldown_,
            maxSlippageBps_
        );
    }

    /// @notice Set the reference outright. For the first one, and for the day
    ///         the pool is re-seeded and the old number means nothing.
    function setReference(uint256 price) external onlyOwner {
        emit ReferenceMoved(refPrice, price, price == 0 ? 0 : spotPrice());
        refPrice = price;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Take anything out. The owner can always empty this contract, and
    ///         saying so plainly is better than a timelock nobody would wait
    ///         out on a treasury this size. It should be a multisig.
    function sweep(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadParam();
        IERC20(asset).safeTransfer(to, amount);
        emit Swept(asset, to, amount);
    }

    /// @notice ETH sent here becomes WETH, because that is what it trades with.
    receive() external payable {
        weth.deposit{value: msg.value}();
    }

    /// @notice Wrap any ETH sitting here, for the case where it arrived by
    ///         selfdestruct or a coinbase transfer and missed `receive`.
    function wrap() external {
        uint256 bal = address(this).balance;
        if (bal == 0) revert NothingToDo();
        weth.deposit{value: bal}();
    }
}
