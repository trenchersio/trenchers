// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../TrenchersAgentAccount.sol";

/// @dev A "fixed" agent wallet version for upgrade tests: same storage, one new function.
contract AgentAccountV2Mock is TrenchersAgentAccount {
    constructor(IAgentConfig config_, address fund_) TrenchersAgentAccount(config_, fund_) {}
    function versionTwo() external pure returns (uint256) { return 2; }
}
