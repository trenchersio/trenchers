// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface INFTNotify {
    function notifyAwake(uint256 tokenId) external;
}

interface IERC6551Registry {
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external view returns (address);
}

/// @title AgentStarterFund
/// @notice Every Trencher sells for 0.1 ETH. Half of each primary sale is set aside here so the
///         buyer can give their agent a 0.05 ETH starter balance: enough to launch its own coin
///         on Pons and start trading.
///
///         The holder registers the Trencher (its ERC-6551 agent wallet is deployed), then calls
///         claim(tokenId). The fund pays CLAIM straight into that Trencher's agent wallet, never to
///         a person. Each Trencher can be claimed once, ever. House agents #1-#5 and the treasury
///         that lists the collection cannot claim. A Trencher resold before claiming can still be
///         claimed by its new holder.
///
///         The agent wallet implementation treats ETH arriving from this contract as a locked
///         starter balance: it can pay for a coin launch or trades, but not be withdrawn.
///
/// @dev    Solvency: the fund always keeps CLAIM for every Trencher not yet claimed. Only ETH above
///         that reserve (e.g. what remains once marketplace fees are covered) can be released, and
///         only to the excess destination (the buyback vault).
contract AgentStarterFund is Ownable, ReentrancyGuard {
    uint256 public constant CLAIM = 0.05 ether;
    uint256 public constant FIRST_ID = 6;      // #1-#5 are house agents
    uint256 public constant LAST_ID = 2000;
    uint256 public constant ELIGIBLE = LAST_ID - FIRST_ID + 1; // 1,995

    IERC721 public immutable nft;
    IERC6551Registry public immutable registry;
    address public immutable treasury;

    address public accountImplementation; // set once, when the agent wallet contract is deployed
    bytes32 public accountSalt;
    address payable public excessTo;      // set once: the buyback vault

    mapping(uint256 => bool) public claimed;
    uint256 public claimedCount;
    uint256 public totalClaimed;

    event Funded(address indexed from, uint256 amount);
    event Claimed(uint256 indexed tokenId, address indexed holder, address indexed agentWallet, uint256 amount);
    event AccountSet(address implementation, bytes32 salt);
    event ExcessToSet(address to);
    event ExcessReleased(address to, uint256 amount);

    error NotEligible();
    error AlreadyClaimed();
    error NotHolder();
    error TreasuryCannotClaim();
    error NotRegistered();
    error NotOpen();
    error Underfunded();
    error AlreadySet();
    error ZeroAddress();
    error NothingToRelease();
    error TransferFailed();

    constructor(address owner_, IERC721 nft_, IERC6551Registry registry_, address treasury_) {
        if (owner_ == address(0) || address(nft_) == address(0) || address(registry_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        _transferOwnership(owner_);
        nft = nft_;
        registry = registry_;
        treasury = treasury_;
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    /// @notice One-time: the ERC-6551 account implementation and salt that agent wallets use.
    function setAccount(address implementation, bytes32 salt) external onlyOwner {
        if (accountImplementation != address(0)) revert AlreadySet();
        if (implementation == address(0)) revert ZeroAddress();
        accountImplementation = implementation;
        accountSalt = salt;
        emit AccountSet(implementation, salt);
    }

    /// @notice One-time: where ETH above the claim reserve goes (the buyback vault).
    function setExcessTo(address payable to) external onlyOwner {
        if (excessTo != address(0)) revert AlreadySet();
        if (to == address(0)) revert ZeroAddress();
        excessTo = to;
        emit ExcessToSet(to);
    }

    /// @notice The agent wallet address of a Trencher (deterministic, exists once registered).
    function agentWallet(uint256 tokenId) public view returns (address) {
        if (accountImplementation == address(0)) revert NotOpen();
        return registry.account(accountImplementation, accountSalt, block.chainid, address(nft), tokenId);
    }

    /// @notice Pays the 0.05 ETH starter balance into a registered Trencher's agent wallet.
    function claim(uint256 tokenId) external nonReentrant {
        if (tokenId < FIRST_ID || tokenId > LAST_ID) revert NotEligible();
        if (claimed[tokenId]) revert AlreadyClaimed();
        if (msg.sender == treasury) revert TreasuryCannotClaim();
        if (nft.ownerOf(tokenId) != msg.sender) revert NotHolder();
        address wallet = agentWallet(tokenId);
        if (wallet.code.length == 0) revert NotRegistered();
        if (address(this).balance < CLAIM) revert Underfunded();

        claimed[tokenId] = true;
        claimedCount += 1;
        totalClaimed += CLAIM;
        (bool ok, ) = wallet.call{value: CLAIM}("");
        if (!ok) revert TransferFailed();
        emit Claimed(tokenId, msg.sender, wallet, CLAIM);
        // Wake the NFT: its metadata switches from dormant (grey) to awake (colour).
        try INFTNotify(address(nft)).notifyAwake(tokenId) {} catch {}
    }

    /// @notice ETH the fund must keep for Trenchers that have not claimed yet.
    function reserve() public view returns (uint256) {
        return CLAIM * (ELIGIBLE - claimedCount);
    }

    function excess() public view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 r = reserve();
        return bal > r ? bal - r : 0;
    }

    /// @notice Sends ETH above the reserve to the buyback vault. Callable by anyone.
    function releaseExcess() external nonReentrant {
        address payable to = excessTo;
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = excess();
        if (amount == 0) revert NothingToRelease();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ExcessReleased(to, amount);
    }
}
