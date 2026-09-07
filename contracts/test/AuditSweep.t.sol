// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract AuditSweep is Test {
    MockERC20 kevin; MockERC20 gme; MockERC721 crew; KevinStaking s;
    address owner = makeAddr("owner"); address alice = makeAddr("alice"); address bob = makeAddr("bob");
    uint256 constant MIN = 5_000_000e18; uint256 constant POT = 30_000e18;
    function setUp() public {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("K","K",18); gme = new MockERC20("G","G",18); crew = new MockERC721();
        s = new KevinStaking(IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), 30 days, owner);
        vm.startPrank(owner); s.setMinStake(MIN); s.setWarmup(5 days); s.setTerm(1, 90 days, 6_000); vm.stopPrank();
        kevin.mint(alice, 50_000_000e18); kevin.mint(bob, 50_000_000e18);
        vm.prank(alice); kevin.approve(address(s), type(uint256).max);
        vm.prank(bob); kevin.approve(address(s), type(uint256).max);
    }
    function test_ownerSweepsForfeitures() public {
        vm.prank(alice); s.stakeFor(MIN, 1);
        vm.prank(bob);   s.stakeFor(MIN, 1);
        vm.warp(block.timestamp + 5 days + 1); s.activate(alice); s.activate(bob);
        gme.mint(address(s), POT); vm.prank(owner); s.notifyRewardAmount(POT);
        vm.warp(block.timestamp + 10 days);

        uint256 hers = s.earned(alice);
        vm.prank(alice); s.exit();                 // breaks her 90-day term
        uint256 free = s.freeRewardBalance();
        console2.log("alice forfeited      :", hers);
        console2.log("freeRewardBalance now:", free);

        vm.prank(owner); s.recoverERC20(IERC20(address(gme)), free);
        console2.log("owner walked off with:", gme.balanceOf(owner));
        assertApproxEqAbs(gme.balanceOf(owner), hers, 1e12, "forfeiture went to the treasury, not to bob");
    }
}
