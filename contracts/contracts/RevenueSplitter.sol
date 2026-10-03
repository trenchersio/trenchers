// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RevenueSplitter
/// @notice Single receiving address for Trenchers mint proceeds and secondary royalties.
///
///         Mint proceeds (ETH sent by the NFT contract):
///           50% buybacks, 20% development (immediate), 20% development (vested linearly
///           over VEST_DURATION), 10% prize pool.
///         Royalties (any other ETH, and any ERC-20 such as WETH): 100% buybacks.
///
/// @dev    Amounts are owed to *buckets*, not addresses, so a bucket's destination can be
///         changed (behind a timelock) without misrouting what is already owed. Release is
///         permissionless pull: anyone can push a bucket's owed balance to its destination.
///         The buyback vault and prize pool are built in a later milestone; until their
///         destinations are set, those buckets simply accrue.
contract RevenueSplitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Bucket { Buyback, Dev, Prize }

    uint256 public constant BPS = 10_000;
    uint256 public constant MINT_BUYBACK_BPS = 5_000;
    uint256 public constant MINT_DEV_NOW_BPS = 2_000;
    uint256 public constant MINT_DEV_VESTED_BPS = 2_000;
    uint256 public constant MINT_PRIZE_BPS = 1_000;
    uint256 public constant VEST_DURATION = 180 days;
    uint256 public constant TIMELOCK = 48 hours;

    /// @notice The NFT contract; ETH from it is treated as mint proceeds.
    address public nft;
    uint256 public immutable vestStart;

    mapping(Bucket => address payable) public destination;
    mapping(Bucket => uint256) public owed; // ETH ready to release
    uint256 public vestedTotal;    // cumulative ETH placed into dev vesting
    uint256 public vestedReleased; // ETH moved from vesting into the Dev bucket

    // Totals for public verification.
    uint256 public totalMintProceeds;
    uint256 public totalRoyalties;
    mapping(Bucket => uint256) public totalReleased;

    struct Pending { address payable to; uint64 eta; }
    mapping(Bucket => Pending) public pendingDestination;

    event NftSet(address nft);
    event MintProceedsReceived(uint256 amount);
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

    /// @param owner_   Initial owner (the deployer, who links the NFT and then hands ownership to the Safe).
    /// @param devSafe  Destination of the Dev bucket.
    /// @param vestStart_ Start of the dev vesting schedule (normally the mint date).
    constructor(address owner_, address payable devSafe, uint256 vestStart_) {
        if (owner_ == address(0) || devSafe == address(0)) revert ZeroAddress();
        _transferOwnership(owner_);
        destination[Bucket.Dev] = devSafe;
        vestStart = vestStart_;
        emit DestinationSet(Bucket.Dev, devSafe);
    }

    /// @notice One-time link to the NFT contract (deployed after the splitter).
    function setNft(address nft_) external onlyOwner {
        if (nft != address(0)) revert AlreadySet();
        if (nft_ == address(0)) revert ZeroAddress();
        nft = nft_;
        emit NftSet(nft_);
    }

    receive() external payable {
        if (msg.sender == nft && nft != address(0)) {
            uint256 dev = (msg.value * MINT_DEV_NOW_BPS) / BPS;
            uint256 vest = (msg.value * MINT_DEV_VESTED_BPS) / BPS;
            uint256 prize = (msg.value * MINT_PRIZE_BPS) / BPS;
            owed[Bucket.Dev] += dev;
            owed[Bucket.Prize] += prize;
            vestedTotal += vest;
            owed[Bucket.Buyback] += msg.value - dev - vest - prize; // rounding dust to buybacks
            totalMintProceeds += msg.value;
            emit MintProceedsReceived(msg.value);
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
