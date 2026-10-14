// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A mintable stand-in for $TRENCHERS. Transfers to 0x…dEaD can be switched off to make a burn fail.
contract MockToken is ERC20 {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bool public blockDead;

    error DeadBlocked();

    constructor() ERC20("Trenchers", "TRENCHERS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlockDead(bool b) external {
        blockDead = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blockDead && to == DEAD) revert DeadBlocked();
        super._update(from, to, value);
    }
}
