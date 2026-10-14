// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The ERC-8004 identity registry: an agent is an ERC-721 token, its id is the agent id.
interface IAgentRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function register(string calldata agentURI) external returns (uint256 agentId);
}

/// @notice Wrapped ETH. The pool keeps its books in WETH so every amount is an ordinary ERC-20 balance.
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @notice What a backer contract implements to take part in the pool's decisions and hear about its lines.
interface ILineHook {
    function canBorrow(
        uint256 backerId,
        uint256 agentId,
        uint256 amount,
        uint64 term,
        uint256 fee,
        address caller,
        address owner,
        address to
    ) external view returns (bool);
    function onBorrow(uint256 backerId, uint256 agentId, uint256 loanId) external;
    function onDefault(uint256 backerId, uint256 agentId, uint256 loanId, uint256 principal, bool lastLoan) external;
    function onRelease(uint256 backerId, uint256 agentId, uint256 amount, uint8 reason) external;
}
