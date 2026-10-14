// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice ERC-8004 identity registry stand-in: an agent is an ERC-721, ids start at 1, minted to the caller.
contract MockAgentRegistry is ERC721 {
    uint256 public nextId = 1;
    mapping(uint256 => string) public agentURI;

    constructor() ERC721("Agent Identity", "AGENT") {}

    function register(string calldata uri) external returns (uint256 agentId) {
        agentId = nextId++;
        _safeMint(msg.sender, agentId);
        agentURI[agentId] = uri;
    }
}
