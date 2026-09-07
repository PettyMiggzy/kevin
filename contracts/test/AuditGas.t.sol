// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract AuditGas is Test {
    MockERC20 kevin; MockERC20 gme; MockERC721 crew; KevinStaking s;
    address owner = makeAddr("owner");
    function setUp() public {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("K","K",18); gme = new MockERC20("G","G",18); crew = new MockERC721();
        s = new KevinStaking(IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), 30 days, owner);
        vm.startPrank(owner); s.setMinStake(5_000_000e18); s.setWarmup(5 days); s.setTerm(1, 30 days, 2_500); vm.stopPrank();
    }
    function test_activateManyGas() public {
        uint256 n = 250;
        address[] memory accts = new address[](n);
        for (uint256 i; i < n; ++i) {
            address u = address(uint160(0x1000 + i));
            accts[i] = u;
            kevin.mint(u, 6_000_000e18);
            vm.startPrank(u); kevin.approve(address(s), type(uint256).max); s.stakeFor(6_000_000e18, 1); vm.stopPrank();
        }
        gme.mint(address(s), 30_000e18); vm.prank(owner); s.notifyRewardAmount(30_000e18);
        vm.warp(block.timestamp + 5 days + 1);
        uint256 g = gasleft();
        s.activateMany(accts);
        uint256 used = g - gasleft();
        console2.log("activateMany(250) gas:", used);
        console2.log("per account        :", used / n);
    }
}
