// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IAgentRegistry, IWETH, ILineHook} from "./interfaces/ICreditDeps.sol";
import {CreditCalls} from "./CreditCalls.sol";

/// @title TrenchersCreditPool
/// @notice Trenchers Credit: ETH credit lines for ERC-8004 agents, every line fully backed.
///
///  - Lenders put in ETH and get pool shares. A loan loss never reaches them: the share price cannot fall.
///  - Backers lock pool shares. Locked shares are lent out and earn like any other, and they stand behind the
///    lines their backer opens, one for one. A default burns the backer's shares for the principal and the fee.
///  - An agent has at most one backer at a time, only with its owner's signed consent, and can switch backer
///    whenever no loan is open.
///  - Everything needed to close a loan is fixed when it is taken.
///  - The reserve's share of every fee goes to the Trenchers buyback wallet (anyone can send it there).
///  - The owner is a timelock. The guardian can stop new risk for at most 14 days at a time; exits never stop.
///
///  Books are kept in WETH; the ETH functions wrap and unwrap on the way in and out.
contract TrenchersCreditPool is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint64 public constant MAX_PERIOD = 365 days;
    uint64 public constant MIN_GRACE = 1 days;
    uint64 public constant MAX_PAUSE = 14 days;
    uint64 public constant HOOK_DELAY = 48 hours;
    uint64 public constant MIN_HOLD = 7 days;
    uint256 public constant EARLY_EXIT_BPS = 50;
    uint256 public constant MAX_FEE_BPS = 500; // base fee per 30 days
    uint256 public constant MAX_PREMIUM_BPS = 200; // backer premium per 30 days
    uint256 public constant MAX_KEEPER_BOUNTY = 0.001 ether;
    uint256 public constant SEED = 0.0001 ether; // dead shares, minted once, so shares can never be inflated
    uint256 public constant RESERVE_FLOOR = 0.005 ether; // kept back for rounding top-ups
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    bytes32 public constant CONSENT_TYPEHASH = keccak256(
        "Consent(uint256 agentId,uint256 backerId,address owner,uint256 maxPremiumBps,uint256 nonce,uint256 deadline)"
    );

    // ------------------------------------------------------------------ types

    enum LoanStatus {
        None,
        Active,
        Repaid,
        Defaulted
    }

    /// Why a line (or part of it) went back to its backer.
    enum Release {
        Lowered,
        Left,
        Moved,
        Frozen,
        AfterDefault
    }

    struct Agent {
        bool enrolled;
        bool isBacker;
        bool defaulted;
        bool frozen;
        uint64 enrolledAt;
        uint64 lastBorrowAt;
        uint64 lastRepayAt;
        uint256 backer;
        uint256 line; // ETH its backer stands behind
        uint256 linesOut; // backers: the lines they have open
        uint256 principalOut;
        uint256 activeLoans;
        uint256 premiumBps; // on this agent's future loans, all to its backer
        uint256 premiumCap; // the most its owner agreed to
        uint256 loansRepaid;
        uint256 volumeRepaid;
        uint256 feesPaid;
        uint256 backedDefaults; // backers: loans of theirs that defaulted
        uint256 seasonedRepaid; // repaid loans held at least `minScoreTerm`
        uint256 ethSecondsRepaid; // principal x time held, summed over repaid loans
    }

    struct Loan {
        uint256 agentId;
        uint256 backerId;
        uint256 principal;
        uint256 fee; // base + premium
        uint256 backerCut; // of the base fee
        uint256 reserveCut; // of the base fee
        uint256 premium; // all to the backer
        address owner; // the agent's owner at borrow: the address a default marks
        uint64 issuedAt;
        uint64 dueAt;
        uint64 defaultableAt;
        uint64 minScoreTerm;
        uint64 closedAt;
        LoanStatus status;
    }

    struct Params {
        uint256 minLoan;
        uint256 maxLoan;
        uint64 minTerm;
        uint64 maxTerm;
        uint64 grace;
        uint64 minScoreTerm;
        uint256 feeBps; // base fee per 30 days of term
        uint256 backerFeeBps; // of the base fee
        uint256 reserveFeeBps; // of the base fee
        uint256 minBacking;
        uint256 maxUtilizationBps;
        uint256 keeperBounty;
    }

    struct Consent {
        uint256 agentId;
        uint256 backerId;
        address owner;
        uint256 maxPremiumBps;
        uint256 nonce;
        uint256 deadline;
    }

    // ------------------------------------------------------------------ storage

    IWETH public immutable weth;
    IAgentRegistry public immutable registry;
    address public immutable buyback;

    Params internal params;
    address public guardian;
    uint64 public pausedUntil;
    bool public seeded;

    uint256 public poolLiquidity; // ETH behind shares, not lent out
    uint256 public totalPrincipalOut;
    uint256 public totalShares;
    uint256 public reserve;
    uint256 public unclaimedBackerFees;
    uint256 public totalFeesEarned; // the lenders' part, all time
    uint256 public totalSlashed; // principal paid by backers' shares on defaults
    uint256 public totalBadDebt; // must stay 0
    uint256 public totalToBuyback;
    /// Fees of a backer's open loans, held out of its free backing, so a default always costs it the fee too.
    mapping(uint256 => uint256) public feeLocked;

    mapping(address => uint256) public shares;
    mapping(address => uint64) public lastDepositAt;

    mapping(uint256 => uint256) public backerShares;
    mapping(uint256 => uint64) public lastBackingAt; // the same 7-day clock as lenders, so backing is no side door
    mapping(uint256 => address) public hook;
    mapping(uint256 => address) public pendingHook;
    mapping(uint256 => uint64) public hookEta;

    mapping(uint256 => Agent) internal _agents;
    mapping(uint256 => address) public delegateOf;
    mapping(uint256 => address) private _delegateOwner;
    mapping(uint256 => uint256) public nonces;

    mapping(uint256 => uint256) public backerFees; // claimable
    mapping(uint256 => mapping(uint256 => uint256)) public feesFrom; // backer => agent => all time

    mapping(address => uint256) public ownerDefaults; // a default marks the person, not only the agent
    mapping(address => bool) public custodian;

    Loan[] internal _loans; // id = index, 0 unused
    mapping(uint256 => uint256[]) internal _loansOf;

    // ------------------------------------------------------------------ events, errors

    event Seeded(address indexed by);
    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event BackerRegistered(uint256 indexed backerId, uint256 assets, uint256 shares);
    event BackingAdded(uint256 indexed backerId, address indexed from, uint256 assets, uint256 shares);
    event BackingUnlocked(uint256 indexed backerId, uint256 assets, uint256 shares, address to);
    event BackerRetired(uint256 indexed backerId);
    event HookQueued(uint256 indexed backerId, address hook, uint64 eta);
    event HookSet(uint256 indexed backerId, address hook);
    event HookFailed(uint256 indexed backerId, bytes4 selector);
    event LineRaised(uint256 indexed backerId, uint256 indexed agentId, uint256 amount, uint256 line);
    event LineReleased(uint256 indexed backerId, uint256 indexed agentId, uint256 amount, Release reason);
    event BackerChanged(uint256 indexed agentId, uint256 indexed from, uint256 indexed to);
    event PremiumSet(uint256 indexed backerId, uint256 indexed agentId, uint256 premiumBps);
    event Frozen(uint256 indexed backerId, uint256 indexed agentId, bool frozen);
    event Borrowed(
        uint256 indexed loanId, uint256 indexed agentId, uint256 indexed backerId, uint256 principal, uint256 fee,
        uint64 dueAt, address to
    );
    event Repaid(uint256 indexed loanId, uint256 indexed agentId, uint256 principal, uint256 fee, address payer);
    event FeeSplit(uint256 indexed loanId, uint256 indexed backerId, uint256 toLenders, uint256 toBacker, uint256 toReserve);
    event Defaulted(
        uint256 indexed loanId, uint256 indexed agentId, uint256 indexed backerId, uint256 principal,
        uint256 sharesBurnt, address owner
    );
    event KeeperPaid(address indexed keeper, uint256 amount);
    event BackerFeesClaimed(uint256 indexed backerId, address indexed to, uint256 amount);
    event DelegateSet(uint256 indexed agentId, address delegate);
    event ReserveFunded(address indexed from, uint256 amount);
    event ReserveToBuyback(address indexed by, uint256 amount);
    event ReserveStaked(uint256 indexed backerId, uint256 amount, uint256 shares);
    event CustodianSet(address indexed who, bool allowed);
    event GuardianSet(address indexed guardian);
    event PausedUntil(uint64 until);
    event ParamsUpdated(Params params);

    error Paused();
    error NotSeeded();
    error AlreadySeeded();
    error ZeroAmount();
    error NotOwnerOf(uint256 id, address caller);
    error NotController(uint256 id, address caller);
    error NotGuardian();
    error InvalidAgent(uint256 id);
    error NotBacker(uint256 id);
    error IsBacker(uint256 id);
    error AgentDefaulted(uint256 id);
    error WrongBacker(uint256 id, uint256 backer);
    error LoanOpen(uint256 id);
    error BadConsent();
    error ConsentExpired();
    error PremiumTooHigh(uint256 bps, uint256 cap);
    error InsufficientBacking(uint256 backerId, uint256 requested, uint256 free);
    error InsufficientLine(uint256 id, uint256 requested, uint256 available);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error UtilizationTooHigh();
    error LoanSizeOutOfRange(uint256 amount);
    error TermOutOfRange(uint64 term);
    error FeeTooHigh(uint256 fee, uint256 maxFee);
    error IsFrozen(uint256 id);
    error OwnerDefaulted(address owner);
    error BorrowBlockedByBacker(uint256 backerId);
    error LoanNotActive(uint256 loanId);
    error LoanNotDue(uint256 loanId, uint64 defaultableAt);
    error WrongLoan(uint256 loanId);
    error DueTooHigh(uint256 due, uint256 maxDue);
    error WrongValue(uint256 sent, uint256 due);
    error BelowMinBacking(uint256 amount, uint256 minBacking);
    error SlippageShares(uint256 minted, uint256 minShares);
    error InvalidHook(address hook);
    error HookNotReady(uint64 eta);
    error StillBacking(uint256 backerId);
    error ReserveShort(uint256 requested, uint256 reserve);
    error InvalidParams();
    error Renounce();
    error EthSendFailed();
    error NotWeth();

    // ------------------------------------------------------------------ construction, pause

    constructor(IWETH weth_, IAgentRegistry registry_, address buyback_, address owner_, address guardian_, Params memory p)
        Ownable(owner_)
        EIP712("Trenchers Credit", "1")
    {
        if (address(weth_) == address(0) || address(registry_) == address(0) || buyback_ == address(0)) {
            revert InvalidParams();
        }
        weth = weth_;
        registry = registry_;
        buyback = buyback_;
        guardian = guardian_;
        _setParams(p);
        _loans.push();
    }

    /// @notice Only WETH sends ETH here (when the pool unwraps).
    receive() external payable {
        if (msg.sender != address(weth)) revert NotWeth();
    }

    /// @notice Mints the dead shares that make share inflation impossible. Once, by anyone who pays SEED.
    function seed() external payable nonReentrant {
        if (seeded) revert AlreadySeeded();
        if (msg.value != SEED) revert WrongValue(msg.value, SEED);
        seeded = true;
        weth.deposit{value: SEED}();
        poolLiquidity += SEED;
        totalShares += SEED;
        shares[DEAD] += SEED;
        emit Seeded(msg.sender);
    }

    modifier whenNotPaused() {
        if (block.timestamp < pausedUntil) revert Paused();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _;
    }

    /// @notice Stops new risk (deposits, backing, new lines, borrows) for at most 14 days. Exits never stop.
    function pause() external onlyGuardian nonReentrant {
        pausedUntil = uint64(block.timestamp) + MAX_PAUSE;
        emit PausedUntil(pausedUntil);
    }

    function unpause() external onlyGuardian nonReentrant {
        pausedUntil = 0;
        emit PausedUntil(0);
    }

    function renounceOwnership() public pure override {
        revert Renounce();
    }

    // ------------------------------------------------------------------ money in and out

    /// @dev Takes `assets` in from the caller: as the ETH sent with the call, or as WETH they approved.
    function _pull(uint256 assets) internal {
        if (msg.value > 0) {
            if (msg.value != assets) revert WrongValue(msg.value, assets);
            weth.deposit{value: assets}();
        } else {
            IERC20(address(weth)).safeTransferFrom(msg.sender, address(this), assets);
        }
    }

    /// @dev Pays out `assets` as ETH (unwrapped) or as WETH.
    function _push(address to, uint256 assets, bool asEth) internal {
        if (to == address(0)) revert InvalidParams();
        if (asEth) {
            weth.withdraw(assets);
            (bool ok,) = to.call{value: assets}("");
            if (!ok) revert EthSendFailed();
        } else {
            IERC20(address(weth)).safeTransfer(to, assets);
        }
    }

    // ------------------------------------------------------------------ identity

    function _ownerOf(uint256 id) internal view returns (address o) {
        try registry.ownerOf(id) returns (address o_) {
            o = o_;
        } catch {
            revert InvalidAgent(id);
        }
    }

    function isController(uint256 id, address who) public view returns (bool) {
        if (id == 0) return false;
        try registry.ownerOf(id) returns (address o) {
            return o == who || (who != address(0) && delegateOf[id] == who && _delegateOwner[id] == o);
        } catch {
            return false;
        }
    }

    function _onlyOwnerOf(uint256 id) internal view {
        if (_ownerOf(id) != msg.sender) revert NotOwnerOf(id, msg.sender);
    }

    function _onlyController(uint256 id) internal view {
        if (!isController(id, msg.sender)) revert NotController(id, msg.sender);
    }

    /// @notice Lets a hot key borrow and manage the line for the agent. It lapses when the agent changes hands.
    function setDelegate(uint256 id, address delegate) external nonReentrant {
        address o = _ownerOf(id);
        if (o != msg.sender) revert NotOwnerOf(id, msg.sender);
        delegateOf[id] = delegate;
        _delegateOwner[id] = o;
        emit DelegateSet(id, delegate);
    }

    function _enroll(Agent storage a) internal {
        if (!a.enrolled) {
            a.enrolled = true;
            if (a.enrolledAt == 0) a.enrolledAt = uint64(block.timestamp);
        }
    }

    // ------------------------------------------------------------------ lenders

    function totalAssets() public view returns (uint256) {
        return poolLiquidity + totalPrincipalOut;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 ta = totalAssets();
        if (totalShares == 0 || ta == 0) return assets;
        return assets * totalShares / ta;
    }

    function convertToAssets(uint256 shares_) public view returns (uint256) {
        if (totalShares == 0) return shares_;
        return shares_ * totalAssets() / totalShares;
    }

    function _mintFor(uint256 assets) internal returns (uint256 minted) {
        if (!seeded) revert NotSeeded();
        if (assets == 0) revert ZeroAmount();
        minted = convertToShares(assets);
        if (minted == 0) revert ZeroAmount();
        _pull(assets);
        poolLiquidity += assets;
        totalShares += minted;
    }

    /// @notice Lend: send ETH with the call (or approve WETH and leave `msg.value` at 0).
    function deposit(uint256 assets, address receiver, uint256 minShares)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 minted)
    {
        minted = _mintFor(assets);
        if (minted < minShares) revert SlippageShares(minted, minShares);
        uint256 held = shares[receiver];
        shares[receiver] += minted;
        // a share-weighted clock: a tiny deposit cannot restart someone else's seven days
        lastDepositAt[receiver] = held == 0
            ? uint64(block.timestamp)
            : uint64((held * uint256(lastDepositAt[receiver]) + minted * block.timestamp) / (held + minted));
        emit Deposited(receiver, assets, minted);
    }

    /// @notice Take money out, as far as it isn't lent out. Within 7 days of depositing, 0.5% stays with the
    ///         lenders who stay.
    function withdraw(uint256 shares_, address receiver, bool asEth) external nonReentrant returns (uint256 out) {
        if (shares_ == 0) revert ZeroAmount();
        uint256 assets = convertToAssets(shares_);
        if (assets > poolLiquidity) revert InsufficientLiquidity(assets, poolLiquidity);
        shares[msg.sender] -= shares_;
        uint256 fee =
            block.timestamp < uint256(lastDepositAt[msg.sender]) + MIN_HOLD ? assets * EARLY_EXIT_BPS / 10_000 : 0;
        out = assets - fee;
        totalShares -= shares_;
        poolLiquidity -= out;
        emit Withdrawn(msg.sender, out, shares_);
        _push(receiver, out, asEth);
    }

    // ------------------------------------------------------------------ backers

    /// @notice Turns an identity into a backer, with at least `minBacking` locked as pool shares.
    function registerBacker(uint256 backerId, uint256 assets) external payable nonReentrant whenNotPaused {
        _onlyOwnerOf(backerId);
        Agent storage r = _agents[backerId];
        if (r.isBacker) revert IsBacker(backerId);
        if (r.defaulted) revert AgentDefaulted(backerId);
        if (r.backer != 0 || r.line != 0 || r.activeLoans != 0) revert LoanOpen(backerId);
        if (assets < params.minBacking) revert BelowMinBacking(assets, params.minBacking);
        uint256 minted = _mintFor(assets);
        r.isBacker = true;
        _enroll(r);
        _clockBacking(backerId, minted);
        backerShares[backerId] += minted;
        emit BackerRegistered(backerId, assets, minted);
    }

    /// @notice Adds backing behind a backer. Anyone may; only the backer's owner can take it out.
    function addBacking(uint256 backerId, uint256 assets) external payable nonReentrant whenNotPaused {
        if (!_agents[backerId].isBacker) revert NotBacker(backerId);
        uint256 minted = _mintFor(assets);
        _clockBacking(backerId, minted);
        backerShares[backerId] += minted;
        emit BackingAdded(backerId, msg.sender, assets, minted);
    }

    function _clockBacking(uint256 backerId, uint256 minted) internal {
        uint256 held = backerShares[backerId];
        lastBackingAt[backerId] = held == 0
            ? uint64(block.timestamp)
            : uint64((held * uint256(lastBackingAt[backerId]) + minted * block.timestamp) / (held + minted));
    }

    function backing(uint256 backerId) public view returns (uint256) {
        return convertToAssets(backerShares[backerId]);
    }

    function freeBacking(uint256 backerId) public view returns (uint256) {
        uint256 b = backing(backerId);
        uint256 out = _agents[backerId].linesOut + feeLocked[backerId];
        return b > out ? b - out : 0;
    }

    /// @notice Takes out backing that stands behind nothing. Within 7 days of adding backing, 0.5% stays in the pool.
    function unlockBacking(uint256 backerId, uint256 shares_, address to, bool asEth)
        external
        nonReentrant
        returns (uint256 assets)
    {
        _onlyOwnerOf(backerId);
        if (shares_ == 0) revert ZeroAmount();
        uint256 left = backerShares[backerId] - shares_;
        uint256 out = _agents[backerId].linesOut + feeLocked[backerId];
        if (convertToAssets(left) < out) {
            revert InsufficientBacking(backerId, convertToAssets(shares_), freeBacking(backerId));
        }
        uint256 gross = convertToAssets(shares_);
        if (gross > poolLiquidity) revert InsufficientLiquidity(gross, poolLiquidity);
        // within 7 days of adding backing, 0.5% stays with the pool, as it does for lenders
        assets = block.timestamp < uint256(lastBackingAt[backerId]) + MIN_HOLD ? gross - gross * EARLY_EXIT_BPS / 10_000 : gross;
        backerShares[backerId] = left;
        totalShares -= shares_;
        poolLiquidity -= assets;
        emit BackingUnlocked(backerId, assets, shares_, to);
        _push(to, assets, asEth);
    }

    /// @notice A backer with nothing locked and no line open becomes a plain identity again.
    function retireBacker(uint256 backerId) external nonReentrant {
        _onlyOwnerOf(backerId);
        Agent storage r = _agents[backerId];
        if (!r.isBacker) revert NotBacker(backerId);
        if (backerShares[backerId] != 0 || r.linesOut != 0) revert StillBacking(backerId);
        r.isBacker = false;
        delete hook[backerId];
        delete pendingHook[backerId];
        emit BackerRetired(backerId);
    }

    /// @notice Sets a backer's hook: at once while it backs nothing, otherwise after 48 hours.
    function setHook(uint256 backerId, address h) external nonReentrant {
        _onlyOwnerOf(backerId);
        if (!_agents[backerId].isBacker) revert NotBacker(backerId);
        if (h != address(0)) {
            if (h == address(this) || h == address(weth) || h == address(registry) || h.code.length == 0) {
                revert InvalidHook(h);
            }
        }
        if (_agents[backerId].linesOut == 0) {
            hook[backerId] = h;
            delete pendingHook[backerId];
            delete hookEta[backerId];
            emit HookSet(backerId, h);
        } else {
            pendingHook[backerId] = h;
            hookEta[backerId] = uint64(block.timestamp) + HOOK_DELAY;
            emit HookQueued(backerId, h, hookEta[backerId]);
        }
    }

    function applyHook(uint256 backerId) external nonReentrant {
        uint64 eta = hookEta[backerId];
        if (eta == 0 || block.timestamp < eta) revert HookNotReady(eta);
        hook[backerId] = pendingHook[backerId];
        delete pendingHook[backerId];
        delete hookEta[backerId];
        emit HookSet(backerId, hook[backerId]);
    }

    function claimBackerFees(uint256 backerId, address to, bool asEth) external nonReentrant returns (uint256 amount) {
        _onlyOwnerOf(backerId);
        amount = backerFees[backerId];
        if (amount == 0) revert ZeroAmount();
        backerFees[backerId] = 0;
        unclaimedBackerFees -= amount;
        emit BackerFeesClaimed(backerId, to, amount);
        _push(to, amount, asEth);
    }

    // ------------------------------------------------------------------ consent, lines, switching backer

    function consentDigest(Consent calldata c) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(CONSENT_TYPEHASH, c.agentId, c.backerId, c.owner, c.maxPremiumBps, c.nonce, c.deadline))
        );
    }

    /// @notice Opens a line (or takes over one from another backer) with the agent owner's signed consent. Only
    ///         the backer's owner can use a consent, so nobody can run in front of it. A previous backer gets its
    ///         whole line back first; that needs no loan open.
    function openLine(
        uint256 backerId,
        uint256 agentId,
        uint256 amount,
        uint256 premiumBps,
        Consent calldata c,
        bytes calldata sig
    ) external nonReentrant whenNotPaused {
        _onlyOwnerOf(backerId);
        Agent storage s = _agents[backerId];
        if (!s.isBacker) revert NotBacker(backerId);
        if (agentId == 0 || agentId == backerId) revert InvalidAgent(agentId);
        Agent storage a = _agents[agentId];
        if (a.isBacker) revert IsBacker(agentId);
        if (a.defaulted) revert AgentDefaulted(agentId);
        if (
            c.agentId != agentId || c.backerId != backerId || c.owner != _ownerOf(agentId)
                || c.nonce != nonces[agentId] || c.maxPremiumBps > MAX_PREMIUM_BPS
                || !CreditCalls.validSig(c.owner, consentDigest(c), sig)
        ) revert BadConsent();
        if (block.timestamp > c.deadline) revert ConsentExpired();
        if (premiumBps > c.maxPremiumBps) revert PremiumTooHigh(premiumBps, c.maxPremiumBps);
        nonces[agentId] = c.nonce + 1;

        uint256 old = a.backer;
        if (old != 0 && old != backerId) {
            if (a.activeLoans != 0) revert LoanOpen(agentId);
            _endLine(old, agentId, a, Release.Moved);
        }
        if (a.backer != backerId) {
            a.backer = backerId;
            a.frozen = false;
            _enroll(a);
            emit BackerChanged(agentId, old, backerId);
        }
        a.premiumCap = c.maxPremiumBps;
        a.premiumBps = premiumBps;
        emit PremiumSet(backerId, agentId, premiumBps);
        if (amount > 0) _raise(backerId, s, agentId, a, amount);
    }

    /// @notice Adds to a line this backer already has open.
    function raiseLine(uint256 backerId, uint256 agentId, uint256 amount) external nonReentrant whenNotPaused {
        _onlyOwnerOf(backerId);
        Agent storage a = _agents[agentId];
        if (a.backer != backerId || backerId == 0) revert WrongBacker(agentId, a.backer);
        if (a.defaulted) revert AgentDefaulted(agentId);
        _raise(backerId, _agents[backerId], agentId, a, amount);
    }

    function _raise(uint256 backerId, Agent storage s, uint256 agentId, Agent storage a, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 free = freeBacking(backerId);
        if (amount > free) revert InsufficientBacking(backerId, amount, free);
        s.linesOut += amount;
        a.line += amount;
        emit LineRaised(backerId, agentId, amount, a.line);
    }

    /// @notice Takes back line the agent hasn't drawn. Taking all of it ends the backing.
    function lowerLine(uint256 backerId, uint256 agentId, uint256 amount) external nonReentrant {
        _onlyOwnerOf(backerId);
        Agent storage a = _agents[agentId];
        if (a.backer != backerId || backerId == 0) revert WrongBacker(agentId, a.backer);
        if (amount == 0) revert ZeroAmount();
        uint256 undrawn = a.line > a.principalOut ? a.line - a.principalOut : 0;
        if (amount > undrawn) revert InsufficientLine(agentId, amount, undrawn);
        a.line -= amount;
        _agents[backerId].linesOut -= amount;
        if (a.line == 0 && a.activeLoans == 0) _clearBacker(a);
        _released(backerId, agentId, amount, Release.Lowered);
    }

    /// @notice The agent ends its backing itself, with no loan open; the whole line goes back.
    function leaveLine(uint256 agentId) external nonReentrant {
        _onlyController(agentId);
        Agent storage a = _agents[agentId];
        uint256 s = a.backer;
        if (s == 0) revert WrongBacker(agentId, 0);
        if (a.activeLoans != 0) revert LoanOpen(agentId);
        _endLine(s, agentId, a, Release.Left);
        emit BackerChanged(agentId, s, 0);
    }

    /// @notice The backer stops new borrowing. Open loans run to term; the undrawn line comes back as they close.
    function freezeLine(uint256 agentId, bool frozen_) external nonReentrant {
        Agent storage a = _agents[agentId];
        uint256 s = a.backer;
        if (s == 0) revert WrongBacker(agentId, 0);
        _onlyOwnerOf(s);
        a.frozen = frozen_;
        emit Frozen(s, agentId, frozen_);
        if (frozen_) _releaseFrozen(agentId, a);
    }

    /// @notice A backer can lower the premium on future loans, or raise it up to what the owner agreed to.
    function setPremium(uint256 agentId, uint256 premiumBps) external nonReentrant {
        Agent storage a = _agents[agentId];
        uint256 s = a.backer;
        if (s == 0) revert WrongBacker(agentId, 0);
        _onlyOwnerOf(s);
        if (premiumBps > a.premiumCap) revert PremiumTooHigh(premiumBps, a.premiumCap);
        a.premiumBps = premiumBps;
        emit PremiumSet(s, agentId, premiumBps);
    }

    function _endLine(uint256 s, uint256 agentId, Agent storage a, Release reason) internal {
        uint256 amount = a.line;
        if (amount > 0) {
            a.line = 0;
            _agents[s].linesOut -= amount;
        }
        _clearBacker(a);
        _released(s, agentId, amount, reason);
    }

    function _clearBacker(Agent storage a) internal {
        a.backer = 0;
        a.frozen = false;
        a.premiumBps = 0;
        a.premiumCap = 0;
    }

    function _releaseFrozen(uint256 agentId, Agent storage a) internal {
        uint256 s = a.backer;
        uint256 undrawn = a.line > a.principalOut ? a.line - a.principalOut : 0;
        if (undrawn > 0) {
            a.line -= undrawn;
            _agents[s].linesOut -= undrawn;
        }
        if (a.line == 0 && a.activeLoans == 0) _clearBacker(a);
        if (undrawn > 0) _released(s, agentId, undrawn, Release.Frozen);
    }

    /// @dev Once a defaulted agent's last loan closes, what is left of its line goes back.
    function _settleDead(uint256 agentId, Agent storage a) internal {
        if (!a.defaulted || a.activeLoans != 0) return;
        uint256 s = a.backer;
        uint256 rest = a.line;
        if (rest > 0) {
            a.line = 0;
            _agents[s].linesOut -= rest;
        }
        if (s != 0) {
            _clearBacker(a);
            _released(s, agentId, rest, Release.AfterDefault);
        }
    }

    // ------------------------------------------------------------------ loans

    function quoteFee(uint256 agentId, uint256 principal, uint64 term)
        public
        view
        returns (uint256 fee, uint256 backerCut, uint256 reserveCut, uint256 premium)
    {
        uint256 base = principal * params.feeBps * term / (10_000 * 30 days);
        backerCut = base * params.backerFeeBps / 10_000;
        reserveCut = base * params.reserveFeeBps / 10_000;
        premium = principal * _agents[agentId].premiumBps * term / (10_000 * 30 days);
        fee = base + premium;
    }

    function _checkBorrower(uint256 agentId, Agent storage a) internal view returns (address o) {
        if (a.backer == 0 || a.isBacker) revert WrongBacker(agentId, a.backer);
        if (a.defaulted) revert AgentDefaulted(agentId);
        if (a.frozen) revert IsFrozen(agentId);
        o = _ownerOf(agentId);
        if (ownerDefaults[o] != 0 && !custodian[o]) revert OwnerDefaulted(o);
    }

    function _newLoan(uint256 agentId, uint256 backerId, uint256 principal, uint64 term, address o)
        internal
        view
        returns (Loan memory l)
    {
        if (term < params.minTerm || term > params.maxTerm) revert TermOutOfRange(term);
        (l.fee, l.backerCut, l.reserveCut, l.premium) = quoteFee(agentId, principal, term);
        l.agentId = agentId;
        l.backerId = backerId;
        l.principal = principal;
        l.owner = o;
        l.issuedAt = uint64(block.timestamp);
        l.dueAt = uint64(block.timestamp) + term;
        l.defaultableAt = l.dueAt + params.grace;
        l.minScoreTerm = params.minScoreTerm;
        l.status = LoanStatus.Active;
    }

    function _checkRoom(uint256 agentId, Agent storage a, uint256 amount) internal view {
        if (amount < params.minLoan || amount > params.maxLoan) revert LoanSizeOutOfRange(amount);
        uint256 avail = a.line > a.principalOut ? a.line - a.principalOut : 0;
        if (amount > avail) revert InsufficientLine(agentId, amount, avail);
        if (amount > poolLiquidity) revert InsufficientLiquidity(amount, poolLiquidity);
        if ((totalPrincipalOut + amount) * 10_000 > params.maxUtilizationBps * totalAssets()) {
            revert UtilizationTooHigh();
        }
    }

    /// @notice Draws on the agent's line. The loan goes to `to` as ETH (`asEth`) or WETH.
    function borrow(uint256 agentId, uint256 amount, uint64 term, address to, uint256 maxFee, bool asEth)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 loanId)
    {
        _onlyController(agentId);
        Agent storage a = _agents[agentId];
        address o = _checkBorrower(agentId, a);
        _checkRoom(agentId, a, amount);
        Loan memory l = _newLoan(agentId, a.backer, amount, term, o);
        if (l.fee > maxFee) revert FeeTooHigh(l.fee, maxFee);
        if (!_canBorrow(l.backerId, abi.encode(l.backerId, agentId, amount, term, l.fee, msg.sender, o, to))) {
            revert BorrowBlockedByBacker(l.backerId);
        }
        uint256 fb = freeBacking(l.backerId);
        if (l.fee > fb) revert InsufficientBacking(l.backerId, l.fee, fb);
        feeLocked[l.backerId] += l.fee;

        loanId = _loans.length;
        _loans.push(l);
        _loansOf[agentId].push(loanId);
        a.principalOut += amount;
        a.activeLoans += 1;
        a.lastBorrowAt = uint64(block.timestamp);
        poolLiquidity -= amount;
        totalPrincipalOut += amount;
        emit Borrowed(loanId, agentId, l.backerId, amount, l.fee, l.dueAt, to);
        _notify(l.backerId, abi.encodeWithSelector(ILineHook.onBorrow.selector, l.backerId, agentId, loanId));
        _push(to, amount, asEth);
    }

    function _splitFee(uint256 loanId, Loan storage l) internal {
        uint256 toBacker = l.backerCut + l.premium;
        uint256 toLenders = l.fee - toBacker - l.reserveCut;
        poolLiquidity += toLenders;
        totalFeesEarned += toLenders;
        if (toBacker > 0) {
            backerFees[l.backerId] += toBacker;
            feesFrom[l.backerId][l.agentId] += toBacker;
            unclaimedBackerFees += toBacker;
        }
        if (l.reserveCut > 0) reserve += l.reserveCut;
        emit FeeSplit(loanId, l.backerId, toLenders, toBacker, l.reserveCut);
    }

    /// @notice Anyone can repay, in ETH (send exactly what is due) or WETH. `expectedAgentId` and `maxDue` make
    ///         sure it is the loan the payer meant.
    function repay(uint256 loanId, uint256 expectedAgentId, uint256 maxDue) external payable nonReentrant {
        if (loanId == 0 || loanId >= _loans.length) revert LoanNotActive(loanId);
        Loan storage l = _loans[loanId];
        if (l.status != LoanStatus.Active) revert LoanNotActive(loanId);
        if (l.agentId != expectedAgentId) revert WrongLoan(loanId);
        uint256 due = l.principal + l.fee;
        if (due > maxDue) revert DueTooHigh(due, maxDue);
        _pull(due);

        Agent storage a = _agents[l.agentId];
        l.status = LoanStatus.Repaid;
        l.closedAt = uint64(block.timestamp);
        a.principalOut -= l.principal;
        feeLocked[l.backerId] -= l.fee;
        a.activeLoans -= 1;
        a.lastRepayAt = uint64(block.timestamp);
        totalPrincipalOut -= l.principal;
        poolLiquidity += l.principal;
        _splitFee(loanId, l);

        a.loansRepaid += 1;
        a.volumeRepaid += l.principal;
        a.feesPaid += l.fee;
        uint256 term = l.dueAt - l.issuedAt;
        uint256 held = block.timestamp - l.issuedAt;
        if (held > term) held = term;
        a.ethSecondsRepaid += l.principal * held;
        if (held >= l.minScoreTerm) a.seasonedRepaid += 1;
        emit Repaid(loanId, l.agentId, l.principal, l.fee, msg.sender);

        if (a.defaulted) _settleDead(l.agentId, a);
        else if (a.frozen) _releaseFrozen(l.agentId, a);
    }

    /// @notice Anyone, once a loan is past its grace period. The backer's shares pay the principal and the unpaid
    ///         fee; lenders are untouched, and defaulting on yourself still costs the fee.
    function markDefault(uint256 loanId) external nonReentrant {
        if (loanId == 0 || loanId >= _loans.length) revert LoanNotActive(loanId);
        Loan storage l = _loans[loanId];
        if (l.status != LoanStatus.Active) revert LoanNotActive(loanId);
        if (block.timestamp <= l.defaultableAt) revert LoanNotDue(loanId, l.defaultableAt);

        uint256 p = l.principal;
        uint256 s = l.backerId;
        uint256 agentId = l.agentId;
        uint256 f = l.fee;
        feeLocked[s] -= f;
        uint256 burnt = _slash(s, p, f);

        l.status = LoanStatus.Defaulted;
        l.closedAt = uint64(block.timestamp);
        Agent storage a = _agents[agentId];
        a.principalOut -= p;
        a.activeLoans -= 1;
        a.line -= p;
        a.defaulted = true;
        _agents[s].linesOut -= p;
        _agents[s].backedDefaults += 1;
        if (!custodian[l.owner]) ownerDefaults[l.owner] += 1;
        emit Defaulted(loanId, agentId, s, p, burnt, l.owner);

        _payKeeper();
        _notify(s, abi.encodeWithSelector(ILineHook.onDefault.selector, s, agentId, loanId, p, a.activeLoans == 0));
        _settleDead(agentId, a);
    }

    /// @dev Burns the backer's shares worth `p + f`, rounded up so the share price can only go up. `p` left the pool
    ///      as the loan; `f`, the unpaid fee, stays with the remaining shares.
    function _slash(uint256 s, uint256 p, uint256 f) internal returns (uint256 burn) {
        uint256 ts = totalShares;
        uint256 ta = totalAssets();
        burn = ((p + f) * ts + ta - 1) / ta;
        uint256 held = backerShares[s];
        if (burn > held) {
            // Only reachable through rounding (a fully used backer can end up a unit short). The reserve tops up
            // what keeps the share price from falling; anything it can't cover is recorded, never hidden.
            burn = held;
            uint256 need = p * ts > held * ta ? (p * ts - held * ta + ts - 1) / ts : 0;
            uint256 gap = need < reserve ? need : reserve;
            reserve -= gap;
            poolLiquidity += gap;
            if (need > gap) totalBadDebt += need - gap;
        }
        backerShares[s] = held - burn;
        totalShares = ts - burn;
        totalPrincipalOut -= p;
        totalSlashed += p;
    }

    function _payKeeper() internal {
        uint256 bounty = params.keeperBounty < reserve ? params.keeperBounty : reserve;
        if (bounty > 0) {
            reserve -= bounty;
            emit KeeperPaid(msg.sender, bounty);
            IERC20(address(weth)).safeTransfer(msg.sender, bounty);
        }
    }

    // ------------------------------------------------------------------ hooks

    function _canBorrow(uint256 s, bytes memory args) internal view returns (bool) {
        address h = hook[s];
        if (h == address(0)) return true;
        return CreditCalls.canBorrow(h, abi.encodePacked(ILineHook.canBorrow.selector, args));
    }

    function _notify(uint256 s, bytes memory data) internal {
        address h = hook[s];
        if (h == address(0)) return;
        if (!CreditCalls.notify(h, data)) {
            bytes4 sel;
            assembly {
                sel := mload(add(data, 0x20))
            }
            emit HookFailed(s, sel);
        }
    }

    function _released(uint256 s, uint256 agentId, uint256 amount, Release reason) internal {
        emit LineReleased(s, agentId, amount, reason);
        _notify(s, abi.encodeWithSelector(ILineHook.onRelease.selector, s, agentId, amount, uint8(reason)));
    }

    // ------------------------------------------------------------------ reserve

    function fundReserve(uint256 amount) external payable nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pull(amount);
        reserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    /// @notice Sends the reserve above its small floor to the Trenchers buyback wallet, as ETH. Anyone can call it.
    function reserveToBuyback() external nonReentrant returns (uint256 amount) {
        amount = reserve > RESERVE_FLOOR ? reserve - RESERVE_FLOOR : 0;
        if (amount == 0) revert ZeroAmount();
        reserve -= amount;
        totalToBuyback += amount;
        emit ReserveToBuyback(msg.sender, amount);
        _push(buyback, amount, true);
    }

    /// @notice Owner: turns reserve into backing behind a backer (protocol money as first-loss backing).
    function reserveToBacking(uint256 backerId, uint256 amount) external onlyOwner nonReentrant {
        if (!_agents[backerId].isBacker) revert NotBacker(backerId);
        if (amount == 0) revert ZeroAmount();
        if (amount > reserve) revert ReserveShort(amount, reserve);
        uint256 minted = convertToShares(amount);
        if (minted == 0) revert ZeroAmount();
        reserve -= amount;
        poolLiquidity += amount;
        totalShares += minted;
        backerShares[backerId] += minted;
        emit ReserveStaked(backerId, amount, minted);
    }

    // ------------------------------------------------------------------ owner (a timelock)

    function setCustodian(address who, bool allowed) external onlyOwner {
        custodian[who] = allowed;
        emit CustodianSet(who, allowed);
    }

    function setGuardian(address g) external onlyOwner {
        guardian = g;
        emit GuardianSet(g);
    }

    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    function _setParams(Params memory p) internal {
        if (
            p.minLoan == 0 || p.minLoan > p.maxLoan || p.minTerm == 0 || p.minTerm > p.maxTerm || p.maxTerm > MAX_PERIOD
                || p.grace < MIN_GRACE || p.grace > MAX_PERIOD || p.minScoreTerm > p.maxTerm || p.feeBps > MAX_FEE_BPS
                || p.backerFeeBps + p.reserveFeeBps > 10_000 || p.maxUtilizationBps == 0
                || p.maxUtilizationBps > 10_000 || p.keeperBounty > MAX_KEEPER_BOUNTY
        ) revert InvalidParams();
        params = p;
        emit ParamsUpdated(p);
    }

    // ------------------------------------------------------------------ views

    function getParams() external view returns (Params memory) {
        return params;
    }

    function getAgent(uint256 id) external view returns (Agent memory) {
        return _agents[id];
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return _loans[loanId];
    }

    function loanCount() external view returns (uint256) {
        return _loans.length - 1;
    }

    function loansOf(uint256 id) external view returns (uint256[] memory) {
        return _loansOf[id];
    }

    function loanCountOf(uint256 id) external view returns (uint256) {
        return _loansOf[id].length;
    }

    function loanIdOf(uint256 id, uint256 i) external view returns (uint256) {
        return _loansOf[id][i];
    }
}
