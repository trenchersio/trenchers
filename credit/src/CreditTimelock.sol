// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title CreditTimelock
/// @notice Owner of Trenchers Credit: every change of terms waits 48 hours in public. The team Safe proposes and
///         executes; there is no admin.
contract CreditTimelock is TimelockController {
    constructor(address safe)
        TimelockController(48 hours, _one(safe), _one(safe), address(0))
    {}

    function _one(address a) private pure returns (address[] memory l) {
        l = new address[](1);
        l[0] = a;
    }
}
