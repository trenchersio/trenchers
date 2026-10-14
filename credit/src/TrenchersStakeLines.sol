// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IAgentRegistry, ILineHook} from "./interfaces/ICreditDeps.sol";
import {TrenchersCreditPool as Pool} from "./TrenchersCreditPool.sol";

/// @title TrenchersStakeLines
/// @notice Stake $TRENCHERS, get an ETH credit line for your agent.
///
///         This contract is a backer in the Trenchers Credit pool, with its own ERC-8004 identity. Its ETH backing
///         (put in by anyone with `fund`, and grown by its share of loan fees) stands behind every line it opens,
///         one for one, so lenders never carry a loss.
///
///         An agent's owner stakes $TRENCHERS and gets a line of `stake / tokensPerEth` ETH, up to `maxLine`. The
///         owner borrows from the pool, and anyone can repay. If a loan defaults, this contract's backing pays the
///         pool and the whole stake is burnt. Closing the line with no loan open gives the whole stake back.
///
///         The owner (a timelock) sets the terms; the guardian can stop new lines and borrows, never exits.
contract TrenchersStakeLines is ILineHook, IERC721Receiver, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant LINE_STEP = 0.001 ether; // lines are whole multiples of this
    uint256 public constant WEEK = 7 days;

    Pool public immutable pool;
    IERC20 public immutable token;
    IAgentRegistry public immutable registry;
    uint256 public immutable backerId;

    address public guardian;
    bool public paused;

    uint256 public tokensPerEth; // $TRENCHERS (wei) staked per 1 ETH of line
    uint256 public maxLine;
    uint64 public maxTerm;
    uint256 public weeklyCap; // new line opened per 7 days
    uint256 public weekStart;
    uint256 public openedThisWeek;

    struct Stake {
        address staker;
        uint256 tokens;
        uint256 line; // what this contract has open for the agent
        uint256 room; // weekly room this stake used (the pool's callbacks never touch it)
        uint64 openedAt;
        bool burnt;
    }

    mapping(uint256 => Stake) public stakes;
    uint256 public totalStaked;
    uint256 public totalBurnt;
    uint256 public linesOpened;

    event Funded(address indexed by, uint256 amount);
    event Opened(uint256 indexed agentId, address indexed staker, uint256 tokens, uint256 line);
    event Added(uint256 indexed agentId, uint256 tokens, uint256 line);
    event Closed(uint256 indexed agentId, address indexed staker, uint256 tokensBack);
    event Burnt(uint256 indexed agentId, uint256 loanId, uint256 tokens);
    event Harvested(uint256 amount);
    event TermsSet(uint256 tokensPerEth, uint256 maxLine, uint64 maxTerm, uint256 weeklyCap);
    event PausedSet(bool paused);
    event GuardianSet(address guardian);

    error NotPool();
    error NotStaker();
    error NotAgentOwner();
    error HasStake();
    error NoStake();
    error StakeBurnt();
    error LineTooSmall(uint256 line);
    error WeeklyCapReached(uint256 room);
    error LoanOpen();
    error IsPaused();
    error NotGuardian();
    error BadTerms();
    error NothingToHarvest();
    error Renounce();

    constructor(
        Pool pool_,
        IERC20 token_,
        address owner_,
        address guardian_,
        uint256 tokensPerEth_,
        uint256 maxLine_,
        uint64 maxTerm_,
        uint256 weeklyCap_,
        string memory agentURI
    ) Ownable(owner_) {
        pool = pool_;
        token = token_;
        registry = pool_.registry();
        guardian = guardian_;
        _setTerms(tokensPerEth_, maxLine_, maxTerm_, weeklyCap_);
        weekStart = block.timestamp;
        // This contract's own identity: the backer the pool sees.
        backerId = registry.register(agentURI);
    }

    receive() external payable {
        if (msg.sender != address(pool)) revert NotPool();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function renounceOwnership() public pure override {
        revert Renounce();
    }

    modifier onlyPool() {
        if (msg.sender != address(pool)) revert NotPool();
        _;
    }

    // ------------------------------------------------------------------ backing

    /// @notice Adds ETH backing. Anyone can; only the owner can take free backing out again.
    function fund() external payable nonReentrant {
        if (msg.value == 0) revert BadTerms();
        Pool.Agent memory me = pool.getAgent(backerId);
        if (!me.isBacker) {
            pool.registerBacker{value: msg.value}(backerId, msg.value);
            pool.setHook(backerId, address(this));
        } else {
            pool.addBacking{value: msg.value}(backerId, msg.value);
        }
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Turns this backer's share of loan fees into more backing. Anyone can call it.
    function harvest() external nonReentrant returns (uint256 amount) {
        amount = pool.backerFees(backerId);
        if (amount == 0) revert NothingToHarvest();
        pool.claimBackerFees(backerId, address(this), true);
        pool.addBacking{value: amount}(backerId, amount);
        emit Harvested(amount);
    }

    // ------------------------------------------------------------------ lines

    /// @notice The line `tokens` of $TRENCHERS would open (before the weekly room).
    function lineFor(uint256 tokens) public view returns (uint256 line) {
        line = tokens * 1 ether / tokensPerEth;
        if (line > maxLine) line = maxLine;
        line -= line % LINE_STEP;
    }

    /// @notice The new line that can still be opened this week.
    function weeklyRoom() public view returns (uint256) {
        if (block.timestamp >= weekStart + WEEK) return weeklyCap;
        return weeklyCap > openedThisWeek ? weeklyCap - openedThisWeek : 0;
    }

    function _useRoom(uint256 amount) internal {
        if (block.timestamp >= weekStart + WEEK) {
            weekStart += ((block.timestamp - weekStart) / WEEK) * WEEK;
            openedThisWeek = 0;
        }
        if (openedThisWeek + amount > weeklyCap) revert WeeklyCapReached(weeklyRoom());
        openedThisWeek += amount;
    }

    /// @notice Stake $TRENCHERS and open a line for your agent. `c` and `sig` are your consent to this backer
    ///         (the pool's EIP-712 Consent with backerId = this contract's identity, premium 0).
    function open(uint256 agentId, uint256 tokens, Pool.Consent calldata c, bytes calldata sig) external nonReentrant {
        if (paused) revert IsPaused();
        if (registry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        Stake storage s = stakes[agentId];
        if (s.tokens != 0 || s.burnt) revert HasStake();
        uint256 line = lineFor(tokens);
        if (line < pool.getParams().minLoan) revert LineTooSmall(line);
        _useRoom(line);
        token.safeTransferFrom(msg.sender, address(this), tokens);
        stakes[agentId] = Stake({staker: msg.sender, tokens: tokens, line: line, room: line, openedAt: uint64(block.timestamp), burnt: false});
        totalStaked += tokens;
        linesOpened += 1;
        pool.openLine(backerId, agentId, line, 0, c, sig);
        emit Opened(agentId, msg.sender, tokens, line);
    }

    /// @notice Stake more behind an open line, and raise it to match.
    function add(uint256 agentId, uint256 tokens) external nonReentrant {
        if (paused) revert IsPaused();
        Stake storage s = stakes[agentId];
        if (s.tokens == 0) revert NoStake();
        if (s.staker != msg.sender || registry.ownerOf(agentId) != msg.sender) revert NotStaker();
        if (pool.getAgent(agentId).backer != backerId) revert NoStake();
        token.safeTransferFrom(msg.sender, address(this), tokens);
        s.tokens += tokens;
        totalStaked += tokens;
        uint256 next = lineFor(s.tokens);
        if (next > s.line) {
            uint256 delta = next - s.line;
            _useRoom(delta);
            s.line = next;
            s.room += delta;
            pool.raiseLine(backerId, agentId, delta);
        }
        emit Added(agentId, tokens, s.line);
    }

    /// @notice Close the line and take the whole stake back. Needs no loan open.
    function close(uint256 agentId) external nonReentrant {
        Stake storage s = stakes[agentId];
        if (s.staker != msg.sender) revert NotStaker();
        if (s.tokens == 0) revert NoStake();
        Pool.Agent memory a = pool.getAgent(agentId);
        uint256 used = s.room;
        if (a.backer == backerId) {
            if (a.activeLoans != 0) revert LoanOpen();
            if (a.line > 0) pool.lowerLine(backerId, agentId, a.line);
        }
        // (6) a default the hook could not act on: the stake is burnt here instead, never handed back
        if (a.defaulted && _defaultedHere(agentId, s)) {
            _burn(agentId, s, 0);
            return;
        }
        // a line opened and closed in the same week gives its room back, so nobody can block the week for free
        if (s.openedAt >= weekStart && block.timestamp < weekStart + WEEK) {
            openedThisWeek = openedThisWeek > used ? openedThisWeek - used : 0;
        }
        uint256 back = s.tokens;
        totalStaked -= back;
        delete stakes[agentId];
        token.safeTransfer(msg.sender, back);
        emit Closed(agentId, msg.sender, back);
    }

    // ------------------------------------------------------------------ the pool's hooks

    /// @notice A borrow needs: not paused, a term within `maxTerm`, and the agent still owned by its staker.
    function canBorrow(uint256, uint256 agentId, uint256, uint64 term, uint256, address, address owner, address)
        external
        view
        returns (bool)
    {
        Stake storage s = stakes[agentId];
        return !paused && term <= maxTerm && s.tokens != 0 && !s.burnt && s.staker == owner;
    }

    function onBorrow(uint256, uint256, uint256) external view onlyPool {}

    /// @notice A default: the pool has already been paid from this contract's backing; the stake is burnt.
    function onDefault(uint256, uint256 agentId, uint256 loanId, uint256, bool) external onlyPool {
        _burn(agentId, stakes[agentId], loanId);
    }

    function _burn(uint256 agentId, Stake storage s, uint256 loanId) internal {
        uint256 t = s.tokens;
        s.burnt = true;
        s.line = 0;
        if (t > 0) {
            s.tokens = 0;
            totalStaked -= t;
            totalBurnt += t;
            token.safeTransfer(DEAD, t);
        }
        emit Burnt(agentId, loanId, t);
    }

    /// @notice Anyone: burns the stake of an agent the pool has marked defaulted, if the hook could not.
    function burnDefaulted(uint256 agentId) external nonReentrant {
        Stake storage s = stakes[agentId];
        if (s.tokens == 0) revert NoStake();
        if (!pool.getAgent(agentId).defaulted || !_defaultedHere(agentId, s)) revert NoStake();
        _burn(agentId, s, 0);
    }

    /// @dev Did a loan this contract backed, taken since this stake was opened, default? Only then is the stake burnt:
    ///      a default under another backer cost this contract nothing.
    function _defaultedHere(uint256 agentId, Stake storage s) internal view returns (bool) {
        // newest first, one loan at a time: older history is never copied
        for (uint256 i = pool.loanCountOf(agentId); i > 0; i--) {
            Pool.Loan memory l = pool.getLoan(pool.loanIdOf(agentId, i - 1));
            if (l.issuedAt < s.openedAt) break;
            if (l.backerId == backerId && l.status == Pool.LoanStatus.Defaulted) return true;
        }
        return false;
    }

    function onRelease(uint256, uint256 agentId, uint256 amount, uint8) external onlyPool {
        Stake storage s = stakes[agentId];
        s.line = s.line > amount ? s.line - amount : 0;
    }

    // ------------------------------------------------------------------ owner and guardian

    function setTerms(uint256 tokensPerEth_, uint256 maxLine_, uint64 maxTerm_, uint256 weeklyCap_) external onlyOwner {
        _setTerms(tokensPerEth_, maxLine_, maxTerm_, weeklyCap_);
    }

    function _setTerms(uint256 tokensPerEth_, uint256 maxLine_, uint64 maxTerm_, uint256 weeklyCap_) internal {
        if (tokensPerEth_ == 0 || maxLine_ < LINE_STEP || maxTerm_ == 0 || weeklyCap_ < maxLine_) revert BadTerms();
        tokensPerEth = tokensPerEth_;
        maxLine = maxLine_;
        maxTerm = maxTerm_;
        weeklyCap = weeklyCap_;
        emit TermsSet(tokensPerEth_, maxLine_, maxTerm_, weeklyCap_);
    }

    /// @notice Owner: takes backing that stands behind nothing out of the pool, as ETH.
    function unlockBacking(uint256 shares, address to) external onlyOwner nonReentrant {
        pool.unlockBacking(backerId, shares, to, true);
    }

    /// @notice Owner: stops new borrowing on one line (open loans run to term).
    function freeze(uint256 agentId, bool frozen) external onlyOwner nonReentrant {
        pool.freezeLine(agentId, frozen);
    }

    function setPaused(bool p) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused = p;
        emit PausedSet(p);
    }

    function setGuardian(address g) external onlyOwner {
        guardian = g;
        emit GuardianSet(g);
    }

    // ------------------------------------------------------------------ views

    /// @notice An agent's stake and line, with what the pool says about it.
    function position(uint256 agentId)
        external
        view
        returns (Stake memory s, uint256 lineInPool, uint256 drawn, uint256 activeLoans, bool backedHere)
    {
        s = stakes[agentId];
        Pool.Agent memory a = pool.getAgent(agentId);
        backedHere = a.backer == backerId;
        lineInPool = backedHere ? a.line : 0;
        drawn = a.principalOut;
        activeLoans = a.activeLoans;
    }

    /// @notice This backer's ETH: all of it, what stands behind lines, and what is free.
    function backingInfo() external view returns (uint256 total, uint256 used, uint256 free, uint256 feesWaiting) {
        total = pool.backing(backerId);
        free = pool.freeBacking(backerId);
        used = total > free ? total - free : 0;
        feesWaiting = pool.backerFees(backerId);
    }
}
