// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KevinNFT} from "../src/KevinNFT.sol";

/**
 * @notice Puts KevinNFT on chain. It does NOT price a tier, load a token id,
 *         lock the ladder, or open minting — all four are deliberate separate
 *         steps you take after reading the deployed contract back, same
 *         split DeployFloorV4.s.sol uses for "deployed" vs "armed".
 *
 *  forge script script/DeployKevinNFT.s.sol --rpc-url robinhood --broadcast
 *
 * Env:
 *   PRIVATE_KEY   deployer key
 *   KEVIN_TOKEN   $KEVIN ERC-20. Defaults to the live token on chain 4663.
 *   KEK_TOKEN     $KEK ERC-20, the first of the two fee-share tokens.
 *                 Defaults to the live token on chain 4663.
 *   WETH_TOKEN    the second fee-share token. Defaults to WETH on chain 4663
 *                 (same address DeployFloorV4.s.sol uses as QUOTE).
 *   BASE_URI      where token metadata is hosted. This is the ONE thing
 *                 setBaseURI can still change after lockTiers() — see the
 *                 contract's own comment on why that is fine and tier
 *                 content is not. No real metadata host exists yet, so the
 *                 default is an obvious placeholder — do not lock the
 *                 ladder against it.
 *   NFT_OWNER     can price tiers, load ids, lock, open, and re-host
 *                 metadata. Defaults to the same treasury wallet every other
 *                 owner-gated contract in this repo uses:
 *                 0x2977F5339157E7f6341f09D6F48811B9D1F67C42
 */
contract DeployKevinNFT is Script {
    function run() external returns (KevinNFT nft) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address kevin = vm.envOr("KEVIN_TOKEN", address(0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A));
        address kek = vm.envOr("KEK_TOKEN", address(0x5a3544a0328afD50A9979e03404F35c555B88c00));
        address weth = vm.envOr("WETH_TOKEN", address(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73));
        address owner = vm.envOr("NFT_OWNER", address(0x2977F5339157E7f6341f09D6F48811B9D1F67C42));
        string memory baseURI = vm.envOr("BASE_URI", string("ipfs://TODO-not-hosted-yet/"));

        vm.startBroadcast(pk);
        nft = new KevinNFT(kevin, kek, weth, baseURI, owner);
        vm.stopBroadcast();

        console2.log("KevinNFT   ", address(nft));
        console2.log("KEVIN      ", kevin);
        console2.log("KEK        ", kek);
        console2.log("WETH       ", weth);
        console2.log("baseURI    ", baseURI);
        console2.log("owner      ", owner);
        console2.log("");
        console2.log("Nothing is priced or loaded yet. From the owner:");
        console2.log("  1. node tools/mint-model-burn.mjs        review the ladder before it goes on chain");
        console2.log("  2. NFT_ADDRESS=<above> node tools/load-nft-tiers.mjs --set-prices --load");
        console2.log("     sets all five burn amounts and loads all 1,000 token ids, chunked");
        console2.log("  3. Read the contract back. remaining(tier) should read 400/300/200/75/25.");
        console2.log("  4. Only then, by hand: lockTiers() -- irreversible, prices and ids frozen forever");
        console2.log("  5. openMint() -- irreversible in the sense that a closed mint cannot un-happen");
        console2.log("     for whoever already minted, though openMint itself has no close counterpart");
        console2.log("");
        console2.log("BASE_URI above is a placeholder unless you set one. Do not lockTiers() against it");
        console2.log("if you intend to mint before real metadata is hosted -- setBaseURI stays open");
        console2.log("after lock, so this alone is not blocking, just don't forget it.");
    }
}
