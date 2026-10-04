// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Test-only stand-ins for the ERC-6551 registry and an agent wallet.
contract MockAgentWallet {
    receive() external payable {}
}

contract MockRegistry {
    mapping(uint256 => address) public wallets;
    function setWallet(uint256 tokenId, address wallet) external { wallets[tokenId] = wallet; }
    function createAccount(address, bytes32, uint256, address, uint256 tokenId) external returns (address) {
        if (wallets[tokenId] == address(0)) wallets[tokenId] = address(new MockAgentWallet());
        return wallets[tokenId];
    }
    function account(address, bytes32, uint256, address, uint256 tokenId) external view returns (address) {
        address w = wallets[tokenId];
        return w == address(0) ? address(uint160(uint256(keccak256(abi.encode(tokenId))))) : w;
    }
}

/// @dev Forces ETH into a contract without calling it (selfdestruct in the creating transaction).
contract ForceSend {
    constructor(address payable to) payable { selfdestruct(to); }
}

/// @dev A minimal marketplace for tests: the buyer pays ETH, the seller (who approved it) gets paid.
contract MockMarket {
    function buy(address nft, uint256 id, address payable seller) external payable {
        IERC721Like(nft).transferFrom(seller, msg.sender, id);
        (bool ok, ) = seller.call{value: msg.value}("");
        require(ok, "pay");
    }
}

interface IERC721Like { function transferFrom(address from, address to, uint256 id) external; }

/// @dev Stands in for a Safe in launch tests (only what the launch page reads).
contract MockSafe {
    function getThreshold() external pure returns (uint256) { return 2; }
    function getOwners() external pure returns (address[] memory o) { o = new address[](2); o[0] = address(0x5a1); o[1] = address(0x5a2); }
}
