// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@limitbreak/creator-token-standards/src/erc721c/ERC721C.sol";
import "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IStarterFundView {
    function claimed(uint256 tokenId) external view returns (bool);
}

/// @title Trenchers
/// @notice 2,000 trading agents on Robinhood Chain. Each token can be registered as an on-chain
///         trading agent through its ERC-6551 token-bound account.
/// @dev    There is no public mint. The owner mints every token for free: IDs 1-5 to the team
///         (house agents) at deploy, the other 1,995 in batches to the treasury, which lists them
///         on OpenSea. ERC721-C (Limit Break) so OpenSea can enforce creator earnings.
contract TrenchersNFT is OwnableBasic, ERC721C, BasicRoyalties {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 2000;
    uint256 public constant TEAM_RESERVE = 5;
    uint96 public constant ROYALTY_BPS = 500; // 5%

    uint256 public totalSupply;

    string private _baseTokenURI;
    string private _preRevealURI;
    string private _contractURI;
    bool public metadataFrozen;

    /// @notice The Agent Starter Fund. Once set, metadata follows each token's state:
    ///         dormant (grey art, 0.01 ETH still claimable) until its starter balance is claimed,
    ///         then awake (full colour). House agents #1-#5 are always awake.
    address public starterFund;

    event BaseURIChanged(string baseURI);
    event MetadataFrozen();
    event StarterFundSet(address fund);
    /// @dev EIP-4906 single-token refresh, emitted when a Trencher wakes up.
    event MetadataUpdate(uint256 tokenId);

    error SoldOut();
    error ZeroQuantity();
    error Frozen();
    error ZeroAddress();
    error AlreadySet();
    error NotStarterFund();

    constructor(
        address royaltyReceiver_,
        address team_,
        string memory preRevealURI_,
        string memory contractURI_
    )
        ERC721OpenZeppelin("Trenchers", "TRENCH")
        BasicRoyalties(royaltyReceiver_, ROYALTY_BPS)
    {
        if (royaltyReceiver_ == address(0) || team_ == address(0)) revert ZeroAddress();
        _preRevealURI = preRevealURI_;
        _contractURI = contractURI_;

        // If Limit Break's default transfer validator is not deployed on this chain, a call to it
        // would revert every transfer. Fall back to no validator until one is configured.
        if (DEFAULT_TRANSFER_VALIDATOR.code.length == 0) {
            setTransferValidator(address(0));
        }

        // Token IDs 1-5 go to the team: the house agents, never sold.
        for (uint256 i = 1; i <= TEAM_RESERVE; ++i) {
            _mint(team_, i);
        }
        totalSupply = TEAM_RESERVE;
    }

    // ------------------------------------------------------------------ minting

    /// @notice Free mint by the owner, in batches, to the treasury that lists them on OpenSea.
    function ownerMint(address to, uint256 quantity) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (quantity == 0) revert ZeroQuantity();
        uint256 supply = totalSupply;
        if (supply + quantity > MAX_SUPPLY) revert SoldOut();
        totalSupply = supply + quantity;
        for (uint256 i = 1; i <= quantity; ++i) {
            _mint(to, supply + i);
        }
    }

    // ------------------------------------------------------------------ admin

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        if (metadataFrozen) revert Frozen();
        _baseTokenURI = baseURI_;
        emit BaseURIChanged(baseURI_);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice One-time link to the Agent Starter Fund, which switches metadata to dormant/awake.
    function setStarterFund(address fund) external onlyOwner {
        if (starterFund != address(0)) revert AlreadySet();
        if (fund == address(0)) revert ZeroAddress();
        starterFund = fund;
        emit StarterFundSet(fund);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice Called by the starter fund when a Trencher's starter balance is claimed, so
    ///         marketplaces refresh it from dormant to awake.
    function notifyAwake(uint256 tokenId) external {
        if (msg.sender != starterFund) revert NotStarterFund();
        emit MetadataUpdate(tokenId);
    }

    /// @notice True once the Trencher's agent has claimed its starter balance (house agents always).
    function isAwake(uint256 tokenId) public view returns (bool) {
        if (tokenId <= TEAM_RESERVE) return true;
        return starterFund != address(0) && IStarterFundView(starterFund).claimed(tokenId);
    }

    /// @notice Freezing locks the base URI; the dormant/awake switch keeps working, by design.
    function freezeMetadata() external onlyOwner {
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function setContractURI(string calldata contractURI_) external onlyOwner {
        _contractURI = contractURI_;
    }

    /// @notice Royalty receiver can be moved (e.g. a new splitter); the 5% rate is fixed.
    function setRoyaltyReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        _setDefaultRoyalty(receiver, ROYALTY_BPS);
    }

    // ------------------------------------------------------------------ metadata

    /// @dev EIP-4906 so marketplaces refresh after reveal.
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);
        if (bytes(_baseTokenURI).length == 0) return _preRevealURI;
        if (starterFund == address(0)) return string.concat(_baseTokenURI, tokenId.toString(), ".json");
        return string.concat(_baseTokenURI, isAwake(tokenId) ? "awake/" : "dormant/", tokenId.toString(), ".json");
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    // ------------------------------------------------------------------ plumbing

    function supportsInterface(bytes4 interfaceId) public view override(ERC721C, ERC2981) returns (bool) {
        return interfaceId == bytes4(0x49064906) // EIP-4906
            || ERC721C.supportsInterface(interfaceId)
            || ERC2981.supportsInterface(interfaceId);
    }
}
