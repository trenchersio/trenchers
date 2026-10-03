// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Test-only ERC-6551 registry with the same account bytecode layout as the canonical v0.3
///      registry: an ERC-1167 proxy followed by (salt, chainId, tokenContract, tokenId).
contract MockERC6551Registry {
    event AccountCreated(address account, address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId);

    function _code(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(salt, chainId, tokenContract, tokenId)
        );
    }

    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address a) {
        a = account(implementation, salt, chainId, tokenContract, tokenId);
        if (a.code.length > 0) return a;
        bytes memory code = _code(implementation, salt, chainId, tokenContract, tokenId);
        assembly { a := create2(0, add(code, 0x20), mload(code), salt) }
        require(a != address(0), "create2");
        emit AccountCreated(a, implementation, salt, chainId, tokenContract, tokenId);
    }

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) public view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(_code(implementation, salt, chainId, tokenContract, tokenId))));
        return address(uint160(uint256(h)));
    }
}

/// @dev A stand-in DEX router / launcher that records calls and can pay ETH back.
contract MockRouter {
    uint256 public calls;
    uint256 public lastValue;
    function swap() external payable { calls++; lastValue = msg.value; }
    function launch() external payable { calls++; lastValue = msg.value; }
    receive() external payable {}
}
