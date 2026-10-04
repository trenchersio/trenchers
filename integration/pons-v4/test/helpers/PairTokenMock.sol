// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A plain 18-decimal ERC-20 used as an approved non-ETH Pons pair token (to check the adapter rejects it).
contract PairTokenMock is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {
        _mint(msg.sender, 1e30);
    }
}
