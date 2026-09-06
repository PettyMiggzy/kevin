// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev WETH, near enough: an ERC-20 you can mint by sending ether.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "eth");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/**
 * @dev A token that keeps a slice of every transfer, the way a pad token with a
 *      tax does. The point of it in these tests is that the contract must count
 *      what ARRIVED, not what the quote said would arrive.
 */
contract TaxedERC20 is ERC20 {
    uint256 public taxBps;
    address public immutable sink;

    constructor(uint256 taxBps_, address sink_) ERC20("Taxed", "TAX") {
        taxBps = taxBps_;
        sink = sink_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTax(uint256 bps) external {
        taxBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || taxBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 cut = (value * taxBps) / 10_000;
        super._update(from, sink, cut);
        super._update(from, to, value - cut);
    }
}

/// @dev Holds the reserves and answers getReserves(). The router below moves
///      them, so the constant product in these tests is a real one.
contract MockPair {
    address public token0;
    address public token1;
    uint112 private r0;
    uint112 private r1;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (r0, r1, uint32(block.timestamp));
    }

    /// @dev Seed it the way a launchpad seeds an LP: move the tokens in, then
    ///      tell it what it is holding.
    function sync() public {
        r0 = uint112(IERC20(token0).balanceOf(address(this)));
        r1 = uint112(IERC20(token1).balanceOf(address(this)));
    }

    /// @dev A real pair pays the swap out itself, from inside swap(). This one
    ///      is told to by the router, which keeps the mock free of approvals
    ///      that a real pair would never need.
    function payOut(address t, address to, uint256 amount) external {
        IERC20(t).transfer(to, amount);
        sync();
    }
}

/**
 * @dev A Uniswap V2 router, cut down to the one function KevinFloor calls, with
 *      the real constant-product arithmetic and the real 0.3% fee.
 *
 *      `shortfallBps` makes it deliver less than the maths says, which is what
 *      a sandwich looks like from inside the caller: the quote was honest when
 *      it was taken and the fill was not. That is the case the contract's own
 *      slippage check exists for, so it has to be reproducible here.
 */
contract MockRouter {
    MockPair public immutable pair;
    uint256 public shortfallBps;

    constructor(MockPair pair_) {
        pair = pair_;
    }

    function setShortfall(uint256 bps) external {
        shortfallBps = bps;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "EXPIRED");
        require(path.length == 2, "PATH");
        IERC20 tin = IERC20(path[0]);
        IERC20 tout = IERC20(path[1]);

        uint256 beforeIn = tin.balanceOf(address(pair));
        tin.transferFrom(msg.sender, address(pair), amountIn);
        // What the pair actually received, which is not amountIn for a taxed
        // token — the same reason the caller has to measure too.
        uint256 got = tin.balanceOf(address(pair)) - beforeIn;

        uint256 rIn = beforeIn;
        uint256 rOut = tout.balanceOf(address(pair));
        uint256 inWithFee = got * 997;
        uint256 out = (inWithFee * rOut) / (rIn * 1000 + inWithFee);
        if (shortfallBps != 0) out = (out * (10_000 - shortfallBps)) / 10_000;

        require(out >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        // The pair pays out and restates its reserves, exactly as a real one
        // does at the end of swap().
        pair.payOut(address(tout), to, out);
    }
}
