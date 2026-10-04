// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC721Min {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function totalSupply() external view returns (uint256);
}

interface ISplitterMin {
    function release(uint8 bucket) external;
}

/// @title TestnetSale
/// @notice Testnet stand-in for the OpenSea listing. It holds the treasury's Trenchers and sells
///         the next one at a fixed price. The sale ETH goes to the RevenueSplitter as a primary sale
///         (this contract is the splitter's primary seller), and the starter share is released to
///         the Agent Starter Fund straight away, so the buyer can awaken their Trencher right after.
/// @dev    Not for mainnet: on mainnet the treasury lists on OpenSea and forwards proceeds itself.
contract TestnetSale {
    IERC721Min public immutable nft;
    address payable public immutable splitter;
    uint256 public immutable price;
    uint256 public cursor = 6; // ids 1-5 are the house agents

    event Bought(address indexed buyer, uint256 indexed tokenId, uint256 price);

    error WrongPrice();
    error SoldOut();
    error TransferFailed();

    constructor(IERC721Min nft_, address payable splitter_, uint256 price_) {
        nft = nft_;
        splitter = splitter_;
        price = price_;
    }

    /// @notice Buys the next unsold Trencher.
    function buy() external payable returns (uint256 tokenId) {
        if (msg.value != price) revert WrongPrice();
        uint256 supply = nft.totalSupply();
        tokenId = cursor;
        while (tokenId <= supply && nft.ownerOf(tokenId) != address(this)) ++tokenId;
        if (tokenId > supply) revert SoldOut();
        cursor = tokenId + 1;
        nft.transferFrom(address(this), msg.sender, tokenId);
        (bool ok, ) = splitter.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        ISplitterMin(splitter).release(3); // Bucket.Starter
        emit Bought(msg.sender, tokenId, msg.value);
    }

    /// @notice How many Trenchers are still for sale.
    function available() external view returns (uint256 n) {
        uint256 supply = nft.totalSupply();
        for (uint256 i = cursor; i <= supply; ++i) if (nft.ownerOf(i) == address(this)) ++n;
    }
}
