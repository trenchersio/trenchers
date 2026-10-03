// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Test-only stand-ins for the ERC-6551 registry and an agent wallet.
contract MockAgentWallet {
    receive() external payable {}
}

contract MockRegistry {
    mapping(uint256 => address) public wallets;
    function setWallet(uint256 tokenId, address wallet) external { wallets[tokenId] = wallet; }
    function account(address, bytes32, uint256, address, uint256 tokenId) external view returns (address) {
        address w = wallets[tokenId];
        return w == address(0) ? address(uint160(uint256(keccak256(abi.encode(tokenId))))) : w;
    }
}
