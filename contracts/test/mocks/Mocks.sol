// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev Plain ERC-20 with an open mint. Stands in for $KEVIN.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Plain ERC-721 with an open mint. Stands in for KEVIN'S CREW.
contract MockERC721 is ERC721 {
    constructor() ERC721("KEVIN'S CREW", "CREW") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function mintBatch(address to, uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            _mint(to, ids[i]);
        }
    }
}

interface ITokenHook {
    function onTokenMoved() external;
}

/**
 * @dev ERC-20 that calls back into a registered hook whenever it moves tokens
 *      to that hook's address. This is the ERC-777-shaped footgun that breaks
 *      naive staking contracts; here it is used to prove the guard holds.
 */
contract HookERC20 is ERC20 {
    address public hook;
    bool public hookEnabled;

    constructor() ERC20("Hook KEVIN", "hKEVIN") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHook(address hook_, bool enabled) external {
        hook = hook_;
        hookEnabled = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hookEnabled && to == hook && hook != address(0)) {
            ITokenHook(hook).onTokenMoved();
        }
    }
}
