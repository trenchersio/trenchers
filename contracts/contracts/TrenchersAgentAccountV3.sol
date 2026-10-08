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

/// @dev The Pons V2 launch factory (github.com/ponsdotdev/pons-labs, contractsV2), as deployed on Robinhood Chain.
interface IPonsLaunchFactory {
    struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }
    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
    }
    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken)
        external payable returns (address token, address curve);
    function launchFee() external view returns (uint256);
    function feeEscrow() external view returns (address);
    /// @dev The first fields of Pons's LaunchedToken record (the same in every published factory version).
    struct LaunchRecord { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; }
    function getLaunchedToken(address token) external view returns (LaunchRecord memory);
}

/// @dev Pons's creator-fee escrow: a creator fee recipient claims what it is owed (paid to msg.sender).
interface IPonsFeeEscrow {
    function claim() external returns (uint256 amount);
}

/// @dev A coin's Pons V2 bonding curve: its creator may move the fees collected so far into the escrow.
interface IPonsCurve {
    function sweepFees(uint256 minBuybackTokensOut) external;
}

interface IAgentConfig {
    function engine() external view returns (address);
    function router() external view returns (address);
    function launcher() external view returns (address);
    function starterFund() external view returns (address);
    function paused() external view returns (bool);
}

/// @title TrenchersAgentAccountV3
/// @notice Agent wallet logic, version 3 (version 2 with a format-independent coin launch): an opt-in version holders switch to with
///         TrenchersAgentWallet.setAgentVersion (offered through AgentConfig behind the 48-hour timelock).
///         Same storage layout as version 1 (nothing added), so switching keeps the wallet address, balance,
///         rules, limits and track record, and the holder can switch back at any time.
///
///         What changes from version 1, the agent's own coin:
///           - launchCoin: the agent wallet itself calls the Pons V2 launch factory, so Pons records the
///             agent wallet as the coin's deployer and as its creator (fee recipient, creator controls).
///             The Pons launch fee (and only that, at most MAX_LAUNCH_FEE) may be paid from the locked
///             starter balance, so an agent can launch with nothing but its starter. The coin's address is
///             taken from Pons's own return value and recorded so the engine never trades it.
///           - claimCoinFees: collects the coin's creator fees from Pons's fee escrow into the agent
///             wallet, also during the starter lock. Collected fees are free balance (withdrawable).
///         Everything else is exactly version 1.
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
contract TrenchersAgentAccountV3 is IERC165, IERC1271, IERC6551Account, IERC6551Executable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STARTER_LOCK = 180 days;
    /// @notice Agent wallet code version (fixed versions count up).
    uint256 public constant VERSION = 3;
    /// @notice The most of the locked starter balance a coin launch may use (the Pons launch fee is 0.0005 ETH).
    uint256 public constant MAX_LAUNCH_FEE = 0.002 ether;

    IAgentConfig public immutable config;
    /// @notice The Agent Starter Fund. Fixed at deployment: only ETH from this fund is ever locked.
    address public immutable starterFund;

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
    /// @notice (Version 2, appended) The agent coin's Pons bonding curve, for collecting creator fees.
    address public coinCurve;


    event PolicySet(address indexed holder, uint128 perTrade, uint128 dailyCap, bool live);
    event RuleApplied(uint32 indexed version, bytes32 ruleHash, string ruleUri);
    event Traded(uint256 value, bytes4 selector);
    event StarterReceived(uint256 amount);
    event CoinLaunched(address indexed coin);
    event CoinFeesClaimed(uint256 amount);
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

    constructor(IAgentConfig config_, address starterFund_) { config = config_; starterFund = starterFund_; }

    // ------------------------------------------------------------------ ERC-6551

    receive() external payable {
        if (msg.sender == starterFund && msg.value > 0) {
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

    /// @dev No signatures on the wallet's behalf during the starter lock (they could approve token
    ///      transfers without going through execute).
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (inStarterLock()) return bytes4(0);
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

    /// @notice Launches the agent's own coin on Pons, once, with the agent wallet as the caller, so it is the coin's
    ///         deployer and creator. `data` is the launch call for the Pons factory configured in AgentConfig (its exact
    ///         format depends on the factory version, so the website builds it). Whatever it says, the wallet checks
    ///         Pons's own record afterwards and reverts unless the new coin was deployed by this wallet, pays its
    ///         creator fees to this wallet and is ETH-paired. `fee` is the ETH sent with the call: it may come from the
    ///         locked starter up to MAX_LAUNCH_FEE (the locked amount shrinks by what it paid).
    function launchCoin(bytes calldata data, uint256 fee) external onlyHolder nonReentrant returns (address coin_, address curve) {
        IPonsLaunchFactory factory = IPonsLaunchFactory(config.launcher());
        if (address(factory) == address(0) || coin != address(0)) revert NotAllowed();
        uint256 free = withdrawable();
        if (fee > free) {
            if (fee > MAX_LAUNCH_FEE) revert StarterLocked();
            starterLocked -= fee - free;
        }
        _state++;
        bytes memory r = _call(address(factory), fee, data);
        if (r.length < 64) revert NotAllowed();
        (coin_, curve) = abi.decode(r, (address, address));
        IPonsLaunchFactory.LaunchRecord memory rec = factory.getLaunchedToken(coin_);
        if (rec.token != coin_ || rec.curve != curve || rec.deployer != address(this) || rec.creatorFeeRecipient != address(this) || rec.pairToken != address(0)) revert NotAllowed();
        coin = coin_;
        coinCurve = curve;
        emit CoinLaunched(coin_);
    }

    /// @notice Collects the agent coin's creator fees into this wallet: first moves the fees its bonding
    ///         curve has collected so far into Pons's fee escrow (as the coin's creator; skipped once the coin
    ///         has graduated, when its Uniswap pool pays the escrow directly), then claims the escrow.
    ///         Anyone may call it: the ETH can only come to this wallet. Collected fees are free balance.
    function claimCoinFees() external nonReentrant returns (uint256 amount) {
        if (coin == address(0)) revert NotAllowed();
        address escrow = IPonsLaunchFactory(config.launcher()).feeEscrow();
        _state++;
        if (coinCurve != address(0)) { try IPonsCurve(coinCurve).sweepFees(0) {} catch {} }
        uint256 before = address(this).balance;
        try IPonsFeeEscrow(escrow).claim() {} catch {}
        amount = address(this).balance - before;
        emit CoinFeesClaimed(amount);
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
    ///         only plain ETH sends from the free balance (withdraw does the same).
    function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable onlyHolder nonReentrant returns (bytes memory) {
        if (operation != 0) revert NotAllowed();
        // During the starter lock, only plain ETH sends from the free balance: no contract calls, so
        // coins bought with the starter can't be moved, approved or sold outside the engine's limits.
        if (inStarterLock() && (data.length != 0 || value > withdrawable())) revert StarterLocked();
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
        if (!p.live || p.perTrade == 0) revert Paused();
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
        uint256 before = address(this).balance;
        bytes memory result = _call(router, value, data);
        // Count only what the trade really spent: a partly filled buy refunds the rest (its ETH comes back).
        uint256 back = address(this).balance + value - before;
        if (back > 0) spentToday -= back > value ? value : back;
        return result;
    }

    /// @notice Lets the router pull a token the agent is selling. Never the agent's own coin.
    function approveRouter(IERC20 tokenToSell, uint256 amount) external {
        if (msg.sender != config.engine()) revert NotEngine();
        if (config.paused()) revert TradingPaused();
        if (address(tokenToSell) == coin) revert NotAllowed();
        if (policy.setBy != owner() || policyTransfers != _transfers()) revert PolicyStale();
        if (!policy.live || policy.perTrade == 0) revert Paused();
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
}
