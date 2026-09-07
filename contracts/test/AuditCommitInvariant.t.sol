// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {KevinStaking} from "../src/KevinStaking.sol";
import {MockERC20, MockERC721} from "./mocks/Mocks.sol";

contract CommitHandler is Test {
    KevinStaking public immutable s; MockERC20 public immutable kevin;
    MockERC20 public immutable gme; MockERC721 public immutable crew; address public immutable owner;
    address[5] public actors;
    constructor(KevinStaking s_, MockERC20 k, MockERC20 g, MockERC721 c, address o) {
        s = s_; kevin = k; gme = g; crew = c; owner = o;
        actors = [makeAddr("c_a"), makeAddr("c_b"), makeAddr("c_c"), makeAddr("c_d"), makeAddr("c_e")];
        for (uint256 i; i < 5; ++i) {
            kevin.mint(actors[i], 100_000_000e18);
            vm.startPrank(actors[i]);
            kevin.approve(address(s), type(uint256).max);
            crew.setApprovalForAll(address(s), true);
            vm.stopPrank();
            for (uint256 j; j < 3; ++j) crew.mint(actors[i], 10 * i + j);
        }
        vm.startPrank(owner);
        s.setTierBoost(1, 5_000, "b"); s.setTierBoost(2, 20_000, "g");
        s.setTerm(1, 7 days, 2_500); s.setTerm(2, 30 days, 6_000); s.setTerm(3, 180 days, 10_000);
        s.setMinStake(1_000_000e18); s.setWarmup(5 days);
        vm.stopPrank();
    }
    function actorCount() external pure returns (uint256) { return 5; }
    function _a(uint256 x) internal view returns (address) { return actors[x % 5]; }

    function stakeFor(uint256 seed, uint256 amt, uint256 term) external {
        address a = _a(seed);
        amt = bound(amt, 1, kevin.balanceOf(a) == 0 ? 1 : kevin.balanceOf(a));
        if (kevin.balanceOf(a) < amt) return;
        vm.prank(a); s.stakeFor(amt, term % 4);
    }
    function withdraw(uint256 seed, uint256 amt) external {
        address a = _a(seed); uint256 b = s.balanceOf(a); if (b == 0) return;
        vm.prank(a); s.withdraw(bound(amt, 1, b));
    }
    function getReward(uint256 seed) external { vm.prank(_a(seed)); s.getReward(); }
    function exit_(uint256 seed) external { address a = _a(seed); if (s.balanceOf(a)==0 && s.earned(a)==0) return; vm.prank(a); s.exit(); }
    function emergency(uint256 seed) external { address a = _a(seed); if (s.balanceOf(a)==0) return; vm.prank(a); s.emergencyWithdraw(); }
    function activate(uint256 seed) external { s.activate(_a(seed)); }
    function activateMany(uint256 s1, uint256 s2) external {
        address[] memory l = new address[](2); l[0] = _a(s1); l[1] = _a(s2); s.activateMany(l);
    }
    function syncBoost(uint256 seed) external { s.syncBoost(_a(seed)); }
    function stakeNft(uint256 seed, uint256 w) external {
        address a = _a(seed); uint256 id = 10 * (seed % 5) + (w % 3);
        if (crew.ownerOf(id) != a) return;
        uint256[] memory ids = new uint256[](1); ids[0] = id; vm.prank(a); s.stakeNfts(ids);
    }
    function withdrawNft(uint256 seed, uint256 w) external {
        address a = _a(seed); uint256 id = 10 * (seed % 5) + (w % 3);
        if (s.nftDepositor(id) != a) return;
        uint256[] memory ids = new uint256[](1); ids[0] = id; vm.prank(a); s.withdrawNfts(ids);
    }
    function setMinStake(uint256 v) external { vm.prank(owner); s.setMinStake(bound(v, 0, 20_000_000e18)); }
    function setWarmup(uint256 v) external { vm.prank(owner); s.setWarmup(bound(v, 0, 30 days)); }
    function setTerm(uint256 i, uint256 d, uint256 b) external {
        vm.prank(owner); s.setTerm(1 + (i % 3), uint32(bound(d, 0, 365 days)), uint16(bound(b, 0, 10_000)));
    }
    function retune(uint256 t, uint256 b) external { vm.prank(owner); s.setTierBoost(uint16(1 + t % 2), uint16(bound(b, 0, 20_000)), "r"); }
    function fund(uint256 amt) external {
        if (block.timestamp < s.periodFinish()) return;
        amt = bound(amt, 1e18, 100_000e18); gme.mint(address(s), amt); vm.prank(owner); s.notifyRewardAmount(amt);
    }
    function warp(uint256 secs) external { vm.warp(block.timestamp + bound(secs, 1 minutes, 20 days)); }
}

contract AuditCommitInvariant is StdInvariant, Test {
    MockERC20 kevin; MockERC20 gme; MockERC721 crew; KevinStaking s; CommitHandler h;
    address owner = makeAddr("ci_owner");
    function setUp() public {
        vm.warp(1_700_000_000);
        kevin = new MockERC20("K","K",18); gme = new MockERC20("G","G",18); crew = new MockERC721();
        s = new KevinStaking(IERC20(address(kevin)), IERC20(address(gme)), IERC721(address(crew)), 30 days, owner);
        h = new CommitHandler(s, kevin, gme, crew, owner);
        targetContract(address(h));
    }
    function invariant_effectiveSupplyEqualsSum() public view {
        uint256 sum;
        for (uint256 i; i < h.actorCount(); ++i) sum += s.effectiveBalanceOf(h.actors(i));
        assertEq(s.totalEffectiveSupply(), sum, "DRIFT");
    }
    function invariant_totalStakedEqualsSum() public view {
        uint256 sum;
        for (uint256 i; i < h.actorCount(); ++i) sum += s.balanceOf(h.actors(i));
        assertEq(s.totalStaked(), sum, "staked drift");
    }
    function invariant_principalAlwaysCovered() public view {
        assertGe(kevin.balanceOf(address(s)), s.totalStaked(), "principal not covered");
    }
    function invariant_rewardsCovered() public view {
        uint256 owed;
        for (uint256 i; i < h.actorCount(); ++i) owed += s.earned(h.actors(i));
        assertGe(gme.balanceOf(address(s)), owed, "reward insolvent");
    }
    /// @dev boost ceiling: no account can weigh more than 4x its principal.
    function invariant_effectiveNeverExceedsFourX() public view {
        for (uint256 i; i < h.actorCount(); ++i) {
            address a = h.actors(i);
            assertLe(s.effectiveBalanceOf(a), s.balanceOf(a) * 4, "over 4x");
        }
    }
}
