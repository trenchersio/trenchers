// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RevenueSplitter
/// @notice Single receiving address for Trenchers primary-sale proceeds and secondary royalties.
///
///         Primary sales: all 1,995 public Trenchers are minted free to a treasury wallet and listed
///         on OpenSea at 0.02 ETH. ETH the treasury forwards here counts as primary-sale proceeds:
///           51% to the Agent Starter Fund, which pays each buyer's agent a 0.01 ETH starter
///               balance (the extra 1% covers marketplace fees; the fund returns any surplus to
///               buybacks), and the rest to the ecosystem:
///           50% buybacks, 20% development (immediate), 20% development (vested linearly
///           over VEST_DURATION), 10% prize pool.
///         Royalties (ETH from anyone else, and any ERC-20 such as WETH): 100% buybacks.
///
/// @dev    Amounts are owed to *buckets*, not addresses, so a bucket's destination can be
///         changed (behind a timelock) without misrouting what is already owed. Release is
///         permissionless pull: anyone can push a bucket's owed balance to its destination.
///         The buyback vault and prize pool are built in a later milestone; until their
///         destinations are set, those buckets simply accrue.
contract RevenueSplitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Bucket { Buyback, Dev, Prize, Starter }

    uint256 public constant BPS = 10_000;
    uint256 public constant PRIMARY_STARTER_BPS = 5_100; // of the primary sale, to the Agent Starter Fund
    // The rest of the primary sale (the ecosystem half) is split:
    uint256 public constant PRIMARY_BUYBACK_BPS = 5_000;
    uint256 public constant PRIMARY_DEV_NOW_BPS = 2_000;
    uint256 public constant PRIMARY_DEV_VESTED_BPS = 2_000;
    uint256 public constant PRIMARY_PRIZE_BPS = 1_000;
    uint256 public constant VEST_DURATION = 180 days;
    uint256 public constant TIMELOCK = 48 hours;

    /// @notice The treasury wallet that lists the NFTs; ETH from it counts as primary-sale proceeds.
    address public primarySeller;
    uint256 public immutable vestStart;

    mapping(Bucket => address payable) public destination;
    mapping(Bucket => uint256) public owed; // ETH ready to release
    uint256 public vestedTotal;    // cumulative ETH placed into dev vesting
    uint256 public vestedReleased; // ETH moved from vesting into the Dev bucket

    // Totals for public verification.
    uint256 public totalPrimarySales;
    uint256 public totalRoyalties;
    mapping(Bucket => uint256) public totalReleased;

    struct Pending { address payable to; uint64 eta; }
    mapping(Bucket => Pending) public pendingDestination;

    event PrimarySellerSet(address seller);
    event PrimarySaleReceived(uint256 amount);
    event RoyaltyReceived(address indexed from, uint256 amount);
    event Released(Bucket indexed bucket, address indexed to, uint256 amount);
    event TokenReleased(address indexed token, address indexed to, uint256 amount);
    event DestinationProposed(Bucket indexed bucket, address to, uint256 eta);
    event DestinationSet(Bucket indexed bucket, address to);

    error AlreadySet();
    error ZeroAddress();
    error NoDestination();
    error NothingOwed();
    error TooEarly();
    error NoPending();
    error TransferFailed();

    /// @param owner_   Initial owner (the deployer, who sets the primary seller and then hands ownership to the Safe).
    /// @param devSafe  Destination of the Dev bucket.
    /// @param vestStart_ Start of the dev vesting schedule (normally the listing date).
    constructor(address owner_, address payable devSafe, uint256 vestStart_) {
        if (owner_ == address(0) || devSafe == address(0)) revert ZeroAddress();
        _transferOwnership(owner_);
        destination[Bucket.Dev] = devSafe;
        vestStart = vestStart_;
        emit DestinationSet(Bucket.Dev, devSafe);
    }

    /// @notice One-time setting of the treasury wallet whose ETH counts as primary-sale proceeds.
    function setPrimarySeller(address seller) external onlyOwner {
        if (primarySeller != address(0)) revert AlreadySet();
        if (seller == address(0)) revert ZeroAddress();
        primarySeller = seller;
        emit PrimarySellerSet(seller);
    }

    receive() external payable {
        if (msg.sender == primarySeller && primarySeller != address(0)) {
            uint256 starter = (msg.value * PRIMARY_STARTER_BPS) / BPS;
            uint256 eco = msg.value - starter;
            uint256 dev = (eco * PRIMARY_DEV_NOW_BPS) / BPS;
            uint256 vest = (eco * PRIMARY_DEV_VESTED_BPS) / BPS;
            uint256 prize = (eco * PRIMARY_PRIZE_BPS) / BPS;
            owed[Bucket.Starter] += starter;
            owed[Bucket.Dev] += dev;
            owed[Bucket.Prize] += prize;
            vestedTotal += vest;
            owed[Bucket.Buyback] += eco - dev - vest - prize; // rounding dust to buybacks
            totalPrimarySales += msg.value;
            emit PrimarySaleReceived(msg.value);
        } else {
            owed[Bucket.Buyback] += msg.value;
            totalRoyalties += msg.value;
            emit RoyaltyReceived(msg.sender, msg.value);
        }
    }

    // ------------------------------------------------------------------ vesting

    function vestedReleasable() public view returns (uint256) {
        uint256 elapsed = block.timestamp > vestStart ? block.timestamp - vestStart : 0;
        uint256 unlocked = elapsed >= VEST_DURATION ? vestedTotal : (vestedTotal * elapsed) / VEST_DURATION;
        return unlocked - vestedReleased;
    }

    // ------------------------------------------------------------------ release

    /// @notice Pays a bucket's owed ETH to its destination. Callable by anyone.
    function release(Bucket bucket) public nonReentrant {
        if (bucket == Bucket.Dev) {
            uint256 v = vestedReleasable();
            if (v > 0) {
                vestedReleased += v;
                owed[Bucket.Dev] += v;
            }
        }
        address payable to = destination[bucket];
        if (to == address(0)) revert NoDestination();
        uint256 amount = owed[bucket];
        if (amount == 0) revert NothingOwed();
        owed[bucket] = 0;
        totalReleased[bucket] += amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Released(bucket, to, amount);
    }

    /// @notice ERC-20 royalties (e.g. WETH) go entirely to the buyback destination.
    function releaseToken(IERC20 token) external nonReentrant {
        address to = destination[Bucket.Buyback];
        if (to == address(0)) revert NoDestination();
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert NothingOwed();
        token.safeTransfer(to, amount);
        emit TokenReleased(address(token), to, amount);
    }

    // ------------------------------------------------------------------ destinations

    /// @notice First-time setting of an empty destination happens immediately (nothing can be
    ///         misdirected yet, since the bucket has never paid out); changes need the timelock.
    function proposeDestination(Bucket bucket, address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (destination[bucket] == address(0)) {
            destination[bucket] = to;
            emit DestinationSet(bucket, to);
            return;
        }
        uint64 eta = uint64(block.timestamp + TIMELOCK);
        pendingDestination[bucket] = Pending(to, eta);
        emit DestinationProposed(bucket, to, eta);
    }

    function executeDestination(Bucket bucket) external onlyOwner {
        Pending memory p = pendingDestination[bucket];
        if (p.to == address(0)) revert NoPending();
        if (block.timestamp < p.eta) revert TooEarly();
        delete pendingDestination[bucket];
        destination[bucket] = p.to;
        emit DestinationSet(bucket, p.to);
    }

    function cancelDestination(Bucket bucket) external onlyOwner {
        delete pendingDestination[bucket];
    }
}
