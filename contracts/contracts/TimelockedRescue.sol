// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TimelockedRescue
/// @notice Safety net for contracts that pool ETH for many people (the Agent Starter Fund and the
///         Agent Fee Distributor). If something breaks so the normal paths can no longer pay out, the
///         owner (the team Safe) can move everything out, but only in public and only after a delay:
///           1. proposeRescue(to): announced on-chain, starts the delay (48 hours on mainnet);
///           2. executeRescue(tokens): after the delay, sends all ETH and the listed tokens to `to`
///              and shuts the contract down for good.
///         The owner can cancel a proposal at any time. Everyone can watch for RescueProposed, so a
///         rescue can never happen silently or instantly.
abstract contract TimelockedRescue is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Seconds between proposing and executing a rescue (immutable; 48 hours on mainnet).
    uint256 public immutable rescueDelay;
    uint256 public constant MAX_RESCUE_DELAY = 7 days;

    address public rescueTo;
    uint64 public rescueEta;
    /// @notice Set by a completed rescue; the contract's normal functions stop for good.
    bool public shutdown;

    event RescueProposed(address indexed to, uint256 eta);
    event RescueCancelled();
    event Rescued(address indexed to, uint256 eth);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error RescueDelayTooLong();
    error RescueDelayTooShort();
    error NoRescue();
    error RescueTooEarly();
    error IsShutdown();
    error RescueFailed();

    /// @dev Robinhood Chain mainnet: the public delay can't be shorter than 48 hours.
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    uint256 public constant MAINNET_MIN_RESCUE_DELAY = 48 hours;

    constructor(uint256 rescueDelay_) {
        if (rescueDelay_ > MAX_RESCUE_DELAY) revert RescueDelayTooLong();
        if (block.chainid == MAINNET_CHAIN_ID && rescueDelay_ < MAINNET_MIN_RESCUE_DELAY) revert RescueDelayTooShort();
        rescueDelay = rescueDelay_;
    }

    modifier notShutdown() {
        if (shutdown) revert IsShutdown();
        _;
    }

    function proposeRescue(address to) external onlyOwner {
        if (to == address(0)) revert NoRescue();
        rescueTo = to;
        rescueEta = uint64(block.timestamp + rescueDelay);
        emit RescueProposed(to, rescueEta);
    }

    function cancelRescue() external onlyOwner {
        delete rescueTo;
        delete rescueEta;
        emit RescueCancelled();
    }

    /// @notice After the delay: sends all ETH and the balances of `tokens` to the proposed address.
    function executeRescue(address[] calldata tokens) external onlyOwner {
        address to = rescueTo;
        if (to == address(0)) revert NoRescue();
        if (block.timestamp < rescueEta) revert RescueTooEarly();
        shutdown = true;
        delete rescueTo;
        delete rescueEta;
        for (uint256 i; i < tokens.length; ++i) {
            uint256 amount = IERC20(tokens[i]).balanceOf(address(this));
            if (amount > 0) {
                IERC20(tokens[i]).safeTransfer(to, amount);
                emit TokenRescued(tokens[i], to, amount);
            }
        }
        uint256 eth = address(this).balance;
        (bool ok, ) = to.call{value: eth}("");
        if (!ok) revert RescueFailed();
        emit Rescued(to, eth);
    }
}

/// @title InstantRescue
/// @notice For contracts that should never hold funds between calls (the NFT, the Pons adapter): the
///         owner can sweep anything that ends up there by mistake, straight away.
abstract contract InstantRescue {
    using SafeERC20 for IERC20;

    event Swept(address indexed token, address indexed to, uint256 amount);
    error SweepFailed();

    function _rescueOwner() internal view virtual returns (address);

    /// @notice Sends this contract's ETH (token = 0) or token balance to `to`. Owner only.
    function sweep(address token, address to) external {
        if (msg.sender != _rescueOwner() || to == address(0)) revert SweepFailed();
        uint256 amount;
        if (token == address(0)) {
            amount = address(this).balance;
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert SweepFailed();
        } else {
            amount = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(to, amount);
        }
        emit Swept(token, to, amount);
    }
}
