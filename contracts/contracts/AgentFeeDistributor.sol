// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./TimelockedRescue.sol";

interface INFTAwake {
    function isAwake(uint256 tokenId) external view returns (bool);
}

interface IERC6551RegistryView {
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external view returns (address);
}

/// @title AgentFeeDistributor
/// @notice Receives 10% of all $TRENCHERS trading fees and pays them out, in equal shares, into the
///         wallet of every registered Trenchers agent. Nothing to claim or stake: anyone (normally a
///         keeper) can push an agent's share once an epoch closes.
///
///         Enrolment: once a Trencher's agent wallet exists, anyone can call enroll(tokenId). The agent
///         earns from the next epoch on. Each epoch's pot is split by the number of agents enrolled
///         before it began, and that amount is reserved until paid, so late payments are always covered.
contract AgentFeeDistributor is ReentrancyGuard, TimelockedRescue {
    uint256 public constant EPOCH = 7 days;
    uint256 public constant MAX_ID = 2000;

    IERC6551RegistryView public immutable registry;
    address public immutable nft;
    address public accountImplementation;
    bytes32 public accountSalt;

    uint256 public epoch;            // the epoch currently collecting fees
    uint256 public epochStart;
    uint256 public activeAgents;     // agents earning in the current epoch
    uint256 public joiningNext;      // agents enrolled during this epoch, earning from the next
    uint256 public reserved;         // ETH owed to agents for closed epochs, not yet paid

    mapping(uint256 => uint256) public enrolledFrom;   // tokenId => first epoch it earns in (0 = never)
    mapping(uint256 => uint256) public sharePerAgent;  // closed epoch => ETH per agent
    mapping(uint256 => mapping(uint256 => bool)) public paid; // epoch => tokenId => paid

    event AccountSet(address implementation, bytes32 salt);
    event Funded(address indexed from, uint256 amount);
    event Enrolled(uint256 indexed tokenId, uint256 fromEpoch);
    event EpochClosed(uint256 indexed epoch, uint256 pot, uint256 agents, uint256 perAgent);
    event Paid(uint256 indexed epoch, uint256 indexed tokenId, address wallet, uint256 amount);
    event PayFailed(uint256 indexed epoch, uint256 indexed tokenId);

    error AlreadySet();
    error ZeroAddress();
    error NotOpen();
    error BadToken();
    error NotRegistered();
    error NotAwake();
    error AlreadyEnrolled();
    error TooEarly();
    error NotEligible();
    error AlreadyPaid();
    error TransferFailed();

    constructor(address owner_, IERC6551RegistryView registry_, address nft_, uint256 rescueDelay_) TimelockedRescue(rescueDelay_) {
        if (owner_ == address(0) || address(registry_) == address(0) || nft_ == address(0)) revert ZeroAddress();
        _transferOwnership(owner_);
        registry = registry_;
        nft = nft_;
        epoch = 1;
        epochStart = block.timestamp;
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    /// @notice One-time: the ERC-6551 account implementation and salt agent wallets use.
    function setAccount(address implementation, bytes32 salt) external onlyOwner {
        if (accountImplementation != address(0)) revert AlreadySet();
        if (implementation == address(0)) revert ZeroAddress();
        accountImplementation = implementation;
        accountSalt = salt;
        emit AccountSet(implementation, salt);
    }

    function agentWallet(uint256 tokenId) public view returns (address) {
        if (accountImplementation == address(0)) revert NotOpen();
        return registry.account(accountImplementation, accountSalt, block.chainid, nft, tokenId);
    }

    /// @notice Registers a Trencher whose agent wallet exists. It earns from the next epoch.
    function enroll(uint256 tokenId) external notShutdown {
        if (tokenId == 0 || tokenId > MAX_ID) revert BadToken();
        if (enrolledFrom[tokenId] != 0) revert AlreadyEnrolled();
        if (agentWallet(tokenId).code.length == 0) revert NotRegistered();
        // Only Trenchers that exist and are awake (house agents count as awake) share the fees.
        IERC721(nft).ownerOf(tokenId);
        if (!INFTAwake(nft).isAwake(tokenId)) revert NotAwake();
        enrolledFrom[tokenId] = epoch + 1;
        joiningNext += 1;
        emit Enrolled(tokenId, epoch + 1);
    }

    /// @notice Closes the current epoch once it has run for EPOCH. Callable by anyone.
    function closeEpoch() external notShutdown {
        if (block.timestamp < epochStart + EPOCH) revert TooEarly();
        uint256 pot = address(this).balance - reserved;
        uint256 per = activeAgents == 0 ? 0 : pot / activeAgents;
        sharePerAgent[epoch] = per;
        reserved += per * activeAgents;
        emit EpochClosed(epoch, pot, activeAgents, per);
        activeAgents += joiningNext;
        joiningNext = 0;
        epoch += 1;
        epochStart = block.timestamp;
    }

    /// @notice Pays a closed epoch's share into each listed agent's wallet. Callable by anyone.
    function pay(uint256 closedEpoch, uint256[] calldata tokenIds) external nonReentrant notShutdown {
        if (closedEpoch >= epoch) revert TooEarly();
        uint256 per = sharePerAgent[closedEpoch];
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 id = tokenIds[i];
            uint256 from = enrolledFrom[id];
            // Skip (don't revert) so one ineligible or already-paid id can't block a whole batch.
            if (from == 0 || from > closedEpoch || paid[closedEpoch][id]) continue;
            paid[closedEpoch][id] = true;
            if (per == 0) continue;
            address w = agentWallet(id);
            (bool ok, ) = w.call{value: per}("");
            if (!ok) { paid[closedEpoch][id] = false; emit PayFailed(closedEpoch, id); continue; } // stays reserved for a retry
            reserved -= per;
            emit Paid(closedEpoch, id, w, per);
        }
    }
}
