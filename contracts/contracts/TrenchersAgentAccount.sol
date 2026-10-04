// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IERC6551Account {
    receive() external payable;
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
    function state() external view returns (uint256);
    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4 magicValue);
}

interface IERC6551Executable {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes memory);
}

/// @dev TrenchersNFT counts every transfer of each token; a policy is only live for the transfer it was set under.
interface ITransferCount {
    function transferCount(uint256 tokenId) external view returns (uint256);
}

interface IAgentConfig {
    function engine() external view returns (address);
    function router() external view returns (address);
    function launcher() external view returns (address);
    function starterFund() external view returns (address);
    function paused() external view returns (bool);
}

/// @title TrenchersAgentAccount
/// @notice Agent wallet logic, version 1. Agent wallets are TrenchersAgentWallet instances that run the
///         current version from AgentConfig, so this code can be replaced by a fixed version after
///         launch (48-hour public timelock). Storage layout: later versions only append.
/// @notice The wallet of a Trenchers agent: an ERC-6551 token-bound account owned by whoever holds
///         the NFT. The rule: the trading engine can make the agent trade, but can never take its money.
///
///         Holder:  applies guided rules and limits, pauses, withdraws instantly, launches
///                  the agent's coin, and has full control once the starter lock has ended.
///         Engine:  may only call the configured router, with ETH up to the holder's per-trade and daily
///                  caps, and approve that router for tokens it sells. Only while the holder's policy is
///                  live and was set by the current holder (a sale pauses trading automatically).
///         Starter: ETH received from the Agent Starter Fund is locked: it can pay for the coin launch
///                  and trades, but the holder cannot withdraw it until STARTER_LOCK has passed. During
///                  the lock, withdrawals can't take the wallet below the starter amount, and the holder
///                  can't move tokens out (so coins bought with the starter can't be cashed out early).
contract TrenchersAgentAccount is IERC165, IERC1271, IERC6551Account, IERC6551Executable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STARTER_LOCK = 180 days;
    /// @notice Agent wallet code version (fixed versions count up).
    uint256 public constant VERSION = 1;

    IAgentConfig public immutable config;

    uint256 private _state;

    struct Policy {
        uint128 perTrade;   // max ETH per engine trade
        uint128 dailyCap;   // max ETH the engine may spend per UTC day
        bool live;          // trading switched on
        address setBy;      // holder who set it; stale (paused) once the NFT changes hands
    }
    Policy public policy;
    uint32 public ruleVersion;
    bytes32 public ruleHash;     // hash of the applied guided rule (the rule text lives off-chain at ruleUri)
    uint256 public spentDay;     // day index of `spentToday`
    uint256 public spentToday;

    uint256 public starterLocked;   // ETH from the starter fund not yet unlocked
    uint256 public starterLockedAt; // when the starter balance arrived
    address public coin;            // the agent's own coin, if launched (the engine must never trade it)
    /// @notice The NFT's transfer count when the policy was set: if the Trencher has moved since (even
    ///         back to the same holder), the policy is stale and trading stays paused until it is set again.
    uint256 public policyTransfers;


    event PolicySet(address indexed holder, uint128 perTrade, uint128 dailyCap, bool live);
    event RuleApplied(uint32 indexed version, bytes32 ruleHash, string ruleUri);
    event Traded(uint256 value, bytes4 selector);
    event StarterReceived(uint256 amount);
    event CoinLaunched(address indexed coin);
    event Withdrawn(address indexed to, uint256 amount);

    error NotHolder();
    error NotEngine();
    error NotAllowed();
    error PolicyStale();
    error Paused();
    error OverPerTrade();
    error OverDailyCap();
    error StarterLocked();
    error NoWithdrawal();
    error TooEarly();
    error CallFailed(bytes reason);
    error TradingPaused();

    constructor(IAgentConfig config_) { config = config_; }

    // ------------------------------------------------------------------ ERC-6551

    receive() external payable {
        if (msg.sender == config.starterFund() && msg.value > 0) {
            starterLocked += msg.value;
            if (starterLockedAt == 0) starterLockedAt = block.timestamp;
            emit StarterReceived(msg.value);
        }
    }

    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(0x60);
        assembly { extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60) }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function state() external view returns (uint256) { return _state; }

    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        return signer == owner() ? IERC6551Account.isValidSigner.selector : bytes4(0);
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return SignatureChecker.isValidSignatureNow(owner(), hash, signature) ? IERC1271.isValidSignature.selector : bytes4(0);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId || id == type(IERC6551Account).interfaceId
            || id == type(IERC6551Executable).interfaceId || id == type(IERC1271).interfaceId;
    }

    /// @dev Refuses its own Trencher: an NFT held by its own agent wallet could never be moved again.
    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        (uint256 chainId, address tokenContract, uint256 ownId) = token();
        if (msg.sender == tokenContract && tokenId == ownId && chainId == block.chainid) revert NotAllowed();
        return this.onERC721Received.selector;
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { return this.onERC1155Received.selector; }

    // ------------------------------------------------------------------ views

    /// @notice Starter ETH that is still locked (zero once STARTER_LOCK has passed).
    function lockedNow() public view returns (uint256) {
        if (starterLocked == 0 || block.timestamp >= starterLockedAt + STARTER_LOCK) return 0;
        return starterLocked < address(this).balance ? starterLocked : address(this).balance;
    }

    /// @notice True during the 180 days after the starter balance arrived.
    function inStarterLock() public view returns (bool) {
        return starterLockedAt != 0 && block.timestamp < starterLockedAt + STARTER_LOCK;
    }

    /// @dev How many times this agent's Trencher has been transferred (0 if the NFT doesn't count).
    function _transfers() internal view returns (uint256 n) {
        (, address tokenContract, uint256 tokenId) = token();
        try ITransferCount(tokenContract).transferCount(tokenId) returns (uint256 c) { n = c; } catch {}
    }

    /// @notice ETH the holder can withdraw right now: everything except the locked starter balance.
    function withdrawable() public view returns (uint256) { return address(this).balance - lockedNow(); }

    // ------------------------------------------------------------------ holder

    modifier onlyHolder() { if (msg.sender != owner()) revert NotHolder(); _; }

    /// @notice Applies a guided rule (by hash, the text lives at ruleUri) and the hard limits.
    function setPolicy(uint128 perTrade, uint128 dailyCap, bool live, bytes32 ruleHash_, string calldata ruleUri) external onlyHolder {
        policy = Policy(perTrade, dailyCap, live, msg.sender);
        policyTransfers = _transfers();
        emit PolicySet(msg.sender, perTrade, dailyCap, live);
        if (ruleHash_ != bytes32(0) && ruleHash_ != ruleHash) {
            ruleHash = ruleHash_;
            ruleVersion += 1;
            emit RuleApplied(ruleVersion, ruleHash_, ruleUri);
        }
        _state++;
    }

    function pause() external onlyHolder { policy.live = false; _state++; emit PolicySet(msg.sender, policy.perTrade, policy.dailyCap, false); }

    /// @notice Launches the agent's coin through the configured launcher (e.g. the Pons router).
    ///         It may be paid from the starter balance: the lock goes down only by the ETH that actually
    ///         left the wallet. Records the coin (once) so the engine never trades it.
    function launchCoin(bytes calldata data, uint256 value, address coin_) external onlyHolder nonReentrant returns (bytes memory result) {
        address launcher = config.launcher();
        if (launcher == address(0)) revert NotAllowed();
        _state++;
        uint256 before = address(this).balance;
        result = _call(launcher, value, data);
        uint256 spent = before > address(this).balance ? before - address(this).balance : 0;
        if (starterLocked > 0) starterLocked = spent >= starterLocked ? 0 : starterLocked - spent;
        if (coin_ != address(0) && coin == address(0)) { coin = coin_; emit CoinLaunched(coin_); }
    }

    /// @notice Instant withdrawal to the holder of anything above the locked starter balance.
    function withdraw(uint256 amount) external onlyHolder nonReentrant {
        if (amount == 0) revert NoWithdrawal();
        if (amount > withdrawable()) revert StarterLocked();
        _state++;
        (bool ok, bytes memory r) = msg.sender.call{value: amount}("");
        if (!ok) revert CallFailed(r);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice ERC-6551 execute. Unrestricted for the holder after the starter lock period; during it,
    ///         the holder can still make calls that send no ETH above the free balance, don't touch the
    ///         router (trading goes through the engine and its caps) and don't move tokens out.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable onlyHolder nonReentrant returns (bytes memory) {
        if (operation != 0) revert NotAllowed();
        if (inStarterLock()) {
            if (to == config.router() || value > withdrawable()) revert StarterLocked();
            if (_isTokenTransfer(data)) revert StarterLocked();
        }
        _state++;
        return _call(to, value, data);
    }

    // ------------------------------------------------------------------ engine

    /// @notice A swap through the configured router, within the holder's limits.
    function trade(uint256 value, bytes calldata data) external nonReentrant returns (bytes memory) {
        if (msg.sender != config.engine()) revert NotEngine();
        if (config.paused()) revert TradingPaused();
        Policy memory p = policy;
        if (p.setBy != owner() || policyTransfers != _transfers()) revert PolicyStale();
        if (!p.live) revert Paused();
        address router = config.router();
        if (router == address(0)) revert NotAllowed();
        if (value > p.perTrade) revert OverPerTrade();
        uint256 day = block.timestamp / 1 days;
        uint256 spent = day == spentDay ? spentToday : 0;
        if (spent + value > p.dailyCap) revert OverDailyCap();
        spentDay = day;
        spentToday = spent + value;
        _state++;
        emit Traded(value, bytes4(data[:4]));
        return _call(router, value, data);
    }

    /// @notice Lets the router pull a token the agent is selling. Never the agent's own coin.
    function approveRouter(IERC20 tokenToSell, uint256 amount) external {
        if (msg.sender != config.engine()) revert NotEngine();
        if (config.paused()) revert TradingPaused();
        if (address(tokenToSell) == coin) revert NotAllowed();
        if (policy.setBy != owner() || policyTransfers != _transfers()) revert PolicyStale();
        if (!policy.live) revert Paused();
        address r = config.router();
        tokenToSell.safeApprove(r, 0);
        if (amount > 0) tokenToSell.safeApprove(r, amount);
    }

    // ------------------------------------------------------------------ internals

    function _call(address to, uint256 value, bytes calldata data) internal returns (bytes memory result) {
        bool ok;
        (ok, result) = to.call{value: value}(data);
        if (!ok) revert CallFailed(result);
    }

    /// @dev ERC-20/721 transfer, transferFrom, approve, setApprovalForAll, safeTransferFrom.
    function _isTokenTransfer(bytes calldata data) internal pure returns (bool) {
        if (data.length < 4) return false;
        bytes4 s = bytes4(data[:4]);
        return s == IERC20.transfer.selector || s == IERC20.transferFrom.selector || s == IERC20.approve.selector
            || s == 0xa22cb465 /* setApprovalForAll */ || s == 0x42842e0e || s == 0xb88d4fde /* safeTransferFrom */;
    }
}
