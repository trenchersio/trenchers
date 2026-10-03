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

interface IAgentConfig {
    function engine() external view returns (address);
    function router() external view returns (address);
    function launcher() external view returns (address);
    function starterFund() external view returns (address);
}

/// @title TrenchersAgentAccount
/// @notice The wallet of a Trenchers agent: an ERC-6551 token-bound account owned by whoever holds
///         the NFT. The rule: the trading engine can make the agent trade, but can never take its money.
///
///         Holder:  applies guided rules and limits, pauses, withdraws (after a short delay), launches
///                  the agent's coin, and has full control once the starter lock has ended.
///         Engine:  may only call the configured router, with ETH up to the holder's per-trade and daily
///                  caps, and approve that router for tokens it sells. Only while the holder's policy is
///                  live and was set by the current holder (a sale pauses trading automatically).
///         Starter: ETH received from the Agent Starter Fund is locked: it can pay for the coin launch
///                  and trades, but the holder cannot withdraw it until STARTER_LOCK has passed.
contract TrenchersAgentAccount is IERC165, IERC1271, IERC6551Account, IERC6551Executable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STARTER_LOCK = 180 days;
    uint256 public constant WITHDRAW_DELAY = 10 minutes;

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

    struct Withdrawal { address requestedBy; uint128 amount; uint64 readyAt; }
    Withdrawal public withdrawal;

    event PolicySet(address indexed holder, uint128 perTrade, uint128 dailyCap, bool live);
    event RuleApplied(uint32 indexed version, bytes32 ruleHash, string ruleUri);
    event Traded(uint256 value, bytes4 selector);
    event StarterReceived(uint256 amount);
    event CoinLaunched(address indexed coin);
    event WithdrawalRequested(address indexed holder, uint256 amount, uint256 readyAt);
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

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return this.onERC721Received.selector; }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) { return this.onERC1155Received.selector; }

    // ------------------------------------------------------------------ views

    /// @notice Starter ETH that is still locked (zero once STARTER_LOCK has passed).
    function lockedNow() public view returns (uint256) {
        if (starterLocked == 0 || block.timestamp >= starterLockedAt + STARTER_LOCK) return 0;
        return starterLocked < address(this).balance ? starterLocked : address(this).balance;
    }

    /// @notice ETH the holder can withdraw right now (subject to the withdrawal delay).
    function withdrawable() public view returns (uint256) { return address(this).balance - lockedNow(); }

    // ------------------------------------------------------------------ holder

    modifier onlyHolder() { if (msg.sender != owner()) revert NotHolder(); _; }

    /// @notice Applies a guided rule (by hash, the text lives at ruleUri) and the hard limits.
    function setPolicy(uint128 perTrade, uint128 dailyCap, bool live, bytes32 ruleHash_, string calldata ruleUri) external onlyHolder {
        policy = Policy(perTrade, dailyCap, live, msg.sender);
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
    ///         `value` may come from the starter balance. Records the coin so the engine never trades it.
    function launchCoin(bytes calldata data, uint256 value, address coin_) external onlyHolder nonReentrant returns (bytes memory result) {
        address launcher = config.launcher();
        if (launcher == address(0)) revert NotAllowed();
        _state++;
        result = _call(launcher, value, data);
        if (starterLocked > 0) starterLocked = value >= starterLocked ? 0 : starterLocked - value;
        if (coin_ != address(0)) { coin = coin_; emit CoinLaunched(coin_); }
    }

    /// @notice Step 1 of a withdrawal. The request is void if the NFT changes hands before step 2.
    function requestWithdrawal(uint128 amount) external onlyHolder {
        withdrawal = Withdrawal(msg.sender, amount, uint64(block.timestamp + WITHDRAW_DELAY));
        emit WithdrawalRequested(msg.sender, amount, block.timestamp + WITHDRAW_DELAY);
    }

    /// @notice Step 2: sends the requested ETH to the holder, never touching the locked starter balance.
    function withdraw() external onlyHolder nonReentrant {
        Withdrawal memory w = withdrawal;
        if (w.requestedBy != msg.sender || w.amount == 0) revert NoWithdrawal();
        if (block.timestamp < w.readyAt) revert TooEarly();
        if (w.amount > withdrawable()) revert StarterLocked();
        delete withdrawal;
        _state++;
        (bool ok, bytes memory r) = msg.sender.call{value: w.amount}("");
        if (!ok) revert CallFailed(r);
        emit Withdrawn(msg.sender, w.amount);
    }

    /// @notice ERC-6551 execute. Unrestricted for the holder once nothing is locked; while the starter
    ///         balance is locked, the holder can still make calls that send no ETH above the free balance
    ///         and don't touch the router (trading goes through the engine and its caps).
    function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable onlyHolder nonReentrant returns (bytes memory) {
        if (operation != 0) revert NotAllowed();
        if (lockedNow() > 0) {
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
        Policy memory p = policy;
        if (p.setBy != owner()) revert PolicyStale();
        if (!p.live) revert Paused();
        if (value > p.perTrade) revert OverPerTrade();
        uint256 day = block.timestamp / 1 days;
        uint256 spent = day == spentDay ? spentToday : 0;
        if (spent + value > p.dailyCap) revert OverDailyCap();
        spentDay = day;
        spentToday = spent + value;
        _state++;
        emit Traded(value, bytes4(data[:4]));
        return _call(config.router(), value, data);
    }

    /// @notice Lets the router pull a token the agent is selling. Never the agent's own coin.
    function approveRouter(IERC20 tokenToSell, uint256 amount) external {
        if (msg.sender != config.engine()) revert NotEngine();
        if (address(tokenToSell) == coin) revert NotAllowed();
        if (policy.setBy != owner()) revert PolicyStale();
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
