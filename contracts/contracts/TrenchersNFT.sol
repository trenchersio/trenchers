// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@limitbreak/creator-token-standards/src/erc721c/ERC721C.sol";
import "@limitbreak/creator-token-standards/src/access/OwnableBasic.sol";
import "@limitbreak/creator-token-standards/src/programmable-royalties/BasicRoyalties.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IStarterFundView {
    function claimed(uint256 tokenId) external view returns (bool);
}

interface IRevenueSplitterRelease {
    function release(uint8 bucket) external;
}

/// @title Trenchers
/// @notice 2,000 trading agents on Robinhood Chain. Each token can be registered as an on-chain
///         trading agent through its ERC-6551 token-bound account.
/// @dev    IDs 1-5 go to the team (house agents) at deploy. The other 1,995 are minted by anyone on
///         trenchers.io at a fixed price; every mint's ETH goes straight to the RevenueSplitter as a
///         primary sale, and the agent's half moves on to the Agent Starter Fund in the same transaction.
///         Resales happen on OpenSea. ERC721-C (Limit Break) so OpenSea can enforce creator earnings.
contract TrenchersNFT is OwnableBasic, ERC721C, BasicRoyalties {
    using Strings for uint256;

    /// @notice The first collection: 2,000 Trenchers.
    uint256 public constant FIRST_ROUND = 2000;
    /// @notice Current supply cap. Starts at 2,000; the owner can raise it for a later round, never lower it.
    uint256 public maxSupply = FIRST_ROUND;
    uint256 public constant TEAM_RESERVE = 5;
    uint96 public constant ROYALTY_BPS = 500; // 5%
    uint256 public constant MAX_PER_TX = 10;
    uint8 private constant STARTER_BUCKET = 3;

    /// @notice Mint price per Trencher (0.02 ETH on mainnet), fixed at deploy.
    uint256 public immutable mintPrice;
    /// @notice Where mint proceeds go: the RevenueSplitter (also the royalty receiver).
    address payable public immutable splitter;
    bool public mintOpen;

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
    event MintOpened(bool open);
    event Minted(address indexed to, uint256 firstId, uint256 quantity, uint256 paid);
    event MaxSupplyRaised(uint256 maxSupply);
    /// @dev EIP-4906 single-token refresh, emitted when a Trencher wakes up.
    event MetadataUpdate(uint256 tokenId);

    error SoldOut();
    error ZeroQuantity();
    error Frozen();
    error ZeroAddress();
    error AlreadySet();
    error NotStarterFund();
    error MintClosed();
    error WrongPrice();
    error TooMany();
    error TransferFailed();
    error FirstRoundIsPublic();
    error OutOfGas();

    constructor(
        address royaltyReceiver_,
        address team_,
        string memory preRevealURI_,
        string memory contractURI_,
        uint256 mintPrice_
    )
        ERC721OpenZeppelin("Trenchers", "TRENCH")
        BasicRoyalties(royaltyReceiver_, ROYALTY_BPS)
    {
        if (royaltyReceiver_ == address(0) || team_ == address(0)) revert ZeroAddress();
        if (mintPrice_ == 0) revert WrongPrice();
        mintPrice = mintPrice_;
        splitter = payable(royaltyReceiver_);
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

    /// @notice Public mint on trenchers.io: up to 10 per transaction at `mintPrice` each, while open.
    ///         The ETH goes to the RevenueSplitter as a primary sale; the agent's half is released to the
    ///         Agent Starter Fund right away, so the new holder can awaken their Trencher straight after.
    function mint(uint256 quantity) external payable {
        if (!mintOpen) revert MintClosed();
        if (quantity == 0) revert ZeroQuantity();
        if (quantity > MAX_PER_TX) revert TooMany();
        if (msg.value != mintPrice * quantity) revert WrongPrice();
        uint256 supply = totalSupply;
        if (supply + quantity > maxSupply) revert SoldOut();
        totalSupply = supply + quantity;
        for (uint256 i = 1; i <= quantity; ++i) {
            _mint(msg.sender, supply + i);
        }
        emit Minted(msg.sender, supply + 1, quantity, msg.value);
        (bool ok, ) = splitter.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        // Best effort: if the starter destination isn't set yet, the share waits in the splitter
        // (anyone can release it later). The gas check makes sure a wallet's gas estimate leaves
        // enough for the release: without it, an estimate that starves the inner call still
        // "succeeds" and the agent's half would silently stay behind.
        uint256 gasBefore = gasleft();
        try IRevenueSplitterRelease(splitter).release(STARTER_BUCKET) {} catch {
            if (gasleft() <= gasBefore / 63) revert OutOfGas();
        }
    }

    /// @notice Opens or pauses the public mint.
    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpened(open);
    }

    /// @notice Free mint by the owner, only for a later round: the first 2,000 are minted publicly,
    ///         so every one of them is paid for and funds its own starter balance.
    function ownerMint(address to, uint256 quantity) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (quantity == 0) revert ZeroQuantity();
        uint256 supply = totalSupply;
        if (supply < FIRST_ROUND) revert FirstRoundIsPublic();
        if (supply + quantity > maxSupply) revert SoldOut();
        totalSupply = supply + quantity;
        for (uint256 i = 1; i <= quantity; ++i) {
            _mint(to, supply + i);
        }
    }

    // ------------------------------------------------------------------ admin

    /// @notice Raises the supply cap for a later round. Can only go up.
    function raiseMaxSupply(uint256 newMax) external onlyOwner {
        if (newMax <= maxSupply) revert ZeroQuantity();
        maxSupply = newMax;
        emit MaxSupplyRaised(newMax);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        if (metadataFrozen) revert Frozen();
        _baseTokenURI = baseURI_;
        emit BaseURIChanged(baseURI_);
        emit BatchMetadataUpdate(1, maxSupply);
    }

    /// @notice One-time link to the Agent Starter Fund, which switches metadata to dormant/awake.
    function setStarterFund(address fund) external onlyOwner {
        if (starterFund != address(0)) revert AlreadySet();
        if (fund == address(0)) revert ZeroAddress();
        starterFund = fund;
        emit StarterFundSet(fund);
        emit BatchMetadataUpdate(1, maxSupply);
    }

    /// @notice Called by the starter fund when a Trencher's starter balance is claimed, so
    ///         marketplaces refresh it from dormant to awake.
    function notifyAwake(uint256 tokenId) external {
        if (msg.sender != starterFund) revert NotStarterFund();
        emit MetadataUpdate(tokenId);
    }

    /// @notice True once the Trencher's agent has claimed its starter balance (house agents always).
    function isAwake(uint256 tokenId) public view returns (bool) {
        if (tokenId <= TEAM_RESERVE || tokenId > FIRST_ROUND) return true;
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
